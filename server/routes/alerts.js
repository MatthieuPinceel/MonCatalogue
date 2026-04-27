'use strict';

const express  = require('express');
const router   = express.Router();
const { getDb } = require('../db/init');
const logger   = require('../services/logger');

/** GET /api/alerts */
router.get('/', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare(
      'SELECT * FROM price_alerts ORDER BY created_at DESC'
    ).all();
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/alerts — créer une alerte */
router.post('/', (req, res) => {
  try {
    const db = getDb();
    const { type, item_id, item_name, source, threshold_price } = req.body;
    if (!type || !item_id || !item_name || !threshold_price) {
      return res.status(400).json({ error: 'type, item_id, item_name, threshold_price sont requis' });
    }
    const result = db.prepare(`
      INSERT INTO price_alerts (type, item_id, item_name, source, threshold_price, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(type, item_id, source) DO UPDATE SET threshold_price = excluded.threshold_price, active = 1
    `).run(type, item_id, item_name, source || null, Number.parseFloat(threshold_price));
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/alerts/:id */
router.delete('/:id', (req, res) => {
  try {
    const db = getDb();
    db.prepare('UPDATE price_alerts SET active = 0 WHERE id = ?').run(req.params.id);
    res.json({ deactivated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/alerts/usage — consommation API Anthropic */
router.get('/usage', (req, res) => {
  try {
    const db    = getDb();
    const month = new Date().toISOString().slice(0, 7);
    const usage = db.prepare(`
      SELECT purpose, COUNT(*) as calls, SUM(tokens_input) as tok_in,
             SUM(tokens_output) as tok_out, SUM(cost_usd) as total_usd
      FROM api_usage
      WHERE service = 'anthropic' AND created_at LIKE ?
      GROUP BY purpose
    `).all(`${month}%`);

    const totalUsd = usage.reduce((s, r) => s + (r.total_usd || 0), 0);
    const limit    = Number.parseFloat(process.env.ANTHROPIC_MONTHLY_LIMIT_USD || '2.50');

    res.json({
      month,
      total_usd: totalUsd,
      limit_usd: limit,
      remaining_usd: Math.max(0, limit - totalUsd),
      percent_used: Math.round((totalUsd / limit) * 100),
      by_purpose: usage
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
