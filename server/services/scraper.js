'use strict';

/**
 * Service de scraping promos — Phase 1
 *
 * Boutiques implémentées :
 *   kingjouet    — King Jouet (promos en ligne)
 *   micromania   — Micromania (promos jeux vidéo)
 *   fnac         — Fnac (promos jeux & jouets)
 *   smyths       — Smyths Toys
 *   furetdunord  — Furet du Nord (livres/jeux)
 *   philibert    — Philibert (jeux de société)
 *   cdiscount    — Cdiscount
 *   cultura      — Cultura
 *
 * Stratégie : Cheerio en priorité. Claude Haiku uniquement si HTML trop opaque.
 */

const axios   = require('axios');
const cheerio = require('cheerio');
const logger  = require('./logger');

const DELAY    = parseInt(process.env.SCRAPE_DELAY_MS || '1500', 10);
const UA       = process.env.SCRAPE_USER_AGENT ||
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

const http = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent':      UA,
    'Accept-Language': 'fr-FR,fr;q=0.9',
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection':      'keep-alive'
  },
  maxRedirects: 5
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizePrice(str) {
  if (!str) return null;
  const cleaned = String(str).replace(/[^\d,\.]/g, '').replace(',', '.').trim();
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

function calcDiscount(original, sale) {
  if (!original || !sale || original <= 0) return null;
  return Math.round((1 - sale / original) * 100);
}

// ---------------------------------------------------------------
// KING JOUET
// ---------------------------------------------------------------
async function scrapeKingJouet() {
  const source = 'kingjouet';
  const url    = 'https://www.king-jouet.com/jeux-jouets/promotions.htm';
  logger.info(`[Scraper] ${source} — début`);

  try {
    await sleep(DELAY);
    const { data } = await http.get(url);
    const $        = cheerio.load(data);
    const results  = [];

    // King Jouet liste les articles dans des blocs .product-item ou .product-card
    $('[class*="product"]').each((i, el) => {
      const title = $(el).find('[class*="title"], [class*="name"], h2, h3').first().text().trim();
      if (!title || title.length < 3) return;

      const priceStr    = $(el).find('[class*="price-new"], [class*="sale"], .prix-promo').first().text().trim();
      const origStr     = $(el).find('[class*="price-old"], [class*="original"], .prix-barre').first().text().trim();
      const href        = $(el).find('a').first().attr('href') || '';
      const img         = $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || '';
      const discStr     = $(el).find('[class*="discount"], [class*="promo-percent"]').first().text().trim();

      const price         = normalizePrice(priceStr);
      const originalPrice = normalizePrice(origStr);
      const discount      = normalizePrice(discStr) || calcDiscount(originalPrice, price);

      if (!price && !originalPrice) return;

      results.push({
        source,
        title,
        price,
        original_price: originalPrice,
        discount_percent: discount,
        url: href.startsWith('http') ? href : `https://www.king-jouet.com${href}`,
        image_url: img.startsWith('http') ? img : (img ? `https://www.king-jouet.com${img}` : null),
        category: guessCategoryFromTitle(title),
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
  const url    = 'https://www.micromania.fr/promotions';
  logger.info(`[Scraper] ${source} — début`);

  try {
    await sleep(DELAY);
    const { data } = await http.get(url);
    const $        = cheerio.load(data);
    const results  = [];

    // Micromania utilise des balises article.product-item-info ou li.product-item
    $('li.product-item, article.product-item, .product-item-info').each((i, el) => {
      const title    = $(el).find('.product-item-name, .product-name, [class*="name"]').first().text().trim();
      if (!title) return;

      const priceNew = $(el).find('.special-price .price, .price-final_price .price').first().text().trim();
      const priceOld = $(el).find('.old-price .price, [class*="regular"] .price').first().text().trim();
      const href     = $(el).find('a.product-item-link, a[class*="product"]').first().attr('href') || '';
      const img      = $(el).find('img.product-image-photo').first().attr('src') ||
                       $(el).find('img').first().attr('data-src') || '';
      const badgeTxt = $(el).find('[class*="badge"], [class*="promo"], [class*="discount"]').first().text().trim();

      const price         = normalizePrice(priceNew) || normalizePrice(
        $(el).find('.price').first().text().trim()
      );
      const originalPrice = normalizePrice(priceOld);
      const discount      = calcDiscount(originalPrice, price) ||
        (badgeTxt ? normalizePrice(badgeTxt) : null);

      if (!price) return;

      results.push({
        source,
        title,
        price,
        original_price: originalPrice,
        discount_percent: discount,
        url: href.startsWith('http') ? href : `https://www.micromania.fr${href}`,
        image_url: img || null,
        category: 'JeuxVideo',
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
// FNAC
// ---------------------------------------------------------------
async function scrapeFnac() {
  const source = 'fnac';
  // On cible les promos jeux/jouets directement
  const urls = [
    'https://www.fnac.com/Jeux-de-societe/ar-Jeux-de-soci-t-/s99254502/w-4?sl=MOSSlider&seeMore=0&initialTo=0&Etat_du_produit=3',
    'https://www.fnac.com/Jeux-video/a2000/s99254502/w-4'
  ];
  logger.info(`[Scraper] ${source} — début`);

  const all = [];

  for (const url of urls) {
    try {
      await sleep(DELAY);
      const { data } = await http.get(url);
      const $        = cheerio.load(data);

      $('li.Article-item, article.Article, .Article').each((i, el) => {
        const title    = $(el).find('.Article-title, h3, h2, [class*="title"]').first().text().trim();
        if (!title || title.length < 3) return;

        const priceNew = $(el).find('.f-priceBox-price, .Article-price, [class*="price"]').first().text().trim();
        const priceOld = $(el).find('.f-priceBox-oldPrice, [class*="oldPrice"], [class*="original"]').first().text().trim();
        const href     = $(el).find('a').first().attr('href') || '';
        const img      = $(el).find('img').first().attr('src') ||
                         $(el).find('img').first().attr('data-src') || '';
        const discount = $(el).find('[class*="discount"], [class*="reduction"]').first().text().trim();

        const price         = normalizePrice(priceNew);
        const originalPrice = normalizePrice(priceOld);

        if (!price) return;

        all.push({
          source,
          title,
          price,
          original_price: originalPrice,
          discount_percent: normalizePrice(discount) || calcDiscount(originalPrice, price),
          url: href.startsWith('http') ? href : `https://www.fnac.com${href}`,
          image_url: img || null,
          category: guessCategoryFromTitle(title),
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
  const url    = 'https://www.smythstoys.com/fr/fr-fr/offres-speciales';
  logger.info(`[Scraper] ${source} — début`);

  try {
    await sleep(DELAY);
    const { data } = await http.get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('.product-item, .product-listing__item, [class*="productItem"]').each((i, el) => {
      const title  = $(el).find('[class*="productName"], [class*="product-name"], h2, h3').first().text().trim();
      if (!title) return;

      const priceNew  = $(el).find('[class*="special"], [class*="salePrice"], [class*="now"]').first().text().trim();
      const priceOld  = $(el).find('[class*="wasPrice"], [class*="original"], [class*="old"]').first().text().trim();
      const href      = $(el).find('a').first().attr('href') || '';
      const img       = $(el).find('img').first().attr('src') || '';

      const price         = normalizePrice(priceNew) || normalizePrice($(el).find('.price').first().text());
      const originalPrice = normalizePrice(priceOld);

      if (!price) return;

      results.push({
        source,
        title,
        price,
        original_price: originalPrice,
        discount_percent: calcDiscount(originalPrice, price),
        url: href.startsWith('http') ? href : `https://www.smythstoys.com${href}`,
        image_url: img || null,
        category: guessCategoryFromTitle(title),
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
  const url    = 'https://www.furet.com/livres/promotions.html';
  logger.info(`[Scraper] ${source} — début`);

  try {
    await sleep(DELAY);
    const { data } = await http.get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('.product-item, .product, [class*="article"]').each((i, el) => {
      const title    = $(el).find('a.product-item-link, .product-name, h2').first().text().trim();
      if (!title) return;

      const price    = normalizePrice($(el).find('[class*="price"]').first().text().trim());
      const href     = $(el).find('a').first().attr('href') || '';

      if (!price) return;

      results.push({
        source,
        title,
        price,
        original_price: null,
        discount_percent: null,
        url: href.startsWith('http') ? href : `https://www.furet.com${href}`,
        image_url: $(el).find('img').first().attr('src') || null,
        category: 'JeuxSociete',
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
// PHILIBERT (jeux de société)
// ---------------------------------------------------------------
async function scrapePhilibert() {
  const source = 'philibert';
  const url    = 'https://www.philibertnet.com/fr/342-nouveautes';
  logger.info(`[Scraper] ${source} — début`);

  try {
    await sleep(DELAY);
    const { data } = await http.get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('article.product-miniature, .product_list .product-container').each((i, el) => {
      const title    = $(el).find('.product-title, h2, h3').first().text().trim();
      if (!title) return;

      const priceOld = normalizePrice($(el).find('.regular-price, s.price').first().text());
      const priceNew = normalizePrice($(el).find('.price, .product-price').first().text());
      const href     = $(el).find('a').first().attr('href') || '';
      const img      = $(el).find('img').first().attr('src') || '';

      const price = priceNew || priceOld;
      if (!price) return;

      results.push({
        source,
        title,
        price,
        original_price: priceOld && priceNew && priceOld !== priceNew ? priceOld : null,
        discount_percent: calcDiscount(priceOld, priceNew),
        url: href.startsWith('http') ? href : `https://www.philibertnet.com${href}`,
        image_url: img.startsWith('http') ? img : null,
        category: 'JeuxSociete',
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
  const url    = 'https://www.cultura.com/c/jeux-de-societe/promotions';
  logger.info(`[Scraper] ${source} — début`);

  try {
    await sleep(DELAY);
    const { data } = await http.get(url);
    const $        = cheerio.load(data);
    const results  = [];

    $('[class*="product"], [class*="Product"]').each((i, el) => {
      const title    = $(el).find('[class*="title"], [class*="name"], h2, h3').first().text().trim();
      if (!title || title.length < 3) return;

      const priceNew = normalizePrice($(el).find('[class*="price-sale"], [class*="promo"]').first().text());
      const priceOld = normalizePrice($(el).find('[class*="price-old"], [class*="before"]').first().text());
      const price    = priceNew || normalizePrice($(el).find('[class*="price"]').first().text());
      if (!price) return;

      const href = $(el).find('a').first().attr('href') || '';
      results.push({
        source,
        title,
        price,
        original_price: priceOld,
        discount_percent: calcDiscount(priceOld, price),
        url: href.startsWith('http') ? href : `https://www.cultura.com${href}`,
        image_url: $(el).find('img').first().attr('src') || null,
        category: guessCategoryFromTitle(title),
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
// Utilitaire : deviner la catégorie depuis le titre
// ---------------------------------------------------------------
const CATEGORY_PATTERNS = [
  { pattern: /pokemon|lorcana|magic|yugioh|one piece|tcg|carte/i,  category: 'TCG' },
  { pattern: /lego|technic|duplo/i,                                 category: 'Lego' },
  { pattern: /playstation|xbox|nintendo|switch|ps[45]|jeu vid/i,    category: 'JeuxVideo' },
  { pattern: /jeu de soci|plateau|extension|deck|figurin/i,         category: 'JeuxSociete' }
];

function guessCategoryFromTitle(title) {
  for (const { pattern, category } of CATEGORY_PATTERNS) {
    if (pattern.test(title)) return category;
  }
  return null;
}

// ---------------------------------------------------------------
// Export : liste des scrapers disponibles
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

/**
 * Lance tous les scrapers (ou une sélection).
 * @param {string[]} [only]  liste de clés à restreindre
 * @returns {Promise<object[]>} tous les articles combinés
 */
async function scrapeAll(only) {
  const keys = only && only.length ? only : Object.keys(SCRAPERS);
  const all  = [];

  for (const key of keys) {
    if (!SCRAPERS[key]) {
      logger.warn(`[Scraper] Scraper inconnu : "${key}"`);
      continue;
    }
    const items = await SCRAPERS[key]();
    all.push(...items);
    await sleep(DELAY);
  }

  logger.info(`[Scraper] Total : ${all.length} articles scrappés`);
  return all;
}

module.exports = { scrapeAll, SCRAPERS, guessCategoryFromTitle };
