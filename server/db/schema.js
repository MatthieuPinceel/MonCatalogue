'use strict';

/**
 * Définition du schéma SQLite complet pour Mon Dashboard.
 * Toutes les phases sont anticipées ici pour éviter les migrations répétées.
 */
const SCHEMA = `
-- ================================================================
-- PHASE 1 — Promos & Steam
-- ================================================================

CREATE TABLE IF NOT EXISTS promos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  source           TEXT    NOT NULL,              -- 'kingjouet', 'micromania', 'fnac', ...
  title            TEXT    NOT NULL,
  price            REAL,
  original_price   REAL,
  discount_percent INTEGER,
  currency         TEXT    DEFAULT 'EUR',
  url              TEXT,
  image_url        TEXT,
  category         TEXT,                          -- 'TCG', 'Lego', 'JeuxVideo', 'JeuxSociete', ...
  scraped_at       TEXT    NOT NULL,              -- ISO 8601
  UNIQUE(source, url)
);

CREATE INDEX IF NOT EXISTS idx_promos_source     ON promos(source);
CREATE INDEX IF NOT EXISTS idx_promos_category   ON promos(category);
CREATE INDEX IF NOT EXISTS idx_promos_scraped_at ON promos(scraped_at);

CREATE TABLE IF NOT EXISTS steam_wishlist (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  appid        INTEGER NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  price        REAL,
  sale_price   REAL,
  discount     INTEGER DEFAULT 0,
  release_date TEXT,
  image_url    TEXT,
  store_url    TEXT,
  updated_at   TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS steam_library (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  appid            INTEGER NOT NULL UNIQUE,
  name             TEXT    NOT NULL,
  playtime_forever INTEGER DEFAULT 0,   -- minutes
  playtime_2weeks  INTEGER DEFAULT 0,   -- minutes
  image_url        TEXT,
  updated_at       TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS gmail_promos (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id       TEXT    NOT NULL UNIQUE,
  subject          TEXT,
  sender           TEXT,
  snippet          TEXT,
  extracted_promos TEXT,                -- JSON stringifié
  received_at      TEXT,
  processed_at     TEXT,
  used_ai          INTEGER DEFAULT 0    -- 1 si Claude Haiku a été utilisé
);

-- ================================================================
-- PHASE 3 — Alertes prix
-- ================================================================

CREATE TABLE IF NOT EXISTS price_alerts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  type            TEXT NOT NULL,        -- 'tcg_card', 'lego_set', 'steam_game', 'promo'
  item_id         TEXT NOT NULL,        -- identifiant externe (appid, card_id, set_number…)
  item_name       TEXT NOT NULL,
  source          TEXT,                 -- 'cardmarket', 'steam', 'kingjouet', ...
  threshold_price REAL NOT NULL,
  current_price   REAL,
  active          INTEGER DEFAULT 1,
  triggered_at    TEXT,
  email_sent      INTEGER DEFAULT 0,
  created_at      TEXT NOT NULL,
  UNIQUE(type, item_id, source)
);

-- ================================================================
-- PHASE 4 — Historique de prix
-- ================================================================

CREATE TABLE IF NOT EXISTS price_history (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  source     TEXT NOT NULL,
  item_id    TEXT NOT NULL,
  item_name  TEXT,
  price      REAL NOT NULL,
  currency   TEXT DEFAULT 'EUR',
  scraped_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_item ON price_history(source, item_id);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(scraped_at);

-- ================================================================
-- PHASE 5 — Budget mensuel
-- ================================================================

CREATE TABLE IF NOT EXISTS purchases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  amount      REAL    NOT NULL,
  category    TEXT    NOT NULL,   -- 'TCG_Pokemon', 'TCG_Lorcana', 'Lego', 'JeuxVideo', 'JeuxSociete'
  store       TEXT,
  purchase_date TEXT  NOT NULL,
  notes       TEXT,
  created_at  TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_purchases_date     ON purchases(purchase_date);
CREATE INDEX IF NOT EXISTS idx_purchases_category ON purchases(category);

CREATE TABLE IF NOT EXISTS budget_limits (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  category   TEXT NOT NULL UNIQUE,
  monthly_limit REAL NOT NULL,
  updated_at TEXT NOT NULL
);

-- Limites par défaut
INSERT OR IGNORE INTO budget_limits (category, monthly_limit, updated_at) VALUES
  ('TCG_Pokemon',  50.0,  datetime('now')),
  ('TCG_Lorcana',  30.0,  datetime('now')),
  ('Lego',         80.0,  datetime('now')),
  ('JeuxVideo',    40.0,  datetime('now')),
  ('JeuxSociete',  30.0,  datetime('now'));

-- ================================================================
-- PHASE 6 — Collection Lego
-- ================================================================

CREATE TABLE IF NOT EXISTS lego_collection (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  set_number   TEXT    NOT NULL UNIQUE,
  name         TEXT    NOT NULL,
  theme        TEXT,
  pieces       INTEGER,
  price_paid   REAL,
  retail_price REAL,
  date_added   TEXT    NOT NULL,
  status       TEXT    DEFAULT 'owned',   -- 'owned', 'wishlist', 'sold'
  notes        TEXT,
  image_url    TEXT
);

-- ================================================================
-- PHASE 2 — Collection TCG
-- ================================================================

CREATE TABLE IF NOT EXISTS tcg_collection (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game        TEXT NOT NULL,             -- 'pokemon', 'lorcana'
  card_id     TEXT NOT NULL,
  set_id      TEXT,
  set_name    TEXT,
  card_name   TEXT NOT NULL,
  rarity      TEXT,
  condition   TEXT DEFAULT 'NM',         -- NM, LP, MP, HP, D
  quantity    INTEGER DEFAULT 1,
  price_paid  REAL,
  market_price REAL,
  last_price_update TEXT,
  notes       TEXT,
  added_at    TEXT NOT NULL,
  UNIQUE(game, card_id, condition)
);

CREATE INDEX IF NOT EXISTS idx_tcg_game   ON tcg_collection(game);
CREATE INDEX IF NOT EXISTS idx_tcg_set    ON tcg_collection(set_id);

-- ================================================================
-- TRANSVERSE — Suivi consommation API Anthropic
-- ================================================================

CREATE TABLE IF NOT EXISTS api_usage (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  service       TEXT NOT NULL,           -- 'anthropic'
  model         TEXT,
  tokens_input  INTEGER DEFAULT 0,
  tokens_output INTEGER DEFAULT 0,
  cost_usd      REAL    DEFAULT 0,
  purpose       TEXT,                    -- 'scrape_fallback', 'email_parse', 'weekly_summary'
  created_at    TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_usage_month ON api_usage(created_at);

-- ================================================================
-- Wishlist TCG — cartes ET produits scellés
-- ================================================================

CREATE TABLE IF NOT EXISTS tcg_wishlist (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game         TEXT NOT NULL,          -- 'pokemon', 'lorcana', 'magic', 'one_piece', 'autre'
  product_type TEXT NOT NULL,          -- 'carte', 'booster', 'display', 'etb', 'tin', 'coffret', 'deck', 'blister', 'bundle', 'autre'
  name         TEXT NOT NULL,
  set_name     TEXT,
  target_price REAL,                   -- budget max que l'utilisateur veut payer
  image_url    TEXT,
  notes        TEXT,
  added_at     TEXT NOT NULL
);

-- Calendrier des sorties TCG
CREATE TABLE IF NOT EXISTS tcg_releases (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  game         TEXT NOT NULL,
  set_name     TEXT NOT NULL,
  release_date TEXT NOT NULL,
  type         TEXT,                     -- 'booster', 'starter', 'tin', ...
  description  TEXT,
  notified     INTEGER DEFAULT 0,
  created_at   TEXT NOT NULL
);
`;

module.exports = SCHEMA;
