// Agent inboxes (#240): another agent (the Oracle) asks the owner of an area for a change, and the
// owner executes it and keeps it in its own conversation. Each owner has a closed list of request
// kinds (src/domains/po/product-owner.js REQUEST_KINDS: the Backlog; src/domains/supervisor/supervisor-chat.js REQUEST_KINDS:
// workflows, skills and runs) and a handleRequest built on handle() below:
//   1. the request is recorded in the owner's history ({ role: 'request', request: { from, kind, ref } },
//      "Request from the Oracle: <kind> (<reason>)"), ref being the sender's message id;
//   2. a mechanical kind runs `perform(kind, params)`: the code of the owner's own buttons, given by the
//      service (no model call, US$ 0); a judgment kind runs `ask(params, request, reason)`: a normal
//      question to the owner's model, at that model's cost;
//   3. the result is recorded with the same `request` ("Done: …" / "Failed: …", costUsd, error).
// A refused kind or a failed request never throws: { ok: false, error }, recorded like the rest.
// #241 (the Oracle routes every change through request_agent):
// - a kind that answers a human gate is refused, whoever asks: a gate waits for the owner;
// - `wait(kind, params)` → a reason or null: a request that needs the owner's click (it starts a paid
//   run, or the Night watch does not allow it) is a pending card in the owner's chat ({ pending: true,
//   status: 'proposed', waits }), checked first (`check`), run only by act() (Do it) or dismissed;
//   waitReason() is the rule the service uses;
// - `after(result)` sees every mechanical result and every card left waiting (`pending`), with the
//   request's params and `auto` (false after the owner's click): the service logs them in the night log;
// - a result whose action took a backup keeps its `undo`; act() 'undo' puts it back (`restore`).

const { permissionOf } = require('../night/night-watch');

const SENDERS = { findings: 'the Findings button', oracle: 'the Oracle' };
const ACT_ACTIONS = ['dismiss', 'do', 'undo'];
// the refs of the cards being performed after a click
const acting = new Set();

/** Who sent a request, as a sentence names it ("the Oracle"). */
const senderName = (from) => SENDERS[from] || (from ? `the ${from}` : 'another agent');

/** Whether a request kind would answer a human gate (approval.resolve, gate.*): never taken. */
const answersGate = (kind) => /^(approval|gate)(\.|$)/i.test(String(kind || ''));

/** The request's line in the owner's history. */
function requestText({ from, kind, reason }) {
  return `Request from ${senderName(from)}: ${kind || '(no kind)'}${reason ? ` (${reason})` : ''}`;
}

/**
 * Why a request waits for the owner's click, or null when the owner runs it at once. `clickKinds`:
 * the owner's kinds that start a paid run; `confirmKinds`: the kinds that publish or are hard to
 * reverse, which wait by day (the Night watch off); under an active Night watch (`watch.active`) a
 * kind runs alone only when the owner allowed its permission (src/domains/night/night-watch.js permissionOf, `allowed`).
 * The watch is also active, by day, under Self-healing (#278: `watch.selfHealing`): a kind no
 * permission covers then keeps the daytime rule (the owner is there), and a covered kind runs alone
 * only when its permission is checked.
 */
function waitReason(kind, params, { clickKinds = [], confirmKinds = [], watch = null, allowed = [] } = {}) {
  if (clickKinds.includes(kind)) return 'It starts a run, which can cost money: it waits for the owner\'s click.';
  const byDay = confirmKinds.includes(kind) ? 'It publishes or is hard to reverse: it waits for the owner\'s click.' : null;
  if (!watch?.active) return byDay;
  const permission = permissionOf(kind, params);
  if (watch.selfHealing) {
    if (!permission) return byDay;
    return allowed.includes(permission) ? null : `Self-healing does not allow it (permission "${permission}"): it waits for the owner's click.`;
  }
  if (!permission) return 'The Night watch never runs it alone: it waits for the owner\'s click.';
  if (!allowed.includes(permission)) return `The Night watch does not allow it (permission "${permission}"): it waits for the owner's click.`;
  return null;
}

// Runs a mechanical kind and records its result → the inbox's answer.
async function execute({ kind, params, request, role, record, perform, after, auto }) {
  const failed = (error) => {
    const m = record({ role, text: `Failed: ${error}`, request, costUsd: 0, error });
    return { ...request, ok: false, text: m.text, costUsd: 0, error, ownerTs: m.ts };
  };
  let out;
  try {
    out = await perform(kind, params);
  } catch (e) {
    const res = failed(e.message || String(e));
    after?.({ ...res, params, auto });
    return res;
  }
  const undo = out?.backup?.undo || null;
  const m = record({ role, text: `Done: ${String(out?.text || kind)}`, request, costUsd: 0, ...(undo ? { undo } : {}) });
  const res = { ...request, ok: true, text: m.text, costUsd: 0, ownerTs: m.ts };
  after?.({ ...res, params, auto });
  return res;
}

/**
 * Runs one request. `input`: { kind, params, reason, from, ref }. `owner`: { kinds (the closed list),
 * judgment (the kinds that go to the model), role (of the owner's result messages), record(message)
 * → the stored message (with its ts), perform(kind, params) → { text, backup? }, ask(params, request,
 * reason) → { message } (the model's answer, already recorded with `request`), wait(kind, params) →
 * a reason to wait for the owner's click or null, check(kind, params) (throws when it cannot run:
 * checked before a card waits), after(result) }.
 * @returns { ok, text, costUsd, error?, model?, pending?, ownerTs, from, kind, ref } ownerTs: the ts of the owner's result message (of the card when pending)
 */
async function handle(input, { kinds, judgment = [], role, record, perform, ask, wait = () => null, check = () => {}, after = null }) {
  const from = String(input?.from || '').trim() || 'unknown';
  const kind = String(input?.kind || '').trim();
  const ref = String(input?.ref || '').trim() || `request-${Date.now().toString(36)}`;
  const reason = String(input?.reason || '').trim();
  const params = input?.params && typeof input.params === 'object' && !Array.isArray(input.params) ? input.params : {};
  const request = { from, kind, ref };
  let refusal = null;
  if (answersGate(kind)) refusal = `"${kind}" answers a human gate: no agent answers one, the gate waits for the owner.`;
  else if (!kinds.includes(kind)) refusal = `This agent does not take "${kind || '(no kind)'}" requests; it takes: ${kinds.join(', ')}.`;
  let waits = null;
  if (!refusal && !judgment.includes(kind)) {
    try {
      waits = wait(kind, params) || null;
      if (waits) check(kind, params);
    } catch (e) {
      refusal = e.message || String(e);
      waits = null;
    }
  }
  const card = record({ role: 'request', text: requestText({ from, kind, reason }), request, ...(reason ? { reason } : {}), params, ...(waits ? { pending: true, status: 'proposed', waits } : {}) });
  const failed = (error) => {
    const m = record({ role, text: `Failed: ${error}`, request, costUsd: 0, error });
    return { ...request, ok: false, text: m.text, costUsd: 0, error, ownerTs: m.ts };
  };
  if (refusal) return failed(refusal);
  if (waits) {
    const res = { ...request, ok: true, pending: true, text: `Waiting for the owner's click: ${waits}`, costUsd: 0, ownerTs: card.ts };
    after?.({ ...res, params, auto: false });
    return res;
  }
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
  return execute({ kind, params, request, role, record, perform, after, auto: true });
}

/**
 * The owner's click on a request card (#241): { ref, action: 'do' | 'dismiss' | 'undo' }. 'do' runs a
 * pending request (perform), 'dismiss' drops it, 'undo' puts back the backup its result took
 * (restore(undo) → { text }). `owner`: { history() (the conversation), role, record, perform, restore, after }.
 * Throws when the card is not there or not in that state.
 * @returns { ok, text, costUsd, error?, ownerTs, from, kind, ref }
 */
async function act({ ref, action } = {}, { history, role, record, perform, restore, after = null }) {
  if (!ACT_ACTIONS.includes(action)) throw new Error(`The action is one of ${ACT_ACTIONS.join(', ')}.`);
  const all = history();
  const card = all.find((m) => m.role === 'request' && m.request?.ref === String(ref || ''));
  if (!card) throw new Error('This request is not in the conversation.');
  const { request, params = {} } = card;
  const last = all.filter((m) => m !== card && m.request?.ref === request.ref && m.role !== 'request' && m.role !== 'user').at(-1) || null;
  if (action === 'undo') {
    if (!last?.undo || last.undone) throw new Error('This request has nothing to undo.');
    const out = await restore(last.undo);
    const m = record({ role, text: `Undone: ${String(out?.text || 'the backup was put back.')}`, request, costUsd: 0, undone: true });
    return { ...request, ok: true, text: m.text, costUsd: 0, ownerTs: m.ts };
  }
  if (!card.pending || last || acting.has(request.ref)) throw new Error('This request does not wait for a click any more.');
  if (action === 'dismiss') {
    const m = record({ role, text: 'Dismissed by the owner: nothing was done.', request, costUsd: 0, dismissed: true });
    return { ...request, ok: true, text: m.text, costUsd: 0, ownerTs: m.ts };
  }
  // reserved before anything is awaited: a second click on the same card is refused
  acting.add(request.ref);
  try {
    return await execute({ kind: request.kind, params, request, role, record, perform, after, auto: false });
  } finally {
    acting.delete(request.ref);
  }
}

module.exports = {
  act,
  answersGate,
  handle,
  requestText,
  senderName,
  waitReason,
};
