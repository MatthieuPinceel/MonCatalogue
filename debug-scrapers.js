'use strict';
/**
 * Script de diagnostic des scrapers — lance avec : node debug-scrapers.js
 * Affiche les 50 premiers éléments trouvés par cheerio pour chaque site.
 */
require('dotenv').config();
const axios   = require('axios');
const cheerio = require('cheerio');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const http = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Connection': 'keep-alive',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Cache-Control': 'max-age=0',
  }
});

const SITES = [
  {
    name: 'Smyths Mega Promos',
    url: 'https://www.smythstoys.com/fr/fr-fr/jouets/mega-promos/c/mega-promos',
    referer: 'https://www.smythstoys.com/fr/fr-fr/',
    selectors: ['.product-item', '[class*="product-item"]', '[class*="ProductItem"]', '[class*="product__"]', 'li.product', '.product-listing__item']
  },
  {
    name: 'Philibert Promotions',
    url: 'https://www.philibertnet.com/fr/promotions',
    referer: 'https://www.philibertnet.com/fr/',
    selectors: ['article.product-miniature', '.js-product-miniature', '[class*="product-miniature"]', '.product_list li', '.product-container']
  },
  {
    name: 'Cultura Promotions',
    url: 'https://www.cultura.com/les-promotions.html',
    referer: 'https://www.cultura.com/',
    selectors: ['[class*="product-tile"]', '[class*="ProductTile"]', '[class*="product-card"]', '[class*="product-item"]', '[class*="tile"]']
  },
  {
    name: 'Furet du Nord Soldes',
    url: 'https://www.furet.com/livres/livres-a-prix-reduits/loisirs-et-sports/jeux.html',
    referer: 'https://www.furet.com/',
    selectors: ['[class*="product"]', 'article', '.product-item', '[class*="card"]', 'li.item']
  },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  for (const site of SITES) {
    console.log(`\n${'='.repeat(70)}`);
    console.log(`SITE : ${site.name}`);
    console.log(`URL  : ${site.url}`);
    console.log('='.repeat(70));

    try {
      const { data, status } = await http.get(site.url, {
        headers: { Referer: site.referer }
      });
      console.log(`Status : ${status} | Taille HTML : ${data.length} octets`);

      if (typeof data !== 'string' || data.length < 500) {
        console.log('⚠️  Réponse trop courte ou non-HTML :', String(data).slice(0, 200));
        continue;
      }

      // Chercher la balise title
      const titleMatch = data.match(/<title[^>]*>([^<]+)<\/title>/i);
      console.log(`Title : ${titleMatch ? titleMatch[1].trim() : '(non trouvé)'}`);

      const $ = cheerio.load(data);

      // Tester chaque sélecteur
      for (const sel of site.selectors) {
        const count = $(sel).length;
        if (count > 0) {
          console.log(`\n✅ Sélecteur "${sel}" → ${count} éléments`);
          // Afficher les 3 premiers avec leur HTML réduit
          $(sel).slice(0, 3).each((i, el) => {
            const text = $(el).text().replace(/\s+/g, ' ').trim().slice(0, 150);
            const classes = $(el).attr('class') || '';
            console.log(`  [${i}] class="${classes.slice(0,80)}" | texte: ${text}`);
          });
        } else {
          console.log(`❌ Sélecteur "${sel}" → 0 éléments`);
        }
      }

      // Lister toutes les classes uniques qui contiennent "product"
      const productClasses = new Set();
      $('[class]').each((i, el) => {
        const cls = $(el).attr('class') || '';
        cls.split(' ').filter(c => /product|card|item|tile/i.test(c)).forEach(c => productClasses.add(c));
      });
      if (productClasses.size) {
        console.log(`\n📋 Classes contenant "product/card/item/tile" : ${[...productClasses].slice(0, 20).join(', ')}`);
      }

    } catch (err) {
      console.log(`❌ ERREUR : ${err.message}`);
    }

    await sleep(2000);
  }

  console.log('\n\nDiagnostic terminé.');
})();
