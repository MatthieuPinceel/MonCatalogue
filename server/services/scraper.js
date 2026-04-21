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
// Stubs — sites toujours bloqués
// ---------------------------------------------------------------
async function scrapeFnac()       { logger.info(`[Scraper] fnac — ignoré (anti-bot)`);  return []; }
async function scrapeFuretDuNord(){ logger.info(`[Scraper] furetdunord — ignoré (403)`); return []; }

// ---------------------------------------------------------------
// DEALABS — flux RSS (pas de scraping, XML public)
// ---------------------------------------------------------------
function extractPricesFromText(text) {
  const matches = [...text.matchAll(/(\d+[,\.]\d{1,2})\s*€/g)]
    .map(m => parseFloat(m[1].replace(',', '.')))
    .filter(v => v > 0 && v < 1500);
  if (!matches.length) return { price: null, original_price: null };
  if (matches.length === 1) return { price: matches[0], original_price: null };
  return { price: Math.min(...matches), original_price: Math.max(...matches) };
}

async function scrapeDealabsRSS(feedUrl, category) {
  logger.info(`[Scraper] dealabs RSS — ${feedUrl}`);
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.dealabs.com/').get(feedUrl);
    const $       = cheerio.load(data, { xmlMode: true });
    const results = [];
    const now     = new Date().toISOString();

    $('item').each((i, el) => {
      const title   = $(el).find('title').text().trim();
      const url     = $(el).find('link').text().trim() || $(el).find('guid').text().trim();
      const pubDate = $(el).find('pubDate').text().trim();
      if (!title || !url) return;

      const { price, original_price } = extractPricesFromText(title);
      if (!price) return;

      results.push({
        source:           'dealabs',
        title,
        price,
        original_price,
        discount_percent: calcDiscount(original_price, price),
        url,
        image_url:        null,
        category,
        item_type:        'promo',
        scraped_at:       pubDate ? new Date(pubDate).toISOString() : now
      });
    });

    logger.info(`[Scraper] dealabs (${category}) — ${results.length} deals`);
    return results;
  } catch (err) {
    logger.error(`[Scraper] dealabs erreur : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// KING JOUET — HTML serveur, Cheerio OK, pagination /pageN.htm
// ---------------------------------------------------------------
async function scrapeKingJouetPage(url, category, itemType = 'promo') {
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.king-jouet.com/').get(url);
    const $        = cheerio.load(data);
    const results  = [];
    const maxPrice = itemType === 'catalog' ? 1500 : 500;

    // Sélecteurs King Jouet (PrestaShop-like)
    $('article.product-miniature, .produit-vignette, [class*="product-item"]').each((i, el) => {
      const title = $(el).find('[class*="product-title"], [class*="produit-lib"], h2, h3').first().text().trim()
                 || $(el).find('a[title]').first().attr('title') || '';
      if (!title || title.length < 3) return;
      const priceOld = normalizePrice($(el).find('[class*="regular-price"], [class*="old-price"], s, del').first().text(), maxPrice);
      const priceNew = normalizePrice($(el).find('[class*="price-sale"], [class*="product-price"], .price').first().text(), maxPrice);
      const price    = priceNew || priceOld;
      if (!price) return;
      const href = $(el).find('a').first().attr('href') || '';
      results.push({
        source: 'kingjouet', title, price,
        original_price:   priceOld && priceNew && priceOld !== priceNew ? priceOld : null,
        discount_percent: calcDiscount(priceOld, priceNew),
        url:       href.startsWith('http') ? href : `https://www.king-jouet.com${href}`,
        image_url: $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || null,
        category:  guessCategoryFromTitle(title) || category,
        item_type: itemType,
        scraped_at: new Date().toISOString()
      });
    });
    return results;
  } catch (err) {
    logger.error(`[Scraper] kingjouet erreur sur ${url} : ${err.message}`);
    return [];
  }
}

async function scrapeKingJouetPaginated(baseUrl, category, itemType = 'promo', maxPages = 3) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const url   = baseUrl.replace('page1.htm', `page${page}.htm`);
    const items = await scrapeKingJouetPage(url, category, itemType);
    all.push(...items);
    if (items.length < 5) break; // Dernière page probablement
    await sleep(DELAY);
  }
  logger.info(`[Scraper] kingjouet (${itemType}) — ${all.length} articles (${maxPages} pages max)`);
  return all;
}

async function scrapeKingJouet() {
  return scrapeKingJouetPaginated('https://www.king-jouet.com/jeux-jouets/promotions/page1.htm', null, 'promo');
}

// ---------------------------------------------------------------
// MICROMANIA — HTML serveur bien structuré
// ---------------------------------------------------------------
async function scrapeMicromaniaPage(url, category, itemType = 'promo') {
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.micromania.fr/').get(url);
    const $        = cheerio.load(data);
    const results  = [];
    const maxPrice = itemType === 'catalog' ? 1500 : 500;

    $('[class*="product-item"], [class*="product-tile"], article[class*="product"]').each((i, el) => {
      const title = $(el).find('[class*="product-name"], [class*="product-title"], h2, h3').first().text().trim()
                 || $(el).find('a[title]').first().attr('title') || '';
      if (!title || title.length < 3) return;
      const priceOld = normalizePrice($(el).find('[class*="old-price"], [class*="price-old"], s, del').first().text(), maxPrice);
      const priceNew = normalizePrice($(el).find('[class*="price-sale"], [class*="special-price"], [class*="price-final"]').first().text()
                    || $(el).find('[class*="price"]').first().text(), maxPrice);
      const price    = priceNew || priceOld;
      if (!price) return;
      const href = $(el).find('a').first().attr('href') || '';
      results.push({
        source: 'micromania', title, price,
        original_price:   priceOld && priceNew && priceOld !== priceNew ? priceOld : null,
        discount_percent: calcDiscount(priceOld, priceNew),
        url:       href.startsWith('http') ? href : `https://www.micromania.fr${href}`,
        image_url: $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || null,
        category:  guessCategoryFromTitle(title) || category,
        item_type: itemType,
        scraped_at: new Date().toISOString()
      });
    });
    return results;
  } catch (err) {
    logger.error(`[Scraper] micromania erreur sur ${url} : ${err.message}`);
    return [];
  }
}

async function scrapeMicromania() {
  const results = await scrapeMicromaniaPage('https://www.micromania.fr/promotions', null, 'promo');
  logger.info(`[Scraper] micromania — ${results.length} articles`);
  return results;
}

// ---------------------------------------------------------------
// SMYTHS — HTML serveur propre
// ---------------------------------------------------------------
async function scrapeSmythsPage(url, category, itemType = 'promo') {
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.smythstoys.com/fr/').get(url);
    const $        = cheerio.load(data);
    const results  = [];
    const maxPrice = itemType === 'catalog' ? 1500 : 500;

    $('[class*="product-item"], [class*="productItem"], [class*="product-tile"]').each((i, el) => {
      const title = $(el).find('[class*="product-name"], [class*="productName"], h2, h3').first().text().trim()
                 || $(el).find('a[title]').first().attr('title') || '';
      if (!title || title.length < 3) return;
      const priceOld = normalizePrice($(el).find('[class*="was-price"], [class*="old-price"], s').first().text(), maxPrice);
      const priceNew = normalizePrice($(el).find('[class*="now-price"], [class*="sale-price"], [class*="current-price"]').first().text()
                    || $(el).find('[class*="price"]').first().text(), maxPrice);
      const price    = priceNew || priceOld;
      if (!price) return;
      const href = $(el).find('a').first().attr('href') || '';
      results.push({
        source: 'smyths', title, price,
        original_price:   priceOld && priceNew && priceOld !== priceNew ? priceOld : null,
        discount_percent: calcDiscount(priceOld, priceNew),
        url:       href.startsWith('http') ? href : `https://www.smythstoys.com${href}`,
        image_url: $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-lazy') || null,
        category:  guessCategoryFromTitle(title) || category,
        item_type: itemType,
        scraped_at: new Date().toISOString()
      });
    });
    return results;
  } catch (err) {
    logger.error(`[Scraper] smyths erreur sur ${url} : ${err.message}`);
    return [];
  }
}

async function scrapeSmyths() { return []; } // Pas de page promo dédiée confirmée

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
  // Sites avec pages promos dédiées
  kingjouet:              scrapeKingJouet,
  'kingjouet-promo-lego': () => scrapeKingJouetPaginated('https://www.king-jouet.com/jeux-jouets/promotions/marque-lego/page1.htm', 'Lego', 'promo'),
  'kingjouet-promo-js':   () => scrapeKingJouetPaginated('https://www.king-jouet.com/jeux-jouets/jeux-de-societe-promotion/page1.htm', 'JeuxSociete', 'promo'),
  micromania:             scrapeMicromania,
  fnac:                   scrapeFnac,
  smyths:                 scrapeSmyths,
  furetdunord:            scrapeFuretDuNord,
  philibert:              scrapePhilibert,
  'philibert-occasions':  () => scrapePhilibertPage('https://www.philibertnet.com/fr/214-occasions', null, 'promo'),
  cultura:                scrapeCultura,
  'cultura-promo-jv':     () => scrapeCulturaPage('https://www.cultura.com/jeux-video-consoles/promotions-jeux-video.html', 'JeuxVideo', 'promo'),
  // Dealabs RSS — pas de scraping, XML public, très fiable
  'dealabs-pokemon':      () => scrapeDealabsRSS('https://www.dealabs.com/rss/groupes/pokemon',     'TCG'),
  'dealabs-lego':         () => scrapeDealabsRSS('https://www.dealabs.com/rss/groupes/lego',        'Lego'),
  'dealabs-jv':           () => scrapeDealabsRSS('https://www.dealabs.com/rss/groupes/jeux-video',  'JeuxVideo'),
  'dealabs-jouets':       () => scrapeDealabsRSS('https://www.dealabs.com/rss/groupes/jeux-jouets', null),
};

// ---------------------------------------------------------------
// Scrapers de catalogue (pages catégories, hors promo)
// ---------------------------------------------------------------
// URLs vérifiées manuellement — à mettre à jour si une page disparaît
const CATALOG_SCRAPERS = {
  // Cultura — TCG
  'cultura-pokemon': () => scrapeCulturaPage('https://www.cultura.com/jeux-video-consoles/cartes-a-jouer/cartes-pokemon.html', 'TCG',  'catalog'),
  'cultura-lorcana': () => scrapeCulturaPage('https://www.cultura.com/jeux-video-consoles/cartes-a-jouer/cartes-lorcana.html', 'TCG',  'catalog'),
  'cultura-magic':   () => scrapeCulturaPage('https://www.cultura.com/jeux-video-consoles/cartes-a-jouer/cartes-magic.html',   'TCG',  'catalog'),
  // Cultura — Lego & JV
  'cultura-lego':    () => scrapeCulturaPage('https://www.cultura.com/univers-enfant/jeux-jouets/jeux-de-construction/lego/tous-les-produits-lego.html', 'Lego', 'catalog'),
  'cultura-jv':      () => scrapeCulturaPage('https://www.cultura.com/jeux-video-consoles.html', 'JeuxVideo', 'catalog'),
  // Philibert — TCG
  'philibert-pokemon': () => scrapePhilibertPage('https://www.philibertnet.com/fr/212-pokemon',        'TCG',        'catalog'),
  'philibert-lorcana': () => scrapePhilibertPage('https://www.philibertnet.com/fr/15880-lorcana',      'TCG',        'catalog'),
  'philibert-tcg':     () => scrapePhilibertPage('https://www.philibertnet.com/fr/119-jeux-de-cartes', 'TCG',        'catalog'),
  'philibert-js':      () => scrapePhilibertPage('https://www.philibertnet.com/fr/50-jeux-de-societe', 'JeuxSociete','catalog'),
  // King Jouet — catalogue
  'kingjouet-pokemon': () => scrapeKingJouetPaginated('https://www.king-jouet.com/jeux-jouets/Pokemon/page1.htm',                                                  'TCG',  'catalog'),
  'kingjouet-tcg':     () => scrapeKingJouetPaginated('https://www.king-jouet.com/jeux-jouets/jeux-societes/cartes-a-collectionner/page1.htm',                     'TCG',  'catalog'),
  'kingjouet-lego':    () => scrapeKingJouetPage('https://www.king-jouet.com/pages/lego_univers/lego.htm', 'Lego', 'catalog'),
  // Micromania — catalogue TCG
  'micromania-pokemon': () => scrapeMicromaniaPage('https://www.micromania.fr/c/cartes?marque=pokemon',  'TCG', 'catalog'),
  'micromania-lorcana': () => scrapeMicromaniaPage('https://www.micromania.fr/c/cartes?marque=lorcana',  'TCG', 'catalog'),
  // Smyths — catalogue TCG
  'smyths-tcg':        () => scrapeSmythsPage('https://www.smythstoys.com/fr/fr-fr/jouets/jeux-de-societe-et-puzzles/cartes-a-collectionner/c/SM13010611', 'TCG', 'catalog'),
  'smyths-pokemon':    () => scrapeSmythsPage('https://www.smythstoys.com/fr/fr-fr/marques/pokemon/c/SM130208', 'TCG', 'catalog'),
  'smyths-lorcana':    () => scrapeSmythsPage('https://www.smythstoys.com/fr/fr-fr/jouets/jeux-de-societe-et-puzzles/cartes-a-collectionner/cartes-lorcana/c/SM1301061105', 'TCG', 'catalog'),
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
