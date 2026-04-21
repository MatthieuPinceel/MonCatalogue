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

  const userMsg = items.map((item, i) => {
    const parts = [`[${i}] ID:${item.id} | Titre: ${item.title} | Source: ${item.source} | Prix: ${item.price}€`];
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
      output_config: {
        format: {
          type: 'json_schema',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    id:         { type: 'number' },
                    is_promo:   { type: 'boolean' },
                    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                    reason:     { type: 'string' }
                  },
                  required: ['id', 'is_promo', 'confidence', 'reason']
                }
              }
            },
            required: ['results']
          }
        }
      },
      messages: [{ role: 'user', content: userMsg }]
    });

    const text = response.content.find(b => b.type === 'text')?.text || '{"results":[]}';
    const parsed = JSON.parse(text);

    // Remappe les index 0-based vers les vrais IDs
    return (parsed.results || []).map((r, i) => ({
      id:         items[i]?.id ?? r.id,
      is_promo:   r.is_promo,
      confidence: r.confidence,
      reason:     r.reason
    }));
  } catch (err) {
    logger.error(`[AI Classifier] Erreur : ${err.message}`);
    throw err;
  }
}

const ANALYZE_PROMPT = `Tu es un expert en prix pour les produits TCG (Pokémon, Lorcana, Magic), Lego, jeux vidéo et jeux de société en France.

On te donne un article scrapé depuis une boutique en ligne. Analyse-le et donne :
- verdict : "excellent" (affaire exceptionnelle), "bon" (bon prix), "correct" (prix normal), "moyen" (un peu cher), "mauvais" (pas intéressant)
- score : note de 1 (très mauvais) à 5 (excellent)
- resume : une phrase courte résumant ton avis
- explication : 2-3 phrases expliquant ton raisonnement (prix marché, comparaison, contexte)
- recommandation : conseil concret (ex: "Achetez maintenant", "Attendez les soldes", "Prix habituel, rien d'urgent")

Contexte marché France 2024-2025 :
- Booster Pokémon standard : 4-5€, Display (36 boosters) : 120-150€
- ETB Pokémon : 45-60€, Coffret premium : 30-50€
- Booster Lorcana : 4-5€, Display Lorcana : 100-130€
- Set Lego moyen : 50-80€ (prix public MSRP)
- Jeux PS5/Xbox neufs : 50-70€, Switch : 40-60€

Réponds UNIQUEMENT en JSON valide.`;

/**
 * Analyse un article individuel avec Claude.
 * @param {{id, title, price, original_price, discount_percent, source, category, url}} item
 * @returns {Promise<{verdict, score, resume, explication, recommandation}>}
 */
async function analyzeItem(item) {
  const lines = [
    `Titre : ${item.title}`,
    `Source : ${item.source}`,
    `Catégorie : ${item.category || 'inconnue'}`,
    `Prix actuel : ${item.price}€`,
  ];
  if (item.original_price) lines.push(`Prix original : ${item.original_price}€`);
  if (item.discount_percent) lines.push(`Remise affichée : -${item.discount_percent}%`);
  if (item.url) lines.push(`URL : ${item.url}`);

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 512,
    system: [{ type: 'text', text: ANALYZE_PROMPT, cache_control: { type: 'ephemeral' } }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            verdict:         { type: 'string', enum: ['excellent', 'bon', 'correct', 'moyen', 'mauvais'] },
            score:           { type: 'number' },
            resume:          { type: 'string' },
            explication:     { type: 'string' },
            recommandation:  { type: 'string' }
          },
          required: ['verdict', 'score', 'resume', 'explication', 'recommandation']
        }
      }
    },
    messages: [{ role: 'user', content: lines.join('\n') }]
  });

  const text = response.content.find(b => b.type === 'text')?.text || '{}';
  return JSON.parse(text);
}

module.exports = { classifyItems, analyzeItem };
