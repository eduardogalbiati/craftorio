// Agent inboxes (#240): another agent's request (the Oracle's) in its owner's conversation, drawn as
// one card in the Product Owner's drawer (views/backlog/backlog-po.js) and the Supervisor chat
// (views/supervisor/supervisor.js): who sent it and when, the kind, the reason, then the result with
// its state and its cost (US$ 0 and "no model call" for a mechanical request), and a link back to
// the Oracle's chat. The request's messages share `request.ref` (src/agent-inbox.js): the result and
// a plan request's question are drawn inside the card, not again (inCard); a plan answer stays a
// normal answer under it. reveal(ref) scrolls an open conversation to a request's card (the Oracle's
// line links to it).
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

  /** The card of a request message (role 'request'); `testid` names it for the screen it is on. */
  function cardHtml(msg, all, { testid }) {
    const r = msg.request || {};
    const result = resultOf(msg, all);
    const question = (all || []).find((x) => x.role === 'user' && x.request?.ref === r.ref);
    const failed = !!result?.error;
    const state = !result ? '<span class="pill pill-running">Working</span>' : failed ? '<span class="pill pill-failed">Failed</span>' : '<span class="pill pill-success">Done</span>';
    const outcome = !result ? ''
      : result.answer ? `<div class="small">Answered below.</div>`
        : `<div class="md md-compact">${esc(result.text || '')}</div>`;
    const cost = result ? `<div class="sup-wmsg-meta">${esc(usd(result.costUsd))} · ${result.model ? esc(result.model) : 'no model call'}</div>` : '';
    const back = r.from === 'oracle' ? ` · <a href="#" data-open-oracle-chat title="The Oracle's message that sent this request">Oracle's chat</a>` : '';
    return `<div class="sup-wmsg system agent-request${failed ? ' error' : ''}" data-testid="${esc(testid)}" data-request-ref="${esc(r.ref || '')}">
      <div class="sup-wmsg-meta">Request from ${esc(sender(r.from))} at ${esc(hhmm(msg.ts))} · <span class="badge">${esc(r.kind || '')}</span> · ${state}${back}</div>
      ${msg.reason ? `<div>${esc(msg.reason)}</div>` : ''}
      ${question ? `<div class="small muted">${esc(question.text)}</div>` : ''}
      ${outcome}${cost}</div>`;
  }

  /** Scrolls the request's card into view once its conversation is drawn. */
  function reveal(ref, tries = 10) {
    const card = [...document.querySelectorAll('[data-request-ref]')].find((el) => el.dataset.requestRef === ref && el.offsetParent);
    if (card) card.scrollIntoView({ block: 'center' });
    else if (tries > 0) setTimeout(() => reveal(ref, tries - 1), 200);
  }

  document.addEventListener('click', (e) => {
    const link = e.target.closest('[data-open-oracle-chat]');
    if (!link) return;
    e.preventDefault();
    window.OracleChat?.open();
  });

  window.AgentRequest = { cardHtml, inCard, reveal, usd };
})();
