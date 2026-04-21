'use strict';

const express  = require('express');
const router   = express.Router();
const { getDb } = require('../db/init');
const { scrapeAll, scrapeAllCatalog } = require('../services/scraper');
const logger   = require('../services/logger');

/**
 * GET /api/promos
 * Retourne les promos/catalogue en base (avec filtres optionnels).
 * Query params : source, category, item_type, sort, promo_only, limit, offset
 */
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { source, category, item_type, sort, promo_only, limit = 50, offset = 0 } = req.query;

    let sql    = 'SELECT * FROM promos WHERE 1=1';
    const args = [];

    if (source)     { sql += ' AND source = ?';     args.push(source); }
    if (category)   { sql += ' AND category = ?';   args.push(category); }
    if (item_type)  { sql += ' AND item_type = ?';  args.push(item_type); }
    if (promo_only === '1') { sql += ' AND discount_percent IS NOT NULL AND original_price IS NOT NULL'; }

    const ORDER = {
      discount_desc: 'discount_percent DESC NULLS LAST, scraped_at DESC',
      savings_desc:  'CASE WHEN original_price IS NOT NULL THEN (original_price - price) ELSE -1 END DESC',
      price_asc:     'price ASC',
      price_desc:    'price DESC',
      alpha_asc:     'title ASC COLLATE NOCASE',
      by_source:     'source ASC, discount_percent DESC NULLS LAST',
      by_category:   'category ASC NULLS LAST, discount_percent DESC NULLS LAST',
      date_desc:     'scraped_at DESC'
    };
    sql += ` ORDER BY ${ORDER[sort] || ORDER.date_desc} LIMIT ? OFFSET ?`;
    args.push(parseInt(limit, 10), parseInt(offset, 10));

    const rows = db.prepare(sql).all(...args);

    // Total pour la pagination
    let countSql  = 'SELECT COUNT(*) as total FROM promos WHERE 1=1';
    const countArgs = [];
    if (source)    { countSql += ' AND source = ?';    countArgs.push(source); }
    if (category)  { countSql += ' AND category = ?';  countArgs.push(category); }
    if (item_type) { countSql += ' AND item_type = ?'; countArgs.push(item_type); }
    if (promo_only === '1') { countSql += ' AND discount_percent IS NOT NULL AND original_price IS NOT NULL'; }
    const { total } = db.prepare(countSql).get(...countArgs);

    res.json({ total, limit: parseInt(limit, 10), offset: parseInt(offset, 10), data: rows });
  } catch (err) {
    logger.error(`[/api/promos GET] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/promos/sources
 * Liste les sources disponibles et leur dernier scraping.
 */
router.get('/sources', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare(
      `SELECT source, COUNT(*) as count, MAX(scraped_at) as last_scraped
       FROM promos GROUP BY source ORDER BY last_scraped DESC`
    ).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/promos/scrape
 * Déclenche manuellement le scraping des pages promos.
 */
router.post('/scrape', async (req, res) => {
  const { sources } = req.body || {};
  logger.info(`[/api/promos/scrape] Scraping promos — sources : ${sources ? sources.join(',') : 'toutes'}`);
  try {
    const items  = await scrapeAll(sources);
    const saved  = savePromos(items);
    const deleted = cleanupOldPromos(getDb());
    res.json({ scraped: items.length, saved, deleted, sources: sources || 'all' });
  } catch (err) {
    logger.error(`[/api/promos/scrape] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/promos/scrape-catalog
 * Déclenche le scraping des pages catalogue (produits hors promo).
 */
router.post('/scrape-catalog', async (req, res) => {
  const { sources } = req.body || {};
  logger.info(`[/api/promos/scrape-catalog] Scraping catalogue — sources : ${sources ? sources.join(',') : 'toutes'}`);
  try {
    const items   = await scrapeAllCatalog(sources);
    const saved   = savePromos(items);
    const deleted = cleanupOldPromos(getDb());
    res.json({ scraped: items.length, saved, deleted, sources: sources || 'all' });
  } catch (err) {
    logger.error(`[/api/promos/scrape-catalog] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/promos/cleanup
 * Supprime manuellement les articles > 7 jours.
 */
router.post('/cleanup', (req, res) => {
  try {
    const deleted = cleanupOldPromos(getDb());
    res.json({ deleted });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/promos/stats
 * Statistiques rapides pour le dashboard.
 */
router.get('/stats', (req, res) => {
  try {
    const db    = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const stats = {
      total:         db.prepare("SELECT COUNT(*) as n FROM promos WHERE item_type = 'promo' OR item_type IS NULL").get().n,
      today:         db.prepare("SELECT COUNT(*) as n FROM promos WHERE scraped_at >= ? AND (item_type = 'promo' OR item_type IS NULL)").get(today + 'T00:00:00').n,
      by_category:   db.prepare("SELECT category, COUNT(*) as n FROM promos WHERE item_type = 'promo' OR item_type IS NULL GROUP BY category").all(),
      top_discounts: db.prepare(
        `SELECT title, source, price, original_price, discount_percent
         FROM promos
         WHERE discount_percent IS NOT NULL AND (item_type = 'promo' OR item_type IS NULL)
         ORDER BY discount_percent DESC
         LIMIT 10`
      ).all()
    };
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Insère ou met à jour les articles en base (UPSERT sur source+url).
 * Conserve le prix le plus bas jamais observé pour chaque article.
 */
function savePromos(items) {
  const db   = getDb();
  const stmt = db.prepare(`
    INSERT INTO promos (source, title, price, original_price, discount_percent,
                        url, image_url, category, item_type, scraped_at)
    VALUES (@source, @title, @price, @original_price, @discount_percent,
            @url, @image_url, @category, @item_type, @scraped_at)
    ON CONFLICT(source, url) DO UPDATE SET
      title            = excluded.title,
      price            = CASE WHEN excluded.price < promos.price THEN excluded.price ELSE promos.price END,
      original_price   = CASE WHEN excluded.price < promos.price THEN excluded.original_price ELSE promos.original_price END,
      discount_percent = CASE WHEN excluded.price < promos.price THEN excluded.discount_percent ELSE promos.discount_percent END,
      image_url        = excluded.image_url,
      category         = excluded.category,
      item_type        = excluded.item_type,
      scraped_at       = excluded.scraped_at
  `);

  let count = 0;
  const insert = db.transaction((rows) => {
    for (const row of rows) {
      if (!row.url) continue;
      try {
        stmt.run({ item_type: 'promo', ...row });
        count++;
      } catch (e) {
        logger.warn(`[promos] Erreur insertion "${row.title}" : ${e.message}`);
      }
    }
  });
  insert(items);
  return count;
}

/**
 * Supprime les articles dont scraped_at est antérieur à 7 jours.
 * Les articles rescrapés ont leur scraped_at mis à jour → ils survivent.
 */
function cleanupOldPromos(db) {
  const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = db.prepare(`DELETE FROM promos WHERE scraped_at < ?`).run(cutoff);
  if (result.changes > 0) logger.info(`[promos] Nettoyage : ${result.changes} articles supprimés (> 7 jours)`);
  return result.changes;
}

module.exports = router;
module.exports.savePromos = savePromos;
