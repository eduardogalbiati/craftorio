// The engine connection page (connection.html): this computer or a remote engine (address + token),
// Test connection, then Save and restart; after a failure of the remote engine, why, with Retry,
// Change the address and Use this computer. Cancel (or Esc) closes it without changing anything;
// when it is the app's only window (the engine failed) the button reads Quit and quits the app
// (Esc does not: quitting is never one stray key). Talks only to window.connection
// (src/engine-connection-preload.js); the saved token never comes back to the page (a blank token
// field keeps it).
(() => {
  const $ = (sel) => document.querySelector(sel);
  const api = window.connection;
  let view = null; // the last state(): { mode, saved, failure, app, remoteHost }
  let busy = false;

  // an IPC error's message without Electron's "Error invoking remote method '…': Error: " prefix
  const errText = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, '');
  const chosen = () => document.querySelector('input[name="cn-mode"]:checked')?.value || 'local';
  const fields = () => ({ address: $('#cn-address').value.trim(), token: $('#cn-token').value.trim() });

  function setResult(text, kind) {
    const el = $('#cn-result');
    el.textContent = text || '';
    el.dataset.kind = kind || '';
  }

  function showResult(t) {
    if (!t) return setResult('');
    if (t.ok) return setResult(t.message, t.sameContract ? 'ok' : 'warn');
    return setResult(t.message, 'error');
  }

  function nowText(v) {
    if (v.failure) return '';
    if (v.mode === 'remote') return `This window shows the engine on ${v.remoteHost || v.saved.address}.`;
    return `This computer runs the engine (app ${v.app}).`;
  }

  function paintMode() {
    const remote = chosen() === 'remote';
    $('#cn-remote').classList.toggle('hidden', !remote);
    const same = view && chosen() === view.mode && !view.failure;
    $('#cn-save').textContent = remote ? 'Test, save and restart' : 'Save and restart';
    $('#cn-save').disabled = busy || (same && !remote);
    $('#cn-test').disabled = busy;
    $('#cn-foot-hint').textContent = remote
      ? 'Saving tests the engine first, then restarts the app on it.'
      : 'Switching restarts the app on this computer\'s engine and workspace.';
  }

  function paint(v) {
    view = v;
    const failed = !!v.failure;
    $('.cn-failure').classList.toggle('hidden', !failed);
    $('#cn-failure-text').textContent = failed ? v.failure.message : '';
    $('#cn-now').textContent = nowText(v);
    $('#cn-cancel').textContent = v.alone ? 'Quit' : 'Cancel';
    $('#cn-cancel').title = v.alone ? 'Quit the app (this is its only window)' : 'Close without changing anything (Esc)';
    const mode = failed || v.saved.mode === 'remote' ? 'remote' : v.mode;
    document.querySelector(`input[name="cn-mode"][value="${mode}"]`).checked = true;
    $('#cn-address').value = v.saved.address || '';
    $('#cn-token').value = '';
    $('#cn-token').placeholder = v.saved.hasToken ? 'Saved (leave blank to keep it)' : '';
    setResult('');
    paintMode();
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
    setResult('Testing…', 'busy');
    const { address, token } = fields();
    showResult(await api.test(address, token));
  });

  const save = () => run(async () => {
    const mode = chosen();
    const { address, token } = fields();
    setResult(mode === 'remote' ? 'Testing…' : 'Saving…', 'busy');
    const r = await api.save(mode, address, token);
    if (r.test) showResult(r.test);
    if (!r.saved) return;
    if (r.restarting) setResult(`${r.test?.ok ? `${r.test.message} ` : ''}Restarting…`, 'ok');
    else { setResult(r.message || 'Saved.', 'ok'); await load(); }
  });

  const retry = () => run(async () => {
    setResult('Connecting…', 'busy');
    const r = await api.retry();
    if (!r.ok && r.failure) {
      $('#cn-failure-text').textContent = r.failure.message;
      setResult('');
    }
  });

  document.querySelectorAll('input[name="cn-mode"]').forEach((el) => el.addEventListener('change', () => { setResult(''); paintMode(); }));
  $('#cn-address').addEventListener('input', () => { splitPastedUrl(); setResult(''); });
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
  api.onChanged(load);
  load();
})();
