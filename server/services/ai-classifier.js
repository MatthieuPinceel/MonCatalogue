'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('./logger');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `Tu es un assistant qui analyse des articles scrapés depuis des boutiques en ligne spécialisées (TCG, Lego, jeux vidéo, jeux de société) et détermine si chacun est en promotion ou non.

Pour chaque article, tu reçois : titre, prix actuel, prix original (si disponible), et source.

Règles de classification :
- "promo" : l'article a un prix réduit clairement identifiable (ancien prix barré, mention "solde", "promo", "%" de réduction, prix anormalement bas par rapport au prix habituel du produit)
- "catalog" : prix normal sans réduction visible

Réponds UNIQUEMENT en JSON valide, format : {"results": [{"id": <number>, "is_promo": <boolean>, "confidence": <"high"|"medium"|"low">, "reason": <string courte en français>}]}`;

/**
 * Classifie un lot d'articles via l'API Claude.
 * @param {Array<{id, title, price, original_price, source}>} items
 * @returns {Promise<Array<{id, is_promo, confidence, reason}>>}
 */
async function classifyItems(items) {
  if (!items.length) return [];

  const userMsg = items.map(item => {
    const parts = [`ID:${item.id} | Titre: ${item.title} | Source: ${item.source} | Prix: ${item.price}€`];
    if (item.original_price) parts.push(`| Prix original: ${item.original_price}€`);
    return parts.join(' ');
  }).join('\n');

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 2048,
      system: [
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }
      ],
      messages: [{ role: 'user', content: userMsg }]
    });

    const text = response.content.find(b => b.type === 'text')?.text || '{"results":[]}';

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      logger.error(`[AI Classifier] JSON invalide : ${text.slice(0, 200)}`);
      return [];
    }

    // Utilise r.id (envoyé dans le prompt) pour le remappage correct
    const idMap = Object.fromEntries(items.map(item => [item.id, item]));
    return (parsed.results || [])
      .filter(r => r.id != null && idMap[r.id])
      .map(r => ({
        id:         r.id,
        is_promo:   r.is_promo,
        confidence: r.confidence,
        reason:     r.reason
      }));
  } catch (err) {
    logger.error(`[AI Classifier] Erreur : ${err.message}`);
    throw err;
  }
}

const ANALYZE_PROMPT = `Tu es un assistant qui analyse des articles scrapés depuis des boutiques en ligne et décrit la promotion exacte.

À partir du titre, du prix, du prix original et de la source, identifie et décris précisément la promotion :

- type_promo : le type exact parmi "remise_pourcentage", "prix_barre", "bundle", "solde", "destockage", "prix_normal", "inconnu"
- description : description claire et concise de la promotion (ex: "Booster Pokémon SV09 à -25% chez Fnac", "Display 36 boosters au prix soldé")
- economie_euros : économie en euros calculée (original - actuel), null si indisponible
- economie_pourcentage : pourcentage de remise réel calculé, null si indisponible
- conditions : conditions particulières détectées dans le titre (ex: "offre limitée", "jusqu'au X", "membre uniquement"), null si aucune
- est_promo : true si c'est réellement une promotion, false si c'est le prix catalogue normal

Réponds UNIQUEMENT en JSON valide.`;

/**
 * Analyse un article individuel avec Claude — décrit la promotion exacte.
 * @param {{id, title, price, original_price, discount_percent, source, category, url}} item
 * @returns {Promise<{type_promo, description, economie_euros, economie_pourcentage, conditions, est_promo}>}
 */
async function analyzeItem(item) {
  const lines = [
    `Titre : ${item.title}`,
    `Source : ${item.source}`,
    `Prix actuel : ${item.price}€`,
  ];
  if (item.original_price) lines.push(`Prix original : ${item.original_price}€`);
  if (item.discount_percent) lines.push(`Remise affichée : -${item.discount_percent}%`);
  if (item.category) lines.push(`Catégorie : ${item.category}`);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: [{ type: 'text', text: ANALYZE_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: lines.join('\n') }]
  });

  const text = response.content.find(b => b.type === 'text')?.text || '{}';
  try {
    return JSON.parse(text);
  } catch (e) {
    logger.error(`[AI Classifier/analyze] JSON invalide : ${text.slice(0, 200)}`);
    return { type_promo: 'inconnu', description: item.title, economie_euros: null, economie_pourcentage: null, conditions: null, est_promo: false };
  }
}

module.exports = { classifyItems, analyzeItem };
