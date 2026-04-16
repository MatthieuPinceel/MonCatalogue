'use strict';

/**
 * Service d'envoi d'emails via Gmail API (OAuth2).
 * Dépend de server/routes/gmail.js pour le client OAuth2 initialisé.
 */

const logger = require('./logger');

let gmailClient = null;

/**
 * Injecter le client Gmail OAuth2 (appelé depuis routes/gmail.js après auth).
 * @param {object} client  instance google.auth.OAuth2 avec refresh_token
 */
function setGmailClient(client) {
  gmailClient = client;
}

/**
 * Envoyer un email via Gmail API.
 * @param {object} opts
 * @param {string} opts.to
 * @param {string} opts.subject
 * @param {string} opts.html
 * @param {string} [opts.text]
 */
async function sendEmail({ to, subject, html, text }) {
  if (!gmailClient) {
    logger.warn('[Mailer] Client Gmail non initialisé — email non envoyé');
    return { sent: false, reason: 'gmail_not_configured' };
  }

  try {
    const { google } = require('googleapis');
    const gmail = google.gmail({ version: 'v1', auth: gmailClient });

    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: Mon Dashboard <${process.env.GMAIL_USER}>`,
      `To: ${to}`,
      `Content-Type: text/html; charset=utf-8`,
      `MIME-Version: 1.0`,
      `Subject: ${utf8Subject}`,
      '',
      html
    ];
    const raw = Buffer.from(messageParts.join('\n'))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    const res = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw }
    });

    logger.info(`[Mailer] Email envoyé à ${to} — sujet : "${subject}" (id: ${res.data.id})`);
    return { sent: true, messageId: res.data.id };
  } catch (err) {
    logger.error(`[Mailer] Erreur envoi email : ${err.message}`);
    return { sent: false, reason: err.message };
  }
}

/**
 * Template HTML pour les alertes de prix.
 */
function buildPriceAlertHtml({ itemName, source, thresholdPrice, currentPrice, url }) {
  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><style>
  body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px; }
  .card { background: white; border-radius: 8px; padding: 20px; max-width: 500px; margin: auto; }
  .badge { background: #e74c3c; color: white; padding: 4px 10px; border-radius: 4px; font-size: 13px; }
  h2 { color: #2c3e50; }
  .price { font-size: 24px; font-weight: bold; color: #e74c3c; }
  .threshold { color: #7f8c8d; font-size: 14px; }
  a.btn { display: inline-block; margin-top: 16px; background: #3498db; color: white;
          padding: 10px 20px; border-radius: 6px; text-decoration: none; }
</style></head>
<body>
<div class="card">
  <span class="badge">Alerte Prix</span>
  <h2>${itemName}</h2>
  <p>Source : <strong>${source}</strong></p>
  <p class="price">${currentPrice.toFixed(2)} €</p>
  <p class="threshold">Seuil défini : ${thresholdPrice.toFixed(2)} €</p>
  ${url ? `<a class="btn" href="${url}" target="_blank">Voir l'offre</a>` : ''}
</div>
</body></html>`;
}

/**
 * Template HTML pour le résumé hebdomadaire.
 */
function buildWeeklySummaryHtml({ promos, priceChanges, upcomingReleases, budgetSummary, aiSummary }) {
  const promoList = (promos || []).slice(0, 10).map(p =>
    `<li><strong>${p.title}</strong> — ${p.price ? p.price.toFixed(2) + ' €' : 'prix N/A'}
     ${p.discount_percent ? `(-${p.discount_percent}%)` : ''} (${p.source})</li>`
  ).join('');

  return `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><style>
  body { font-family: Arial, sans-serif; background: #f4f4f4; padding: 20px; color: #333; }
  .card { background: white; border-radius: 8px; padding: 24px; max-width: 600px; margin: auto; }
  h1 { color: #2c3e50; border-bottom: 2px solid #3498db; padding-bottom: 8px; }
  h2 { color: #3498db; margin-top: 24px; }
  ul { padding-left: 20px; }
  li { margin-bottom: 6px; }
  .ai-summary { background: #ecf0f1; border-left: 4px solid #3498db; padding: 12px; border-radius: 4px; }
  .footer { margin-top: 24px; font-size: 12px; color: #95a5a6; text-align: center; }
</style></head>
<body>
<div class="card">
  <h1>📊 Résumé Hebdomadaire — Mon Dashboard</h1>
  ${aiSummary ? `<div class="ai-summary">${aiSummary}</div>` : ''}
  <h2>🏷️ Top 10 Promos de la semaine</h2>
  <ul>${promoList || '<li>Aucune promo trouvée cette semaine.</li>'}</ul>
  <h2>📦 Sorties à venir</h2>
  <ul>${(upcomingReleases || []).map(r =>
    `<li>${r.set_name} (${r.game}) — ${r.release_date}</li>`).join('') || '<li>Aucune sortie prévue.</li>'}</ul>
  <div class="footer">Mon Dashboard — généré le ${new Date().toLocaleDateString('fr-FR')}</div>
</div>
</body></html>`;
}

module.exports = { setGmailClient, sendEmail, buildPriceAlertHtml, buildWeeklySummaryHtml };
