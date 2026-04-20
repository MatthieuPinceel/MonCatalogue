'use strict';

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const express = require('express');
const path    = require('path');
const logger  = require('./services/logger');
const { initDb } = require('./db/init');

// ---------------------------------------------------------------
// Init base de données
// ---------------------------------------------------------------
initDb();

// ---------------------------------------------------------------
// App Express
// ---------------------------------------------------------------
const app  = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// Fichiers statiques (dashboard front-end)
app.use(express.static(path.join(__dirname, '../client')));

// ---------------------------------------------------------------
// Routes API
// ---------------------------------------------------------------
app.use('/api/promos',  require('./routes/promos'));
app.use('/api/steam',   require('./routes/steam'));
app.use('/api/gmail',   require('./routes/gmail'));
app.use('/api/tcg',     require('./routes/tcg'));
app.use('/api/lego',    require('./routes/lego'));
app.use('/api/budget',  require('./routes/budget'));
app.use('/api/alerts',  require('./routes/alerts'));
app.use('/api/prices',  require('./routes/prices'));
app.use('/api/db',      require('./routes/db'));

// ---------------------------------------------------------------
// Route racine — API health
// ---------------------------------------------------------------
app.get('/api/health', (req, res) => {
  const { getDb } = require('./db/init');
  const db = getDb();
  const promos  = db.prepare('SELECT COUNT(*) as n FROM promos').get().n;
  const library = db.prepare('SELECT COUNT(*) as n FROM steam_library').get().n;
  res.json({
    status:  'ok',
    version: '1.0.0',
    uptime:  Math.round(process.uptime()),
    db: { promos, steam_library: library }
  });
});

// SPA fallback — renvoie index.html pour toutes les routes non-API
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Route API introuvable' });
  }
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

// ---------------------------------------------------------------
// Gestion erreurs globale
// ---------------------------------------------------------------
app.use((err, req, res, _next) => {
  logger.error(`[Express] ${err.message}`);
  res.status(500).json({ error: err.message });
});

// ---------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------
const server = app.listen(PORT, () => {
  logger.info(`╔══════════════════════════════════════════╗`);
  logger.info(`║   Mon Dashboard — démarré sur :${PORT}     ║`);
  logger.info(`╚══════════════════════════════════════════╝`);
  logger.info(`   Dashboard : http://localhost:${PORT}`);
  logger.info(`   API santé : http://localhost:${PORT}/api/health`);
  logger.info(`   Gmail auth: http://localhost:${PORT}/api/gmail/auth`);

  // Démarrer les crons en arrière-plan
  require('./cron');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} déjà utilisé. Changer PORT dans .env`);
  } else {
    logger.error(`Erreur serveur : ${err.message}`);
  }
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('[Server] Arrêt propre (SIGTERM)');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  logger.info('[Server] Arrêt propre (SIGINT)');
  server.close(() => process.exit(0));
});

module.exports = app;
