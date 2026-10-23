// The engine connection page (connection.html): this computer or a remote engine (address + token),
// Test connection, then Save and restart; after a failure of the remote engine, why, with Retry,
// Change the address and Use this computer. Cancel (or Esc) closes it without changing anything;
// when it is the app's only window (the engine failed) the button reads Quit and quits the app
// (Esc does not: quitting is never one stray key). Talks only to window.connection
// (src/engine-connection-preload.js); the saved token never comes back to the page (a blank token
// field keeps it). A plain-http address outside loopback and Tailscale shows "Allow an insecure
// connection", and its warning every time it is checked (#480). Its texts are connection.* keys of the catalog (#329, window.I18n): the language
// the engine's page asked for (?lang=, remembered for the next time), else the one this computer's
// app last showed, else the computer's; the main process's messages (test results, failures) stay
// English, like the engine's errors.
(() => {
  const $ = (sel) => document.querySelector(sel);
  const api = window.connection;
  const I18n = window.I18n;
  let view = null; // the last state(): { mode, saved, failure, app, remoteHost }
  let busy = false;

  // an IPC error's message without Electron's "Error invoking remote method '…': Error: " prefix
  const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
  const chosen = () => document.querySelector('input[name="cn-mode"]:checked')?.value || 'local';
  const fields = () => ({ address: $('#cn-address').value.trim(), token: $('#cn-token').value.trim() });

  // a plain-http address outside this computer and Tailscale: not encrypted, so Test and Save need
  // the opt-in (#480). The main process decides (engine-connection:check, its insecureAddress); the
  // last answer for the address in the field is kept here.
  let optInNeeded = false;
  let checkSeq = 0;
  async function checkAddress() {
    const seq = ++checkSeq;
    const address = $('#cn-address').value.trim();
    let needed = false;
    if (address) {
      try { needed = !!(await api.check(address)).insecure; } catch { needed = false; }
    }
    if (seq !== checkSeq) return; // the field changed meanwhile: a later answer paints
    optInNeeded = needed;
    paintInsecure();
  }

  // the opt-in shows for such an address; its warning, every time it is checked
  function paintInsecure() {
    const needed = chosen() === 'remote' && optInNeeded;
    $('#cn-insecure-row').classList.toggle('hidden', !needed);
    $('#cn-insecure-warning').classList.toggle('hidden', !(needed && $('#cn-insecure').checked));
  }

  function setResult(text, kind) {
    const el = $('#cn-result');
    el.textContent = text || '';
    el.dataset.kind = kind || '';
  }

  function showResult(r) {
    if (!r) return setResult('');
    if (r.ok) return setResult(r.message, r.sameContract ? 'ok' : 'warn');
    return setResult(r.message, 'error');
  }

  // the language the engine's page asked for (?lang=), kept for the page's next opening
  function chooseLanguage() {
    const asked = new URLSearchParams(location.search).get('lang');
    if (!asked || !I18n.languages().includes(asked)) return;
    I18n.setLanguage(asked);
    try { localStorage.setItem('interfaceLanguage', asked); } catch { /* no storage: this time only */ }
  }

  // the static texts of connection.html (data-i18n, data-i18n-placeholder)
  function paintTexts() {
    document.documentElement.lang = I18n.getLanguage();
    document.title = `${t('connection.title')} · Multiagent Orchestrator`;
    document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  }

  function nowText(v) {
    if (v.failure) return '';
    if (v.mode === 'remote') return t('connection.now_remote', { host: v.remoteHost || v.saved.address });
    return t('connection.now_local', { app: v.app });
  }

  function paintMode() {
    const remote = chosen() === 'remote';
    $('#cn-remote').classList.toggle('hidden', !remote);
    const same = view && chosen() === view.mode && !view.failure;
    $('#cn-save').textContent = t(remote ? 'connection.save_remote' : 'connection.save');
    $('#cn-save').disabled = busy || (same && !remote);
    $('#cn-test').disabled = busy;
    $('#cn-foot-hint').textContent = t(remote ? 'connection.foot_remote' : 'connection.foot_local');
    paintInsecure();
  }

  function paint(v) {
    view = v;
    const failed = !!v.failure;
    $('.cn-failure').classList.toggle('hidden', !failed);
    $('#cn-failure-text').textContent = failed ? v.failure.message : '';
    $('#cn-now').textContent = nowText(v);
    // data-close: what the button does, whatever the language
    $('#cn-cancel').dataset.close = v.alone ? 'quit' : 'cancel';
    $('#cn-cancel').textContent = t(v.alone ? 'connection.quit' : 'common.cancel');
    $('#cn-cancel').title = t(v.alone ? 'connection.quit_title' : 'connection.cancel_title');
    const mode = failed || v.saved.mode === 'remote' ? 'remote' : v.mode;
    document.querySelector(`input[name="cn-mode"][value="${mode}"]`).checked = true;
    $('#cn-address').value = v.saved.address || '';
    $('#cn-insecure').checked = !!v.saved.insecure;
    $('#cn-token').value = '';
    $('#cn-token').placeholder = v.saved.hasToken ? t('connection.token_saved') : '';
    setResult('');
    paintMode();
    checkAddress();
  }

  async function load() {
    try {
      paint(await api.state());
    } catch (e) {
      setResult(errText(e), 'error');
    }
  }

  // a pasted engine URL with ?token=…: the token goes to its own field, the address keeps the origin
  function splitPastedUrl() {
    const input = $('#cn-address');
    const m = /^(https?:\/\/[^/?#]+)\/?\?token=([^&#\s]+)\s*$/i.exec(input.value.trim());
    if (!m) return;
    input.value = m[1];
    try { $('#cn-token').value = decodeURIComponent(m[2]); } catch { $('#cn-token').value = m[2]; }
  }

  async function run(fn) {
    if (busy) return;
    busy = true;
    paintMode();
    try {
      await fn();
    } catch (e) {
      setResult(errText(e), 'error');
    } finally {
      busy = false;
      paintMode();
    }
  }

  const testNow = () => run(async () => {
    setResult(t('connection.testing'), 'busy');
    const { address, token } = fields();
    showResult(await api.test(address, token, $('#cn-insecure').checked));
  });

  const save = () => run(async () => {
    const mode = chosen();
    const { address, token } = fields();
    setResult(t(mode === 'remote' ? 'connection.testing' : 'connection.saving'), 'busy');
    const r = await api.save(mode, address, token, $('#cn-insecure').checked);
    if (r.test) showResult(r.test);
    if (!r.saved) return;
    if (r.restarting) setResult(`${r.test?.ok ? `${r.test.message} ` : ''}${t('connection.restarting')}`, 'ok');
    else { await load(); setResult(t('connection.saved'), 'ok'); }
  });

  const retry = () => run(async () => {
    setResult(t('connection.connecting'), 'busy');
    const r = await api.retry();
    if (!r.ok && r.failure) {
      $('#cn-failure-text').textContent = r.failure.message;
      setResult('');
    }
  });

  document.querySelectorAll('input[name="cn-mode"]').forEach((el) => el.addEventListener('change', () => { setResult(''); paintMode(); }));
  $('#cn-address').addEventListener('input', () => { splitPastedUrl(); setResult(''); checkAddress(); });
  $('#cn-insecure').addEventListener('change', () => { setResult(''); paintInsecure(); });
  $('#cn-token').addEventListener('input', () => setResult(''));
  $('#cn-address').addEventListener('keydown', (e) => { if (e.key === 'Enter') testNow(); });
  $('#cn-token').addEventListener('keydown', (e) => { if (e.key === 'Enter') testNow(); });
  $('#cn-test').addEventListener('click', testNow);
  $('#cn-save').addEventListener('click', save);
  $('#cn-retry').addEventListener('click', retry);
  const close = () => api.close().catch((e) => setResult(errText(e), 'error'));
  $('#cn-cancel').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && view && !view.alone) close(); });
  $('#cn-change').addEventListener('click', () => {
    document.querySelector('input[name="cn-mode"][value="remote"]').checked = true;
    paintMode();
    $('#cn-address').focus({ preventScroll: true });
    $('#cn-address').select();
  });
  $('#cn-local').addEventListener('click', () => {
    document.querySelector('input[name="cn-mode"][value="local"]').checked = true;
    paintMode();
    save();
  });
  chooseLanguage();
  paintTexts();
  api.onChanged(load);
  load();
})();
