'use strict';

const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const { getDb } = require('../db/init');
const cache    = require('../services/cache');
const logger   = require('../services/logger');

const STEAM_API_KEY = process.env.STEAM_API_KEY;
const STEAM_ID      = process.env.STEAM_ID;

const http = axios.create({ timeout: 10000 });

// ---------------------------------------------------------------
// GET /api/steam/library
// Retourne la bibliothèque Steam depuis la DB (fraîcheur < 6h) ou l'API.
// ---------------------------------------------------------------
router.get('/library', async (req, res) => {
  try {
    const cached = cache.get('steam_library');
    if (cached) return res.json(cached);

    const db  = getDb();
    const age = db.prepare(
      "SELECT MAX(updated_at) as last FROM steam_library"
    ).get();

    // Si données en base < 6h, on les renvoie directement
    if (age?.last) {
      const diff = (Date.now() - new Date(age.last).getTime()) / 3600000;
      if (diff < 6) {
        const rows = db.prepare('SELECT * FROM steam_library ORDER BY playtime_forever DESC').all();
        cache.set('steam_library', rows, 3600);
        return res.json(rows);
      }
    }

    // Sinon fetch depuis l'API Steam
    const fresh = await fetchSteamLibrary();
    cache.set('steam_library', fresh, 3600);
    res.json(fresh);
  } catch (err) {
    logger.error(`[/api/steam/library] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// GET /api/steam/wishlist
// Retourne la wishlist Steam.
// ---------------------------------------------------------------
router.get('/wishlist', async (req, res) => {
  try {
    const cached = cache.get('steam_wishlist');
    if (cached) return res.json(cached);

    const db  = getDb();
    const age = db.prepare("SELECT MAX(updated_at) as last FROM steam_wishlist").get();

    if (age?.last) {
      const diff = (Date.now() - new Date(age.last).getTime()) / 3600000;
      if (diff < 6) {
        const rows = db.prepare('SELECT * FROM steam_wishlist ORDER BY name ASC').all();
        cache.set('steam_wishlist', rows, 3600);
        return res.json(rows);
      }
    }

    const fresh = await fetchSteamWishlist();
    cache.set('steam_wishlist', fresh, 3600);
    res.json(fresh);
  } catch (err) {
    logger.error(`[/api/steam/wishlist] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// POST /api/steam/refresh
// Force la mise à jour depuis l'API Steam.
// ---------------------------------------------------------------
router.post('/refresh', async (req, res) => {
  try {
    logger.info('[Steam] Refresh manuel déclenché');
    const [library, wishlist] = await Promise.all([
      fetchSteamLibrary(),
      fetchSteamWishlist()
    ]);
    cache.del('steam_library');
    cache.del('steam_wishlist');
    res.json({
      library:  library.length,
      wishlist: wishlist.length
    });
  } catch (err) {
    logger.error(`[/api/steam/refresh] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// GET /api/steam/stats
// Stats rapides pour le dashboard.
// ---------------------------------------------------------------
router.get('/stats', (req, res) => {
  try {
    const db    = getDb();
    const stats = {
      library_count:    db.prepare('SELECT COUNT(*) as n FROM steam_library').get().n,
      wishlist_count:   db.prepare('SELECT COUNT(*) as n FROM steam_wishlist').get().n,
      total_playtime_h: db.prepare('SELECT COALESCE(SUM(playtime_forever),0) as total FROM steam_library').get().total / 60,
      most_played:      db.prepare('SELECT name, playtime_forever FROM steam_library ORDER BY playtime_forever DESC LIMIT 5').all(),
      on_sale:          db.prepare('SELECT * FROM steam_wishlist WHERE discount > 0 ORDER BY discount DESC').all(),
      last_updated:     db.prepare('SELECT MAX(updated_at) as last FROM steam_library').get().last
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// Fonctions privées
// ---------------------------------------------------------------

async function fetchSteamLibrary() {
  if (!STEAM_API_KEY || !STEAM_ID) {
    throw new Error('STEAM_API_KEY ou STEAM_ID manquant dans .env');
  }

  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/` +
    `?key=${STEAM_API_KEY}&steamid=${STEAM_ID}&include_appinfo=true&format=json`;

  const { data } = await http.get(url);
  const games    = data?.response?.games || [];

  const db   = getDb();
  const now  = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO steam_library (appid, name, playtime_forever, playtime_2weeks, image_url, updated_at)
    VALUES (@appid, @name, @playtime_forever, @playtime_2weeks, @image_url, @updated_at)
    ON CONFLICT(appid) DO UPDATE SET
      name             = excluded.name,
      playtime_forever = excluded.playtime_forever,
      playtime_2weeks  = excluded.playtime_2weeks,
      image_url        = excluded.image_url,
      updated_at       = excluded.updated_at
  `);

  const upsert = db.transaction((rows) => {
    for (const g of rows) {
      stmt.run({
        appid:            g.appid,
        name:             g.name,
        playtime_forever: g.playtime_forever || 0,
        playtime_2weeks:  g.playtime_2weeks  || 0,
        image_url:        `https://cdn.akamai.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
        updated_at:       now
      });
    }
  });
  upsert(games);

  logger.info(`[Steam] Bibliothèque : ${games.length} jeux enregistrés`);
  return db.prepare('SELECT * FROM steam_library ORDER BY playtime_forever DESC').all();
}

async function fetchSteamWishlist() {
  if (!STEAM_ID) throw new Error('STEAM_ID manquant dans .env');

  // La wishlist Steam est publique si le profil est public
  const url = `https://store.steampowered.com/wishlist/profiles/${STEAM_ID}/wishlistdata/?p=0`;

  const { data } = await http.get(url, {
    headers: {
      'User-Agent': process.env.SCRAPE_USER_AGENT || 'Mozilla/5.0',
      'Accept': 'application/json'
    }
  });

  const db    = getDb();
  const now   = new Date().toISOString();
  const items = [];

  if (data && typeof data === 'object') {
    for (const [appid, info] of Object.entries(data)) {
      if (info.name) {
        // Récupérer le prix depuis l'API store si disponible
        const subs  = info.subs || [];
        const sub   = subs.find(s => s.discount_pct !== undefined) || subs[0] || {};
        const price = sub.price ? sub.price / 100 : null;
        const sale  = sub.discount_pct ? price * (1 - sub.discount_pct / 100) : price;

        items.push({
          appid:        parseInt(appid, 10),
          name:         info.name,
          price:        price,
          sale_price:   sale,
          discount:     sub.discount_pct || 0,
          release_date: info.release_string || null,
          image_url:    `https://cdn.akamai.steamstatic.com/steam/apps/${appid}/header.jpg`,
          store_url:    `https://store.steampowered.com/app/${appid}`,
          updated_at:   now
        });
      }
    }
  }

  const stmt = db.prepare(`
    INSERT INTO steam_wishlist (appid, name, price, sale_price, discount, release_date, image_url, store_url, updated_at)
    VALUES (@appid, @name, @price, @sale_price, @discount, @release_date, @image_url, @store_url, @updated_at)
    ON CONFLICT(appid) DO UPDATE SET
      name         = excluded.name,
      price        = excluded.price,
      sale_price   = excluded.sale_price,
      discount     = excluded.discount,
      release_date = excluded.release_date,
      image_url    = excluded.image_url,
      store_url    = excluded.store_url,
      updated_at   = excluded.updated_at
  `);

  const upsert = db.transaction((rows) => { for (const r of rows) stmt.run(r); });
  upsert(items);

  logger.info(`[Steam] Wishlist : ${items.length} jeux enregistrés`);
  return db.prepare('SELECT * FROM steam_wishlist ORDER BY name ASC').all();
}

module.exports = router;
