// Live progress of the agent chats (#180): the Product Owner (src/product-owner.js), the Oracle
// (src/oracle.js) and the Supervisor chat (src/supervisor-chat.js). A turn's items (runTurn's
// onItem: thinking, text, tool_call, tool_result) go to the UI as they arrive, on one pushed event,
// 'chat:progress' { chat, key, turnId, phase: 'start' | 'items' | 'end', items, status }, batched at
// most every THROTTLE_MS and cut to what the UI shows (no tool output, no thinking text). Nothing
// is stored: the conversation files keep what they kept. A turn can be stopped (chat:cancel): its
// AbortSignal kills the CLI and the chat records the answer written so far, marked as stopped.
// mockSteps: the simulated chats stream a few fake steps and their text, so the UI can be checked
// without a model call (delays scaled by MULTIAGENT_MOCK_DELAY_SCALE, like the mock provider).

const crypto = require('crypto');

const THROTTLE_MS = 100;
const SHOWN = ['text', 'thinking', 'tool_call', 'tool_result'];
const MAX_VALUE = 200;
const MAX_KEYS = 8;

// A tool call's input as the activity line needs it: short scalar values only.
function slimInput(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (Object.keys(out).length >= MAX_KEYS) break;
    if (typeof v === 'string') out[k] = v.length > MAX_VALUE ? `${v.slice(0, MAX_VALUE)}…` : v;
    else if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
  }
  return out;
}

/** A runTurn item as the UI receives it, or null when the UI does not show its kind. */
function progressItem(item) {
  if (!item || !SHOWN.includes(item.kind)) return null;
  if (item.kind === 'text') return { kind: 'text', text: String(item.text || '') };
  if (item.kind === 'thinking') return { kind: 'thinking' };
  if (item.kind === 'tool_call') return { kind: 'tool_call', id: item.id || null, name: String(item.name || ''), input: slimInput(item.input) };
  return { kind: 'tool_result', id: item.id || null, is_error: !!item.is_error };
}

/** The prose written so far (text blocks), without the trailing ```json block. */
function partialText(texts = []) {
  return texts.join('\n\n').replace(/```json[\s\S]*$/, '').trim();
}

/**
 * The turns in flight, one per chat and key (the Product Owner's project id; '' for the Oracle and
 * the Supervisor chat). `emit(payload)` pushes 'chat:progress'. start() → { turnId, signal,
 * onItem, partial(), stopped(), end(status) }; cancel(chat, key) aborts the turn in flight.
 */
function createChatTurns({ emit, throttleMs = THROTTLE_MS, now = Date.now }) {
  const live = new Map();
  const id = (chat, key) => `${chat}:${key || ''}`;

  function start(chat, key = '') {
    const k = id(chat, key);
    const controller = new AbortController();
    // a second question while one is in flight (the Oracle and the Supervisor refuse it) is not
    // shown: the live view and Stop stay on the first
    if (live.has(k)) {
      return { turnId: null, signal: controller.signal, abort: () => controller.abort(), onItem() {}, partial: () => '', stopped: () => controller.signal.aborted, end() {} };
    }
    const turn = { turnId: crypto.randomUUID(), abort: () => controller.abort(), queue: [], timer: null, last: 0, texts: [], ended: false };
    live.set(k, turn);
    const send = (phase, extra = {}) => {
      try { emit({ chat, key: key || '', turnId: turn.turnId, phase, items: [], ...extra }); } catch { /* the UI is optional */ }
    };
    const flush = () => {
      clearTimeout(turn.timer);
      turn.timer = null;
      if (!turn.queue.length) return;
      const items = turn.queue;
      turn.queue = [];
      turn.last = now();
      send('items', { items });
    };
    send('start');
    return {
      turnId: turn.turnId,
      signal: controller.signal,
      abort: () => controller.abort(),
      onItem(item) {
        if (turn.ended) return;
        const it = progressItem(item);
        if (!it) return;
        if (it.kind === 'text') turn.texts.push(it.text);
        turn.queue.push(it);
        const wait = turn.last + throttleMs - now();
        if (wait <= 0) flush();
        else if (!turn.timer) turn.timer = setTimeout(flush, wait);
      },
      partial: () => partialText(turn.texts),
      stopped: () => controller.signal.aborted,
      end(status = 'done') {
        if (turn.ended) return;
        flush();
        turn.ended = true;
        if (live.get(k) === turn) live.delete(k);
        send('end', { status });
      },
    };
  }

  return {
    start,
    /** Stops the chat's turn in flight → whether there was one. */
    cancel(chat, key = '') {
      const turn = live.get(id(chat, key));
      if (!turn) return false;
      turn.abort();
      return true;
    },
    /** The turn id in flight for a chat, or null. */
    active: (chat, key = '') => live.get(id(chat, key))?.turnId || null,
  };
}

/**
 * The simulated turn's stream: thinking, each step as a tool call and its result, then `text` block
 * by block (and a ```json block when `json` is set, which the UI hides). Rejects 'Cancelled' when
 * `signal` aborts.
 */
async function mockSteps(onItem, { steps = [], text = '', json = null, signal, delayMs = 250 } = {}) {
  const scale = +(process.env.MULTIAGENT_MOCK_DELAY_SCALE ?? 1);
  const wait = (ms) => new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Cancelled')); return; }
    const t = setTimeout(resolve, Math.max(0, ms * scale));
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('Cancelled')); }, { once: true });
  });
  onItem({ kind: 'thinking', text: 'Simulated' });
  await wait(delayMs);
  for (const [i, s] of steps.entries()) {
    onItem({ kind: 'tool_call', id: `mock-${i}`, name: s.name, input: s.input || {} });
    await wait(delayMs);
    onItem({ kind: 'tool_result', id: `mock-${i}`, output: '', is_error: false });
  }
  for (const part of String(text || '').split(/\n{2,}/).filter((p) => p.trim())) {
    onItem({ kind: 'text', text: part });
    await wait(delayMs / 2);
  }
  if (json) onItem({ kind: 'text', text: `\`\`\`json\n${JSON.stringify(json, null, 2)}\n\`\`\`` });
}

module.exports = {
  createChatTurns,
  mockSteps,
  partialText,
  progressItem,
  THROTTLE_MS,
};
