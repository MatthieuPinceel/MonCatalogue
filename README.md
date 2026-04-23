# Mon Catalogue

Dashboard personnel pour suivre promotions, collections et budget autour de mes centres d'intérêt : TCG Pokémon, Lorcana, Lego et jeux vidéo.

> Projet réalisé en Node.js avec Claude (Anthropic) pour tester ses capacités et limites en développement d'applications complètes.

---

## Fonctionnalités

### Promos
- Scraping automatique des promotions sur plusieurs enseignes (Fnac, King Jouet, Micromania, Cultura, Philibert, BCD Jeux, Smyths, Furet du Nord, Amazon, Idealo, Dealabs)
- Classification IA des articles via Claude Haiku (détection promo / catalogue)
- Analyse individuelle d'une promo via Claude (type, économie, conditions)
- Scanner le catalogue pour trouver des prix de référence
- Scraping par source individuelle ou groupé
- Scan des emails Gmail pour extraire les offres reçues par mail
- Pagination, filtres (source, catégorie, type, remise), recherche plein texte

### TCG (Pokémon & Lorcana)
- Collection de cartes avec état (NM, LP, MP, HP, D), quantité et prix payé
- Recherche de cartes via PokémonTCG.io et Lorcast
- Ajout rapide depuis les résultats de recherche
- Wishlist produits scellés (booster, display, ETB, tin, coffret, deck…)
- Offres automatiques croisées avec les promos scrapées
- Cartes manquantes dans un set (comparaison collection / set complet)
- Export CSV de la collection
- Valeur de marché totale de la collection

### Lego
- Collection de sets avec statut (Possédé / Wishlist / Vendu)
- Lookup automatique sur Rebrickable (nom, pièces, prix catalogue, image)
- Wishlist enrichie des meilleures offres trouvées dans les promos
- Filtres par statut et thème
- Totaux : prix payés vs prix catalogue

### Steam
- Bibliothèque de jeux synchronisée via l'API Steam (temps de jeu, image)
- Wishlist Steam récupérée via Chromium (XHR interception, cookie de session)
- Statistiques : total de jeux, heures de jeu, top 5 plus joués, soldes en cours
- Refresh manuel ou automatique (cron quotidien 6h00)

### Budget
- Suivi mensuel des achats par catégorie (TCG Pokémon, TCG Lorcana, Lego, Jeux Vidéo, Jeux de Société)
- Limites mensuelles configurables par catégorie
- Indicateurs visuels de dépassement de budget
- Historique sur 12 mois avec graphique en barres (Chart.js)

### Alertes prix
- Alertes déclenchées quand un article passe sous un seuil de prix
- Notification par email (Nodemailer)
- Résumé hebdomadaire automatique généré par Claude Haiku (lundi 8h)
- Suivi de la consommation API Anthropic (coût, tokens, par usage)

### Liens utiles
- Page de liens organisés par catégorie : sites marchands, comparateurs, TCG, Lego, jeux vidéo

---

## Stack technique

| Couche | Technologie |
|--------|-------------|
| Serveur | Node.js 18+, Express 4 |
| Base de données | SQLite via better-sqlite3 (WAL mode) |
| Scraping HTML | Axios + Cheerio |
| Scraping JS | Playwright / Puppeteer (Chromium) |
| IA | Anthropic SDK (`@anthropic-ai/sdk`) — Claude Haiku |
| Emails | Gmail API (googleapis) + Nodemailer |
| TCG API | PokémonTCG.io, Lorcast |
| Lego API | Rebrickable |
| Steam | Steam Web API + Chromium (wishlist) |
| Crons | node-cron (timezone Europe/Paris) |
| Frontend | HTML/CSS/JS vanilla, Chart.js |
| Cache mémoire | Cache LRU maison avec TTL |
| Logs | Winston |

---

## Prérequis

- Node.js ≥ 18
- Un compte Steam (pour la bibliothèque et la wishlist)
- Une clé API Steam
- Un projet Google Cloud avec l'API Gmail activée (pour le scan des emails)
- Une clé API Anthropic (pour la classification IA et le résumé hebdo)
- Optionnel : clé PokémonTCG.io (sans clé, limite de requêtes plus basse)
- Optionnel : clé Rebrickable (pour le lookup des sets Lego)

---

## Installation

```bash
# Cloner le dépôt
git clone https://github.com/MatthieuPinceel/MonCatalogue.git
cd MonCatalogue

# Installer les dépendances
npm install

# Copier et remplir le fichier de configuration
cp .env.example .env
# Éditer .env avec vos clés API

# Initialiser la base de données
npm run db:init

# Démarrer en développement
npm run dev

# Démarrer en production
npm start
```

L'application est accessible sur `http://localhost:3000` (ou le port configuré dans `PORT`).

---

## Configuration `.env`

```dotenv
# Serveur
PORT=3000
DB_PATH=./server/db/database.sqlite

# Steam
STEAM_API_KEY=votre_cle_steam
STEAM_ID=votre_steam_id_64bits
STEAM_LOGIN_SECURE=valeur_du_cookie_steamLoginSecure   # optionnel, pour wishlist privée

# Anthropic (Claude)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MONTHLY_LIMIT_USD=5.00   # plafond de dépense mensuel

# Gmail
GMAIL_CLIENT_ID=...apps.googleusercontent.com
GMAIL_CLIENT_SECRET=...
GMAIL_REDIRECT_URI=http://localhost:3000/api/gmail/callback
GMAIL_USER=votre@gmail.com
GMAIL_TOKEN_PATH=./server/db/gmail_token.json

# TCG & Lego
POKEMON_TCG_API_KEY=           # optionnel
REBRICKABLE_API_KEY=           # optionnel

# Emails d'alerte
ALERT_EMAIL=votre@email.com

# Scraping (optionnel)
SCRAPE_DELAY_MS=1500
SCRAPE_USER_AGENT=

# Crons (expressions cron, défauts ci-dessous)
CRON_SCRAPE_PROMOS=30 2 * * *    # 2h30 chaque nuit
CRON_GMAIL_SCAN=0 7 * * *        # 7h00 chaque matin
CRON_PRICE_ALERTS=0 3 * * *      # 3h00 chaque nuit
CRON_PRICE_HISTORY=30 3 * * *    # 3h30 chaque nuit
CRON_WEEKLY_SUMMARY=0 8 * * 1    # lundi 8h00
```

---

## Authentification Gmail

L'authentification Gmail utilise OAuth2. Au premier lancement :

1. Démarrer le serveur
2. Ouvrir `http://localhost:3000/api/gmail/auth` dans un navigateur
3. Autoriser l'accès à votre compte Gmail
4. Le token est sauvegardé dans `GMAIL_TOKEN_PATH` pour les sessions suivantes

---

## Structure du projet

```
MonCatalogue/
├── client/
│   ├── index.html          # SPA — page unique
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js          # Routeur SPA, utilitaires globaux
│       ├── dashboard.js    # Page d'accueil / résumé
│       ├── promos.js       # Page promos & scraping
│       ├── tcg.js          # Page TCG (collection + wishlist)
│       ├── lego.js         # Page Lego
│       ├── steam.js        # Page Steam
│       ├── budget.js       # Page budget mensuel
│       └── alerts.js       # Page alertes prix & usage Anthropic
│
└── server/
    ├── index.js            # Point d'entrée Express
    ├── cron.js             # Tâches planifiées (node-cron)
    ├── db/
    │   ├── schema.js       # Définition des tables SQLite
    │   ├── init.js         # Initialisation de la BDD (singleton)
    │   └── database.sqlite # Base de données (gitignorée)
    ├── routes/
    │   ├── promos.js       # /api/promos
    │   ├── steam.js        # /api/steam
    │   ├── gmail.js        # /api/gmail
    │   ├── tcg.js          # /api/tcg
    │   ├── lego.js         # /api/lego
    │   ├── budget.js       # /api/budget
    │   ├── alerts.js       # /api/alerts
    │   ├── prices.js       # /api/prices
    │   └── db.js           # /api/db
    └── services/
        ├── scraper.js      # Scrapers par enseigne (Cheerio + Chromium)
        ├── ai-classifier.js# Classification IA des promos (Claude Haiku)
        ├── anthropic.js    # Wrapper SDK Anthropic
        ├── cache.js        # Cache mémoire LRU avec TTL
        ├── cardmarket.js   # Prix Cardmarket (TCG)
        ├── chromium.js     # Gestion instance Playwright/Puppeteer
        ├── logger.js       # Winston
        └── mailer.js       # Nodemailer + templates HTML
```

---

## API REST

| Méthode | Route | Description |
|---------|-------|-------------|
| GET | `/api/health` | Santé de l'application |
| GET | `/api/promos` | Liste des promos (filtres : source, category, sort, q…) |
| POST | `/api/promos/scrape` | Lancer le scraping promos |
| POST | `/api/promos/scrape-catalog` | Lancer le scraping catalogue |
| POST | `/api/promos/classify` | Classification IA des articles |
| POST | `/api/promos/:id/analyze` | Analyser une promo avec Claude |
| GET | `/api/steam/library` | Bibliothèque Steam |
| GET | `/api/steam/wishlist` | Wishlist Steam |
| GET | `/api/steam/stats` | Stats Steam |
| POST | `/api/steam/refresh` | Forcer la mise à jour Steam |
| GET | `/api/tcg/collection` | Collection TCG |
| POST | `/api/tcg/collection` | Ajouter une carte |
| GET | `/api/tcg/wishlist` | Wishlist TCG |
| POST | `/api/tcg/wishlist` | Ajouter à la wishlist |
| GET | `/api/tcg/wishlist/prices` | Wishlist + meilleures offres |
| GET | `/api/tcg/missing?game=&set=` | Cartes manquantes dans un set |
| GET | `/api/tcg/export` | Export CSV |
| GET | `/api/lego/collection` | Collection Lego |
| GET | `/api/lego/lookup/:setNumber` | Lookup Rebrickable |
| GET | `/api/lego/wishlist/prices` | Wishlist Lego + offres |
| GET | `/api/budget/summary?month=` | Résumé budget du mois |
| POST | `/api/budget/purchases` | Ajouter un achat |
| GET | `/api/gmail/auth` | Démarrer l'auth OAuth2 Gmail |
| POST | `/api/gmail/scan` | Scanner les emails |
| GET | `/api/alerts` | Liste des alertes prix |
| POST | `/api/alerts` | Créer une alerte |
| GET | `/api/alerts/usage` | Consommation API Anthropic |

---

## Tâches cron

| Cron | Heure par défaut | Action |
|------|-----------------|--------|
| Scraping promos | 2h30 | Scrape toutes les enseignes |
| Scan Gmail | 7h00 | Analyse les emails promotionnels |
| Alertes prix | 3h00 | Vérifie les seuils et envoie des emails |
| Historique prix | 3h30 | Met à jour les prix Cardmarket en collection |
| Résumé hebdo | Lundi 8h00 | Génère et envoie le résumé par Claude Haiku |
| Refresh Steam | 6h00 | Synchronise bibliothèque et wishlist Steam |

---

## Licence

MIT
