'use strict';

require('dotenv').config({ path: require('node:path').resolve(__dirname, '../../.env') });
const Database = require('better-sqlite3');
const path     = require('node:path');
const fs       = require('node:fs');
const SCHEMA   = require('./schema');
const logger   = require('../services/logger');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');

let _db = null;

function getDb() {
  if (_db) return _db;
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  return _db;
}

function initDb() {
  const db = getDb();
  db.exec(SCHEMA);
  // Migrations non destructives
  try { db.exec(`ALTER TABLE gmail_promos ADD COLUMN category TEXT`);   } catch (e) { logger.debug(`[DB] ${e.message}`); }
  try { db.exec(`ALTER TABLE gmail_promos ADD COLUMN ai_summary TEXT`); } catch (e) { logger.debug(`[DB] ${e.message}`); }
  try { db.exec(`ALTER TABLE promos ADD COLUMN item_type TEXT DEFAULT 'promo'`); } catch (e) { logger.debug(`[DB] ${e.message}`); }
  // tcg_wishlist est définie dans schema.js — pas de doublon ici
  console.log(`[DB] Base initialisée : ${DB_PATH}`);
  return db;
}

// Si exécuté directement : node server/db/init.js
if (require.main === module) {
  initDb();
  process.exit(0);
}

module.exports = { getDb, initDb };
