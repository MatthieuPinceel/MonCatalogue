'use strict';

const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const { getDb } = require('../db/init');
const logger   = require('../services/logger');

const REBRICKABLE_KEY = process.env.REBRICKABLE_API_KEY;
const rbHttp = axios.create({ timeout: 10000, baseURL: 'https://rebrickable.com/api/v3/lego' });

/**
 * GET /api/lego/lookup/:setNumber
 * Cherche un set sur Rebrickable et retourne ses infos (nom, thème, pièces, image, prix).
 */
router.get('/lookup/:setNumber', async (req, res) => {
  if (!REBRICKABLE_KEY) return res.status(503).json({ error: 'REBRICKABLE_API_KEY non configurée' });
  const num = req.params.setNumber.replace(/[^0-9\-]/g, '');
  const setId = num.includes('-') ? num : `${num}-1`;
  try {
    const { data } = await rbHttp.get(`/sets/${setId}/`, {
      headers: { Authorization: `key ${REBRICKABLE_KEY}` }
    });
    res.json({
      set_number:   data.set_num.replace(/-\d+$/, ''),
      name:         data.name,
      theme:        data.theme_id ? null : null, // résolu séparément
      pieces:       data.num_parts,
      retail_price: data.retail_price || null,
      image_url:    data.set_img_url,
      year:         data.year,
      rebrickable_url: data.set_url
    });
  } catch (err) {
    if (err.response?.status === 404) return res.status(404).json({ error: 'Set non trouvé' });
    logger.error(`[Lego/lookup] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/lego/collection */
router.get('/collection', (req, res) => {
  try {
    const db   = getDb();
    const { theme, status = 'owned' } = req.query;
    let sql  = 'SELECT * FROM lego_collection WHERE 1=1';
    const args = [];
    if (status) { sql += ' AND status = ?'; args.push(status); }
    if (theme)  { sql += ' AND theme LIKE ?'; args.push(`%${theme}%`); }
    sql += ' ORDER BY date_added DESC';
    const rows = db.prepare(sql).all(...args);

    const total_paid  = rows.reduce((s, r) => s + (r.price_paid  || 0), 0);
    const total_retail = rows.reduce((s, r) => s + (r.retail_price || 0), 0);

    res.json({ count: rows.length, total_paid, total_retail, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/lego/collection — ajouter un set */
router.post('/collection', (req, res) => {
  try {
    const db = getDb();
    const { set_number, name, theme, pieces, price_paid, retail_price, status = 'owned', notes, image_url } = req.body;
    if (!set_number || !name) {
      return res.status(400).json({ error: 'set_number et name sont requis' });
    }
    const result = db.prepare(`
      INSERT INTO lego_collection (set_number, name, theme, pieces, price_paid, retail_price,
        date_added, status, notes, image_url)
      VALUES (?, ?, ?, ?, ?, ?, date('now'), ?, ?, ?)
      ON CONFLICT(set_number) DO UPDATE SET
        name         = excluded.name,
        theme        = excluded.theme,
        pieces       = excluded.pieces,
        price_paid   = excluded.price_paid,
        retail_price = excluded.retail_price,
        status       = excluded.status,
        notes        = excluded.notes
    `).run(set_number, name, theme, pieces, price_paid, retail_price, status, notes, image_url);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/lego/collection/:id */
router.put('/collection/:id', (req, res) => {
  try {
    const db = getDb();
    const { name, theme, pieces, price_paid, retail_price, status, notes } = req.body;
    db.prepare(`
      UPDATE lego_collection
      SET name=?, theme=?, pieces=?, price_paid=?, retail_price=?, status=?, notes=?
      WHERE id=?
    `).run(name, theme, pieces, price_paid, retail_price, status, notes, req.params.id);
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/lego/collection/:id */
router.delete('/collection/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM lego_collection WHERE id = ?').run(req.params.id);
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/lego/themes — liste des thèmes */
router.get('/themes', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT DISTINCT theme, COUNT(*) as count FROM lego_collection GROUP BY theme').all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/lego/wishlist/prices
 * Retourne les items wishlist enrichis des meilleures offres trouvées dans promos.
 */
router.get('/wishlist/prices', (req, res) => {
  try {
    const db       = getDb();
    const wishlist = db.prepare("SELECT * FROM lego_collection WHERE status = 'wishlist' ORDER BY name").all();

    const results = wishlist.map(item => {
      // Chercher dans promos par numéro de set OU mots du nom
      const words = item.name.split(' ').filter(w => w.length > 3).slice(0, 3);
      const patterns = [item.set_number, ...words];
      const placeholders = patterns.map(() => "title LIKE ?").join(' OR ');
      const args = patterns.map(p => `%${p}%`);

      const offers = db.prepare(
        `SELECT source, title, price, original_price, discount_percent, url, image_url, scraped_at
         FROM promos
         WHERE (${placeholders}) AND category = 'Lego'
         ORDER BY price ASC LIMIT 5`
      ).all(...args);

      return { ...item, offers };
    });

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/lego/stats */
router.get('/stats', (req, res) => {
  try {
    const db    = getDb();
    const stats = {
      total:        db.prepare("SELECT COUNT(*) as n FROM lego_collection WHERE status='owned'").get().n,
      wishlist:     db.prepare("SELECT COUNT(*) as n FROM lego_collection WHERE status='wishlist'").get().n,
      total_spent:  db.prepare("SELECT COALESCE(SUM(price_paid),0) as t FROM lego_collection WHERE status='owned'").get().t,
      by_theme:     db.prepare("SELECT theme, COUNT(*) as n, SUM(price_paid) as spent FROM lego_collection WHERE status='owned' GROUP BY theme ORDER BY n DESC").all(),
      recent:       db.prepare("SELECT * FROM lego_collection ORDER BY date_added DESC LIMIT 5").all()
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
