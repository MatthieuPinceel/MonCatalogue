'use strict';

/**
 * Tâches planifiées — node-cron
 * Toutes les horaires sont configurables dans .env
 */

const cron   = require('node-cron');
const logger = require('./services/logger');

// ---------------------------------------------------------------
// CRON 1 — Scraping nocturne des promos (défaut : 2h30)
// ---------------------------------------------------------------
const CRON_PROMOS = process.env.CRON_SCRAPE_PROMOS || '30 2 * * *';

cron.schedule(CRON_PROMOS, async () => {
  logger.info('[Cron] Scraping promos — démarrage');
  try {
    const { scrapeAll }    = require('./services/scraper');
    const { savePromos }   = require('./routes/promos');

    const items = await scrapeAll();
    const saved = savePromos(items);
    logger.info(`[Cron] Scraping promos — ${items.length} articles → ${saved} enregistrés`);
  } catch (err) {
    logger.error(`[Cron] Scraping promos erreur : ${err.message}`);
  }
}, { timezone: 'Europe/Paris' });

// ---------------------------------------------------------------
// CRON 2 — Scan Gmail quotidien (défaut : 7h00)
// ---------------------------------------------------------------
const CRON_GMAIL = process.env.CRON_GMAIL_SCAN || '0 7 * * *';

cron.schedule(CRON_GMAIL, async () => {
  logger.info('[Cron] Scan Gmail — démarrage');
  try {
    const { scanPromoEmails, loadStoredToken } = require('./routes/gmail');
    const tokenOk = loadStoredToken();
    if (!tokenOk) {
      logger.warn('[Cron] Gmail : token absent — passer par /api/gmail/auth');
      return;
    }
    const result = await scanPromoEmails();
    logger.info(`[Cron] Gmail — ${result.saved} email(s) traité(s)`);
  } catch (err) {
    logger.error(`[Cron] Gmail erreur : ${err.message}`);
  }
}, { timezone: 'Europe/Paris' });

// ---------------------------------------------------------------
// CRON 3 — Vérification alertes prix (défaut : 3h00)
// ---------------------------------------------------------------
const CRON_ALERTS = process.env.CRON_PRICE_ALERTS || '0 3 * * *';

cron.schedule(CRON_ALERTS, async () => {
  logger.info('[Cron] Alertes prix — vérification');
  try {
    await checkPriceAlerts();
  } catch (err) {
    logger.error(`[Cron] Alertes prix erreur : ${err.message}`);
  }
}, { timezone: 'Europe/Paris' });

// ---------------------------------------------------------------
// CRON 4 — Historique prix Cardmarket (défaut : 3h30)
// ---------------------------------------------------------------
const CRON_HISTORY = process.env.CRON_PRICE_HISTORY || '30 3 * * *';

cron.schedule(CRON_HISTORY, async () => {
  logger.info('[Cron] Historique prix — démarrage');
  try {
    await updatePriceHistory();
  } catch (err) {
    logger.error(`[Cron] Historique prix erreur : ${err.message}`);
  }
}, { timezone: 'Europe/Paris' });

// ---------------------------------------------------------------
// CRON 5 — Résumé hebdomadaire Claude Haiku (lundi 8h00)
// ---------------------------------------------------------------
const CRON_WEEKLY = process.env.CRON_WEEKLY_SUMMARY || '0 8 * * 1';

cron.schedule(CRON_WEEKLY, async () => {
  logger.info('[Cron] Résumé hebdomadaire — génération');
  try {
    await sendWeeklySummary();
  } catch (err) {
    logger.error(`[Cron] Résumé hebdo erreur : ${err.message}`);
  }
}, { timezone: 'Europe/Paris' });

// ---------------------------------------------------------------
// CRON 6 — Refresh Steam (tous les jours à 6h00)
// ---------------------------------------------------------------
cron.schedule('0 6 * * *', async () => {
  logger.info('[Cron] Refresh Steam — démarrage');
  try {
    if (!process.env.STEAM_API_KEY || !process.env.STEAM_ID) {
      logger.warn('[Cron] Steam : STEAM_API_KEY ou STEAM_ID manquant');
      return;
    }
    const steamRouter = require('./routes/steam');
    // Appel direct aux fonctions internes sans passer par HTTP
    await steamRouter._refresh();
    logger.info('[Cron] Refresh Steam — terminé');
  } catch (err) {
    logger.error(`[Cron] Steam refresh erreur : ${err.message}`);
  }
}, { timezone: 'Europe/Paris' });

logger.info('[Cron] Planificateur démarré (timezone: Europe/Paris)');

// ---------------------------------------------------------------
// Fonctions internes
// ---------------------------------------------------------------

async function checkPriceAlerts() {
  const { getDb }  = require('./db/init');
  const { getPokemonCardPrice } = require('./services/cardmarket');
  const mailer     = require('./services/mailer');
  const db         = getDb();

  const alerts = db.prepare(
    "SELECT * FROM price_alerts WHERE active = 1 AND email_sent = 0"
  ).all();

  logger.info(`[Alerts] ${alerts.length} alerte(s) active(s) à vérifier`);

  for (const alert of alerts) {
    let currentPrice = null;

    try {
      if (alert.type === 'tcg_card') {
        const result = await getPokemonCardPrice(alert.item_name);
        currentPrice = result?.priceFrom;
      }
      // Étendre pour d'autres types dans les phases suivantes

      if (currentPrice !== null && currentPrice <= alert.threshold_price) {
        logger.info(`[Alerts] DÉCLENCHÉE : ${alert.item_name} à ${currentPrice} € (seuil : ${alert.threshold_price} €)`);

        // Mettre à jour en base
        db.prepare(
          "UPDATE price_alerts SET current_price = ?, triggered_at = datetime('now') WHERE id = ?"
        ).run(currentPrice, alert.id);

        // Envoyer email
        const html = mailer.buildPriceAlertHtml({
          itemName:       alert.item_name,
          source:         alert.source || 'cardmarket',
          thresholdPrice: alert.threshold_price,
          currentPrice,
          url:            null
        });

        const result = await mailer.sendEmail({
          to:      process.env.ALERT_EMAIL,
          subject: `Alerte Prix : ${alert.item_name} → ${currentPrice} €`,
          html
        });

        if (result.sent) {
          db.prepare("UPDATE price_alerts SET email_sent = 1 WHERE id = ?").run(alert.id);
        }
      }
    } catch (err) {
      logger.warn(`[Alerts] Erreur vérif alerte #${alert.id} : ${err.message}`);
    }
  }
}

async function updatePriceHistory() {
  const { getDb } = require('./db/init');
  const { getPokemonCardPrice } = require('./services/cardmarket');
  const db = getDb();

  // Cartes en collection avec prix Cardmarket à mettre à jour
  const cards = db.prepare(
    "SELECT DISTINCT card_id, card_name, game FROM tcg_collection WHERE game = 'pokemon'"
  ).all();

  for (const card of cards) {
    try {
      const result = await getPokemonCardPrice(card.card_name);
      if (result?.priceFrom) {
        db.prepare(`
          INSERT INTO price_history (source, item_id, item_name, price, currency, scraped_at)
          VALUES ('cardmarket', ?, ?, ?, 'EUR', datetime('now'))
        `).run(`pokemon_${card.card_id}`, card.card_name, result.priceFrom);

        // Mettre à jour le prix courant en collection
        db.prepare(`
          UPDATE tcg_collection SET market_price = ?, last_price_update = datetime('now')
          WHERE card_id = ? AND game = 'pokemon'
        `).run(result.priceFrom, card.card_id);
      }
    } catch (err) {
      logger.warn(`[PriceHistory] Erreur ${card.card_name} : ${err.message}`);
    }
  }

  logger.info(`[PriceHistory] ${cards.length} carte(s) mises à jour`);
}

async function sendWeeklySummary() {
  const { getDb }    = require('./db/init');
  const { callHaiku } = require('./services/anthropic');
  const mailer       = require('./services/mailer');
  const db           = getDb();

  const since = new Date();
  since.setDate(since.getDate() - 7);

  // Top promos de la semaine
  const promos = db.prepare(`
    SELECT title, source, price, original_price, discount_percent
    FROM promos WHERE scraped_at >= ? AND discount_percent IS NOT NULL
    ORDER BY discount_percent DESC LIMIT 10
  `).all(since.toISOString());

  // Sorties à venir (7 prochains jours)
  const releases = db.prepare(`
    SELECT * FROM tcg_releases
    WHERE release_date BETWEEN date('now') AND date('now', '+7 days')
    ORDER BY release_date ASC
  `).all();

  // Budget du mois en cours
  const month  = new Date().toISOString().slice(0, 7);
  const budget = db.prepare(`
    SELECT category, SUM(amount) as spent FROM purchases
    WHERE purchase_date LIKE ? GROUP BY category
  `).all(`${month}%`);

  let aiSummary = '';
  try {
    const promoText = promos.map(p =>
      `${p.title} (${p.source}) : ${p.price}€ (-${p.discount_percent}%)`
    ).join('\n');

    const { text } = await callHaiku({
      purpose: 'weekly_summary',
      systemPrompt: 'Tu es un assistant personnel qui résume les promotions de la semaine de façon concise et enthousiaste en français. Sois bref (3-4 phrases max).',
      userMessage: `Voici les top promos de cette semaine :\n${promoText || 'Aucune promo notable.'}\n\nRésume en 3-4 phrases pour Matthieu, fan de TCG Pokémon, Lorcana, Lego et jeux vidéo.`
    });
    aiSummary = text;
  } catch (err) {
    logger.warn(`[WeeklySummary] Claude Haiku non disponible : ${err.message}`);
  }

  const html = mailer.buildWeeklySummaryHtml({
    promos,
    upcomingReleases: releases,
    budgetSummary: budget,
    aiSummary
  });

  await mailer.sendEmail({
    to:      process.env.ALERT_EMAIL,
    subject: `📊 Résumé hebdo — ${new Date().toLocaleDateString('fr-FR')}`,
    html
  });
}
