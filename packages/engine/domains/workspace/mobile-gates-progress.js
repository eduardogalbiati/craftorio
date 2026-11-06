// Phone page progress: tab-scoped note drafts (never answers or tokens) and server-relative link
// expiry. Serialized inline by mobile-gates-page; storage denial never blocks a manual decision.
function phoneGateProgress(text, state) {
  const field = document.getElementById('fb');
  const hint = document.getElementById('draft-status');
  const key = state.draftKey;
  let finished = false;
  let interval = null;
  const ttl = 24 * 60 * 60 * 1000;
  function clearDraft() {
    if (!key) return;
    try { sessionStorage.removeItem(key); } catch { /* optional storage */ }
  }
  if (state.ended) clearDraft();
  function paintCount() {
    document.getElementById('note-count').textContent = text.note_count.replace('{count}', String(field.value.length));
  }
  if (field) {
    let restored = false;
    try {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        const draft = JSON.parse(raw);
        if (typeof draft.note === 'string' && Date.now() - draft.at < ttl && draft.at <= Date.now()) {
          field.value = draft.note.slice(0, 2000);
          restored = true;
        } else clearDraft();
      }
      hint.textContent = text[restored ? 'draft_restored' : 'draft_help'];
    } catch { hint.textContent = text.draft_unavailable; }
    paintCount();
    field.addEventListener('input', () => {
      paintCount();
      try {
        if (field.value) sessionStorage.setItem(key, JSON.stringify({ note: field.value.slice(0, 2000), at: Date.now() }));
        else clearDraft();
        hint.textContent = text[field.value ? 'draft_saved' : 'draft_help'];
      } catch { hint.textContent = text.draft_unavailable; }
    });
  }
  const expiry = document.getElementById('gate-expiry');
  const deadline = Number(state.expiresAt);
  const started = Date.now();
  function expired() { return deadline > 0 && Number(state.serverNow) + Date.now() - started >= deadline; }
  function updateExpiry() {
    if (finished || !expiry || !deadline) return;
    const minutes = Math.max(0, Math.ceil((deadline - Number(state.serverNow) - Date.now() + started) / 60000));
    const next = minutes ? text.link_remaining.replace('{minutes}', String(minutes)) : text.link_expired;
    if (expiry.textContent !== next) expiry.textContent = next;
    expiry.className = minutes ? 'muted' : 'error';
    if (expired()) {
      const button = document.getElementById('answer-submit');
      if (button) button.disabled = true;
      document.getElementById('fresh-link').hidden = false;
    }
  }
  updateExpiry();
  if (expiry && deadline && !expired()) interval = setInterval(updateExpiry, 1000);
  function finish() {
    clearDraft();
    finished = true;
    clearInterval(interval);
    if (expiry) expiry.hidden = true;
    const link = document.getElementById('fresh-link');
    if (link) link.hidden = true;
  }
  return { expired, finish };
}

module.exports = { phoneGateProgress };
