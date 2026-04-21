'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');
const SCHEMA   = require('./schema');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');

function getDb() {
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function initDb() {
  const db = getDb();
  db.exec(SCHEMA);
  // Migrations non destructives
  try { db.exec(`ALTER TABLE gmail_promos ADD COLUMN category TEXT`);   } catch (e) {}
  try { db.exec(`ALTER TABLE gmail_promos ADD COLUMN ai_summary TEXT`); } catch (e) {}
  try { db.exec(`ALTER TABLE promos ADD COLUMN item_type TEXT DEFAULT 'promo'`); } catch (e) {}
  try {
    db.exec(`CREATE TABLE IF NOT EXISTS tcg_wishlist (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      game         TEXT NOT NULL,
      product_type TEXT NOT NULL,
      name         TEXT NOT NULL,
      set_name     TEXT,
      target_price REAL,
      image_url    TEXT,
      notes        TEXT,
      added_at     TEXT NOT NULL
    )`);
  } catch (e) {}
  console.log(`[DB] Base initialisée : ${DB_PATH}`);
  return db;
}

// Si exécuté directement : node server/db/init.js
if (require.main === module) {
  initDb();
  process.exit(0);
}

module.exports = { getDb, initDb };
