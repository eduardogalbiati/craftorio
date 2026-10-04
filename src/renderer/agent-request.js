// Agent inboxes (#240): another agent's request (the Oracle's) in its owner's conversation, drawn as
// one card in the Product Owner's drawer (views/backlog/backlog-po.js) and the Supervisor chat
// (views/supervisor/supervisor.js): who sent it and when, the kind, the reason, then the result with
// its state and its cost (US$ 0 and "no model call" for a mechanical request), and a link back to
// the Oracle's chat. The request's messages share `request.ref` (src/agent-inbox.js): the result and
// a plan request's question are drawn inside the card, not again (inCard); a plan answer stays a
// normal answer under it. reveal(ref) scrolls an open conversation to a request's card (the Oracle's
// line links to it).
// #241: a request that waits for the owner's click (a run retry, what the Night watch does not allow)
// is a card with Do it / Dismiss here, never in the Oracle's chat; a done change with a backup has Undo.
// The click goes to the owner's channel (supervisor:requestAct, po:requestAct).
(function () {
  const SENDERS = { oracle: 'the Oracle' };
  const sender = (from) => SENDERS[from] || (from ? `the ${from}` : 'another agent');
  const hhmm = (ts) => (ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '');
  /** A request's cost: "US$ 0" (no model call), else the model's cost. */
  const usd = (n) => { const v = Number(n) || 0; return v ? `US$ ${v.toFixed(v < 0.01 ? 4 : 2)}` : 'US$ 0'; };

  /** Whether a message is drawn inside its request's card (the mechanical result, a plan request's question or error). */
  const inCard = (msg) => !!msg?.request && msg.role !== 'request' && (msg.role === 'user' || !msg.answer);

  /** The message that answers a request: the last one with its ref that is not the request or its question. */
  const resultOf = (msg, all) => [...(all || [])].reverse().find((x) => x !== msg && x.request?.ref === msg.request.ref && x.role !== 'request' && x.role !== 'user') || null;

  /** The state of a request card: its pill, and which of Do it / Dismiss / Undo it offers (#241). */
  function stateOf(msg, result) {
    if (!result) return msg.pending ? { label: 'Waits for your click', pill: 'cancelled', canDo: true } : { label: 'Working', pill: 'running' };
    if (result.dismissed) return { label: 'Dismissed', pill: 'idle' };
    if (result.undone) return { label: 'Undone', pill: 'idle' };
    if (result.error) return { label: 'Failed', pill: 'failed' };
    return { label: 'Done', pill: 'success', canUndo: !!result.undo };
  }

  /**
   * The card of a request message (role 'request'); `testid` names it for the screen it is on. #241:
   * `owner` ('supervisor' | 'po', with its `projectId`) gives a card that waits for the owner's click
   * its Do it / Dismiss buttons, and a result with a backup its Undo.
   */
  function cardHtml(msg, all, { testid, owner = null, projectId = null }) {
    const r = msg.request || {};
    const result = resultOf(msg, all);
    const question = (all || []).find((x) => x.role === 'user' && x.request?.ref === r.ref);
    const st = stateOf(msg, result);
    const failed = st.pill === 'failed';
    const outcome = !result ? (msg.pending && msg.waits ? `<div class="small muted">${esc(msg.waits)}</div>` : '')
      : result.answer ? `<div class="small">Answered below.</div>`
        : `<div class="md md-compact">${esc(result.text || '')}</div>`;
    const cost = result ? `<div class="sup-wmsg-meta">${esc(usd(result.costUsd))} · ${result.model ? esc(result.model) : 'no model call'}</div>` : '';
    const back = r.from === 'oracle' ? ` · <a href="#" data-open-oracle-chat title="The Oracle's message that sent this request">Oracle's chat</a>` : '';
    const buttons = !owner ? ''
      : st.canDo ? `<button class="btn primary sm" type="button" data-request-act="do" data-testid="request-do">Do it</button><button class="btn ghost sm" type="button" data-request-act="dismiss" data-testid="request-dismiss">Dismiss</button>`
        : st.canUndo ? `<button class="btn ghost sm" type="button" data-request-act="undo" data-testid="request-undo" title="Put back the backup taken before the change">Undo</button>` : '';
    return `<div class="sup-wmsg system agent-request${failed ? ' error' : ''}" data-testid="${esc(testid)}" data-request-ref="${esc(r.ref || '')}"${owner ? ` data-request-owner="${esc(owner)}" data-request-project="${esc(projectId || '')}"` : ''}>
      <div class="sup-wmsg-meta">Request from ${esc(sender(r.from))} at ${esc(hhmm(msg.ts))} · <span class="badge">${esc(r.kind || '')}</span> · <span class="pill pill-${st.pill}">${esc(st.label)}</span>${back}</div>
      ${msg.reason ? `<div>${esc(msg.reason)}</div>` : ''}
      ${question ? `<div class="small muted">${esc(question.text)}</div>` : ''}
      ${outcome}${cost}${buttons ? `<div class="row agent-request-actions">${buttons}</div>` : ''}</div>`;
  }

  // The owner's click on a card: the owner's channel runs it, then the screen redraws its conversation
  // (the 'agent-request:changed' event: { owner, projectId, messages, error }; no messages: reload them).
  async function act(btn) {
    const card = btn.closest('[data-request-ref]');
    const owner = card?.dataset.requestOwner;
    if (!owner) return;
    const input = { ref: card.dataset.requestRef, action: btn.dataset.requestAct, mock: typeof devMode === 'function' ? devMode() : false };
    card.querySelectorAll('[data-request-act]').forEach((b) => { b.disabled = true; });
    let out;
    try {
      out = owner === 'po' ? await window.api.productOwnerRequestAct({ ...input, projectId: card.dataset.requestProject }) : await window.api.supervisorRequestAct(input);
    } catch (e) {
      out = { ok: false, error: String(e?.message || e) };
    }
    // a failed change is the card's result (in messages); a refused click (the card was handled meanwhile) is the error
    const error = out?.messages ? null : out?.error || null;
    window.dispatchEvent(new CustomEvent('agent-request:changed', { detail: { owner, projectId: card.dataset.requestProject || null, messages: out?.messages || null, error } }));
  }

  /** Scrolls the request's card into view once its conversation is drawn. */
  function reveal(ref, tries = 10) {
    const card = [...document.querySelectorAll('[data-request-ref]')].find((el) => el.dataset.requestRef === ref && el.offsetParent);
    if (card) card.scrollIntoView({ block: 'center' });
    else if (tries > 0) setTimeout(() => reveal(ref, tries - 1), 200);
  }

  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-request-act]');
    if (btn) { act(btn); return; }
    const link = e.target.closest('[data-open-oracle-chat]');
    if (!link) return;
    e.preventDefault();
    window.OracleChat?.open();
  });

  window.AgentRequest = { cardHtml, inCard, reveal, usd };
})();
