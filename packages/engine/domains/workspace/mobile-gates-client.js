// Phone gates' inline browser client. Serialized by mobile-gates-page.js under a CSP nonce;
// no app API or external scripts. Reads can be retried, but a lost answer is never replayed.
function phoneGatesClient(text) {
  const key = 'multiagent-phone-token';
  const byId = (id) => document.getElementById(id);
  const msg = byId('msg');
  const retry = byId('retry');
  let busy = false;

  function status(name, error = false, focus = false) {
    msg.setAttribute('role', error ? 'alert' : 'status');
    msg.setAttribute('aria-live', error ? 'assertive' : 'polite');
    msg.className = error ? 'error' : 'muted';
    msg.textContent = text[name];
    if (focus) msg.focus();
  }

  function token() {
    return localStorage.getItem(key);
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
    retry.hidden = true;
    status(reason || 'unpaired', !!reason);
  }

  function card(gate) {
    const item = document.createElement('article');
    item.className = 'card';
    const title = document.createElement('h2');
    title.textContent = gate.title || gate.runId;
    const step = document.createElement('p');
    step.className = 'muted';
    step.textContent = gate.stepId;
    const summary = document.createElement('p');
    summary.textContent = gate.headline || gate.message;
    const link = document.createElement('a');
    link.className = 'btn primary';
    link.textContent = text.open;
    link.href = gate.url;
    item.append(title, step, summary, link);
    return item;
  }

  async function load(focus = false) {
    if (busy) return;
    busy = true;
    retry.disabled = true;
    try {
      const tk = token();
      if (!tk) { showPair(); return; }
      byId('pairing').hidden = true;
      byId('gates').replaceChildren();
      status('loading');
      const r = await request('/gates.json', { headers: { Authorization: 'Bearer ' + tk } });
      if (r.status === 401) {
        localStorage.removeItem(key);
        showPair('pair_invalid');
        return;
      }
      if (!r.ok || !Array.isArray(r.data.gates)) throw new Error('Unreadable gates');
      byId('gates').replaceChildren(...r.data.gates.map(card));
      status(r.data.gates.length ? 'list_ready' : 'empty', false, focus);
      retry.textContent = text.refresh;
      retry.hidden = false;
    } catch {
      status('list_failed', true, focus);
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
      busy = true;
      button.disabled = true;
      status('sending');
      let result = 'answer_unknown';
      let correctable = false;
      try {
        const tk = token();
        if (!tk) result = 'unpaired';
        else {
          const d = form.dataset;
          const r = await request(d.post, {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tk },
            body: JSON.stringify({ t: d.t, answer: d.answer, confirm: true, feedback: byId('fb').value || undefined }),
          });
          if (r.ok && r.data.ok === true) {
            form.remove();
            status('answered', false, true);
            return;
          }
          result = answerRefused(r.status);
          correctable = r.status === 400;
        }
      } catch { /* The server may have received the answer: never retry a POST automatically. */ }
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
