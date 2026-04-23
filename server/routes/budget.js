'use strict';

const express  = require('express');
const router   = express.Router();
const { getDb } = require('../db/init');
const logger   = require('../services/logger');

const CATEGORIES = ['TCG_Pokemon', 'TCG_Lorcana', 'Lego', 'JeuxVideo', 'JeuxSociete'];

/** GET /api/budget/purchases?month=2024-04 */
router.get('/purchases', (req, res) => {
  try {
    const db    = getDb();
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const rows  = db.prepare(
      `SELECT * FROM purchases WHERE purchase_date LIKE ? ORDER BY purchase_date DESC`
    ).all(`${month}%`);
    res.json({ month, count: rows.length, data: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/budget/purchases */
router.post('/purchases', (req, res) => {
  try {
    const db = getDb();
    const { name, amount, category, store, purchase_date, notes } = req.body;
    if (!name || !amount || !category) {
      return res.status(400).json({ error: 'name, amount, category sont requis' });
    }
    if (!CATEGORIES.includes(category)) {
      return res.status(400).json({ error: `Catégorie invalide. Valeurs : ${CATEGORIES.join(', ')}` });
    }
    const parsed = parseFloat(amount);
    if (isNaN(parsed) || parsed <= 0) {
      return res.status(400).json({ error: 'Le montant doit être un nombre positif' });
    }
    const date   = purchase_date || new Date().toISOString().slice(0, 10);
    const result = db.prepare(`
      INSERT INTO purchases (name, amount, category, store, purchase_date, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(name, parsed, category, store || null, date, notes || null);
    res.json({ id: result.lastInsertRowid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** DELETE /api/budget/purchases/:id */
router.delete('/purchases/:id', (req, res) => {
  try {
    const db     = getDb();
    const result = db.prepare('DELETE FROM purchases WHERE id = ?').run(req.params.id);
    if (result.changes === 0) return res.status(404).json({ error: 'Achat non trouvé' });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/budget/summary?month=2024-04 */
router.get('/summary', (req, res) => {
  try {
    const db    = getDb();
    const month = req.query.month || new Date().toISOString().slice(0, 7);

    const byCategory = db.prepare(`
      SELECT category, COALESCE(SUM(amount), 0) as spent
      FROM purchases WHERE purchase_date LIKE ?
      GROUP BY category
    `).all(`${month}%`);

    const limits = db.prepare('SELECT * FROM budget_limits').all();
    const limitMap = Object.fromEntries(limits.map(l => [l.category, l.monthly_limit]));

    const summary = CATEGORIES.map(cat => {
      const spent = byCategory.find(r => r.category === cat)?.spent || 0;
      const limit = limitMap[cat] || 0;
      return { category: cat, spent, limit, remaining: limit - spent, over_budget: spent > limit };
    });

    const total_spent = summary.reduce((s, r) => s + r.spent, 0);
    const total_limit = summary.reduce((s, r) => s + r.limit, 0);

    // Historique des 12 derniers mois
    const history = db.prepare(`
      SELECT strftime('%Y-%m', purchase_date) as month, category, SUM(amount) as spent
      FROM purchases
      WHERE purchase_date >= date('now', '-12 months')
      GROUP BY month, category
      ORDER BY month ASC
    `).all();

    res.json({ month, summary, total_spent, total_limit, history });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** GET /api/budget/limits */
router.get('/limits', (req, res) => {
  try {
    const db = getDb();
    res.json(db.prepare('SELECT * FROM budget_limits ORDER BY category').all());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** PUT /api/budget/limits/:category */
router.put('/limits/:category', (req, res) => {
  try {
    const db  = getDb();
    const cat = req.params.category;
    const { monthly_limit } = req.body;
    if (!CATEGORIES.includes(cat)) {
      return res.status(400).json({ error: 'Catégorie invalide' });
    }
    const parsed = parseFloat(monthly_limit);
    if (isNaN(parsed) || parsed < 0) {
      return res.status(400).json({ error: 'monthly_limit doit être un nombre >= 0' });
    }
    db.prepare(`
      INSERT INTO budget_limits (category, monthly_limit, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(category) DO UPDATE SET monthly_limit = excluded.monthly_limit, updated_at = excluded.updated_at
    `).run(cat, parsed);
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
