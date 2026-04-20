'use strict';

/**
 * Service Anthropic / Claude Haiku 4.5
 *
 * Règles d'utilisation strictes (budget 3 €/mois) :
 *  - Ne jamais appeler si Cheerio ou une API JSON peut faire le travail
 *  - Cas autorisés : parser emails complexes, scraper sites sans structure
 *    exploitable, générer le résumé hebdomadaire
 *  - Bloquer si coût mensuel > ANTHROPIC_MONTHLY_LIMIT_USD ($)
 */

const https  = require('https');
const logger = require('./logger');
const { getDb } = require('../db/init');

const MODEL         = 'claude-haiku-4-5-20251001';
const LIMIT_USD     = parseFloat(process.env.ANTHROPIC_MONTHLY_LIMIT_USD || '2.50');
// Coût Claude Haiku 4.5 : $0.80/M tokens input, $4.00/M tokens output (avril 2025)
const COST_INPUT    = 0.80  / 1_000_000;
const COST_OUTPUT   = 4.00  / 1_000_000;

/**
 * Retourne le coût cumulé du mois en cours (en USD).
 */
function getMonthlySpend() {
  const db   = getDb();
  const from = new Date();
  from.setDate(1);
  from.setHours(0, 0, 0, 0);
  const row = db.prepare(
    `SELECT COALESCE(SUM(cost_usd), 0) AS total
     FROM api_usage
     WHERE service = 'anthropic' AND created_at >= ?`
  ).get(from.toISOString());
  return row ? row.total : 0;
}

/**
 * Enregistre l'utilisation en base.
 */
function recordUsage({ model, tokensInput, tokensOutput, costUsd, purpose }) {
  const db = getDb();
  db.prepare(
    `INSERT INTO api_usage (service, model, tokens_input, tokens_output, cost_usd, purpose, created_at)
     VALUES ('anthropic', ?, ?, ?, ?, ?, datetime('now'))`
  ).run(model, tokensInput, tokensOutput, costUsd, purpose || null);
}

/**
 * Appelle Claude Haiku via l'API Anthropic REST (sans SDK pour alléger les dépendances).
 *
 * @param {object} opts
 * @param {string} opts.systemPrompt
 * @param {string} opts.userMessage
 * @param {string} [opts.purpose]   label pour la table api_usage
 * @param {number} [opts.maxTokens] défaut : 1024
 * @returns {Promise<{text: string, tokensInput: number, tokensOutput: number, costUsd: number}>}
 */
async function callHaiku({ systemPrompt, userMessage, purpose, maxTokens = 1024 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY non configurée — appel bloqué');
  }

  const spend = getMonthlySpend();
  if (spend >= LIMIT_USD) {
    logger.warn(`[Anthropic] Budget mensuel atteint (${spend.toFixed(4)} $/${LIMIT_USD} $) — appel bloqué`);
    throw new Error(`Budget Anthropic mensuel épuisé (${spend.toFixed(2)} $)`);
  }

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }]
  });

  logger.info(`[Anthropic] Appel ${purpose || 'n/a'} — budget restant : ${(LIMIT_USD - spend).toFixed(4)} $`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) {
            return reject(new Error(`Anthropic API error: ${json.error.message}`));
          }
          const text         = json.content?.[0]?.text || '';
          const tokensInput  = json.usage?.input_tokens  || 0;
          const tokensOutput = json.usage?.output_tokens || 0;
          const costUsd      = tokensInput * COST_INPUT + tokensOutput * COST_OUTPUT;

          recordUsage({ model: MODEL, tokensInput, tokensOutput, costUsd, purpose });
          logger.info(`[Anthropic] OK — ${tokensInput}+${tokensOutput} tokens, ${costUsd.toFixed(6)} $`);

          resolve({ text, tokensInput, tokensOutput, costUsd });
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Appelle Claude Haiku Vision avec des images (URLs publiques).
 * @param {string[]} imageUrls   URLs des images à analyser
 * @param {string}   prompt      Question/instruction
 * @param {string}   [purpose]
 * @param {number}   [maxTokens]
 */
async function callHaikuVision({ images, prompt, purpose, maxTokens = 1024 }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY non configurée');

  const spend = getMonthlySpend();
  if (spend >= LIMIT_USD) {
    logger.warn(`[Anthropic] Budget atteint (${spend.toFixed(4)} $)`);
    throw new Error(`Budget Anthropic mensuel épuisé`);
  }

  // images : [{ data: base64string, mediaType: 'image/jpeg' }]
  const content = images.map(img => ({
    type: 'image',
    source: { type: 'base64', media_type: img.mediaType || 'image/jpeg', data: img.data }
  }));
  content.push({ type: 'text', text: prompt });

  const body = JSON.stringify({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content }]
  });

  logger.info(`[Anthropic/Vision] ${images.length} image(s) — budget restant : ${(LIMIT_USD - spend).toFixed(4)} $`);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length':    Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.error) return reject(new Error(`Anthropic: ${json.error.message}`));
          const text         = json.content?.[0]?.text || '';
          const tokensInput  = json.usage?.input_tokens  || 0;
          const tokensOutput = json.usage?.output_tokens || 0;
          const costUsd      = tokensInput * COST_INPUT + tokensOutput * COST_OUTPUT;
          recordUsage({ model: MODEL, tokensInput, tokensOutput, costUsd, purpose });
          logger.info(`[Anthropic/Vision] OK — ${tokensInput}+${tokensOutput} tokens, ${costUsd.toFixed(6)} $`);
          resolve({ text, tokensInput, tokensOutput, costUsd });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { callHaiku, callHaikuVision, getMonthlySpend };
