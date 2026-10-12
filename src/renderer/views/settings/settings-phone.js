/* global api */
// Settings › Phone gates (#226): the gates-only page the app serves to the owner's paired phones
// (src/mobile-gates.js, src/service/areas/phone-gates.js). Shows whether the page is served and
// where, "Pair a phone" (a one-time code and its QR code), the setup steps to reach the page
// privately from outside (Tailscale serve, Cloudflare Tunnel with access rules), the address from
// outside with Save and Check, and the paired phones with Revoke. Drawn into #set-phone by
// settings.js when the tab opens; uses app.js globals ($, esc, errMsg, state, confirmDialog).
(() => {
  const ph = { state: null, pairing: null, check: null, error: null, form: null, poll: null };

  const localUrl = (s) => s.url || `http://127.0.0.1:${s.port || 7400}`;
  const when = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { timeZone: TimeZone.current() }) : 'never');

  function statusHtml(s) {
    return s.running
      ? `<span class="badge live" data-testid="phone-status">Served at ${esc(s.url)}</span>`
      : '<span class="badge" data-testid="phone-status">Off</span>';
  }

  function checkHtml() {
    const c = ph.check;
    if (!c) return '';
    const one = (label, r) => (r == null ? `<span class="badge">${label}: not set</span>`
      : r.ok ? `<span class="badge live">${label}: reachable</span>`
        : `<span class="badge warn" title="${esc(r.error || `HTTP ${r.status}`)}">${label}: not reachable</span>`);
    return `<span class="row phone-check" data-testid="phone-reachability">${one('This computer', c.local)}${one('From outside', c.public)}</span>`;
  }

  function stepsHtml(s) {
    const local = localUrl(s);
    return `<ol class="phone-steps small" data-testid="phone-setup-steps">
        <li>The page listens on <code>${esc(local)}</code>, on this computer only. It shows only the open gates: nothing else of the app is served there.</li>
        <li>To reach it from your phone, privately: install <b>Tailscale</b> on this computer and on the phone (same account) and run <code>tailscale serve --bg ${esc(String(s.port || 7400))}</code>; only your devices reach the https address it prints. Or a named <b>Cloudflare Tunnel</b> to <code>${esc(local)}</code> behind a Cloudflare Access policy that allows only your email. Never a public address without access rules.</li>
        <li>Paste that https address in <b>Address from outside</b> above, Save, and press <b>Check</b>: the gate links in the notifications use it.</li>
        <li>Press <b>Pair a phone</b> and scan the QR code with the phone (or open the page and type the code). The phone keeps its own token: revoke it here at any time.</li>
        <li>A gate link works for that gate only, for 30 minutes; every answer asks you to confirm, showing what the button does.</li>
      </ol>`;
  }

  function pairingHtml() {
    const p = ph.pairing;
    if (!p) return '';
    return `<div class="phone-pair" data-testid="phone-pairing">
        <img class="phone-qr" src="${esc(p.qr)}" alt="QR code to pair a phone" width="168" height="168" />
        <div class="phone-pair-text">
          <div class="muted small">Pairing code (one use, until ${esc(new Date(p.expiresAt).toLocaleTimeString(undefined, { timeZone: TimeZone.current() }))})</div>
          <div class="phone-code mono" data-testid="phone-pairing-code">${esc(p.code)}</div>
          <div class="muted small phone-link" title="${esc(p.link)}">${esc(p.link)}</div>
        </div>
      </div>`;
  }

  function devicesHtml(s) {
    const rows = s.devices.map((d) => `<div class="s-row">
        <div class="s-label"><b>${esc(d.name)}</b><span>Paired ${esc(when(d.pairedAt))} · last answer ${esc(when(d.lastSeen))}</span></div>
        <div class="s-ctrl"><button class="btn sm ghost" type="button" data-phone-revoke="${esc(d.id)}">Revoke</button></div>
      </div>`).join('');
    return `<div class="s-group" data-testid="phone-devices">${rows || '<div class="s-row"><div class="s-label"><span>No phone is paired yet.</span></div></div>'}</div>`;
  }

  function formHtml(s) {
    const f = ph.form || { port: s.port || 7400, publicUrl: s.publicUrl || '' };
    return `<div class="s-row">
        <div class="s-label"><b>Port</b><span>The page's port on this computer (127.0.0.1). The next free port is used when it is taken.</span></div>
        <div class="s-ctrl"><input type="number" id="set-phone-port" class="s-num" min="1024" max="65535" step="1" value="${esc(String(f.port))}" aria-label="Phone gates port" /></div>
      </div>
      <div class="s-row">
        <div class="s-label"><b>Address from outside</b><span>Your private https address for the page (Tailscale or Cloudflare Tunnel), used in the gate links. Empty: the links use this computer's address.</span></div>
        <div class="s-ctrl"><input type="text" id="set-phone-public" class="phone-public" placeholder="https://my-pc.tailnet.ts.net" value="${esc(f.publicUrl)}" aria-label="Address from outside" /></div>
      </div>
      <div class="s-row" id="phone-form-actions"${ph.form ? '' : ' hidden'}><div class="s-label">${ph.form && ph.error ? `<span class="error small">${esc(ph.error)}</span>` : ''}</div>
        <div class="s-ctrl row"><button class="btn sm ghost" type="button" id="btn-phone-cancel">Cancel</button><button class="btn sm primary" type="button" id="btn-phone-save">Save</button></div></div>`;
  }

  function draw() {
    const box = $('#set-phone');
    const s = ph.state;
    if (!box || !s) return;
    box.innerHTML = `
      <p class="muted small phone-intro">Answer the human gates from your phone: a page with only the open gates, for your paired phones. An agent, a script or the supervisor never answers through it.</p>
      <div class="s-group">
        <div class="s-row">
          <div class="s-label"><b>Serve the gates page</b><span>${statusHtml(s)}</span></div>
          <label class="switch"><input type="checkbox" id="set-phone-enabled" aria-label="Serve the gates page"${s.enabled ? ' checked' : ''} /><span></span></label>
        </div>
        ${formHtml(s)}
        <div class="s-row">
          <div class="s-label"><b>Reachable</b><span>Whether the page answers on this computer and at the address from outside.</span>${checkHtml()}</div>
          <div class="s-ctrl"><button class="btn sm ghost" type="button" id="btn-phone-check">Check</button></div>
        </div>
        <div class="s-row">
          <div class="s-label"><b>Pair a phone</b><span>A one-time code, valid 10 minutes. Turns the page on.</span>${pairingHtml()}</div>
          <div class="s-ctrl"><button class="btn sm" type="button" id="btn-phone-pair">Pair a phone</button></div>
        </div>
        ${!ph.form && ph.error ? `<div class="s-row"><span class="error small">${esc(ph.error)}</span></div>` : ''}
      </div>
      <h3 class="s-subtitle">Setup</h3>
      ${stepsHtml(s)}
      <h3 class="s-subtitle">Paired phones</h3>
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
      if (!(await confirmDialog(`Revoke ${d?.name || 'this phone'}?`, 'Its gates page stops working at once; pair it again to use it.', 'Revoke'))) return;
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
    else $('#set-phone').innerHTML = `<p class="error small">${esc(ph.error || 'Phone gates are not available.')}</p>`;
  }

  window.PhoneGatesSettings = { render };
})();
