'use strict';
/* ============================================================
   steam.js — Page Steam
   ============================================================ */

let allLibrary = [];
let allWishlist = [];

async function loadSteam() {
  await Promise.all([loadLibrary(), loadWishlist()]);
}

async function loadLibrary() {
  const grid = document.getElementById('libraryGrid');
  grid.innerHTML = '<div class="spinner"></div>';
  try {
    allLibrary = await API.get('/steam/library');
    renderLibraryStats(allLibrary);
    renderGameGrid(allLibrary, grid, true);
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--danger)">Erreur : ${escHtml(err.message)}</p>`;
  }
}

async function loadWishlist() {
  const grid = document.getElementById('wishlistGrid');
  grid.innerHTML = '<div class="spinner"></div>';
  try {
    allWishlist = await API.get('/steam/wishlist');
    renderGameGrid(allWishlist, grid, false);
  } catch (err) {
    grid.innerHTML = `<p style="color:var(--danger)">Erreur : ${escHtml(err.message)}</p>`;
  }
}

function renderLibraryStats(games) {
  const total   = games.length;
  const hoursAll = Math.round(games.reduce((s, g) => s + (g.playtime_forever || 0), 0) / 60);
  const hoursRecent = Math.round(games.reduce((s, g) => s + (g.playtime_2weeks || 0), 0) / 60);
  document.getElementById('libraryStats').innerHTML = `
    <div class="stat-chip"><strong>${total}</strong> jeux</div>
    <div class="stat-chip"><strong>${hoursAll}h</strong> total joué</div>
    <div class="stat-chip"><strong>${hoursRecent}h</strong> ces 2 semaines</div>
  `;
}

function renderGameGrid(games, container, showPlaytime) {
  if (!games.length) {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">🎮</div><p>Aucun jeu trouvé.</p></div>';
    return;
  }
  container.innerHTML = games.slice(0, 80).map(g => {
    const hours = showPlaytime ? Math.round((g.playtime_forever || 0) / 60) : null;
    return `
      <a class="game-card" href="${escHtml(g.store_url || `https://store.steampowered.com/app/${g.appid}`)}" target="_blank" rel="noopener">
        <img src="${escHtml(g.image_url || '')}" alt="" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'460\\' height=\\'215\\' viewBox=\\'0 0 460 215\\'><rect width=\\'460\\' height=\\'215\\' fill=\\'%231a1d27\\'/><text x=\\'50%25\\' y=\\'50%25\\' font-size=\\'40\\' text-anchor=\\'middle\\' dominant-baseline=\\'middle\\'>🎮</text></svg>'" />
        <div class="game-card-body">
          <div class="game-card-name">${escHtml(g.name)}</div>
          <div class="game-card-meta">
            ${showPlaytime ? `${hours}h joué` : ''}
            ${!showPlaytime && g.discount ? `<span class="game-card-sale">${formatPrice(g.sale_price)}</span><span class="game-card-discount">-${g.discount}%</span>` : ''}
            ${!showPlaytime && !g.discount && g.price ? formatPrice(g.price) : ''}
          </div>
        </div>
      </a>`;
  }).join('');
}

// ── Recherche bibliothèque ────────────────────────────────────
document.getElementById('librarySearch').addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = allLibrary.filter(g => g.name.toLowerCase().includes(q));
  renderGameGrid(filtered, document.getElementById('libraryGrid'), true);
});

// ── Refresh ───────────────────────────────────────────────────
document.getElementById('steamRefreshBtn').addEventListener('click', async () => {
  const btn = document.getElementById('steamRefreshBtn');
  btn.disabled = true;
  btn.textContent = '⏳...';
  try {
    await API.post('/steam/refresh', {});
    toast('Steam mis à jour !', 'success');
    await loadSteam();
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '↻ Mettre à jour';
  }
});

window.addEventListener('pagechange', (e) => {
  if (e.detail === 'steam') loadSteam();
});
