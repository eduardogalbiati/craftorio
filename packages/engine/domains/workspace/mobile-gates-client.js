// Phone gates' inline browser client. Serialized by mobile-gates-page.js under a CSP nonce;
// no app API or external scripts. Reads can be retried, but a lost answer is never replayed.
function phoneGatesClient(text, state, progress) {
  const gateProgress = progress(text, state);
  const key = 'multiagent-phone-token';
  const byId = (id) => document.getElementById(id);
  const msg = byId('msg');
  const retry = byId('retry');
  let busy = false;
  let lastRead = null;
  // The last refused pairing stays on screen through automatic refreshes until a new attempt (#819).
  let pairError = null;

  function status(name, error = false, focus = false) {
    msg.setAttribute('role', error ? 'alert' : 'status');
    msg.setAttribute('aria-live', error ? 'assertive' : 'polite');
    msg.className = error ? 'error' : 'muted';
    msg.textContent = text[name];
    if (focus) msg.focus();
  }

  function token() {
    try { return localStorage.getItem(key); }
    catch { const error = new Error('Storage unavailable'); error.storage = true; throw error; }
  }

  async function request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal });
      // Never render the server's error as HTML. The route and status select known UI text.
      const data = response.ok ? await response.json() : null;
      return { ok: response.ok, status: response.status, data };
    } finally { clearTimeout(timer); }
  }

  function showPair(reason) {
    byId('pairing').hidden = false;
    byId('gates').replaceChildren();
    byId('list-updated').textContent = '';
    lastRead = null;
    retry.hidden = true;
    status(reason || 'unpaired', !!reason);
  }

  function card(gate, existing) {
    const item = existing || document.createElement('article');
    if (!existing) {
      item.className = 'card';
      item.dataset.key = JSON.stringify([gate.runId, gate.approvalId]);
      for (const tag of ['h2', 'p', 'p', 'a']) item.append(document.createElement(tag));
    }
    item.querySelector('h2').textContent = gate.title || gate.runId;
    const paragraphs = item.querySelectorAll('p');
    const since = Date.parse(gate.requestedAt);
    const minutes = Math.max(0, Math.floor((gate.serverNow - since) / 60000));
    const waiting = Number.isFinite(minutes) ? text.waiting_minutes.replace('{minutes}', String(minutes)) : text.waiting_unknown;
    paragraphs[0].className = 'muted queue-meta';
    paragraphs[0].textContent = [gate.projectId || text.project_unknown,
      ...(gate.issues || []).map((i) => '#' + i.number), gate.stepId, waiting].filter(Boolean).join(' · ');
    paragraphs[1].textContent = gate.headline || gate.message;
    const link = item.querySelector('a');
    link.className = 'btn primary';
    link.textContent = text.open;
    link.href = gate.url;
    return item;
  }

  function paintCards(gates) {
    const out = byId('gates');
    const existing = [...out.querySelectorAll('article')];
    const next = gates.map((g) => card(g, existing.find((item) => item.dataset.key === JSON.stringify([g.runId, g.approvalId]))));
    // Reuse existing nodes so focus is not lost when a read refreshes a signed link.
    for (const item of existing) if (!next.includes(item)) item.remove();
    for (const item of next) if (!out.contains(item)) out.append(item);
  }

  async function load(focus = false, automatic = false) {
    if (busy || (automatic && document.hidden)) return;
    busy = true;
    retry.disabled = true;
    try {
      const tk = token();
      if (!tk) { showPair(automatic ? pairError : null); return; }
      byId('pairing').hidden = true;
      if (!automatic) status('loading');
      const r = await request('/gates.json', { headers: { Authorization: 'Bearer ' + tk } });
      if (r.status === 401) {
        localStorage.removeItem(key);
        // Kept so an automatic refresh (visibilitychange, timer) still explains why the phone is unpaired.
        pairError = 'pair_invalid';
        showPair(pairError);
        return;
      }
      if (!r.ok || !Array.isArray(r.data.gates)) throw new Error('Unreadable gates');
      paintCards(r.data.gates);
      lastRead = new Date().toLocaleTimeString(document.documentElement.lang || 'en', { hour: '2-digit', minute: '2-digit' });
      byId('list-updated').textContent = text.updated.replace('{time}', lastRead);
      status(r.data.gates.length ? 'list_ready' : 'empty', false, focus);
      retry.textContent = text.refresh;
      retry.hidden = false;
    } catch (error) {
      if (lastRead) byId('list-updated').textContent = text.stale.replace('{time}', lastRead);
      status(error?.storage ? 'storage_unavailable' : 'list_failed', true, focus);
      retry.textContent = text.retry;
      retry.hidden = false;
    } finally {
      busy = false;
      retry.disabled = false;
    }
  }

  async function pair(code) {
    const name = (navigator.userAgent.match(/\(([^;)]+)/) || [])[1] || 'Phone';
    const r = await request('/pair', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code, name }),
    });
    if (!r.ok) return r.status === 429 ? 'pair_limited' : r.status === 403 ? 'pair_refused' : 'pair_failed';
    if (typeof r.data.token !== 'string' || !r.data.token) return 'pair_failed';
    try { localStorage.setItem(key, r.data.token); } catch { return 'storage_failed'; }
    return null;
  }

  async function pairAndLoad(code, focus = false) {
    if (busy) return;
    busy = true;
    const button = byId('pair-submit');
    button.disabled = true;
    status('pairing');
    let error;
    try { error = await pair(code); } catch { error = 'pair_failed'; }
    busy = false;
    button.disabled = false;
    pairError = error || null;
    if (error) {
      showPair(error);
      if (focus) msg.focus();
      return;
    }
    await load(focus);
  }

  function answerRefused(code) {
    if (code === 401) {
      try { localStorage.removeItem(key); } catch { /* the server already refused this device */ }
      return 'pair_invalid';
    }
    return ({ 400: 'answer_invalid', 403: 'link_invalid', 409: 'ended' })[code] || 'answer_unknown';
  }

  function bindConfirmation() {
    const form = byId('confirm');
    const button = byId('answer-submit');
    const recover = byId('recover');
    let locked = false;
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (busy || locked) return;
      if (gateProgress.expired()) { status('link_expired', true, true); return; }
      busy = true;
      button.disabled = true;
      status('sending');
      let result = 'answer_unknown';
      let correctable = false;
      let sent = false;
      try {
        const tk = token();
        if (!tk) result = 'unpaired';
        else {
          const d = form.dataset;
          sent = true;
          const r = await request(d.post, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
            body: JSON.stringify({ t: d.t, answer: d.answer, confirm: true, feedback: byId('fb').value || undefined }),
          });
          if (r.ok && r.data.ok === true) {
            gateProgress.finish();
            form.remove();
            status('answered', false, true);
            return;
          }
          result = answerRefused(r.status);
          if (r.status === 409) gateProgress.finish();
          correctable = r.status === 400;
        }
      } catch {
        // Only an attempted POST has an uncertain result; storage failures happen before sending.
        if (!sent) { result = 'storage_unavailable'; correctable = true; }
      }
      finally { busy = false; }
      locked = !correctable;
      button.disabled = locked;
      status(result, true, true);
      recover.hidden = correctable;
      if (result === 'pair_invalid' || result === 'unpaired' || result === 'link_invalid') {
        recover.href = '/';
        recover.textContent = text.all;
      }
    };
  }

  if (byId('confirm')) { bindConfirmation(); return; }
  if (!byId('pf')) return;
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(false, true); });
  globalThis.addEventListener?.('online', () => load(false, true));
  retry.onclick = () => load(true);
  byId('pf').onsubmit = (event) => {
    event.preventDefault();
    pairAndLoad(byId('pc').value.trim(), true);
  };
  const code = new URLSearchParams(location.search).get('pair');
  if (code) {
    history.replaceState(null, '', '/');
    pairAndLoad(code);
  } else load();
}

module.exports = { phoneGatesClient };
