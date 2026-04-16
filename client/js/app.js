'use strict';
/* ============================================================
   app.js — Noyau de l'application
   Navigation, modal, toast, clock, utils
   ============================================================ */

// ─── API helper ───────────────────────────────────────────────
const API = {
  async get(path) {
    const res = await fetch(`/api${path}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  },
  async post(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  },
  async del(path) {
    const res = await fetch(`/api${path}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  },
  async put(path, body) {
    const res = await fetch(`/api${path}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    return res.json();
  }
};

// ─── Toast ────────────────────────────────────────────────────
function toast(message, type = 'info', duration = 4000) {
  const container = document.getElementById('toastContainer');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(10px)'; el.style.transition = '.3s'; setTimeout(() => el.remove(), 300); }, duration);
}

// ─── Modal ────────────────────────────────────────────────────
const Modal = {
  overlay: null,
  init() {
    this.overlay = document.getElementById('modalOverlay');
    document.getElementById('modalClose').addEventListener('click', () => this.close());
    this.overlay.addEventListener('click', (e) => { if (e.target === this.overlay) this.close(); });
  },
  open(title, bodyHtml) {
    document.getElementById('modalTitle').textContent = title;
    document.getElementById('modalBody').innerHTML = bodyHtml;
    this.overlay.classList.add('open');
  },
  close() {
    this.overlay.classList.remove('open');
  }
};

// ─── Navigation ───────────────────────────────────────────────
const Nav = {
  current: 'dashboard',
  init() {
    document.querySelectorAll('.nav-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const page = link.dataset.page;
        this.go(page);
        // Fermer sidebar sur mobile
        document.getElementById('sidebar').classList.remove('open');
      });
    });

    // Menu toggle mobile
    document.getElementById('menuToggle').addEventListener('click', () => {
      document.getElementById('sidebar').classList.toggle('open');
    });

    // Tabs
    document.querySelectorAll('.tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabId = tab.dataset.tab;
        const parent = tab.closest('.page');
        parent.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        parent.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(tabId)?.classList.add('active');
      });
    });
  },
  go(page) {
    this.current = page;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.page === page));
    document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${page}`));
    document.getElementById('pageTitle').textContent = {
      dashboard: 'Dashboard', promos: 'Promos', steam: 'Steam',
      tcg: 'TCG', lego: 'Lego', budget: 'Budget', alerts: 'Alertes'
    }[page] || page;
    // Charger les données de la page
    window.dispatchEvent(new CustomEvent('pagechange', { detail: page }));
  }
};

// ─── Horloge ─────────────────────────────────────────────────
function startClock() {
  const el = document.getElementById('clock');
  const tick = () => {
    const now = new Date();
    el.textContent = now.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };
  tick();
  setInterval(tick, 1000);
}

// ─── Budget Anthropic (sidebar) ────────────────────────────────
async function loadAnthropicBudget() {
  try {
    const data = await API.get('/alerts/usage');
    const fill  = document.getElementById('budgetFill');
    const value = document.getElementById('budgetValue');
    const pct   = Math.min(data.percent_used, 100);
    fill.style.width = `${pct}%`;
    fill.style.background = pct > 80 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--success)';
    value.textContent = `${data.total_usd.toFixed(3)} $ / ${data.limit_usd} $`;
  } catch (e) { /* silencieux */ }
}

// ─── Refresh button ───────────────────────────────────────────
document.getElementById('refreshBtn').addEventListener('click', () => {
  window.dispatchEvent(new CustomEvent('pagechange', { detail: Nav.current }));
  toast('Actualisation...', 'info', 1500);
});

// ─── Utils ────────────────────────────────────────────────────
function formatPrice(n) {
  if (n == null) return '—';
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
}
function formatDate(str) {
  if (!str) return '—';
  return new Date(str).toLocaleDateString('fr-FR');
}
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Démarrage ────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Modal.init();
  Nav.init();
  startClock();
  loadAnthropicBudget();
  setInterval(loadAnthropicBudget, 60000);

  // Charger la page par défaut
  Nav.go('dashboard');
});

// Rendre global
window.API         = API;
window.toast       = toast;
window.Modal       = Modal;
window.Nav         = Nav;
window.formatPrice = formatPrice;
window.formatDate  = formatDate;
window.escHtml     = escHtml;
