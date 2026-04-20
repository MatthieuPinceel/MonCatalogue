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

// ---------------------------------------------------------------
// KING JOUET
// ---------------------------------------------------------------
async function scrapeKingJouet() {
  const source = 'kingjouet';
  const url    = 'https://www.king-jouet.com/bons-plans/toutes-les-promos.htm';
  logger.info(`[Scraper] ${source} — début`);
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.king-jouet.com/').get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('[class*="product-item"], [class*="productItem"], [class*="product_item"]').each((i, el) => {
      const title = $(el).find('[class*="title"], [class*="name"], h2, h3').first().text().trim();
      if (!title || title.length < 3) return;
      const priceNew      = normalizePrice($(el).find('[class*="price-new"], [class*="promo"], [class*="sale"]').first().text());
      const priceOld      = normalizePrice($(el).find('[class*="price-old"], [class*="barre"], [class*="original"]').first().text());
      const price         = priceNew || normalizePrice($(el).find('[class*="price"]').first().text());
      const href          = $(el).find('a').first().attr('href') || '';
      const img           = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || '';
      if (!price) return;
      results.push({
        source, title, price,
        original_price:   priceOld,
        discount_percent: calcDiscount(priceOld, price),
        url:       href.startsWith('http') ? href : `https://www.king-jouet.com${href}`,
        image_url: img.startsWith('http') ? img : (img ? `https://www.king-jouet.com${img}` : null),
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
// MICROMANIA
// ---------------------------------------------------------------
async function scrapeMicromania() {
  const source = 'micromania';
  const url    = 'https://www.micromania.fr/offres-et-promos';
  logger.info(`[Scraper] ${source} — début`);
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.micromania.fr/').get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('li.product-item, .product-item-info, [class*="product-card"]').each((i, el) => {
      const title    = $(el).find('[class*="product-item-name"], [class*="product-name"]').first().text().trim();
      if (!title) return;
      const priceNew = normalizePrice($(el).find('.special-price .price, [class*="price-final"] .price').first().text());
      const priceOld = normalizePrice($(el).find('.old-price .price, [class*="regular"] .price').first().text());
      const price    = priceNew || normalizePrice($(el).find('.price').first().text());
      if (!price) return;
      const href = $(el).find('a').first().attr('href') || '';
      const img  = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || '';
      results.push({
        source, title, price,
        original_price:   priceOld,
        discount_percent: calcDiscount(priceOld, price),
        url:       href.startsWith('http') ? href : `https://www.micromania.fr${href}`,
        image_url: img || null,
        category:  guessCategoryFromTitle(title) || 'JeuxVideo',
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
// FNAC — API JSON publique (évite les 403 HTML)
// ---------------------------------------------------------------
async function scrapeFnac() {
  const source = 'fnac';
  logger.info(`[Scraper] ${source} — début`);
  const urls = [
    'https://www.fnac.com/Jeux-de-societe/ar-Jeux-de-soci%C3%A9t%C3%A9/s99254502/w-4',
    'https://www.fnac.com/Jeux-video/a2000/s99254502/w-4'
  ];
  const all = [];
  for (const url of urls) {
    try {
      await sleep(DELAY);
      const { data } = await makeHttp('https://www.fnac.com/').get(url);
      const $ = cheerio.load(data);
      $('li.Article-item, article.Article, .Article-item').each((i, el) => {
        const title    = $(el).find('.Article-title, h3, h2').first().text().trim();
        if (!title || title.length < 3) return;
        const priceNew = normalizePrice($(el).find('[class*="priceBox-price"], [class*="price-final"]').first().text());
        const priceOld = normalizePrice($(el).find('[class*="oldPrice"], [class*="original"]').first().text());
        const price    = priceNew || normalizePrice($(el).find('[class*="price"]').first().text());
        if (!price) return;
        const href = $(el).find('a').first().attr('href') || '';
        all.push({
          source, title, price,
          original_price:   priceOld,
          discount_percent: calcDiscount(priceOld, price),
          url:       href.startsWith('http') ? href : `https://www.fnac.com${href}`,
          image_url: $(el).find('img').first().attr('src') || null,
          category:  guessCategoryFromTitle(title),
          scraped_at: new Date().toISOString()
        });
      });
    } catch (err) {
      logger.error(`[Scraper] ${source} erreur (${url}) : ${err.message}`);
    }
  }
  logger.info(`[Scraper] ${source} — ${all.length} articles`);
  return all;
}

// ---------------------------------------------------------------
// SMYTHS TOYS
// ---------------------------------------------------------------
async function scrapeSmyths() {
  const source = 'smyths';
  const url    = 'https://www.smythstoys.com/fr/fr-fr/offres-speciales/c/SSO01';
  logger.info(`[Scraper] ${source} — début`);
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.smythstoys.com/fr/fr-fr/').get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('[class*="product"], [class*="Product"]').each((i, el) => {
      const title = $(el).find('[class*="productName"], [class*="product-name"], [class*="ProductName"], h2, h3').first().text().trim();
      if (!title || title.length < 3) return;
      const priceNew = normalizePrice($(el).find('[class*="salePrice"], [class*="special"], [class*="now"], [class*="sale"]').first().text());
      const priceOld = normalizePrice($(el).find('[class*="wasPrice"], [class*="original"], [class*="old"]').first().text());
      const price    = priceNew || normalizePrice($(el).find('[class*="price"], [class*="Price"]').first().text());
      if (!price) return;
      const href = $(el).find('a').first().attr('href') || '';
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
    logger.info(`[Scraper] ${source} — ${results.length} articles`);
    return results;
  } catch (err) {
    logger.error(`[Scraper] ${source} erreur : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// FURET DU NORD
// ---------------------------------------------------------------
async function scrapeFuretDuNord() {
  const source = 'furetdunord';
  const url    = 'https://www.furet.com/jeux-et-jouets/jeux-de-societe/promotions.html';
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
  const url    = 'https://www.philibertnet.com/fr/33-promotions';
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
  const url    = 'https://www.cultura.com/c/jeux?prefn1=isOnSale&prefv1=true';
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
