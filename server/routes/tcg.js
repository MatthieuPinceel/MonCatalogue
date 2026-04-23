'use strict';

const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const { getDb } = require('../db/init');
const cache    = require('../services/cache');
const logger   = require('../services/logger');

const POKEMON_BASE = 'https://api.pokemontcg.io/v2';
const LORCANA_BASE = process.env.LORCANA_API_BASE || 'https://api.lorcast.com/v0';

const http = axios.create({ timeout: 15000 });

// Fetch natif (undici) pour l'API PokémonTCG — fingerprint TLS différent d'axios
// ce qui contourne les blocages Cloudflare qui ciblent le TLS de Node https/axios.
async function pokemonFetch(path, extraHeaders = {}, retries = 2) {
  const url = `${POKEMON_BASE}${path}`;
  const headers = {
    'Accept': 'application/json',
    ...(process.env.POKEMON_TCG_API_KEY ? { 'X-Api-Key': process.env.POKEMON_TCG_API_KEY } : {}),
    ...extraHeaders
  };
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    try {
      const res = await fetch(url, { headers, signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
      return await res.json();
    } catch (err) {
      clearTimeout(timer);
      if (attempt < retries) {
        logger.warn(`[TCG/Pokemon] Retry ${attempt + 1}/${retries} — ${err.message}`);
        await new Promise(r => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ---------------------------------------------------------------
// POKEMON
// ---------------------------------------------------------------

/** GET /api/tcg/pokemon/sets  — liste des sets Pokémon */
router.get('/pokemon/sets', async (req, res) => {
  const cacheKey = 'pokemon_sets';
  const cached   = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const data = await pokemonFetch('/sets?orderBy=-releaseDate');
    const sets = data.data || [];
    cache.set(cacheKey, sets, 3600);
    res.json(sets);
  } catch (err) {
    logger.error(`[TCG/Pokemon/sets] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/tcg/pokemon/cards?set=sv7&name=Pikachu  — recherche cartes */
router.get('/pokemon/cards', async (req, res) => {
  const { set, name, page = 1 } = req.query;
  const cacheKey = `pokemon_cards_${set}_${name}_${page}`;
  const cached   = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    let q = '';
    if (set)  q += `set.id:${set} `;
    if (name) q += `name:"${name.replace(/"/g, '\\"')}"`;
    const qs = new URLSearchParams({ page, pageSize: 36, orderBy: 'number' });
    if (q.trim()) qs.set('q', q.trim());

    const data = await pokemonFetch(`/cards?${qs}`);
    cache.set(cacheKey, data, 1800);
    res.json(data);
  } catch (err) {
    logger.error(`[TCG/Pokemon/cards] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// LORCANA
// ---------------------------------------------------------------

/** GET /api/tcg/lorcana/sets */
router.get('/lorcana/sets', async (req, res) => {
  const cacheKey = 'lorcana_sets';
  const cached   = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const { data } = await http.get(`${LORCANA_BASE}/sets`);
    cache.set(cacheKey, data, 3600);
    res.json(data);
  } catch (err) {
    logger.error(`[TCG/Lorcana/sets] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/tcg/lorcana/cards?set=TFC&ink=Amber&rarity=Legendary */
router.get('/lorcana/cards', async (req, res) => {
  const { set, ink, rarity, name } = req.query;
  const cacheKey = `lorcana_cards_${set}_${ink}_${rarity}_${name}`;
  const cached   = cache.get(cacheKey);
  if (cached) return res.json(cached);

  try {
    const params = {};
    if (set)    params.set    = set;
    if (ink)    params.ink    = ink;
    if (rarity) params.rarity = rarity;
    if (name)   params.name   = name;
    const { data } = await http.get(`${LORCANA_BASE}/cards`, { params });
    cache.set(cacheKey, data, 1800);
    res.json(data);
  } catch (err) {
    logger.error(`[TCG/Lorcana/cards] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// COLLECTION
// ---------------------------------------------------------------

/** GET /api/tcg/collection?game=pokemon */
router.get('/collection', (req, res) => {
  try {
    const db     = getDb();
    const { game } = req.query;
    let sql  = 'SELECT * FROM tcg_collection';
    const args = [];
    if (game) { sql += ' WHERE game = ?'; args.push(game); }
    sql += ' ORDER BY game, set_name, card_name';
    const rows = db.prepare(sql).all(...args);

    const valueSql = game
      ? 'SELECT COALESCE(SUM(market_price * quantity),0) as total FROM tcg_collection WHERE game = ?'
      : 'SELECT COALESCE(SUM(market_price * quantity),0) as total FROM tcg_collection';
    const { total } = db.prepare(valueSql).get(...args);

    res.json({ total_value: total, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/tcg/collection — ajouter une carte */
router.post('/collection', (req, res) => {
  try {
    const db = getDb();
    const { game, card_id, set_id, set_name, card_name, rarity, condition = 'NM',
            quantity = 1, price_paid, notes } = req.body;
    if (!game || !card_id || !card_name) {
      return res.status(400).json({ error: 'game, card_id, card_name sont requis' });
    }
    const result = db.prepare(`
      INSERT INTO tcg_collection (game, card_id, set_id, set_name, card_name, rarity,
        condition, quantity, price_paid, notes, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(game, card_id, condition) DO UPDATE SET
        quantity  = quantity + excluded.quantity,
        notes     = excluded.notes
    `).run(game, card_id, set_id, set_name, card_name, rarity, condition, quantity, price_paid, notes);
    // Récupère l'ID réel (lastInsertRowid = 0 en cas de UPDATE avec SQLite < 3.35)
    const row = db.prepare('SELECT id FROM tcg_collection WHERE game=? AND card_id=? AND condition=?').get(game, card_id, condition);
    res.json({ id: row?.id ?? result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/tcg/collection/:id */
router.delete('/collection/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM tcg_collection WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/tcg/missing?game=pokemon&set=sv7 — cartes manquantes */
router.get('/missing', async (req, res) => {
  const { game, set } = req.query;
  if (!game || !set) {
    return res.status(400).json({ error: 'game et set sont requis' });
  }

  try {
    const db    = getDb();
    const owned = new Set(
      db.prepare('SELECT card_id FROM tcg_collection WHERE game = ? AND set_id = ?')
        .all(game, set).map(r => r.card_id)
    );

    let allCards = [];
    if (game === 'pokemon') {
      // L'API Pokémon TCG limite pageSize à 250 — on pagine pour les grands sets
      let page = 1;
      while (true) {
        const data = await pokemonFetch(`/cards?q=set.id:${set}&pageSize=250&page=${page}`);
        const cards = data.data || [];
        allCards = allCards.concat(cards.map(c => ({ id: c.id, name: c.name, number: c.number, rarity: c.rarity })));
        if (cards.length < 250) break;
        page++;
      }
    } else if (game === 'lorcana') {
      const { data } = await http.get(`${LORCANA_BASE}/cards?set=${set}`);
      allCards = (data.results || data || []).map(c => ({ id: c.id, name: c.name, rarity: c.rarity }));
    }

    const missing = allCards.filter(c => !owned.has(String(c.id)));
    res.json({ set, game, total: allCards.length, owned: owned.size, missing: missing.length, data: missing });
  } catch (err) {
    logger.error(`[TCG/missing] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/tcg/export?game=pokemon  — export CSV */
router.get('/export', (req, res) => {
  try {
    const db     = getDb();
    const { game } = req.query;
    const sql  = game
      ? 'SELECT * FROM tcg_collection WHERE game = ? ORDER BY game, set_name, card_name'
      : 'SELECT * FROM tcg_collection ORDER BY game, set_name, card_name';
    const rows = game ? db.prepare(sql).all(game) : db.prepare(sql).all();

    const header = 'game,card_id,set_id,set_name,card_name,rarity,condition,quantity,price_paid,market_price,notes\n';
    const csv    = rows.map(r =>
      [r.game, r.card_id, r.set_id, r.set_name, r.card_name, r.rarity,
       r.condition, r.quantity, r.price_paid, r.market_price, r.notes || '']
        .map(v => `"${String(v || '').replace(/"/g, '""')}"`)
        .join(',')
    ).join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tcg_collection_${game || 'all'}.csv"`);
    res.send('﻿' + header + csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// WISHLIST TCG — cartes + produits scellés
// NOTE: /wishlist/prices DOIT être déclaré avant /wishlist/:id
// ---------------------------------------------------------------

/**
 * GET /api/tcg/wishlist/prices
 * Retourne la wishlist enrichie des meilleures offres trouvées dans promos.
 */
router.get('/wishlist/prices', (req, res) => {
  try {
    const db    = getDb();
    const { game } = req.query;
    let sql = 'SELECT * FROM tcg_wishlist';
    const args = [];
    if (game) { sql += ' WHERE game = ?'; args.push(game); }
    sql += ' ORDER BY game, product_type, name';
    const items = db.prepare(sql).all(...args);

    const results = items.map(item => {
      const words = item.name.split(/\s+/).filter(w => w.length > 2).slice(0, 4);
      if (!words.length) return { ...item, offers: [] };

      const placeholders = words.map(() => 'title LIKE ?').join(' OR ');
      const likeArgs = words.map(w => `%${w}%`);

      const offers = db.prepare(
        `SELECT source, title, price, original_price, discount_percent, url, image_url, scraped_at
         FROM promos
         WHERE (${placeholders}) AND category = 'TCG'
         ORDER BY price ASC`
      ).all(...likeArgs);

      return { ...item, offers };
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/tcg/wishlist */
router.get('/wishlist', (req, res) => {
  try {
    const db   = getDb();
    const { game } = req.query;
    let sql = 'SELECT * FROM tcg_wishlist';
    const args = [];
    if (game) { sql += ' WHERE game = ?'; args.push(game); }
    sql += ' ORDER BY game, product_type, name';
    res.json(db.prepare(sql).all(...args));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/tcg/wishlist */
router.post('/wishlist', (req, res) => {
  try {
    const db = getDb();
    const { game, product_type, name, set_name, target_price, image_url, notes } = req.body;
    if (!game || !product_type || !name) {
      return res.status(400).json({ error: 'game, product_type et name sont requis' });
    }
    const result = db.prepare(`
      INSERT INTO tcg_wishlist (game, product_type, name, set_name, target_price, image_url, notes, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(game, product_type, name, set_name || null, target_price || null, image_url || null, notes || null);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/tcg/wishlist/:id */
router.put('/wishlist/:id', (req, res) => {
  try {
    const db = getDb();
    const { game, product_type, name, set_name, target_price, image_url, notes } = req.body;
    if (!game || !product_type || !name) {
      return res.status(400).json({ error: 'game, product_type et name sont requis' });
    }
    const result = db.prepare(`
      UPDATE tcg_wishlist SET game=?, product_type=?, name=?, set_name=?, target_price=?, image_url=?, notes=?
      WHERE id=?
    `).run(game, product_type, name, set_name || null, target_price || null, image_url || null, notes || null, req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Élément non trouvé' });
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/tcg/wishlist/:id */
router.delete('/wishlist/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM tcg_wishlist WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
