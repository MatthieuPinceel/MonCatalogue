'use strict';

const puppeteer = require('puppeteer');
const logger    = require('./logger');

let _browser = null;

const LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-accelerated-2d-canvas',
  '--no-first-run',
  '--no-zygote',
  '--disable-gpu',
  '--disable-quic',
  '--disable-blink-features=AutomationControlled',
  '--disable-features=IsolateOrigins,site-per-process',
  '--window-size=1920,1080',
];

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function getBrowser() {
  if (_browser) {
    try { await _browser.version(); return _browser; } catch (_) { _browser = null; }
  }
  logger.info('[Chromium] Lancement navigateur...');
  _browser = await puppeteer.launch({
    headless: true,
    args: LAUNCH_ARGS,
    defaultViewport: { width: 1920, height: 1080 },
  });
  _browser.on('disconnected', () => { _browser = null; });
  return _browser;
}

async function withPage(fn) {
  const browser = await getBrowser();
  const page    = await browser.newPage();
  try {
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins',   { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR', 'fr', 'en-US', 'en'] });
      window.chrome = { runtime: {} };
    });
    await page.setUserAgent(UA);
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'fr-FR,fr;q=0.9',
      'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });
    return await fn(page);
  } finally {
    await page.close().catch(() => {});
  }
}

async function closeBrowser() {
  if (_browser) { await _browser.close().catch(() => {}); _browser = null; }
}

module.exports = { getBrowser, withPage, closeBrowser };
