'use strict';

/**
 * Route Gmail OAuth2
 *
 * Flux d'authentification :
 *   1. GET /api/gmail/auth        → redirige vers Google pour l'autorisation
 *   2. GET /api/gmail/oauth2callback → Google revient ici avec un code
 *   3. GET /api/gmail/status      → vérifie si le token est valide
 *   4. POST /api/gmail/scan       → scan manuel des emails promos
 *
 * Configuration Gmail OAuth2 (voir README) :
 *   - Créer un projet Google Cloud Console
 *   - Activer Gmail API
 *   - Créer identifiants OAuth2 (Application de bureau)
 *   - Remplir GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET dans .env
 */

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { google } = require('googleapis');
const { getDb }  = require('../db/init');
const logger  = require('../services/logger');
const mailer  = require('../services/mailer');

const TOKEN_PATH    = path.resolve(process.env.GMAIL_TOKEN_PATH || 'server/gmail_token.json');
const REDIRECT_URI  = process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/api/gmail/oauth2callback';
const SCOPES        = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send'
];

// Expéditeurs de newsletters promos à scanner
const PROMO_SENDERS = [
  'steam',
  'micromania',
  'king-jouet', 'kingjouet',
  'lego',
  'pokemon', 'pokémon',
  'furet', 'furetdunord',
  'carrefour',
  'fnac',
  'cultura',
  'cdiscount',
  'smyths',
  'leclerc',
  'auchan',
  'veepee', 'vente-privee', 'venteprivee'
];

let oauth2Client = null;

function getOAuth2Client() {
  if (!oauth2Client) {
    oauth2Client = new google.auth.OAuth2(
      process.env.GMAIL_CLIENT_ID,
      process.env.GMAIL_CLIENT_SECRET,
      REDIRECT_URI
    );
  }
  return oauth2Client;
}

function loadStoredToken() {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
      const client = getOAuth2Client();
      client.setCredentials(token);
      mailer.setGmailClient(client);
      return true;
    }
  } catch (e) {
    logger.warn(`[Gmail] Impossible de lire le token : ${e.message}`);
  }
  return false;
}

function saveToken(token) {
  const dir = path.dirname(TOKEN_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(token));
  logger.info(`[Gmail] Token sauvegardé : ${TOKEN_PATH}`);
}

// Tenter de charger le token au démarrage
loadStoredToken();

// ---------------------------------------------------------------
// GET /api/gmail/status
// ---------------------------------------------------------------
router.get('/status', (req, res) => {
  const configured = !!(process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET);
  const hasToken   = fs.existsSync(TOKEN_PATH);
  const active     = hasToken && !!oauth2Client;

  res.json({
    configured,
    has_token: hasToken,
    active,
    user: process.env.GMAIL_USER,
    message: !configured
      ? 'GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET non configurés dans .env'
      : !hasToken
      ? 'Token absent — visitez /api/gmail/auth pour autoriser l\'accès'
      : 'Gmail connecté'
  });
});

// ---------------------------------------------------------------
// GET /api/gmail/auth
// Démarre le flux OAuth2 → redirige vers Google
// ---------------------------------------------------------------
router.get('/auth', (req, res) => {
  if (!process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) {
    return res.status(400).json({
      error: 'Gmail OAuth2 non configuré',
      instructions: [
        '1. Créer un projet sur https://console.cloud.google.com',
        '2. Activer Gmail API',
        '3. Créer des identifiants OAuth2 → Application de bureau',
        '4. Ajouter GMAIL_CLIENT_ID et GMAIL_CLIENT_SECRET dans .env'
      ]
    });
  }

  const client = getOAuth2Client();
  const url    = client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  });

  logger.info('[Gmail] Redirection vers Google pour OAuth2');
  res.redirect(url);
});

// ---------------------------------------------------------------
// GET /api/gmail/oauth2callback
// Google redirige ici après autorisation
// ---------------------------------------------------------------
router.get('/oauth2callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    logger.error(`[Gmail] OAuth2 refusé : ${error}`);
    return res.status(400).send(`Autorisation refusée : ${error}`);
  }
  if (!code) {
    return res.status(400).send('Code manquant');
  }

  try {
    const client       = getOAuth2Client();
    const { tokens }   = await client.getToken(code);
    client.setCredentials(tokens);
    saveToken(tokens);
    mailer.setGmailClient(client);
    oauth2Client = client;

    logger.info('[Gmail] Authentification réussie !');
    res.send(`
      <html><body style="font-family:sans-serif;text-align:center;padding:40px">
      <h2>✅ Gmail connecté !</h2>
      <p>Le token a été sauvegardé. Vous pouvez fermer cette fenêtre.</p>
      <p><a href="/">Retour au dashboard</a></p>
      </body></html>
    `);
  } catch (err) {
    logger.error(`[Gmail] Erreur échange de code : ${err.message}`);
    res.status(500).send(`Erreur : ${err.message}`);
  }
});

// ---------------------------------------------------------------
// POST /api/gmail/scan
// Scan les newsletters promos des dernières 24h
// ---------------------------------------------------------------
router.post('/scan', async (req, res) => {
  if (!oauth2Client) {
    return res.status(400).json({ error: 'Gmail non connecté. Visitez /api/gmail/auth d\'abord.' });
  }

  try {
    const results = await scanPromoEmails();
    res.json(results);
  } catch (err) {
    logger.error(`[/api/gmail/scan] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// GET /api/gmail/promos
// Retourne les promos extraites des emails
// ---------------------------------------------------------------
router.get('/promos', (req, res) => {
  try {
    const db   = getDb();
    const rows = db.prepare(
      'SELECT * FROM gmail_promos ORDER BY received_at DESC LIMIT 50'
    ).all();
    res.json(rows.map(r => ({
      ...r,
      extracted_promos: r.extracted_promos ? JSON.parse(r.extracted_promos) : []
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// Scan emails promos (logique interne)
// ---------------------------------------------------------------
async function scanPromoEmails() {
  const gmail  = google.gmail({ version: 'v1', auth: oauth2Client });
  const db     = getDb();
  const since  = Math.floor(Date.now() / 1000) - 86400; // 24h

  // Construire la requête Gmail : emails des expéditeurs promos
  const senderQuery = PROMO_SENDERS.map(s => `from:${s}`).join(' OR ');
  const query       = `(${senderQuery}) after:${since}`;

  logger.info(`[Gmail] Scan emails promos...`);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 20
  });

  const messages = listRes.data.messages || [];
  logger.info(`[Gmail] ${messages.length} email(s) trouvé(s)`);

  const saved = [];

  for (const msg of messages) {
    // Déjà traité ?
    const existing = db.prepare('SELECT id FROM gmail_promos WHERE message_id = ?').get(msg.id);
    if (existing) continue;

    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
      format: 'metadata',
      metadataHeaders: ['Subject', 'From', 'Date']
    });

    const headers  = detail.data.payload?.headers || [];
    const subject  = headers.find(h => h.name === 'Subject')?.value || '';
    const sender   = headers.find(h => h.name === 'From')?.value    || '';
    const date     = headers.find(h => h.name === 'Date')?.value    || '';
    const snippet  = detail.data.snippet || '';

    // Extraction regex basique des promos
    const extracted = extractPromosFromText(subject + ' ' + snippet);

    db.prepare(`
      INSERT OR IGNORE INTO gmail_promos
        (message_id, subject, sender, snippet, extracted_promos, received_at, processed_at, used_ai)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 0)
    `).run(msg.id, subject, sender, snippet, JSON.stringify(extracted), date);

    saved.push({ message_id: msg.id, subject, sender, extracted });
  }

  logger.info(`[Gmail] ${saved.length} email(s) enregistré(s)`);
  return { scanned: messages.length, saved: saved.length, items: saved };
}

/**
 * Extraction regex de promotions depuis un texte (subject + snippet).
 * Ne nécessite pas Claude Haiku.
 */
function extractPromosFromText(text) {
  const promos = [];
  const seen   = new Set();

  const add = (p) => {
    const key = JSON.stringify(p);
    if (!seen.has(key)) { seen.add(key); promos.push(p); }
  };

  // "-30%", "jusqu'à -70%", "-50% à -70%"
  const pctPattern = /(?:jusqu['\u2019]?[àa]?\s*)?[–\-]\s*(\d{1,2})\s*%(?:\s*[àa]\s*[–\-]?\s*(\d{1,2})\s*%)?/gi;
  // "X€ au lieu de Y€"
  const pricePattern = /(\d+[,.]?\d*)\s*€\s*(?:au\s*lieu\s*de|instead of)\s*(\d+[,.]?\d*)\s*€/gi;
  // Veepee brand sales : "Vente [Brand]" or "Nouvelle vente :"
  const veepeePattern = /(?:nouvelle\s+vente\s*:\s*|vente\s+)([A-ZÀ-Ý][A-Za-zÀ-ÿ\s&]{2,30})/gi;

  let m;
  while ((m = pctPattern.exec(text)) !== null) {
    add({ type: 'discount_pct', min: parseInt(m[1], 10), max: m[2] ? parseInt(m[2], 10) : null });
  }
  while ((m = pricePattern.exec(text)) !== null) {
    add({ type: 'price', sale: parseFloat(m[1].replace(',','.')), original: parseFloat(m[2].replace(',','.')) });
  }
  while ((m = veepeePattern.exec(text)) !== null) {
    add({ type: 'brand_sale', brand: m[1].trim() });
  }

  return promos;
}

module.exports = router;
module.exports.loadStoredToken = loadStoredToken;
module.exports.scanPromoEmails = scanPromoEmails;
