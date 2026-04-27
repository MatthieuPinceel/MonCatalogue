'use strict';

const express  = require('express');
const router   = express.Router();
const { getDb } = require('../db/init');
const { scrapeAll, scrapeAllCatalog } = require('../services/scraper');
const { classifyItems, analyzeItem }  = require('../services/ai-classifier');
const logger   = require('../services/logger');

/**
 * GET /api/promos
 * Retourne les promos/catalogue en base (avec filtres optionnels).
 * Query params : source, category, item_type, sort, promo_only, limit, offset
 */
router.get('/', (req, res) => {
  try {
    const db = getDb();
    const { source, category, item_type, sort, promo_only, q, limit = 50, offset = 0 } = req.query;
    const safeLimit  = Math.min(Math.max(Number.Number.parseInt(limit,  10) || 50,  1), 200);
    const safeOffset = Math.max(Number.Number.parseInt(offset, 10) || 0, 0);

    let sql    = 'SELECT * FROM promos WHERE 1=1';
    const args = [];

    if (source)           { sql += ' AND source = ?';                  args.push(source); }
    if (category)         { sql += ' AND category = ?';                args.push(category); }
    if (item_type)        { sql += ' AND item_type = ?';               args.push(item_type); }
    if (promo_only === '1') { sql += ' AND discount_percent IS NOT NULL AND original_price IS NOT NULL'; }
    if (q)                { sql += ' AND title LIKE ? COLLATE NOCASE'; args.push(`%${q}%`); }

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
    args.push(safeLimit, safeOffset);

    const rows = db.prepare(sql).all(...args);

    // Total pour la pagination
    let countSql  = 'SELECT COUNT(*) as total FROM promos WHERE 1=1';
    const countArgs = [];
    if (source)    { countSql += ' AND source = ?';                  countArgs.push(source); }
    if (category)  { countSql += ' AND category = ?';                countArgs.push(category); }
    if (item_type) { countSql += ' AND item_type = ?';               countArgs.push(item_type); }
    if (promo_only === '1') { countSql += ' AND discount_percent IS NOT NULL AND original_price IS NOT NULL'; }
    if (q)         { countSql += ' AND title LIKE ? COLLATE NOCASE'; countArgs.push(`%${q}%`); }
    const { total } = db.prepare(countSql).get(...countArgs);

    res.json({ total, limit: Number.Number.parseInt(limit, 10), offset: Number.Number.parseInt(offset, 10), data: rows });
  } catch (err) {
    logger.error(`[/api/promos GET] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/promos/scrapers
 * Liste les scrapers disponibles (clés de SCRAPERS et CATALOG_SCRAPERS).
 */
router.get('/scrapers', (req, res) => {
  const { SCRAPERS, CATALOG_SCRAPERS } = require('../services/scraper');
  res.json({
    promos:   Object.keys(SCRAPERS),
    catalog:  Object.keys(CATALOG_SCRAPERS),
  });
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
 * DELETE /api/promos/all
 * Vide entièrement la table promos.
 */
router.delete('/all', (req, res) => {
  try {
    const db     = getDb();
    const result = db.prepare('DELETE FROM promos').run();
    logger.info(`[/api/promos/all] Base vidée : ${result.changes} articles supprimés`);
    res.json({ deleted: result.changes });
  } catch (err) {
    logger.error(`[/api/promos/all] ${err.message}`);
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
 * POST /api/promos/classify
 * Sans body : classifie tous les articles sans remise (max 100).
 * Avec body { ids: [...] } : classifie uniquement les IDs fournis.
 */
router.post('/classify', async (req, res) => {
  try {
    const db  = getDb();
    const { ids } = req.body || {};

    let rows;
    if (ids?.length) {
      const ph = ids.map(() => '?').join(',');
      rows = db.prepare(
        `SELECT id, title, price, original_price, source FROM promos WHERE id IN (${ph})`
      ).all(...ids);
    } else {
      rows = db.prepare(
        `SELECT id, title, price, original_price, source
         FROM promos
         WHERE discount_percent IS NULL AND item_type != 'catalog'
         ORDER BY scraped_at DESC LIMIT 100`
      ).all();
    }

    if (!rows.length) return res.json({ classified: 0, promoted: 0, message: 'Aucun article à classifier.' });

    const BATCH      = 20;
    const updateStmt = db.prepare(`UPDATE promos SET item_type = ? WHERE id = ?`);
    let classified   = 0, promoted = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
      const results = await classifyItems(rows.slice(i, i + BATCH));
      db.transaction(() => {
        for (const r of results) {
          const newType = r.is_promo ? 'promo' : 'catalog';
          updateStmt.run(newType, r.id);
          classified++;
          if (r.is_promo) promoted++;
          logger.info(`[classify] ID ${r.id} → ${newType} (${r.confidence}) : ${r.reason}`);
        }
      })();
    }

    res.json({ classified, promoted });
  } catch (err) {
    logger.error(`[/api/promos/classify] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/promos/:id/analyze
 * Analyse en profondeur un article avec Claude (prix marché, recommandation).
 */
router.post('/:id/analyze', async (req, res) => {
  try {
    const db   = getDb();
    const item = db.prepare('SELECT * FROM promos WHERE id = ?').get(req.params.id);
    if (!item) return res.status(404).json({ error: 'Article non trouvé.' });

    logger.info(`[analyze] ID ${item.id} — "${item.title}"`);
    const result = await analyzeItem(item);
    res.json(result);
  } catch (err) {
    logger.error(`[/api/promos/:id/analyze] ${err.message}`);
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
      price            = CASE WHEN promos.price IS NULL OR excluded.price < promos.price THEN excluded.price ELSE promos.price END,
      original_price   = CASE WHEN promos.price IS NULL OR excluded.price < promos.price THEN excluded.original_price ELSE promos.original_price END,
      discount_percent = CASE WHEN promos.price IS NULL OR excluded.price < promos.price THEN excluded.discount_percent ELSE promos.discount_percent END,
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
