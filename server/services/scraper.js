'use strict';

const axios   = require('axios');
const cheerio = require('cheerio');
const logger  = require('./logger');

// Chromium optionnel — si puppeteer n'est pas installé, les scrapers retournent []
let _withPage = null;
function getWithPage() {
  if (_withPage) return _withPage;
  try {
    _withPage = require('./chromium').withPage;
    return _withPage;
  } catch (e) {
    logger.warn('[Scraper] Chromium non disponible (puppeteer manquant ?), scrapers Chromium désactivés');
    return null;
  }
}

async function withChromiumPage(fn) {
  const withPage = getWithPage();
  if (!withPage) return [];
  return withPage(fn);
}

const DELAY = Number.parseInt(process.env.SCRAPE_DELAY_MS || '1500', 10);
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
  const cleaned = String(str).replace(/\s/g, '').replaceAll(/[^\d,.]/g, '').replace(',', '.').trim();
  const val = Number.parseFloat(cleaned);
  return Number.isNaN(val) || val <= 0 || val > maxPrice ? null : val;
}

function calcDiscount(original, sale) {
  if (!original || !sale || original <= sale) return null;
  return Math.round((1 - sale / original) * 100);
}

// ---------------------------------------------------------------
// FURET DU NORD — Chromium (PrestaShop, anti-bot possible)
// ---------------------------------------------------------------
async function scrapeFuretDuNordPage(url, category, itemType = 'catalog') {
  const maxPrice = itemType === 'catalog' ? 1500 : 500;
  logger.info(`[Chromium/FuretDuNord] (${itemType}) — ${url}`);
  try {
    return await withChromiumPage(async (page) => {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector(
        '[data-id-product], article.product-miniature, .js-product-miniature, li.ajax_block_product',
        { timeout: 15000 }
      ).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      const dbg = await page.evaluate(() =>
        ['[data-id-product]','article.product-miniature','.js-product-miniature',
         'li.ajax_block_product','.product-miniature','[class*="product-item"]',
         '.products article','.product']
          .map(s => `${s}:${document.querySelectorAll(s).length}`).join(' | ')
      );
      logger.info(`[Chromium/FuretDuNord] sélecteurs debug → ${dbg}`);

      const items = await page.evaluate(() => {
        const results = [];
        const cards = document.querySelectorAll(
          '[data-id-product], article.product-miniature, .js-product-miniature, li.ajax_block_product'
        );
        cards.forEach(el => {
          const titleEl = el.querySelector('.product-title a, .product-name a, h2 a, h3 a, [class*="product-title"] a, [class*="name"] a');
          const title   = titleEl?.textContent?.trim() || el.querySelector('a[title]')?.title || '';
          if (!title || title.length < 3) return;
          const priceNew = (el.querySelector('.price:not(.regular-price), .product-price, [itemprop="price"]')?.textContent?.trim()
                        || el.querySelector('[class*="price"]')?.textContent?.trim() || '');
          const priceOld = el.querySelector('.regular-price, s, del, [class*="old-price"]')?.textContent?.trim() || '';
          const imgEl  = el.querySelector('img');
          const linkEl = titleEl || el.querySelector('a');
          results.push({
            title, priceNew, priceOld,
            img:  imgEl?.src || imgEl?.dataset?.src || '',
            href: linkEl?.href || '',
          });
        });
        return results;
      });

      logger.info(`[Chromium/FuretDuNord] ${items.length} produit(s) trouvé(s)`);
      const now = new Date().toISOString();
      return items.map(item => {
        const priceNew = normalizePrice(item.priceNew, maxPrice);
        const priceOld = normalizePrice(item.priceOld, maxPrice);
        const price    = priceNew || priceOld;
        if (!price) return null;
        return {
          source: 'furetdunord', title: item.title, price,
          original_price:   priceOld && priceNew && priceOld !== priceNew ? priceOld : null,
          discount_percent: calcDiscount(priceOld, priceNew),
          url:       item.href || url,
          image_url: item.img || null,
          category:  guessCategoryFromTitle(item.title) || category,
          item_type: itemType, scraped_at: now,
        };
      }).filter(Boolean);
    });
  } catch (err) {
    logger.error(`[Chromium/FuretDuNord] erreur : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// FNAC — Chromium (anti-bot contourné)
// ---------------------------------------------------------------
async function scrapeFnacPage(url, category, itemType = 'promo') {

  const maxPrice = itemType === 'catalog' ? 1500 : 500;
  logger.info(`[Chromium/Fnac] (${itemType}) — ${url}`);
  try {
    return await withChromiumPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('.Article-article, [class*="Article-item"]', { timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));

      const items = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('.Article-article').forEach(el => {
          const title = (
            el.querySelector('.Article-nameContainer, [class*="Article-desc"], h3')?.textContent?.trim() ||
            el.querySelector('a[title]')?.title || ''
          );
          if (!title || title.length < 3) return;
          results.push({
            title,
            price:    el.querySelector('.f-priceBox-price .userPrice, [class*="userPrice"], .f-priceBox-price')?.textContent?.trim() || '',
            oldPrice: el.querySelector('.f-priceBox-oldPrice, [class*="oldPrice"]')?.textContent?.trim() || '',
            img:      el.querySelector('img')?.src || el.querySelector('img')?.dataset?.src || '',
            href:     el.querySelector('a')?.href || '',
          });
        });
        return results;
      });

      const now = new Date().toISOString();
      return items.map(item => {
        const price    = normalizePrice(item.price, maxPrice);
        if (!price) return null;
        const original = normalizePrice(item.oldPrice, maxPrice);
        return {
          source: 'fnac', title: item.title, price, original_price: original,
          discount_percent: calcDiscount(original, price),
          url: item.href || url, image_url: item.img || null,
          category: guessCategoryFromTitle(item.title) || category,
          item_type: itemType, scraped_at: now,
        };
      }).filter(Boolean);
    });
  } catch (err) {
    logger.error(`[Chromium/Fnac] erreur : ${err.message}`);
    return [];
  }
}

async function scrapeFnac() {
  return scrapeFnacPage('https://www.fnac.com/Ventes-flash-et-promotions/n-1940003/w-4', null, 'promo');
}

// ---------------------------------------------------------------
// AMAZON — Chromium (anti-bot contourné, résultats variables)
// ---------------------------------------------------------------
async function scrapeAmazonPage(url, category, itemType = 'catalog') {

  const maxPrice = itemType === 'catalog' ? 1500 : 500;
  logger.info(`[Chromium/Amazon] (${itemType}) — ${url}`);
  try {
    return await withChromiumPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('[data-component-type="s-search-result"]', { timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));

      const items = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('[data-component-type="s-search-result"]').forEach(el => {
          const title = el.querySelector('h2 span')?.textContent?.trim() || '';
          if (!title || title.length < 3) return;
          const priceWhole = el.querySelector('.a-price[data-a-color="base"] .a-price-whole')?.textContent?.trim() || '';
          const priceFrac  = el.querySelector('.a-price[data-a-color="base"] .a-price-fraction')?.textContent?.trim() || '';
          const oldPriceEl = el.querySelector('.a-price[data-a-color="secondary"] .a-offscreen');
          const price      = priceWhole ? `${priceWhole}.${priceFrac || '00'}` : '';
          results.push({
            title,
            price,
            oldPrice: oldPriceEl?.textContent?.trim() || '',
            img:      el.querySelector('.s-image')?.src || '',
            href:     el.querySelector('h2 a')?.href || '',
          });
        });
        return results;
      });

      const now = new Date().toISOString();
      return items.map(item => {
        const price    = normalizePrice(item.price, maxPrice);
        if (!price) return null;
        const original = normalizePrice(item.oldPrice, maxPrice);
        return {
          source: 'amazon', title: item.title, price, original_price: original,
          discount_percent: calcDiscount(original, price),
          url: item.href || url, image_url: item.img || null,
          category: guessCategoryFromTitle(item.title) || category,
          item_type: itemType, scraped_at: now,
        };
      }).filter(Boolean);
    });
  } catch (err) {
    logger.error(`[Chromium/Amazon] erreur : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// GOOGLE SHOPPING — Chromium (résultats comparateur de prix)
// ---------------------------------------------------------------
async function scrapeGoogleShoppingPage(query, category, itemType = 'catalog') {

  const maxPrice = itemType === 'catalog' ? 1500 : 500;
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=shop&hl=fr&gl=fr`;
  logger.info(`[Chromium/GoogleShopping] "${query}"`);
  try {
    return await withChromiumPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // Attendre les résultats shopping ou détecter un CAPTCHA
      await page.waitForSelector('.sh-dgr__content, .sh-pr__product-results-grid, [data-docid]', { timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));

      const isCaptcha = await page.evaluate(() =>
        document.title.includes('unusual traffic') || !!document.querySelector('#captcha-form, #recaptcha')
      );
      if (isCaptcha) { logger.warn('[Chromium/GoogleShopping] CAPTCHA détecté, skip'); return []; }

      const items = await page.evaluate(() => {
        const results = [];
        // Sélecteurs Google Shopping (peuvent changer)
        const cards = document.querySelectorAll('.sh-dgr__content, .VZTCjd, .sh-dlr__list-result');
        cards.forEach(el => {
          const title    = el.querySelector('h3, [class*="title"]')?.textContent?.trim() || '';
          if (!title || title.length < 3) return;
          const priceEl  = el.querySelector('[class*="price"], .a8Pemb, .HRLxBb, [aria-label*="€"]');
          const price    = priceEl?.textContent?.trim() || priceEl?.getAttribute('aria-label') || '';
          const merchant = el.querySelector('[class*="merchant"], .aULzUe, .E5ocAb')?.textContent?.trim() || '';
          const imgEl    = el.querySelector('img');
          const linkEl   = el.querySelector('a');
          if (!price) return;
          results.push({ title, price, merchant, img: imgEl?.src || '', href: linkEl?.href || '' });
        });
        return results;
      });

      const now = new Date().toISOString();
      return items.map(item => {
        const price = normalizePrice(item.price, maxPrice);
        if (!price) return null;
        const source = item.merchant ? `google/${item.merchant}` : 'google';
        return {
          source, title: item.title, price, original_price: null, discount_percent: null,
          url: item.href || url, image_url: item.img || null,
          category: guessCategoryFromTitle(item.title) || category,
          item_type: itemType, scraped_at: now,
        };
      }).filter(Boolean);
    });
  } catch (err) {
    logger.error(`[Chromium/GoogleShopping] erreur : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// IDEALO — comparateur de prix FR, Chromium
// ---------------------------------------------------------------
async function scrapeIdealoPage(url, category, itemType = 'catalog') {

  const maxPrice = itemType === 'catalog' ? 1500 : 500;
  logger.info(`[Chromium/Idealo] (${itemType}) — ${url}`);
  try {
    return await withChromiumPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('[class*="product"], .sr-resultList', { timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));

      const items = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('[class*="productOffers-module__product"], .sr-resultList__item, [data-testid*="product"]').forEach(el => {
          const title   = el.querySelector('[class*="title"], h3, h2, [itemprop="name"]')?.textContent?.trim() || '';
          if (!title || title.length < 3) return;
          const priceEl = el.querySelector('[class*="price"], [itemprop="price"], [class*="Price"]');
          const price   = priceEl?.textContent?.trim() || priceEl?.getAttribute('content') || '';
          const imgEl   = el.querySelector('img');
          const linkEl  = el.querySelector('a');
          if (!price) return;
          results.push({ title, price, img: imgEl?.src || '', href: linkEl?.href || '' });
        });
        return results;
      });

      const now = new Date().toISOString();
      return items.map(item => {
        const price = normalizePrice(item.price, maxPrice);
        if (!price) return null;
        return {
          source: 'idealo', title: item.title, price, original_price: null, discount_percent: null,
          url: item.href || url, image_url: item.img || null,
          category: guessCategoryFromTitle(item.title) || category,
          item_type: itemType, scraped_at: now,
        };
      }).filter(Boolean);
    });
  } catch (err) {
    logger.error(`[Chromium/Idealo] erreur : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// DEALABS — flux RSS (pas de scraping, XML public)
// ---------------------------------------------------------------
function extractPricesFromText(text) {
  const matches = [...text.matchAll(/(\d+[,.]\d{1,2})\s*€/g)]
    .map(m => Number.parseFloat(m[1].replace(',', '.')))
    .filter(v => v > 0 && v < 1500);
  if (!matches.length) return { price: null, original_price: null };
  if (matches.length === 1) return { price: matches[0], original_price: null };
  return { price: Math.min(...matches), original_price: Math.max(...matches) };
}

// Dealabs a supprimé les RSS /groupes/ — on filtre le flux principal par mots-clés
const DEALABS_RSS = 'https://www.dealabs.com/rss/discussions';
const DEALABS_KEYWORDS = {
  TCG:         /pokemon|lorcana|magic.the.gathering|one.piece.card|jcc|booster|carte.?a.?collectionner/i,
  Lego:        /lego|technic|duplo/i,
  JeuxVideo:   /playstation|xbox|nintendo|switch|ps[45]|jeu.vid|steam|epic.games/i,
  JeuxSociete: /jeu.de.soci|jeu.soci|plateau|extension|figurine|deck.building/i,
};

async function scrapeDealabsRSS(feedUrl, category) {
  logger.info(`[Scraper] dealabs RSS — ${DEALABS_RSS} (filtre: ${category || 'tous'})`);
  try {
    await sleep(DELAY);
    const { data } = await makeHttp('https://www.dealabs.com/').get(DEALABS_RSS);
    const $       = cheerio.load(data, { xmlMode: true });
    const results = [];
    const now     = new Date().toISOString();
    const pattern = category ? DEALABS_KEYWORDS[category] : null;

    $('item').each((i, el) => {
      const title   = $(el).find('title').text().trim();
      const url     = $(el).find('link').text().trim() || $(el).find('guid').text().trim();
      const pubDate = $(el).find('pubDate').text().trim();
      if (!title || !url) return;
      // Filtre par catégorie si demandé
      if (pattern && !pattern.test(title)) return;

      const { price, original_price } = extractPricesFromText(title);
      if (!price) return;

      const detectedCat = category || Object.entries(DEALABS_KEYWORDS).find(([, p]) => p.test(title))?.[0] || null;
      results.push({
        source:           'dealabs',
        title,
        price,
        original_price,
        discount_percent: calcDiscount(original_price, price),
        url,
        image_url:        null,
        category:         detectedCat,
        item_type:        'promo',
        scraped_at:       pubDate ? new Date(pubDate).toISOString() : now
      });
    });

    logger.info(`[Scraper] dealabs (${category || 'tous'}) — ${results.length} deals`);
    return results;
  } catch (err) {
    logger.error(`[Scraper] dealabs erreur : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// KING JOUET — Chromium (bloque axios avec 403)
// ---------------------------------------------------------------
async function scrapeKingJouetPage(url, category, itemType = 'promo') {

  const maxPrice = itemType === 'catalog' ? 1500 : 500;
  logger.info(`[Chromium/KingJouet] (${itemType}) — ${url}`);
  try {
    return await withChromiumPage(async (page) => {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForSelector('article.product-miniature, .produit-vignette, [class*="product-item"]', { timeout: 15000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1000));

      const items = await page.evaluate(() => {
        const results = [];
        document.querySelectorAll('article.product-miniature, .produit-vignette, [class*="product-item"]').forEach(el => {
          const title = (
            el.querySelector('[class*="product-title"], [class*="produit-lib"], h2, h3')?.textContent?.trim() ||
            el.querySelector('a[title]')?.title || ''
          );
          if (!title || title.length < 3) return;
          results.push({
            title,
            priceNew: el.querySelector('[class*="price-sale"], [class*="product-price"], .price')?.textContent?.trim() || '',
            priceOld: el.querySelector('[class*="regular-price"], [class*="old-price"], s, del')?.textContent?.trim() || '',
            img:      el.querySelector('img')?.src || el.querySelector('img')?.dataset?.src || '',
            href:     el.querySelector('a')?.href || '',
          });
        });
        return results;
      });

      const now = new Date().toISOString();
      return items.map(item => {
        const priceNew = normalizePrice(item.priceNew, maxPrice);
        const priceOld = normalizePrice(item.priceOld, maxPrice);
        const price    = priceNew || priceOld;
        if (!price) return null;
        return {
          source: 'kingjouet', title: item.title, price,
          original_price:   priceOld && priceNew && priceOld !== priceNew ? priceOld : null,
          discount_percent: calcDiscount(priceOld, priceNew),
          url:       item.href || url,
          image_url: item.img || null,
          category:  guessCategoryFromTitle(item.title) || category,
          item_type: itemType, scraped_at: now,
        };
      }).filter(Boolean);
    });
  } catch (err) {
    logger.error(`[Chromium/KingJouet] erreur sur ${url} : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// BCD JEUX — Chromium (WAF bloque les requêtes statiques)
// Site PrestaShop spécialisé TCG / jeux de société
// ---------------------------------------------------------------
async function scrapeBcdJeuxPage(url, category, itemType = 'catalog') {
  const maxPrice = itemType === 'catalog' ? 1500 : 500;
  logger.info(`[Chromium/BcdJeux] (${itemType}) — ${url}`);
  try {
    return await withChromiumPage(async (page) => {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector(
        '[data-id-product], article.product-miniature, .js-product-miniature, .product-miniature',
        { timeout: 15000 }
      ).catch(() => {});
      await new Promise(r => setTimeout(r, 2000));

      // Debug : compter chaque sélecteur candidat
      const dbg = await page.evaluate(() =>
        ['[data-id-product]','article.product-miniature','.product-miniature',
         '.js-product-miniature','.thumbnail-container','#js-product-list article',
         '.products article','.product-item','[class*="product-card"]']
          .map(s => `${s}:${document.querySelectorAll(s).length}`)
          .join(' | ')
      );
      logger.info(`[Chromium/BcdJeux] sélecteurs debug → ${dbg}`);

      const items = await page.evaluate(() => {
        const results = [];
        // [data-id-product] = attribut PrestaShop universel, présent sur tous les thèmes
        const cards = document.querySelectorAll('[data-id-product]');
        cards.forEach(el => {
          const titleEl = el.querySelector(
            '.product-title a, .product-name a, h2 a, h3 a, ' +
            '[class*="product-title"] a, [class*="product-name"] a, [class*="name"] a'
          );
          const title = titleEl?.textContent?.trim() || el.querySelector('a[title]')?.title || '';
          if (!title || title.length < 3) return;

          // Prix courant (exclure les anciens prix)
          const priceNew = (
            el.querySelector('.price:not(.regular-price), .product-price, [itemprop="price"]')?.textContent?.trim() ||
            el.querySelector('[class*="price"]')?.textContent?.trim() || ''
          );
          const priceOld = (
            el.querySelector('.regular-price, s, del, [class*="old-price"], [class*="regular"]')?.textContent?.trim() || ''
          );
          const discount = el.querySelector('[class*="discount"], [class*="reduction"]')?.textContent?.trim() || '';
          const imgEl   = el.querySelector('img');
          const linkEl  = titleEl || el.querySelector('a');

          results.push({
            title, priceNew, priceOld, discount,
            img:  imgEl?.src || imgEl?.dataset?.src || imgEl?.dataset?.lazy || '',
            href: linkEl?.href || '',
          });
        });
        return results;
      });

      logger.info(`[Chromium/BcdJeux] ${items.length} carte(s) trouvée(s) sur ${url}`);

      const now = new Date().toISOString();
      const mapped = items.map(item => {
        const priceNew = normalizePrice(item.priceNew, maxPrice);
        const priceOld = normalizePrice(item.priceOld, maxPrice);
        const price    = priceNew || priceOld;
        if (!price) return null;

        let discountPct = calcDiscount(priceOld, priceNew);
        if (!discountPct && item.discount) {
          const m = item.discount.match(/(\d+)\s*%/);
          if (m) discountPct = Number.parseInt(m[1], 10);
        }

        return {
          source:           'bcd-jeux',
          title:            item.title,
          price,
          original_price:   priceOld && priceNew && priceOld !== priceNew ? priceOld : null,
          discount_percent: discountPct,
          url:              item.href || url,
          image_url:        item.img || null,
          category:         guessCategoryFromTitle(item.title) || category,
          item_type:        itemType,
          scraped_at:       now,
        };
      }).filter(Boolean);

      logger.info(`[Chromium/BcdJeux] ${mapped.length}/${items.length} articles valides extraits (${itemType})`);
      const withDiscount = mapped.filter(i => i.discount_percent);
      if (withDiscount.length) logger.info(`[Chromium/BcdJeux] dont ${withDiscount.length} avec remise détectée`);
      return mapped;
    });
  } catch (err) {
    logger.error(`[Chromium/BcdJeux] erreur sur ${url} : ${err.message}`);
    return [];
  }
}

async function scrapeBcdJeuxPaginated(baseUrl, category, itemType = 'catalog', maxPages = 3) {
  const all = [];
  for (let p = 1; p <= maxPages; p++) {
    const url   = p === 1 ? baseUrl : `${baseUrl}?page=${p}`;
    const items = await scrapeBcdJeuxPage(url, category, itemType);
    all.push(...items);
    if (items.length < 5) break;
    await new Promise(r => setTimeout(r, DELAY));
  }
  logger.info(`[Chromium/BcdJeux] (${itemType}) — ${all.length} articles (${maxPages} pages max)`);
  return all;
}

async function scrapeBcdJeux() {
  // Pages éditoriales : pas de pagination
  const promos  = await scrapeBcdJeuxPage('https://www.bcd-jeux.fr/page/11-promotions',              null, 'promo');
  const soldes  = await scrapeBcdJeuxPage('https://www.bcd-jeux.fr/page/144-soldes-jeux-et-jouets',  null, 'promo');
  // Catégorie numérique "2 achetés = 1 offert" : pagination ?page=N
  const deux    = await scrapeBcdJeuxPaginated('https://www.bcd-jeux.fr/8301-promo-2-jeux-achetes-1-jeu-offert', null, 'promo', 2);
  return [...promos, ...soldes, ...deux];
}

async function scrapeKingJouetPaginated(baseUrl, category, itemType = 'promo', maxPages = 3) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const url   = baseUrl.replace('page1.htm', `page${page}.htm`);
    const items = await scrapeKingJouetPage(url, category, itemType);
    all.push(...items);
    if (items.length < 5) break;
    await new Promise(r => setTimeout(r, DELAY));
  }
  logger.info(`[Chromium/KingJouet] (${itemType}) — ${all.length} articles (${maxPages} pages max)`);
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
// SMYTHS — Chromium (axios bloqué par anti-bot Hybris)
// ---------------------------------------------------------------
async function scrapeSmythsPage(url, category, itemType = 'promo') {
  const maxPrice = itemType === 'catalog' ? 1500 : 500;
  logger.info(`[Chromium/Smyths] (${itemType}) — ${url}`);
  try {
    return await withChromiumPage(async (page) => {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
      await page.waitForSelector(
        '[class*="product-item"], [class*="productItem"], [class*="product-tile"], [class*="product-card"]',
        { timeout: 15000 }
      ).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));

      const dbg = await page.evaluate(() =>
        ['[class*="product-item"]','[class*="productItem"]','[class*="product-tile"]',
         '[class*="product-card"]','[data-product-code]','[data-productcode]','.product']
          .map(s => `${s}:${document.querySelectorAll(s).length}`).join(' | ')
      );
      logger.info(`[Chromium/Smyths] sélecteurs debug → ${dbg}`);

      const items = await page.evaluate(() => {
        const results = [];
        const cards = document.querySelectorAll(
          '[class*="product-item"], [class*="productItem"], [class*="product-tile"], [class*="product-card"]'
        );
        cards.forEach(el => {
          const title = el.querySelector('[class*="product-name"], [class*="productName"], h2, h3')?.textContent?.trim()
                     || el.querySelector('a[title]')?.title || '';
          if (!title || title.length < 3) return;
          const priceOld = el.querySelector('[class*="was-price"], [class*="old-price"], s')?.textContent?.trim() || '';
          const priceNew = (el.querySelector('[class*="now-price"], [class*="sale-price"], [class*="current-price"]')?.textContent?.trim()
                        || el.querySelector('[class*="price"]')?.textContent?.trim() || '');
          const imgEl  = el.querySelector('img');
          const linkEl = el.querySelector('a');
          results.push({
            title, priceNew, priceOld,
            img:  imgEl?.src || imgEl?.dataset?.src || '',
            href: linkEl?.href || '',
          });
        });
        return results;
      });

      logger.info(`[Chromium/Smyths] ${items.length} produit(s) trouvé(s)`);
      const now = new Date().toISOString();
      return items.map(item => {
        const priceNew = normalizePrice(item.priceNew, maxPrice);
        const priceOld = normalizePrice(item.priceOld, maxPrice);
        const price    = priceNew || priceOld;
        if (!price) return null;
        return {
          source: 'smyths', title: item.title, price,
          original_price:   priceOld && priceNew && priceOld !== priceNew ? priceOld : null,
          discount_percent: calcDiscount(priceOld, priceNew),
          url:       item.href || url,
          image_url: item.img || null,
          category:  guessCategoryFromTitle(item.title) || category,
          item_type: itemType, scraped_at: now,
        };
      }).filter(Boolean);
    });
  } catch (err) {
    logger.error(`[Chromium/Smyths] erreur sur ${url} : ${err.message}`);
    return [];
  }
}

async function scrapeSmythsPaginated(baseUrl, category, itemType = 'promo', maxPages = 3) {
  const all = [];
  const sz  = 60;
  for (let p = 0; p < maxPages; p++) {
    const sep  = baseUrl.includes('?') ? '&' : '?';
    const url  = p === 0 ? baseUrl : `${baseUrl}${sep}start=${p * sz}&sz=${sz}`;
    const items = await scrapeSmythsPage(url, category, itemType);
    all.push(...items);
    if (items.length < 5) break;
    await sleep(DELAY);
  }
  logger.info(`[Scraper/Smyths] (${itemType}) — ${all.length} articles`);
  return all;
}

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
// SHOPIFY — API JSON publique /products.json (sans Chromium)
// ---------------------------------------------------------------
async function scrapeShopifyJson(host, keywords, sourceName, category = 'TCG', itemType = 'catalog', maxPages = 2, collectionPath = null) {
  const results = [];
  const kw = keywords.map(k => k.toLowerCase());
  for (let page = 1; page <= maxPages; page++) {
    try {
      await sleep(DELAY);
      const base = collectionPath
        ? `https://${host}/${collectionPath}/products.json`
        : `https://${host}/products.json`;
      const url = `${base}?limit=250&page=${page}`;
      const { data } = await makeHttp(`https://${host}/`).get(url, { headers: { Accept: 'application/json' } });
      const products = data.products || [];
      if (!products.length) break;
      for (const p of products) {
        const title = p.title || '';
        if (kw.length && !kw.some(k => title.toLowerCase().includes(k))) continue;
        const variant = p.variants?.[0];
        if (!variant) continue;
        const price = normalizePrice(String(variant.price), 1500);
        if (!price) continue;
        const compareAt = variant.compare_at_price ? normalizePrice(String(variant.compare_at_price), 1500) : null;
        results.push({
          source: sourceName, title, price,
          original_price:   compareAt && compareAt > price ? compareAt : null,
          discount_percent: calcDiscount(compareAt, price),
          url:        `https://${host}/products/${p.handle}`,
          image_url:  p.images?.[0]?.src || null,
          category:   guessCategoryFromTitle(title) || category,
          item_type:  itemType,
          scraped_at: new Date().toISOString()
        });
      }
      if (products.length < 250) break;
    } catch (err) {
      logger.error(`[Scraper/${sourceName}] erreur page ${page} : ${err.message}`);
      break;
    }
  }
  logger.info(`[Scraper/${sourceName}] (${itemType}) — ${results.length} articles`);
  return results;
}

// ---------------------------------------------------------------
// PRESTASHOP générique — Cheerio (boutiques sans WAF agressif)
// ---------------------------------------------------------------
async function scrapePrestaPage(url, sourceName, host, category = 'TCG', itemType = 'catalog') {
  try {
    await sleep(DELAY);
    const { data } = await makeHttp(`https://${host}/`).get(url);
    const $ = cheerio.load(data);
    const results = [];
    $('[data-id-product], article.product-miniature, .js-product-miniature').each((_, el) => {
      const title = $(el).find('.product-title a, h2, h3').first().text().trim()
                 || $(el).find('a[title]').first().attr('title') || '';
      if (!title || title.length < 3) return;
      const priceOld = normalizePrice($(el).find('.regular-price, s, del').first().text(), 1500);
      const priceNew = normalizePrice($(el).find('.price').not('.regular-price').first().text(), 1500);
      const price = priceNew || priceOld;
      if (!price) return;
      const href = $(el).find('a').first().attr('href') || '';
      results.push({
        source: sourceName, title, price,
        original_price:   priceOld && priceNew && priceOld > priceNew ? priceOld : null,
        discount_percent: calcDiscount(priceOld, priceNew),
        url:        href.startsWith('http') ? href : `https://${host}${href}`,
        image_url:  $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || null,
        category:   guessCategoryFromTitle(title) || category,
        item_type:  itemType,
        scraped_at: new Date().toISOString()
      });
    });
    logger.info(`[Scraper/${sourceName}] (${itemType}) — ${results.length} articles sur ${url}`);
    return results;
  } catch (err) {
    logger.error(`[Scraper/${sourceName}] erreur sur ${url} : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// WOOCOMMERCE générique — Cheerio
// ---------------------------------------------------------------
async function scrapeWooPage(url, sourceName, host, category = 'TCG', itemType = 'catalog') {
  try {
    await sleep(DELAY);
    const { data } = await makeHttp(`https://${host}/`).get(url);
    const $ = cheerio.load(data);
    const results = [];
    $('li.product, .product-type-simple, .product-type-variable').each((_, el) => {
      const title = $(el).find('.woocommerce-loop-product__title, h2, h3').first().text().trim() || '';
      if (!title || title.length < 3) return;
      const priceOld = normalizePrice($(el).find('.price del bdi, .price del').first().text(), 1500);
      const priceNew = normalizePrice($(el).find('.price ins bdi, .price ins').first().text()
                    || $(el).find('.price bdi, .amount').first().text(), 1500);
      const price = priceNew || priceOld;
      if (!price) return;
      const href = $(el).find('a').first().attr('href') || '';
      results.push({
        source: sourceName, title, price,
        original_price:   priceOld && priceNew && priceOld > priceNew ? priceOld : null,
        discount_percent: calcDiscount(priceOld, priceNew),
        url:        href.startsWith('http') ? href : `https://${host}${href}`,
        image_url:  $(el).find('img').first().attr('src') || $(el).find('img').first().attr('data-src') || null,
        category:   guessCategoryFromTitle(title) || category,
        item_type:  itemType,
        scraped_at: new Date().toISOString()
      });
    });
    logger.info(`[Scraper/${sourceName}] (${itemType}) — ${results.length} articles sur ${url}`);
    return results;
  } catch (err) {
    logger.error(`[Scraper/${sourceName}] erreur sur ${url} : ${err.message}`);
    return [];
  }
}

// ---------------------------------------------------------------
// Helpers de pagination
// ---------------------------------------------------------------
async function scrapeWooPaginated(baseUrl, sourceName, host, category = 'TCG', itemType = 'catalog', maxPages = 3) {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = page === 1 ? baseUrl : `${baseUrl.replace(/\/?$/, '')}/page/${page}/`;
    const items = await scrapeWooPage(url, sourceName, host, category, itemType);
    all.push(...items);
    if (items.length < 5) break;
    await sleep(DELAY);
  }
  return all;
}

async function scrapePrestaPagePaginated(baseUrl, sourceName, host, category = 'TCG', itemType = 'catalog', maxPages = 3, pageParam = 'p') {
  const all = [];
  for (let page = 1; page <= maxPages; page++) {
    const sep = baseUrl.includes('?') ? '&' : '?';
    const url = page === 1 ? baseUrl : `${baseUrl}${sep}${pageParam}=${page}`;
    const items = await scrapePrestaPage(url, sourceName, host, category, itemType);
    all.push(...items);
    if (items.length < 5) break;
    await sleep(DELAY);
  }
  return all;
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
  // King Jouet — pages promos
  kingjouet:              scrapeKingJouet,
  'kingjouet-promo-lego': () => scrapeKingJouetPaginated('https://www.king-jouet.com/jeux-jouets/promotions/marque-lego/page1.htm', 'Lego', 'promo'),
  'kingjouet-promo-js':   () => scrapeKingJouetPaginated('https://www.king-jouet.com/jeux-jouets/jeux-de-societe-promotion/page1.htm', 'JeuxSociete', 'promo'),
  // Micromania utilise Gmail parser à la place (newsletter déjà reçue)
  // Fallback HTML désactivé (ECONNRESET — anti-bot actif) :
  // micromania: scrapeMicromania,
  // Smyths — pages promos confirmées
  'smyths-promo':         () => scrapeSmythsPaginated('https://www.smythstoys.com/fr/fr-fr/jouets/mega-promos/c/mega-promos',                    null,          'promo'),
  'smyths-soldes':        () => scrapeSmythsPaginated('https://www.smythstoys.com/fr/fr-fr/jouets/soldes/c/soldes',                               null,          'promo'),
  'smyths-lego-promo':    () => scrapeSmythsPaginated('https://www.smythstoys.com/fr/fr-fr/jouets/lego/promotions-lego/c/promotions-lego',        'Lego',        'promo'),
  // Philibert — promos + occasions
  philibert:              scrapePhilibert,
  'philibert-occasions':  () => scrapePhilibertPage('https://www.philibertnet.com/fr/214-occasions', null, 'promo'),
  // Cultura
  cultura:                scrapeCultura,
  'cultura-promo-jv':     () => scrapeCulturaPage('https://www.cultura.com/jeux-video-consoles/promotions-jeux-video.html', 'JeuxVideo', 'promo'),
  // Dealabs RSS — XML public, fiable, remplace Google Shopping
  'dealabs-pokemon':      () => scrapeDealabsRSS('https://www.dealabs.com/rss/groupes/pokemon',     'TCG'),
  'dealabs-lego':         () => scrapeDealabsRSS('https://www.dealabs.com/rss/groupes/lego',        'Lego'),
  'dealabs-jv':           () => scrapeDealabsRSS('https://www.dealabs.com/rss/groupes/jeux-video',  'JeuxVideo'),
  'dealabs-jouets':       () => scrapeDealabsRSS('https://www.dealabs.com/rss/groupes/jeux-jouets', null),
  // BCD Jeux — Chromium (WAF) — URLs PrestaShop vérifiées
  'bcd-jeux':             scrapeBcdJeux,   // agrège promos + soldes + 2pour1
  'bcd-promos':           () => scrapeBcdJeuxPage('https://www.bcd-jeux.fr/page/11-promotions',             null, 'promo'),
  'bcd-soldes':           () => scrapeBcdJeuxPage('https://www.bcd-jeux.fr/page/144-soldes-jeux-et-jouets', null, 'promo'),
  'bcd-2pour1':           () => scrapeBcdJeuxPaginated('https://www.bcd-jeux.fr/8301-promo-2-jeux-achetes-1-jeu-offert', null, 'promo', 2),
  // Fnac — Chromium
  fnac:                   scrapeFnac,
  'fnac-pokemon':         () => scrapeFnacPage('https://www.fnac.com/Carte-Pokemon/ia8454014/w-4', 'TCG', 'promo'),
  'fnac-lorcana':         () => scrapeFnacPage('https://www.fnac.com/Carte-Lorcana/ia8527699/w-4', 'TCG', 'promo'),
};

// ---------------------------------------------------------------
// Scrapers de catalogue (pages catégories, hors promo)
// ---------------------------------------------------------------
// URLs vérifiées manuellement — à mettre à jour si une page disparaît
const CATALOG_SCRAPERS = {
  // Cultura — TCG (URLs confirmées)
  'cultura-pokemon':     () => scrapeCulturaPage('https://www.cultura.com/jeux-video-consoles/cartes-a-jouer/cartes-pokemon.html', 'TCG', 'catalog'),
  'cultura-lorcana':     () => scrapeCulturaPage('https://www.cultura.com/jeux-video-consoles/cartes-a-jouer/cartes-lorcana.html', 'TCG', 'catalog'),
  'cultura-magic':       () => scrapeCulturaPage('https://www.cultura.com/jeux-video-consoles/cartes-a-jouer/cartes-magic.html',   'TCG', 'catalog'),
  // Cultura — Lego & JV
  'cultura-lego':        () => scrapeCulturaPage('https://www.cultura.com/univers-enfant/jeux-jouets/jeux-de-construction/lego/tous-les-produits-lego.html', 'Lego', 'catalog'),
  'cultura-jv':          () => scrapeCulturaPage('https://www.cultura.com/jeux-video-consoles.html', 'JeuxVideo', 'catalog'),
  // Philibert — slugs PrestaShop stables
  'philibert-pokemon':   () => scrapePhilibertPage('https://www.philibertnet.com/fr/212-pokemon',        'TCG',        'catalog'),
  'philibert-lorcana':   () => scrapePhilibertPage('https://www.philibertnet.com/fr/15880-lorcana',      'TCG',        'catalog'),
  'philibert-tcg':       () => scrapePhilibertPage('https://www.philibertnet.com/fr/119-jeux-de-cartes', 'TCG',        'catalog'),
  'philibert-js':        () => scrapePhilibertPage('https://www.philibertnet.com/fr/50-jeux-de-societe', 'JeuxSociete','catalog'),
  // Micromania utilise Gmail parser à la place (newsletter déjà reçue)
  // Fallback HTML désactivé (ECONNRESET — anti-bot actif). URLs correctes si besoin :
  // 'micromania-catalog': () => scrapeMicromaniaPage('https://www.micromania.fr/c/cartes',                     'TCG',      'catalog'),
  // 'micromania-pokemon': () => scrapeMicromaniaPage('https://www.micromania.fr/cartes-pokemon.html',          'TCG',      'catalog'),
  // 'micromania-lorcana': () => scrapeMicromaniaPage('https://www.micromania.fr/universe?licence=LORCANA',     'TCG',      'catalog'),
  // 'micromania-promo':   () => scrapeMicromaniaPage('https://www.micromania.fr/promotions',                   null,       'promo'),
  // Fnac — catalogue Chromium
  'fnac-pokemon-cat':    () => scrapeFnacPage('https://www.fnac.com/Carte-Pokemon/ia8454014/w-4', 'TCG',  'catalog'),
  'fnac-lorcana-cat':    () => scrapeFnacPage('https://www.fnac.com/Carte-Lorcana/ia8527699/w-4', 'TCG',  'catalog'),
  'fnac-lego-cat':       () => scrapeFnacPage('https://www.fnac.com/Lego/n-2218/w-4',             'Lego', 'catalog'),
  // Amazon — catalogue Chromium
  'amazon-pokemon':      () => scrapeAmazonPage('https://www.amazon.fr/s?k=cartes+pokemon&rh=n%3A322085011', 'TCG',  'catalog'),
  'amazon-lorcana':      () => scrapeAmazonPage('https://www.amazon.fr/s?k=cartes+lorcana',                  'TCG',  'catalog'),
  'amazon-lego':         () => scrapeAmazonPage('https://www.amazon.fr/s?k=lego&rh=n%3A322083011',           'Lego', 'catalog'),
  // Idealo — comparateur, Chromium (IDs catégorie stables)
  'idealo-pokemon':      () => scrapeIdealoPage('https://www.idealo.fr/cat/20338/cartes-pokemon.html', 'TCG',  'catalog'),
  'idealo-lego':         () => scrapeIdealoPage('https://www.idealo.fr/cat/1484/lego.html',             'Lego', 'catalog'),
  // BCD Jeux — Chromium — IDs PrestaShop permanents + pages éditoriales stables
  // Catégories numériques → pagination ?page=N
  'bcd-pokemon':         () => scrapeBcdJeuxPaginated('https://www.bcd-jeux.fr/51185-jeux-de-cartes-a-collectionner-pokemon', 'TCG',        'catalog'),
  'bcd-pokemon-fab':     () => scrapeBcdJeuxPaginated('https://www.bcd-jeux.fr/fabricant/276-pokemon',                        'TCG',        'catalog'),
  'bcd-lorcana':         () => scrapeBcdJeuxPaginated('https://www.bcd-jeux.fr/51188-disney-lorcana-tcg-jcc',                  'TCG',        'catalog'),
  'bcd-lorcana-fab':     () => scrapeBcdJeuxPaginated('https://www.bcd-jeux.fr/fabricant/920-disney-lorcana-tcg',              'TCG',        'catalog'),
  // Pages éditoriales → pas de pagination
  'bcd-tcg-global':      () => scrapeBcdJeuxPage('https://www.bcd-jeux.fr/page/133-jcc-jce-cartes-a-collectionner',           'TCG',        'catalog'),
  'bcd-jds':             () => scrapeBcdJeuxPage('https://www.bcd-jeux.fr/page/57-les-jeux-de-societe-pour-toute-la-famille',  'JeuxSociete','catalog'),

  // ── Boutiques spécialisées TCG ─────────────────────────────────
  // Shopify — API /products.json publique, pas de Chromium
  // Lorenzone — Shopify collections spécifiques (remplace ludiworld, plus précis)
  'lorenzone-pokemon':   () => scrapeShopifyJson('lorenzone.fr', [], 'lorenzone', 'TCG', 'catalog', 3, 'collections/pokemon'),
  'lorenzone-lorcana':   () => scrapeShopifyJson('lorenzone.fr', [], 'lorenzone', 'TCG', 'catalog', 3, 'collections/lorcana'),
  'relictcg-tcg':        () => scrapeShopifyJson('www.relictcg.com',           ['pokemon','lorcana','magic'], 'relictcg',     'TCG', 'catalog'),
  'kairyu-pokemon':      () => scrapeShopifyJson('www.kairyu.fr',              ['pokemon'],                   'kairyu',       'TCG', 'catalog'),
  'pokestation-pokemon': () => scrapeShopifyJson('www.pokestation.fr',         ['pokemon'],                   'pokestation',  'TCG', 'catalog'),
  // Pokemoms — WooCommerce (pas Shopify)
  'pokemoms-pokemon':    () => scrapeWooPaginated('https://pokemoms.fr/categorie-produit/pokemon/',                                    'pokemoms', 'pokemoms.fr',  'TCG', 'catalog'),
  'pokemoms-coffrets':   () => scrapeWooPaginated('https://pokemoms.fr/categorie-produit/pokemon/coffrets-boosters/',                  'pokemoms', 'pokemoms.fr',  'TCG', 'catalog'),
  'pokemoms-lorcana':    () => scrapeWooPaginated('https://pokemoms.fr/categorie-produit/lorcana-tcg/',                                'pokemoms', 'pokemoms.fr',  'TCG', 'catalog'),
  'pokemoms-boutique':   () => scrapeWooPaginated('https://pokemoms.fr/boutique-2/',                                                   'pokemoms', 'pokemoms.fr',  'TCG', 'catalog'),
  // Pokuji — WooCommerce (pas Shopify)
  'pokuji-pokemon':           () => scrapeWooPaginated('https://pokuji.fr/produits/cartes-a-collectionner-tcg/pokemon-francais/',              'pokuji', 'pokuji.fr', 'TCG', 'catalog'),
  'pokuji-lorcana':           () => scrapeWooPaginated('https://pokuji.fr/produits/cartes-a-collectionner-tcg/lorcana-francais/',              'pokuji', 'pokuji.fr', 'TCG', 'catalog'),
  'pokuji-lorcana-display':   () => scrapeWooPaginated('https://pokuji.fr/produits/cartes-a-collectionner-tcg/lorcana-francais/displays-lorcana/',  'pokuji', 'pokuji.fr', 'TCG', 'catalog'),
  'pokuji-lorcana-coffrets':  () => scrapeWooPaginated('https://pokuji.fr/produits/cartes-a-collectionner-tcg/lorcana-francais/coffrets-lorcana/', 'pokuji', 'pokuji.fr', 'TCG', 'catalog'),
  // Ultrajeux — PrestaShop (URLs de catégories, pas de recherche)
  'ultrajeux-pokemon':        () => scrapePrestaPagePaginated('https://www.ultrajeux.com/jeu-4-pokemon.html',                          'ultrajeux', 'www.ultrajeux.com', 'TCG', 'catalog', 3, 'p'),
  'ultrajeux-pokemon-cartes': () => scrapePrestaPagePaginated('https://www.ultrajeux.com/cat-1-4-cartes-a-collectionner-pokemon.html', 'ultrajeux', 'www.ultrajeux.com', 'TCG', 'catalog', 3, 'p'),
  'ultrajeux-lorcana':        () => scrapePrestaPagePaginated('https://www.ultrajeux.com/cat-0-1033-cartes-a-collectionner-lorcana.html', 'ultrajeux', 'www.ultrajeux.com', 'TCG', 'catalog', 3, 'p'),
  // Destocktcg — PrestaShop (URLs de catégories, pas de recherche)
  'destocktcg-pokemon':          () => scrapePrestaPagePaginated('https://www.destocktcg.fr/jeux-de-cartes-a-collectionner/pokemon/',                              'destocktcg', 'www.destocktcg.fr', 'TCG', 'catalog', 3, 'page'),
  'destocktcg-pokemon-boosters': () => scrapePrestaPagePaginated('https://www.destocktcg.fr/jeux-de-cartes-a-collectionner/pokemon/booster-et-boite-de-boosters/', 'destocktcg', 'www.destocktcg.fr', 'TCG', 'catalog', 3, 'page'),
  'destocktcg-lorcana':          () => scrapePrestaPagePaginated('https://www.destocktcg.fr/jeux-de-cartes-a-collectionner/disney-lorcana/',                       'destocktcg', 'www.destocktcg.fr', 'TCG', 'catalog', 3, 'page'),
  'destocktcg-tcg-global':       () => scrapePrestaPagePaginated('https://www.destocktcg.fr/jeux-de-cartes-a-collectionner/',                                      'destocktcg', 'www.destocktcg.fr', 'TCG', 'catalog', 3, 'page'),
  'hikaru-tcg':          () => scrapeShopifyJson('www.hikarudistribution.com', ['pokemon'],                   'hikaru',       'TCG', 'catalog'),
  'dracaugames-tcg':     () => scrapeShopifyJson('www.dracaugames.com',        ['pokemon','lorcana','magic'], 'dracaugames',  'TCG', 'catalog'),
  // Lecoindesbarons — WooCommerce catégories directes (la recherche retournait 0)
  'lecoindesbarons-pokemon': () => scrapeWooPaginated('https://lecoindesbarons.com/les-tcg/cartes-pokemon/',                'lecoindesbarons', 'lecoindesbarons.com', 'TCG', 'catalog'),
  'lecoindesbarons-lorcana': () => scrapeWooPaginated('https://lecoindesbarons.com/les-tcg/cartes-lorcana/',                'lecoindesbarons', 'lecoindesbarons.com', 'TCG', 'catalog'),
  'lecoindesbarons-display': () => scrapeWooPaginated('https://lecoindesbarons.com/les-tcg/cartes-pokemon/display-pokemon/', 'lecoindesbarons', 'lecoindesbarons.com', 'TCG', 'catalog'),
};

async function scrapeAll(only) {
  const keys = only?.length ? only : Object.keys(SCRAPERS);
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
  const keys = only?.length ? only : Object.keys(CATALOG_SCRAPERS);
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
