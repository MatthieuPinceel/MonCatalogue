'use strict';

const express  = require('express');
const router   = express.Router();
const { getDb } = require('../db/init');
const { scrapeAll } = require('../services/scraper');
const logger   = require('../services/logger');

/**
 * GET /api/promos
 * Retourne les promos en base (avec filtres optionnels).
 * Query params : source, category, limit (défaut 50), offset
 */
router.get('/', (req, res) => {
  try {
    const db       = getDb();
    const { source, category, sort, limit = 50, offset = 0 } = req.query;

    let sql    = 'SELECT * FROM promos WHERE 1=1';
    const args = [];

    if (source) {
      sql += ' AND source = ?';
      args.push(source);
    }
    if (category) {
      sql += ' AND category = ?';
      args.push(category);
    }

    const ORDER = {
      discount_desc: 'discount_percent DESC NULLS LAST, scraped_at DESC',
      price_asc:     'price ASC',
      price_desc:    'price DESC',
      date_desc:     'scraped_at DESC'
    };
    sql += ` ORDER BY ${ORDER[sort] || ORDER.date_desc} LIMIT ? OFFSET ?`;
    args.push(parseInt(limit, 10), parseInt(offset, 10));

    const rows = db.prepare(sql).all(...args);

    // Total pour la pagination
    let countSql = 'SELECT COUNT(*) as total FROM promos WHERE 1=1';
    const countArgs = [];
    if (source) { countSql += ' AND source = ?'; countArgs.push(source); }
    if (category) { countSql += ' AND category = ?'; countArgs.push(category); }
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
 * Déclenche manuellement le scraping (limité à certaines sources si précisé).
 * Body : { sources: ['kingjouet', 'micromania'] }  (optionnel)
 */
router.post('/scrape', async (req, res) => {
  const { sources } = req.body || {};
  logger.info(`[/api/promos/scrape] Scraping manuel — sources : ${sources ? sources.join(',') : 'toutes'}`);

  try {
    const items = await scrapeAll(sources);
    const saved = savePromos(items);
    res.json({ scraped: items.length, saved, sources: sources || 'all' });
  } catch (err) {
    logger.error(`[/api/promos/scrape] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/promos/stats
 * Statistiques rapides pour le dashboard.
 */
router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const today = new Date().toISOString().slice(0, 10);
    const stats = {
      total:         db.prepare('SELECT COUNT(*) as n FROM promos').get().n,
      today:         db.prepare("SELECT COUNT(*) as n FROM promos WHERE scraped_at >= ?").get(today + 'T00:00:00').n,
      by_category:   db.prepare("SELECT category, COUNT(*) as n FROM promos GROUP BY category").all(),
      top_discounts: db.prepare(
        `SELECT title, source, price, original_price, discount_percent
         FROM promos
         WHERE discount_percent IS NOT NULL
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
 * Insère ou met à jour les promos en base (UPSERT sur source+url).
 * @param {object[]} items
 * @returns {number} nombre d'insertions
 */
function savePromos(items) {
  const db   = getDb();
  const stmt = db.prepare(`
    INSERT INTO promos (source, title, price, original_price, discount_percent,
                        url, image_url, category, scraped_at)
    VALUES (@source, @title, @price, @original_price, @discount_percent,
            @url, @image_url, @category, @scraped_at)
    ON CONFLICT(source, url) DO UPDATE SET
      title            = excluded.title,
      price            = excluded.price,
      original_price   = excluded.original_price,
      discount_percent = excluded.discount_percent,
      image_url        = excluded.image_url,
      category         = excluded.category,
      scraped_at       = excluded.scraped_at
  `);

  let count = 0;
  const insert = db.transaction((rows) => {
    for (const row of rows) {
      if (!row.url) continue;    // URL obligatoire pour le UNIQUE
      try {
        stmt.run(row);
        count++;
      } catch (e) {
        logger.warn(`[promos] Erreur insertion "${row.title}" : ${e.message}`);
      }
    }
  });
  insert(items);
  return count;
}

module.exports = router;
module.exports.savePromos = savePromos;
