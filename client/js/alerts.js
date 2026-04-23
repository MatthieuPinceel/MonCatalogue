'use strict';
/* ============================================================
   alerts.js — Page Alertes Prix + Usage Anthropic
   ============================================================ */

async function loadAlerts() {
  await Promise.all([loadAlertsList(), loadAnthropicUsage()]);
}

async function loadAlertsList() {
  try {
    const alerts = await API.get('/alerts');
    renderAlertsTable(alerts);
  } catch (err) {
    toast(`Erreur alertes : ${err.message}`, 'error');
  }
}

function renderAlertsTable(alerts) {
  const tbody = document.getElementById('alertsTbody');
  if (!alerts.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty">Aucune alerte configurée.</td></tr>';
    return;
  }
  tbody.innerHTML = alerts.map(a => `
    <tr>
      <td><span class="badge badge-muted">${escHtml(a.type)}</span></td>
      <td>${escHtml(a.item_name)}</td>
      <td>${escHtml(a.source || '—')}</td>
      <td>${formatPrice(a.threshold_price)}</td>
      <td>${a.current_price ? formatPrice(a.current_price) : '—'}</td>
      <td>
        ${a.active
          ? '<span class="badge badge-success">Active</span>'
          : '<span class="badge badge-muted">Inactive</span>'}
        ${a.triggered_at ? `<br><small style="color:var(--text-muted)">Déclenchée ${formatDate(a.triggered_at)}</small>` : ''}
      </td>
      <td><button class="btn-icon" onclick="deleteAlert(${a.id})" title="Désactiver">🗑</button></td>
    </tr>
  `).join('');
}

async function loadAnthropicUsage() {
  try {
    const data = await API.get('/alerts/usage');
    const pct  = Math.min(data.percent_used, 100);
    const color = pct > 80 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--success)';

    document.getElementById('anthropicUsage').innerHTML = `
      <div class="stat-row" style="margin-bottom:12px">
        <div class="stat-chip">Ce mois : <strong>${data.total_usd.toFixed(4)} $</strong></div>
        <div class="stat-chip">Plafond : <strong>${data.limit_usd} $</strong></div>
        <div class="stat-chip">Restant : <strong>${data.remaining_usd.toFixed(4)} $</strong></div>
      </div>
      <div style="margin-bottom:12px">
        <div style="height:10px;background:var(--border);border-radius:5px;overflow:hidden">
          <div style="width:${pct}%;height:100%;background:${color};transition:width .4s"></div>
        </div>
        <div style="text-align:right;font-size:.75rem;color:var(--text-muted);margin-top:4px">${pct}% utilisé</div>
      </div>
      ${data.by_purpose.length ? `
      <table class="data-table">
        <thead><tr><th>Usage</th><th>Appels</th><th>Tokens in</th><th>Tokens out</th><th>Coût</th></tr></thead>
        <tbody>
          ${data.by_purpose.map(r => `
            <tr>
              <td>${escHtml(r.purpose || '—')}</td>
              <td>${r.calls}</td>
              <td>${r.tok_in?.toLocaleString('fr-FR')}</td>
              <td>${r.tok_out?.toLocaleString('fr-FR')}</td>
              <td>${r.total_usd?.toFixed(6)} $</td>
            </tr>
          `).join('')}
        </tbody>
      </table>` : '<p style="color:var(--text-muted);font-size:.9rem">Aucun appel Anthropic ce mois.</p>'}
    `;
  } catch (err) {
    document.getElementById('anthropicUsage').innerHTML = '<p style="color:var(--text-muted)">Non disponible</p>';
  }
}

// ── Nouvelle alerte ───────────────────────────────────────────
document.getElementById('addAlertBtn').addEventListener('click', () => {
  Modal.open('Nouvelle alerte prix', `
    <form id="alertForm">
      <div class="form-group">
        <label class="form-label">Type *</label>
        <select name="type" class="select" required>
          <option value="tcg_card">Carte TCG</option>
          <option value="lego_set">Set Lego</option>
          <option value="steam_game">Jeu Steam</option>
          <option value="promo">Promo générale</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">ID article *</label>
          <input name="item_id" class="input" placeholder="ex: sv7-123" required />
        </div>
        <div class="form-group">
          <label class="form-label">Nom *</label>
          <input name="item_name" class="input" placeholder="ex: Pikachu ex" required />
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">Source</label>
          <input name="source" class="input" placeholder="ex: cardmarket" />
        </div>
        <div class="form-group">
          <label class="form-label">Seuil de prix (€) *</label>
          <input name="threshold_price" class="input" type="number" step="0.01" placeholder="0.00" required />
        </div>
      </div>
      <div class="form-actions">
        <button type="button" class="btn btn-secondary" onclick="Modal.close()">Annuler</button>
        <button type="submit" class="btn btn-primary">Créer l'alerte</button>
      </div>
    </form>
  `);

  document.getElementById('alertForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd);
    body.threshold_price = parseFloat(body.threshold_price);
    try {
      await API.post('/alerts', body);
      toast('Alerte créée !', 'success');
      Modal.close();
      loadAlerts();
    } catch (err) {
      toast(`Erreur : ${err.message}`, 'error');
    }
  }, { once: true });
});

async function deleteAlert(id) {
  if (!confirm('Désactiver cette alerte ?')) return;
  try {
    await API.del(`/alerts/${id}`);
    toast('Alerte désactivée', 'success');
    loadAlerts();
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
  }
}

document.getElementById('gmailScanBtn').addEventListener('click', async () => {
  const btn    = document.getElementById('gmailScanBtn');
  const status = document.getElementById('gmailScanStatus');
  const days   = document.getElementById('gmailScanDays').value;
  btn.disabled = true;
  btn.textContent = '⏳ Scan en cours...';
  status.textContent = 'Analyse des images avec Claude Vision…';
  try {
    const data = await API.post(`/gmail/scan?days=${days}`, {});
    const aiCount = (data.items || []).filter(i => i.ai_summary).length;
    toast(`${data.saved} email(s) enregistré(s) sur ${data.scanned} trouvé(s)`, 'success');
    status.textContent = `✓ ${data.scanned} emails scannés · ${data.saved} nouveaux · ${aiCount} analysés par Vision`;
  } catch (err) {
    toast(`Erreur scan Gmail : ${err.message}`, 'error');
    status.textContent = '';
  } finally {
    btn.disabled = false;
    btn.innerHTML = '📧 Lancer le scan';
  }
});

document.getElementById('gmailAnalyzeBtn').addEventListener('click', async () => {
  const btn    = document.getElementById('gmailAnalyzeBtn');
  const status = document.getElementById('gmailScanStatus');
  btn.disabled = true;
  btn.textContent = '⏳ Analyse en cours...';
  status.textContent = 'Claude Vision analyse les images des emails…';
  try {
    const data = await API.post('/gmail/analyze', {});
    toast(`Vision : ${data.analyzed} email(s) analysé(s) sur ${data.total}`, 'success');
    status.textContent = `✓ ${data.analyzed}/${data.total} emails analysés par Vision`;
  } catch (err) {
    toast(`Erreur : ${err.message}`, 'error');
    status.textContent = '';
  } finally {
    btn.disabled = false;
    btn.textContent = '🤖 Analyser avec Vision';
  }
});

window.addEventListener('pagechange', (e) => {
  if (e.detail === 'alerts') loadAlerts();
});

window.deleteAlert = deleteAlert;
