'use strict';

/**
 * Service Cardmarket — scraping HTML avec Cheerio.
 * Cardmarket n'a pas d'API publique gratuite exploitable,
 * on scrape le site en respectant un délai minimal.
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const logger  = require('./logger');
const cache   = require('./cache');

const BASE_URL  = 'https://www.cardmarket.com/fr';
const DELAY_MS  = Number.parseInt(process.env.SCRAPE_DELAY_MS || '2000', 10);
const UA        = process.env.SCRAPE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

const axiosInstance = axios.create({
  timeout: 15000,
  headers: {
    'User-Agent': UA,
    'Accept-Language': 'fr-FR,fr;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  }
});

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Recherche le prix d'une carte Pokémon sur Cardmarket.
 * @param {string} cardName   ex: "Pikachu"
 * @param {string} [setName]  ex: "Base Set" (optionnel pour affiner)
 * @returns {Promise<{name, setName, priceFrom, priceTrend, url}|null>}
 */
async function getPokemonCardPrice(cardName, setName) {
  const cacheKey = `cardmarket_pokemon_${cardName}_${setName || ''}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const query   = encodeURIComponent(cardName);
  const searchUrl = `${BASE_URL}/Pokemon/Products/Singles?searchString=${query}`;

  try {
    await sleep(DELAY_MS);
    const { data } = await axiosInstance.get(searchUrl);
    const $         = cheerio.load(data);

    const result = null;
    const items  = [];

    // Cardmarket liste les cartes dans des tableaux avec des lignes .article-row
    $('.table-body .row').each((i, el) => {
      const name      = $(el).find('.col-title a').first().text().trim();
      const set       = $(el).find('.col-expansion a').first().text().trim();
      const priceFrom = $(el).find('.col-price .price-container').first().text()
        .replace(/[^\d,.]/g, '').replace(',', '.').trim();

      if (name) {
        items.push({
          name,
          setName: set,
          priceFrom: Number.parseFloat(priceFrom) || null,
          url: BASE_URL + ($(el).find('.col-title a').attr('href') || '')
        });
      }
    });

    // Filtrer par set si fourni
    let match = items.find(it =>
      it.name.toLowerCase().includes(cardName.toLowerCase()) &&
      (!setName || it.setName.toLowerCase().includes(setName.toLowerCase()))
    ) || items[0] || null;

    if (match) {
      cache.set(cacheKey, match, 3600); // cache 1h
      logger.info(`[Cardmarket] ${cardName} → ${match.priceFrom} €`);
    } else {
      logger.warn(`[Cardmarket] Aucun résultat pour "${cardName}"`);
    }

    return match;
  } catch (err) {
    logger.error(`[Cardmarket] Erreur scraping "${cardName}" : ${err.message}`);
    return null;
  }
}

/**
 * Scrape le prix d'une carte Lorcana sur Cardmarket.
 */
async function getLorcanaCardPrice(cardName) {
  const cacheKey = `cardmarket_lorcana_${cardName}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const query     = encodeURIComponent(cardName);
  const searchUrl = `${BASE_URL}/Lorcana/Products/Singles?searchString=${query}`;

  try {
    await sleep(DELAY_MS);
    const { data } = await axiosInstance.get(searchUrl);
    const $         = cheerio.load(data);
    const items     = [];

    $('.table-body .row').each((i, el) => {
      const name      = $(el).find('.col-title a').first().text().trim();
      const priceFrom = $(el).find('.col-price .price-container').first().text()
        .replace(/[^\d,.]/g, '').replace(',', '.').trim();
      if (name) {
        items.push({
          name,
          priceFrom: Number.parseFloat(priceFrom) || null,
          url: BASE_URL + ($(el).find('.col-title a').attr('href') || '')
        });
      }
    });

    const match = items[0] || null;
    if (match) {
      cache.set(cacheKey, match, 3600);
      logger.info(`[Cardmarket/Lorcana] ${cardName} → ${match.priceFrom} €`);
    }
    return match;
  } catch (err) {
    logger.error(`[Cardmarket/Lorcana] Erreur : ${err.message}`);
    return null;
  }
}

module.exports = { getPokemonCardPrice, getLorcanaCardPrice };
