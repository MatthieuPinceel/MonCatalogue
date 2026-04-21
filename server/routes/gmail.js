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
const router  = require('express').Router();
const fs      = require('fs');
const path    = require('path');
const https   = require('https');
const http    = require('http');
const { google } = require('googleapis');
const { getDb }  = require('../db/init');
const logger  = require('../services/logger');
const mailer  = require('../services/mailer');
const { callHaikuVision } = require('../services/anthropic');

const VISION_PROMPT = `Tu es un extracteur de promotions. Analyse ces images d'email promotionnel.
Réponds UNIQUEMENT avec du JSON valide, sans markdown, sans explication.
Format: {"offres":[{"produit":"...","prix":"...","remise":"...","condition":"...","validite":"..."}]}
- produit : nom exact du produit ou catégorie (ex: "Magic The Gathering Boosters", "Tomodachi Life Switch")
- prix : prix affiché (ex: "19,99€", "5€", "4,99€")
- remise : réduction (ex: "-30%", "2=3", "bon d'achat 10€ offert", "2 pour 5€")
- condition : condition si mentionnée (ex: "dès 50€ d'achat", "en précommande")
- validite : durée si mentionnée (ex: "du 13 avril au 4 mai", "dernier jour")`;

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
    const days    = parseInt(req.body.days || req.query.days || 7, 10);
    const results = await scanPromoEmails(days);
    res.json(results);
  } catch (err) {
    logger.error(`[/api/gmail/scan] ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// POST /api/gmail/analyze — re-analyse Vision des emails sans ai_summary
// ---------------------------------------------------------------
router.post('/analyze', async (req, res) => {
  if (!oauth2Client) return res.status(400).json({ error: 'Gmail non connecté.' });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(400).json({ error: 'ANTHROPIC_API_KEY manquante.' });

  try {
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
    const db    = getDb();
    const rows  = db.prepare(`SELECT id, message_id FROM gmail_promos WHERE ai_summary IS NULL`).all();
    logger.info(`[Gmail/Vision] ${rows.length} email(s) à analyser`);

    let done = 0;
    for (const row of rows) {
      try {
        const detail   = await gmail.users.messages.get({ userId: 'me', id: row.message_id, format: 'full' });
        const htmlBody = getHtmlBody(detail.data.payload);
        const imgUrls  = htmlBody ? extractImageUrls(htmlBody) : [];
        const summary  = await analyzeWithVision(imgUrls);
        if (summary) {
          db.prepare(`UPDATE gmail_promos SET ai_summary = ?, used_ai = 1 WHERE id = ?`)
            .run(JSON.stringify(summary), row.id);
          done++;
        }
      } catch (e) {
        logger.warn(`[Gmail/Vision] Skip ${row.message_id} : ${e.message}`);
      }
    }

    res.json({ total: rows.length, analyzed: done });
  } catch (err) {
    logger.error(`[/api/gmail/analyze] ${err.message}`);
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
      'SELECT * FROM gmail_promos ORDER BY received_at DESC LIMIT 100'
    ).all();
    res.json(rows.map(r => ({
      ...r,
      category:         r.category || guessCategoryFromEmail((r.subject || '') + ' ' + (r.snippet || '') + ' ' + (r.sender || '')),
      extracted_promos: r.extracted_promos ? JSON.parse(r.extracted_promos) : [],
      ai_summary:       r.ai_summary ? JSON.parse(r.ai_summary) : null,
      gmail_link:       `https://mail.google.com/mail/u/0/#all/${r.message_id}`
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------------------------------------------
// Scan emails promos (logique interne)
// ---------------------------------------------------------------
async function scanPromoEmails(days = 7) {
  const gmail  = google.gmail({ version: 'v1', auth: oauth2Client });
  const db     = getDb();
  const since  = Math.floor(Date.now() / 1000) - (86400 * days);

  // Uniquement les emails de l'onglet Promotions Gmail
  const query = `category:promotions after:${since}`;

  logger.info(`[Gmail] Scan emails promos...`);

  const listRes = await gmail.users.messages.list({
    userId: 'me',
    q: query,
    maxResults: 100
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
      format: 'full'
    });

    const headers  = detail.data.payload?.headers || [];
    const subject  = headers.find(h => h.name === 'Subject')?.value || '';
    const sender   = headers.find(h => h.name === 'From')?.value    || '';
    const date     = headers.find(h => h.name === 'Date')?.value    || '';
    const snippet  = detail.data.snippet || '';

    const extracted = extractPromosFromText(subject + ' ' + snippet);
    const category  = guessCategoryFromEmail(subject + ' ' + snippet + ' ' + sender);

    // Vision N'EST PAS appelé automatiquement au scan — utiliser le bouton "Analyser avec Vision"
    db.prepare(`
      INSERT OR IGNORE INTO gmail_promos
        (message_id, subject, sender, snippet, extracted_promos, category, ai_summary, received_at, processed_at, used_ai)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, datetime('now'), 0)
    `).run(msg.id, subject, sender, snippet, JSON.stringify(extracted), category, date);

    saved.push({ message_id: msg.id, subject, sender, extracted, category });
  }

  logger.info(`[Gmail] ${saved.length} email(s) enregistré(s)`);
  return { scanned: messages.length, saved: saved.length, items: saved };
}

function guessCategoryFromEmail(text) {
  const t = text.toLowerCase();
  if (/pok[eé]mon|lorcana|magic|yu-?gi-?oh|carte(s)?\s*(tcg|trading)|booster|deck/.test(t)) return 'TCG';
  if (/\blego\b/.test(t)) return 'Lego';
  if (/jeux?\s*vid[eé]o|playstation|xbox|nintendo|steam|gaming|ps[45]\b|switch/.test(t)) return 'JeuxVideo';
  if (/jeux?\s*de\s*soci[eé]t[eé]|plateau|boardgame|asmodee|ravensburger/.test(t)) return 'JeuxSociete';
  if (/veepee|vente.priv[eé]e|vente\s+flash/.test(t)) return 'VentePrivee';
  return 'Général';
}

function getHtmlBody(payload) {
  if (!payload) return null;
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    return Buffer.from(payload.body.data, 'base64url').toString('utf8');
  }
  for (const part of (payload.parts || [])) {
    const result = getHtmlBody(part);
    if (result) return result;
  }
  return null;
}

function extractImageUrls(html, limit = 6) {
  const urls = [];
  const regex = /<img[^>]+src=["']([^"']+)["']/gi;
  let m;
  while ((m = regex.exec(html)) !== null && urls.length < limit) {
    const url = m[1];
    if (/^https:\/\//i.test(url) && !/spacer|pixel|track|beacon|1x1|open\.gif|logo/i.test(url)) {
      urls.push(url);
    }
  }
  return urls;
}

function downloadImage(url, maxRedirects = 5) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': process.env.SCRAPE_USER_AGENT || 'Mozilla/5.0' },
      timeout: 8000
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (maxRedirects <= 0) return resolve(null);
        return downloadImage(res.headers.location, maxRedirects - 1).then(resolve).catch(() => resolve(null));
      }
      if (res.statusCode !== 200) { res.resume(); return resolve(null); }
      const contentType = res.headers['content-type'] || 'image/jpeg';
      const mediaType = contentType.split(';')[0].trim();
      if (!mediaType.startsWith('image/')) { res.resume(); return resolve(null); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ data: Buffer.concat(chunks).toString('base64'), mediaType }));
      res.on('error', () => resolve(null));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function analyzeWithVision(imageUrls) {
  if (!process.env.ANTHROPIC_API_KEY || !imageUrls.length) return null;
  try {
    // Télécharger les images côté serveur → base64
    const downloads = await Promise.all(imageUrls.map(u => downloadImage(u)));
    const images = downloads.filter(Boolean);
    if (!images.length) return null;

    const { text } = await callHaikuVision({
      images,
      prompt: VISION_PROMPT,
      purpose: 'gmail_vision',
      maxTokens: 512
    });

    // Parsing robuste : extraire le JSON même si Claude ajoute du texte autour
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed.offres?.length ? parsed.offres : null;
  } catch (err) {
    logger.warn(`[Gmail/Vision] Erreur : ${err.message}`);
    return null;
  }
}

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
