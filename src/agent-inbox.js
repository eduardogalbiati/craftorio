// Agent inboxes (#240): another agent (the Oracle) asks the owner of an area for a change, and the
// owner executes it and keeps it in its own conversation. Each owner has a closed list of request
// kinds (src/product-owner.js REQUEST_KINDS: the Backlog; src/supervisor-chat.js REQUEST_KINDS:
// workflows, skills and runs) and a handleRequest built on handle() below:
//   1. the request is recorded in the owner's history ({ role: 'request', request: { from, kind, ref } },
//      "Request from the Oracle: <kind> (<reason>)"), ref being the sender's message id;
//   2. a mechanical kind runs `perform(kind, params)`: the code of the owner's own buttons, given by the
//      service (no model call, US$ 0); a judgment kind runs `ask(params, request, reason)`: a normal
//      question to the owner's model, at that model's cost;
//   3. the result is recorded with the same `request` ("Done: …" / "Failed: …", costUsd, error).
// A refused kind or a failed request never throws: { ok: false, error }, recorded like the rest.

const SENDERS = { oracle: 'the Oracle' };

/** Who sent a request, as a sentence names it ("the Oracle"). */
const senderName = (from) => SENDERS[from] || (from ? `the ${from}` : 'another agent');

/** The request's line in the owner's history. */
function requestText({ from, kind, reason }) {
  return `Request from ${senderName(from)}: ${kind || '(no kind)'}${reason ? ` (${reason})` : ''}`;
}

/**
 * Runs one request. `input`: { kind, params, reason, from, ref }. `owner`: { kinds (the closed list),
 * judgment (the kinds that go to the model), role (of the owner's result messages), record(message)
 * → the stored message (with its ts), perform(kind, params) → { text }, ask(params, request, reason) →
 * { message } (the model's answer, already recorded with `request`) }.
 * @returns { ok, text, costUsd, error?, model?, ownerTs, from, kind, ref } ownerTs: the ts of the owner's result message
 */
async function handle(input, { kinds, judgment = [], role, record, perform, ask }) {
  const from = String(input?.from || '').trim() || 'unknown';
  const kind = String(input?.kind || '').trim();
  const ref = String(input?.ref || '').trim() || `request-${Date.now().toString(36)}`;
  const reason = String(input?.reason || '').trim();
  const params = input?.params && typeof input.params === 'object' && !Array.isArray(input.params) ? input.params : {};
  const request = { from, kind, ref };
  record({ role: 'request', text: requestText({ from, kind, reason }), request, ...(reason ? { reason } : {}), params });
  const failed = (error) => {
    const m = record({ role, text: `Failed: ${error}`, request, costUsd: 0, error });
    return { ...request, ok: false, text: m.text, costUsd: 0, error, ownerTs: m.ts };
  };
  if (!kinds.includes(kind)) return failed(`This agent does not take "${kind || '(no kind)'}" requests; it takes: ${kinds.join(', ')}.`);
  if (judgment.includes(kind)) {
    let m;
    try {
      m = (await ask(params, request, reason)).message || {};
    } catch (e) {
      return failed(e.message || String(e));
    }
    const text = String(m.text || '');
    return { ...request, ok: !m.error, text, costUsd: Number(m.costUsd) || 0, ...(m.error ? { error: text || 'The answer failed.' } : {}), model: m.model || null, ownerTs: m.ts };
  }
  let out;
  try {
    out = await perform(kind, params);
  } catch (e) {
    return failed(e.message || String(e));
  }
  const m = record({ role, text: `Done: ${String(out?.text || kind)}`, request, costUsd: 0 });
  return { ...request, ok: true, text: m.text, costUsd: 0, ownerTs: m.ts };
}

module.exports = {
  handle,
  requestText,
  senderName,
};
