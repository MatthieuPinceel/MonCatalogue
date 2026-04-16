'use strict';

const express  = require('express');
const router   = express.Router();
const { getDb } = require('../db/init');
const { getPokemonCardPrice, getLorcanaCardPrice } = require('../services/cardmarket');
const logger   = require('../services/logger');

/** GET /api/prices/history?source=cardmarket&item_id=XY&days=30 */
router.get('/history', (req, res) => {
  try {
    const db   = getDb();
    const { source, item_id, days = 30 } = req.query;
    if (!source || !item_id) {
      return res.status(400).json({ error: 'source et item_id sont requis' });
    }
    const since = new Date();
    since.setDate(since.getDate() - parseInt(days, 10));
    const rows = db.prepare(`
      SELECT * FROM price_history
      WHERE source = ? AND item_id = ? AND scraped_at >= ?
      ORDER BY scraped_at ASC
    `).all(source, item_id, since.toISOString());
    res.json({ source, item_id, days: parseInt(days, 10), data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/prices/cardmarket/pokemon?name=Pikachu&set=Base+Set */
router.get('/cardmarket/pokemon', async (req, res) => {
  const { name, set } = req.query;
  if (!name) return res.status(400).json({ error: 'name est requis' });

  try {
    const result = await getPokemonCardPrice(name, set);
    if (!result) return res.status(404).json({ error: 'Carte non trouvée' });

    // Sauvegarder dans l'historique
    const db = getDb();
    if (result.priceFrom) {
      db.prepare(`
        INSERT INTO price_history (source, item_id, item_name, price, currency, scraped_at)
        VALUES ('cardmarket', ?, ?, ?, 'EUR', datetime('now'))
      `).run(`pokemon_${name}`, name, result.priceFrom);
    }
    res.json(result);
  } catch (err) {
    logger.error(`[/api/prices/cardmarket/pokemon] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/prices/cardmarket/lorcana?name=Elsa */
router.get('/cardmarket/lorcana', async (req, res) => {
  const { name } = req.query;
  if (!name) return res.status(400).json({ error: 'name est requis' });

  try {
    const result = await getLorcanaCardPrice(name);
    if (!result) return res.status(404).json({ error: 'Carte non trouvée' });
    res.json(result);
  } catch (err) {
    logger.error(`[/api/prices/cardmarket/lorcana] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
