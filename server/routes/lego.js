'use strict';

const express  = require('express');
const router   = express.Router();
const { getDb } = require('../db/init');
const logger   = require('../services/logger');

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
