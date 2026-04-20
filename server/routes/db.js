'use strict';

const express  = require('express');
const router   = express.Router();
const path     = require('path');
const fs       = require('fs');
const { getDb } = require('../db/init');
const logger   = require('../services/logger');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../db/database.sqlite');

// GET /api/db/export — télécharge le fichier SQLite
router.get('/export', (req, res) => {
  try {
    if (!fs.existsSync(DB_PATH)) return res.status(404).json({ error: 'Base introuvable' });
    const stat = fs.statSync(DB_PATH);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="moncatalogue-${new Date().toISOString().slice(0,10)}.sqlite"`);
    res.setHeader('Content-Length', stat.size);
    fs.createReadStream(DB_PATH).pipe(res);
    logger.info(`[DB] Export SQLite (${(stat.size / 1024 / 1024).toFixed(1)} Mo)`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/db/export/gmail — exporte uniquement la table gmail_promos en JSON
router.get('/export/gmail', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare('SELECT * FROM gmail_promos ORDER BY received_at DESC').all();
    res.setHeader('Content-Disposition', `attachment; filename="gmail-promos-${new Date().toISOString().slice(0,10)}.json"`);
    res.json(rows);
    logger.info(`[DB] Export Gmail : ${rows.length} entrées`);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/db/import/gmail — importe des entrées gmail_promos depuis JSON
router.post('/import/gmail', express.json({ limit: '50mb' }), (req, res) => {
  try {
    const rows = req.body;
    if (!Array.isArray(rows)) return res.status(400).json({ error: 'Body doit être un tableau JSON' });

    const db   = getDb();
    const stmt = db.prepare(`
      INSERT INTO gmail_promos
        (message_id, subject, sender, received_at, gmail_link, category, ai_summary, created_at)
      VALUES
        (@message_id, @subject, @sender, @received_at, @gmail_link, @category, @ai_summary, @created_at)
      ON CONFLICT(message_id) DO UPDATE SET
        category   = COALESCE(excluded.category,   category),
        ai_summary = COALESCE(excluded.ai_summary, ai_summary)
    `);

    let imported = 0;
    db.transaction(() => {
      for (const r of rows) {
        if (!r.message_id) continue;
        stmt.run({
          message_id: r.message_id,
          subject:    r.subject    || '',
          sender:     r.sender     || '',
          received_at: r.received_at || null,
          gmail_link: r.gmail_link || null,
          category:   r.category   || null,
          ai_summary: r.ai_summary || null,
          created_at: r.created_at || new Date().toISOString()
        });
        imported++;
      }
    })();

    logger.info(`[DB] Import Gmail : ${imported} entrées importées`);
    res.json({ imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
