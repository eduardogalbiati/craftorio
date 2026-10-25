/* global api */
// Settings › Phone gates (#226): the gates-only page the app serves to the owner's paired phones
// (packages/engine/domains/workspace/mobile-gates.js, packages/engine/service/areas/phone-gates.js). Shows whether the page is served and
// where, "Pair a phone" (a one-time code and its QR code), the setup steps to reach the page
// privately from outside (Tailscale serve, Cloudflare Tunnel with access rules), the address from
// outside with Save and Check, and the paired phones with Revoke. Drawn into #set-phone by
// settings.js when the tab opens; uses app.js globals ($, esc, errMsg, state, confirmDialog) and the
// catalog's t (packages/shared/i18n.js, #329: its texts are settings.phone.*).
(() => {
  const ph = { state: null, pairing: null, check: null, error: null, form: null, poll: null };

  const PUBLIC_EXAMPLE = 'https://my-pc.tailnet.ts.net';
  const localUrl = (s) => s.url || `http://127.0.0.1:${s.port || 7400}`;
  const when = (iso) => (iso ? TimeZone.formatLocale(iso, { dateStyle: 'short', timeStyle: 'medium' }, TimeZone.current()) : t('settings.phone.never'));

  function statusHtml(s) {
    return s.running
      ? `<span class="badge live" data-testid="phone-status">${t('settings.phone.served_at', { url: esc(s.url) })}</span>`
      : `<span class="badge" data-testid="phone-status">${t('settings.off')}</span>`;
  }

  function checkHtml() {
    const c = ph.check;
    if (!c) return '';
    const one = (label, r) => (r == null ? `<span class="badge">${t('settings.phone.not_set', { label })}</span>`
      : r.ok ? `<span class="badge live">${t('settings.phone.reachable_state', { label })}</span>`
        : `<span class="badge warn" title="${esc(r.error || `HTTP ${r.status}`)}">${t('settings.phone.not_reachable', { label })}</span>`);
    return `<span class="row phone-check" data-testid="phone-reachability">${one(t('settings.phone.this_computer'), c.local)}${one(t('settings.phone.from_outside'), c.public)}</span>`;
  }

  function stepsHtml(s) {
    const local = esc(localUrl(s));
    return `<ol class="phone-steps small" data-testid="phone-setup-steps">
        <li>${t('settings.phone.step_listen', { url: local })}</li>
        <li>${t('settings.phone.step_reach', { port: esc(String(s.port || 7400)), url: local })}</li>
        <li>${t('settings.phone.step_address')}</li>
        <li>${t('settings.phone.step_pair')}</li>
        <li>${t('settings.phone.step_link')}</li>
      </ol>`;
  }

  function pairingHtml() {
    const p = ph.pairing;
    if (!p) return '';
    const until = TimeZone.formatLocale(p.expiresAt, { timeStyle: 'medium' }, TimeZone.current());
    return `<div class="phone-pair" data-testid="phone-pairing">
        <img class="phone-qr" src="${esc(p.qr)}" alt="${t('settings.phone.qr_alt')}" width="168" height="168" />
        <div class="phone-pair-text">
          <div class="muted small">${t('settings.phone.code_until', { time: esc(until) })}</div>
          <div class="phone-code mono" data-testid="phone-pairing-code">${esc(p.code)}</div>
          <div class="muted small phone-link" title="${esc(p.link)}">${esc(p.link)}</div>
        </div>
      </div>`;
  }

  function devicesHtml(s) {
    const rows = s.devices.map((d) => `<div class="s-row">
        <div class="s-label"><b>${esc(d.name)}</b><span>${t('settings.phone.paired_line', { paired: esc(when(d.pairedAt)), seen: esc(when(d.lastSeen)) })}</span></div>
        <div class="s-ctrl"><button class="btn sm ghost" type="button" data-phone-revoke="${esc(d.id)}">${t('settings.phone.revoke')}</button></div>
      </div>`).join('');
    return `<div class="s-group" data-testid="phone-devices">${rows || `<div class="s-row"><div class="s-label"><span>${t('settings.phone.no_devices')}</span></div></div>`}</div>`;
  }

  function formHtml(s) {
    const f = ph.form || { port: s.port || 7400, publicUrl: s.publicUrl || '' };
    return `<div class="s-row">
        <div class="s-label"><b>${t('settings.phone.port')}</b><span>${t('settings.phone.port_help')}</span></div>
        <div class="s-ctrl"><input type="number" id="set-phone-port" class="s-num" min="1024" max="65535" step="1" value="${esc(String(f.port))}" aria-label="${t('settings.phone.port_label')}" /></div>
      </div>
      <div class="s-row">
        <div class="s-label"><b>${t('settings.phone.address')}</b><span>${t('settings.phone.address_help')}</span></div>
        <div class="s-ctrl"><input type="text" id="set-phone-public" class="phone-public" placeholder="${PUBLIC_EXAMPLE}" value="${esc(f.publicUrl)}" aria-label="${t('settings.phone.address')}" /></div>
      </div>
      <div class="s-row" id="phone-form-actions"${ph.form ? '' : ' hidden'}><div class="s-label">${ph.form && ph.error ? `<span class="error small">${esc(ph.error)}</span>` : ''}</div>
        <div class="s-ctrl row"><button class="btn sm ghost" type="button" id="btn-phone-cancel">${t('common.cancel')}</button><button class="btn sm primary" type="button" id="btn-phone-save">${t('common.save')}</button></div></div>`;
  }

  function draw() {
    const box = $('#set-phone');
    const s = ph.state;
    if (!box || !s) return;
    box.innerHTML = `
      <p class="muted small phone-intro">${t('settings.phone.intro')}</p>
      <div class="s-group">
        <div class="s-row">
          <div class="s-label"><b>${t('settings.phone.serve')}</b><span>${statusHtml(s)}</span></div>
          <label class="switch"><input type="checkbox" id="set-phone-enabled" aria-label="${t('settings.phone.serve')}"${s.enabled ? ' checked' : ''} /><span></span></label>
        </div>
        ${formHtml(s)}
        <div class="s-row">
          <div class="s-label"><b>${t('settings.phone.reachable')}</b><span>${t('settings.phone.reachable_help')}</span>${checkHtml()}</div>
          <div class="s-ctrl"><button class="btn sm ghost" type="button" id="btn-phone-check">${t('settings.phone.check')}</button></div>
        </div>
        <div class="s-row">
          <div class="s-label"><b>${t('settings.phone.pair')}</b><span>${t('settings.phone.pair_help')}</span>${pairingHtml()}</div>
          <div class="s-ctrl"><button class="btn sm" type="button" id="btn-phone-pair">${t('settings.phone.pair')}</button></div>
        </div>
        ${!ph.form && ph.error ? `<div class="s-row"><span class="error small">${esc(ph.error)}</span></div>` : ''}
      </div>
      <h3 class="s-subtitle">${t('settings.phone.setup')}</h3>
      ${stepsHtml(s)}
      <h3 class="s-subtitle">${t('settings.phone.paired')}</h3>
      ${devicesHtml(s)}`;
    wire();
  }

  const act = async (fn) => {
    try { ph.error = null; await fn(); } catch (e) { ph.error = errMsg(e); }
    draw();
  };

  function wire() {
    $('#set-phone-enabled').onchange = (e) => act(async () => { ph.state = await api.configurePhoneGates({ enabled: e.target.checked }); });
    // editing the port or the address shows Save / Cancel (nothing is saved on a keystroke)
    const edit = () => {
      ph.form = { port: $('#set-phone-port').value, publicUrl: $('#set-phone-public').value };
      $('#phone-form-actions').hidden = false;
    };
    $('#set-phone-port').oninput = edit;
    $('#set-phone-public').oninput = edit;
    $('#btn-phone-cancel').onclick = () => { ph.form = null; ph.error = null; draw(); };
    $('#btn-phone-save').onclick = () => act(async () => {
      ph.state = await api.configurePhoneGates({ port: Number($('#set-phone-port').value), publicUrl: $('#set-phone-public').value.trim() });
      ph.form = null;
    });
    $('#btn-phone-check').onclick = () => act(async () => { ph.check = await api.checkPhoneGates(); });
    $('#btn-phone-pair').onclick = () => act(async () => {
      const p = await api.pairPhone();
      ph.pairing = p;
      ph.state = p.state;
      watchPairing(p);
    });
    document.querySelectorAll('[data-phone-revoke]').forEach((b) => (b.onclick = () => act(async () => {
      const d = ph.state.devices.find((x) => x.id === b.dataset.phoneRevoke);
      if (!(await confirmDialog(t('settings.phone.revoke_title', { name: d?.name || t('settings.phone.this_phone') }), t('settings.phone.revoke_body'), t('settings.phone.revoke')))) return;
      ph.state = await api.revokePhone(b.dataset.phoneRevoke);
    })));
  }

  // while a code is shown, the paired phones are refreshed (the phone pairs itself from the QR code)
  function watchPairing(p) {
    clearInterval(ph.poll);
    const until = Date.parse(p.expiresAt);
    const count = ph.state.devices.length;
    ph.poll = setInterval(async () => {
      const visible = state.view === 'settings' && $('#set-phone') && !$('[data-spage="phone"]').classList.contains('hidden');
      if (!visible || Date.now() > until) { clearInterval(ph.poll); return; }
      try {
        const s = await api.phoneGatesState();
        if (s.devices.length !== count) { ph.state = s; ph.pairing = null; clearInterval(ph.poll); draw(); }
      } catch { /* the next tick tries again */ }
    }, 3000);
  }

  async function render() {
    try { ph.state = await api.phoneGatesState(); ph.error = null; } catch (e) { ph.error = errMsg(e); }
    if (ph.state) draw();
    else $('#set-phone').innerHTML = `<p class="error small">${esc(ph.error || t('settings.phone.unavailable'))}</p>`;
  }

  window.PhoneGatesSettings = { render };
})();
