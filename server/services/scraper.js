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

function normalizePrice(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/\s/g, '').replace(/[^\d,\.]/g, '').replace(',', '.').trim();
  const val = parseFloat(cleaned);
  return isNaN(val) || val <= 0 ? null : val;
}

function calcDiscount(original, sale) {
  if (!original || !sale || original <= sale) return null;
  return Math.round((1 - sale / original) * 100);
}

async function scrapeKingJouet() {
  logger.info(`[Scraper] kingjouet — ignoré (Cloudflare, couvert par Gmail)`);
  return [];
}

async function scrapeMicromania() {
  logger.info(`[Scraper] micromania — ignoré (Cloudflare, couvert par Gmail)`);
  return [];
}

async function scrapeFnac() {
  logger.info(`[Scraper] fnac — ignoré (protection anti-bot, couvert par Gmail)`);
  return [];
}

// ---------------------------------------------------------------
// SMYTHS TOYS
// ---------------------------------------------------------------
async function scrapeSmyths() {
  const source = 'smyths';
  const urls   = [
    'https://www.smythstoys.com/fr/fr-fr/jouets/mega-promos/c/mega-promos',
    'https://www.smythstoys.com/fr/fr-fr/jouets/super-promos/c/super-promos'
  ];
  logger.info(`[Scraper] ${source} — début`);
  const results = [];
  for (const url of urls) {
    try {
      await sleep(DELAY);
      const { data } = await makeHttp('https://www.smythstoys.com/fr/fr-fr/').get(url);
      const $ = cheerio.load(data);

      $('.product-item, [class*="productItem"], [class*="product-item"]').each((i, el) => {
        const title = $(el).find('.product__name, [class*="product__name"], [class*="productName"], h2, h3').first().text().trim();
        if (!title || title.length < 3) return;
        const priceNew = normalizePrice($(el).find('[class*="salePrice"], [class*="sale-price"], [class*="now-price"]').first().text());
        const priceOld = normalizePrice($(el).find('[class*="wasPrice"], [class*="was-price"], [class*="old-price"], s').first().text());
        const price    = priceNew || normalizePrice($(el).find('.price, [class*="price"]').first().text());
        if (!price) return;
        const href = $(el).find('a.product__image-link, a').first().attr('href') || '';
        results.push({
          source, title, price,
          original_price:   priceOld,
          discount_percent: calcDiscount(priceOld, price),
          url:       href.startsWith('http') ? href : `https://www.smythstoys.com${href}`,
          image_url: $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || null,
          category:  guessCategoryFromTitle(title),
          scraped_at: new Date().toISOString()
        });
      });
    } catch (err) {
      logger.warn(`[Scraper] ${source} erreur sur ${url} : ${err.message}`);
    }
  }
  logger.info(`[Scraper] ${source} — ${results.length} articles`);
  return results;
}

// ---------------------------------------------------------------
// FURET DU NORD
// ---------------------------------------------------------------
async function scrapeFuretDuNord() {
  const source = 'furetdunord';
  const url    = 'https://www.furet.com/soldes/jeux-de-societe.html';
  logger.info(`[Scraper] ${source} — début`);
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.furet.com/').get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('[class*="product"], article').each((i, el) => {
      const title = $(el).find('[class*="title"], [class*="name"], a[class*="product"], h2, h3').first().text().trim();
      if (!title || title.length < 3) return;
      const priceNew = normalizePrice($(el).find('[class*="promo"], [class*="sale"], [class*="special"]').first().text());
      const priceOld = normalizePrice($(el).find('[class*="old"], [class*="barre"], s').first().text());
      const price    = priceNew || normalizePrice($(el).find('[class*="price"]').first().text());
      if (!price) return;
      const href = $(el).find('a').first().attr('href') || '';
      results.push({
        source, title, price,
        original_price:   priceOld,
        discount_percent: calcDiscount(priceOld, price),
        url:       href.startsWith('http') ? href : `https://www.furet.com${href}`,
        image_url: $(el).find('img').first().attr('src') || null,
        category:  guessCategoryFromTitle(title) || 'JeuxSociete',
        scraped_at: new Date().toISOString()
      });
    });
    logger.info(`[Scraper] ${source} — ${results.length} articles`);
    return results;
  } catch (err) {
    logger.error(`[Scraper] ${source} erreur : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// PHILIBERT
// ---------------------------------------------------------------
async function scrapePhilibert() {
  const source = 'philibert';
  const url    = 'https://www.philibertnet.com/fr/promotions';
  logger.info(`[Scraper] ${source} — début`);
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.philibertnet.com/fr/').get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('article.product-miniature, .js-product-miniature').each((i, el) => {
      const title   = $(el).find('.product-title a, h2, h3').first().text().trim();
      if (!title) return;
      const priceOld = normalizePrice($(el).find('.regular-price, s, .price-regular').first().text());
      const priceNew = normalizePrice($(el).find('.product-price, .price:not(s)').first().text());
      const price    = priceNew || priceOld;
      if (!price) return;
      const href = $(el).find('a').first().attr('href') || '';
      results.push({
        source, title, price,
        original_price:   priceOld && priceNew && priceOld !== priceNew ? priceOld : null,
        discount_percent: calcDiscount(priceOld, priceNew),
        url:       href.startsWith('http') ? href : `https://www.philibertnet.com${href}`,
        image_url: $(el).find('img').first().attr('src') || null,
        category:  'JeuxSociete',
        scraped_at: new Date().toISOString()
      });
    });
    logger.info(`[Scraper] ${source} — ${results.length} articles`);
    return results;
  } catch (err) {
    logger.error(`[Scraper] ${source} erreur : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// CULTURA
// ---------------------------------------------------------------
async function scrapeCultura() {
  const source = 'cultura';
  const url    = 'https://www.cultura.com/les-promotions.html';
  logger.info(`[Scraper] ${source} — début`);
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.cultura.com/').get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('[class*="product-tile"], [class*="ProductTile"], [class*="product-card"]').each((i, el) => {
      const title   = $(el).find('[class*="product-name"], [class*="product-title"], h2, h3').first().text().trim();
      if (!title || title.length < 3) return;
      const priceNew = normalizePrice($(el).find('[class*="price-sale"], [class*="price-promo"], [class*="sale"]').first().text());
      const priceOld = normalizePrice($(el).find('[class*="price-old"], [class*="price-standard"], s').first().text());
      const price    = priceNew || normalizePrice($(el).find('[class*="price"]').first().text());
      if (!price) return;
      const href = $(el).find('a').first().attr('href') || '';
      results.push({
        source, title, price,
        original_price:   priceOld,
        discount_percent: calcDiscount(priceOld, price),
        url:       href.startsWith('http') ? href : `https://www.cultura.com${href}`,
        image_url: $(el).find('img').first().attr('src') || null,
        category:  guessCategoryFromTitle(title),
        scraped_at: new Date().toISOString()
      });
    });
    logger.info(`[Scraper] ${source} — ${results.length} articles`);
    return results;
  } catch (err) {
    logger.error(`[Scraper] ${source} erreur : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// Utilitaires
// ---------------------------------------------------------------
const CATEGORY_PATTERNS = [
  { pattern: /pokemon|lorcana|magic|yugioh|one piece|tcg|carte/i, category: 'TCG' },
  { pattern: /lego|technic|duplo/i,                               category: 'Lego' },
  { pattern: /playstation|xbox|nintendo|switch|ps[45]|jeu.vid/i,  category: 'JeuxVideo' },
  { pattern: /jeu.de.soci|plateau|extension|deck|figurin/i,       category: 'JeuxSociete' }
];

function guessCategoryFromTitle(title) {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(title)) return category;
  }
  return null;
}

const SCRAPERS = {
  kingjouet:   scrapeKingJouet,
  micromania:  scrapeMicromania,
  fnac:        scrapeFnac,
  smyths:      scrapeSmyths,
  furetdunord: scrapeFuretDuNord,
  philibert:   scrapePhilibert,
  cultura:     scrapeCultura
};

async function scrapeAll(only) {
  const keys = only && only.length ? only : Object.keys(SCRAPERS);
  const all  = [];
  for (const key of keys) {
    if (!SCRAPERS[key]) { logger.warn(`[Scraper] Scraper inconnu : "${key}"`); continue; }
    all.push(...await SCRAPERS[key]());
    await sleep(DELAY);
  }
  logger.info(`[Scraper] Total : ${all.length} articles scrappés`);
  return all;
}

module.exports = { scrapeAll, SCRAPERS, guessCategoryFromTitle };
