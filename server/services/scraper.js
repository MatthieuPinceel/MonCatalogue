'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const logger  = require('./logger');

const DELAY = parseInt(process.env.SCRAPE_DELAY_MS || '1500', 10);
const UA    = process.env.SCRAPE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function makeHttp(referer) {
  return axios.create({
    timeout: 20000,
    headers: {
      'User-Agent':      UA,
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Connection':      'keep-alive',
      'Upgrade-Insecure-Requests': '1',
      'Sec-Fetch-Dest':  'document',
      'Sec-Fetch-Mode':  'navigate',
      'Sec-Fetch-Site':  'none',
      'Sec-Fetch-User':  '?1',
      'Cache-Control':   'max-age=0',
      ...(referer ? { 'Referer': referer } : {})
    },
    maxRedirects: 5
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizePrice(str, maxPrice = 500) {
  if (!str) return null;
  const cleaned = String(str).replace(/\s/g, '').replace(/[^\d,\.]/g, '').replace(',', '.').trim();
  const val = parseFloat(cleaned);
  return isNaN(val) || val <= 0 || val > maxPrice ? null : val;
}

function calcDiscount(original, sale) {
  if (!original || !sale || original <= sale) return null;
  return Math.round((1 - sale / original) * 100);
}

// ---------------------------------------------------------------
// Stubs — sites bloqués anti-bot (couverts par Gmail)
// ---------------------------------------------------------------
async function scrapeKingJouet()  { logger.info(`[Scraper] kingjouet — ignoré (Cloudflare)`);    return []; }
async function scrapeMicromania() { logger.info(`[Scraper] micromania — ignoré (Cloudflare)`);   return []; }
async function scrapeFnac()       { logger.info(`[Scraper] fnac — ignoré (anti-bot)`);            return []; }
async function scrapeSmyths()     { logger.info(`[Scraper] smyths — ignoré (anti-bot)`);          return []; }
async function scrapeFuretDuNord(){ logger.info(`[Scraper] furetdunord — ignoré (403)`);          return []; }

// ---------------------------------------------------------------
// PHILIBERT — fonction partagée promo + catalogue
// ---------------------------------------------------------------
async function scrapePhilibertPage(url, defaultCategory, itemType = 'promo') {
  const source   = 'philibert';
  const maxPrice = itemType === 'catalog' ? 1500 : 500;
  logger.info(`[Scraper] ${source} (${itemType}) — ${url}`);
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.philibertnet.com/fr/').get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('li.ajax_block_product').each((i, el) => {
      const titleEl = $(el).find('a.product_img_link, .wrapper_product_2 a, h5 a, a[class*="product_name"]').first();
      const title   = titleEl.text().trim() || $(el).find('a[title]').first().attr('title') || '';
      if (!title || title.length < 3) return;
      const priceOld = normalizePrice($(el).find('.old-price, s, [class*="old"]').first().text(), maxPrice);
      const priceNew = normalizePrice($(el).find('.product-price, .price:not(s):not(.old-price)').first().text(), maxPrice);
      const price    = priceNew || priceOld;
      if (!price) return;
      const href = titleEl.attr('href') || $(el).find('a').first().attr('href') || '';
      results.push({
        source, title, price,
        original_price:   priceOld && priceNew && priceOld !== priceNew ? priceOld : null,
        discount_percent: calcDiscount(priceOld, priceNew),
        url:       href.startsWith('http') ? href : `https://www.philibertnet.com${href}`,
        image_url: $(el).find('img').first().attr('src') || null,
        category:  guessCategoryFromTitle(title) || defaultCategory || 'JeuxSociete',
        item_type: itemType,
        scraped_at: new Date().toISOString()
      });
    });
    logger.info(`[Scraper] ${source} (${itemType}) — ${results.length} articles`);
    return results;
  } catch (err) {
    logger.error(`[Scraper] ${source} erreur : ${err.message}`);
    return [];
  }
}

async function scrapePhilibert() {
  return scrapePhilibertPage('https://www.philibertnet.com/fr/promotions', null, 'promo');
}

// ---------------------------------------------------------------
// CULTURA — fonction partagée promo + catalogue
// ---------------------------------------------------------------
async function scrapeCulturaPage(url, defaultCategory, itemType = 'promo') {
  const source   = 'cultura';
  const maxPrice = itemType === 'catalog' ? 1500 : 500;
  logger.info(`[Scraper] ${source} (${itemType}) — ${url}`);
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.cultura.com/').get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('.one-product, .one-card--product').each((i, el) => {
      const title = $(el).find('.one-product__desc__name, [class*="product__desc__name"], [class*="product__name"]').first().text().trim()
                 || $(el).find('a[title]').first().attr('title') || '';
      if (!title || title.length < 3) return;
      const priceNew = normalizePrice($(el).find('[class*="price--sale"], [class*="price-sale"], [class*="promo"]').first().text(), maxPrice);
      const priceOld = normalizePrice($(el).find('[class*="price--old"], [class*="price-old"], s').first().text(), maxPrice);
      const price    = priceNew || normalizePrice($(el).find('[class*="price"]').first().text(), maxPrice);
      if (!price) return;
      const href = $(el).find('a').first().attr('href') || '';
      results.push({
        source, title, price,
        original_price:   priceOld,
        discount_percent: calcDiscount(priceOld, price),
        url:       href.startsWith('http') ? href : `https://www.cultura.com${href}`,
        image_url: $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || null,
        category:  guessCategoryFromTitle(title) || defaultCategory,
        item_type: itemType,
        scraped_at: new Date().toISOString()
      });
    });
    logger.info(`[Scraper] ${source} (${itemType}) — ${results.length} articles`);
    return results;
  } catch (err) {
    logger.error(`[Scraper] ${source} erreur : ${err.message}`);
    return [];
  }
}

async function scrapeCultura() {
  return scrapeCulturaPage('https://www.cultura.com/les-promotions.html', null, 'promo');
}

// ---------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------
const CATEGORY_PATTERNS = [
  { pattern: /pokemon|lorcana|magic|yugioh|one piece|tcg|carte.a.collectionner/i, category: 'TCG' },
  { pattern: /lego|technic|duplo/i,                                               category: 'Lego' },
  { pattern: /playstation|xbox|nintendo|switch|ps[45]|jeu.vid/i,                  category: 'JeuxVideo' },
  { pattern: /jeu.de.soci|plateau|extension|deck|figurin/i,                       category: 'JeuxSociete' }
];

function guessCategoryFromTitle(title) {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(title)) return category;
  }
  return null;
}

// ---------------------------------------------------------------
// Scrapers de promos
// ---------------------------------------------------------------
const SCRAPERS = {
  kingjouet:   scrapeKingJouet,
  micromania:  scrapeMicromania,
  fnac:        scrapeFnac,
  smyths:      scrapeSmyths,
  furetdunord: scrapeFuretDuNord,
  philibert:   scrapePhilibert,
  cultura:     scrapeCultura
};

// ---------------------------------------------------------------
// Scrapers de catalogue (pages catégories, hors promo)
// ---------------------------------------------------------------
// URLs vérifiées manuellement — désactiver si 404, corriger avec les bonnes URLs
const CATALOG_SCRAPERS = {
  // ✅ Confirmées
  'cultura-pokemon': () => scrapeCulturaPage('https://www.cultura.com/cartes-a-jouer/cartes-pokemon.html', 'TCG', 'catalog'),
  'cultura-lorcana': () => scrapeCulturaPage('https://www.cultura.com/cartes-a-jouer/cartes-lorcana.html', 'TCG', 'catalog'),
  // ❓ À corriger (URLs 404) — décommenter une fois les bonnes URLs trouvées
  // 'cultura-magic':  () => scrapeCulturaPage('???', 'TCG', 'catalog'),
  // 'cultura-lego':   () => scrapeCulturaPage('???', 'Lego', 'catalog'),
  // 'cultura-jv':     () => scrapeCulturaPage('???', 'JeuxVideo', 'catalog'),
  // 'philibert-tcg':  () => scrapePhilibertPage('???', 'TCG', 'catalog'),
  // 'philibert-js':   () => scrapePhilibertPage('???', 'JeuxSociete', 'catalog'),
};

async function scrapeAll(only) {
  const keys = only && only.length ? only : Object.keys(SCRAPERS);
  const all  = [];
  for (const key of keys) {
    if (!SCRAPERS[key]) { logger.warn(`[Scraper] Scraper inconnu : "${key}"`); continue; }
    all.push(...await SCRAPERS[key]());
    await sleep(DELAY);
  }
  logger.info(`[Scraper] Total promos : ${all.length} articles`);
  return all;
}

async function scrapeAllCatalog(only) {
  const keys = only && only.length ? only : Object.keys(CATALOG_SCRAPERS);
  const all  = [];
  for (const key of keys) {
    if (!CATALOG_SCRAPERS[key]) { logger.warn(`[Scraper] Catalogue inconnu : "${key}"`); continue; }
    all.push(...await CATALOG_SCRAPERS[key]());
    await sleep(DELAY);
  }
  logger.info(`[Scraper] Total catalogue : ${all.length} articles`);
  return all;
}

module.exports = { scrapeAll, scrapeAllCatalog, SCRAPERS, CATALOG_SCRAPERS, guessCategoryFromTitle };
