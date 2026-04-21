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
            properties: {
              results: {
                type: 'array',
                items: {
                  type: 'object',
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

module.exports = { classifyItems };
