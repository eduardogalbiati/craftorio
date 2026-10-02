// The Oracle (#122): the app-wide master agent, one persistent conversation that plays Product Owner,
// supervisor, reliability engineer and operator's assistant. Built in like the supervisor and the
// Product Owner (src/agents.js, id `oracle`: model and effort from agents/oracle.json); its
// instructions are the bundled `oracle` skill. Claude Code only, resumed turn after turn
// (claude --resume), read-only: no built-in tool, only its MCP tools (src/oracle-tools.js over its
// own src/supervisor-bridge.js). It proposes; it never writes, and never crosses a human gate.
//
// Its files, in <workspace>/oracle/ (written by the service, never by the model):
//   messages.jsonl   the conversation (user, oracle and system messages), kept across resets
//   state.json       the provider session id, model, context size, whether the next turn compacts
//   memory.md        the owner's standing decisions, saved only through oracle:saveMemory
//   session.md       the opening prompt of the current session (skill, memory, handoff note)
//   handoffs/        one note per compaction or reset (<stamp>-<reason>.md)
//   usage.jsonl      one line per real answer: tokens, cost, session (budgets and Usage)
//   owner.json       the app process that answers (run-owner hold: pid, host, heartbeat)
// A question whose answer never came (the app closed mid-turn) shows as `unanswered` and is noted
// at the next question, which still resumes the same session.
// Compaction: when a turn ends past settings.oracle.compactAtTokens, the next question first writes
// a handoff note (the old session writes it; simulated: built from the state), then starts a new
// session from the skill, the memory and that note. A turn is never cut.
// Budget: settings.oracle.dailyBudgetUsd (0 = no cap) refuses questions once today's spend (UTC
// day, like Usage) reaches it, with { refused: { reason: 'daily-budget', spentUsd, limitUsd,
// resumesAt } }; a blocking Claude Code monthly budget refuses with reason 'monthly-budget'.
// One app process answers: a question from another live process is refused with its pid and host.
// `mock` answers from the simulated Oracle (same tools, called in-process; no model, cost 0).

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { hold, ownerAlive } = require('./run-owner');

const DEFAULT_MODEL = 'claude-opus-5-5';
const DEFAULTS = Object.freeze({ dailyBudgetUsd: 20, compactAtTokens: 150000 });
const MCP_NAME = 'orchestrator';
const SKILL_ID = 'oracle';
const TIMEOUT_MS = 20 * 60e3;
const MAX_MEMORY = 20000;
const RECENT_EXCHANGES = 3;

const HANDOFF_PROMPT = [
  'Your context is about to be reset: write your handoff note for the next session now, in English, as Markdown.',
  'Sections: "Runs being watched" (run ids and why), "Pending questions" (what the owner asked that is still open),',
  '"Promised actions" (what you said you would check or propose), "Findings" (facts established, with their evidence).',
  'Only the note: no greeting, no question.',
].join(' ');

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const readLines = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};
const dayOf = (d) => new Date(d).toISOString().slice(0, 10);
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** The Oracle's settings with the defaults filled in (settings.oracle may be partial). */
function oracleSettings(settings = {}) {
  const o = { ...DEFAULTS, ...(settings.oracle || {}) };
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return { dailyBudgetUsd: n(o.dailyBudgetUsd, DEFAULTS.dailyBudgetUsd), compactAtTokens: n(o.compactAtTokens, DEFAULTS.compactAtTokens) || DEFAULTS.compactAtTokens };
}

const usageFile = (dir) => path.join(dir, 'usage.jsonl');

/** Today's (UTC) spend of the Oracle, in USD. */
function spentOn(dir, now = new Date()) {
  const day = dayOf(now);
  return readLines(usageFile(dir)).filter((u) => String(u.ts).slice(0, 10) === day).reduce((s, u) => s + (Number(u.costUsd) || 0), 0);
}

/**
 * The Oracle's spend as summary-like runs, one per day (usage.computeUsage's `extraRuns`): it is in
 * no run folder, and counts in Usage and the monthly budgets like the runs.
 */
function usageRuns(dir) {
  const days = new Map();
  for (const u of readLines(usageFile(dir))) {
    if (!u.ts) continue;
    const day = String(u.ts).slice(0, 10);
    if (!days.has(day)) days.set(day, { run_id: `oracle-${day}`, workflow: 'Oracle', started_at: u.ts, status: 'succeeded', sessions: [] });
    days.get(day).sessions.push({ provider: u.provider || 'claude', model: u.model, tokens: u.tokens || {}, cost_usd: u.costUsd || 0, provider_session_id: u.sessionId || null, turns: 1 });
  }
  return [...days.values()];
}

/** The text sent for one question: the screen first, then the question. */
function questionText(text, screen) {
  const s = String(screen || '').trim();
  return s ? `[Screen] ${s}\n\n${text}` : text;
}

/** Claude Code's flags for the Oracle: isolated, its MCP server only, no built-in tool (no file writes, no commands). */
function readOnlyArgs(server) {
  const { providerArgs } = require('./engine/capabilities');
  return [
    ...providerArgs('claude-code', { caps: null, isolated: true }).args,
    '--mcp-config', JSON.stringify({ mcpServers: { [MCP_NAME]: server } }),
    '--tools', '',
    '--allowedTools', `mcp__${MCP_NAME}`,
  ];
}

/** Why a blocking monthly budget refuses a question ('' = it does not). `budget`: usage.budgetBaseline (+ peers). */
function monthlyBlock(budget) {
  const b = budget?.claude;
  if (b?.blockOnLimit && ((b.limitUsd && b.usedUsd >= b.limitUsd) || (b.limitTokens && b.usedTokens >= b.limitTokens))) {
    return `${b.name || 'Claude Code'} already reached its monthly budget. Raise it in Usage to ask the Oracle.`;
  }
  return '';
}

/**
 * The Oracle of a workspace. Functions are read at call time (the workspace can change):
 * `dir()` its folder; `tools()` its read-only tools; `bridge` its loopback bridge; `mcpCommand()`
 * how to start src/supervisor-mcp.js; `agent()` { model, effort } (agents.readAgent); `settings()`
 * the workspace settings; `budget()` the monthly budget state with every peer's spend.
 */
function createOracle({ dir, tools, bridge, mcpCommand, skillsDirs, resolveCommand, refuseReal, agent, settings, budget = () => null }) {
  let busy = false;
  let owner = null; // our hold on owner.json
  const files = () => {
    const d = dir();
    return {
      log: path.join(d, 'messages.jsonl'), state: path.join(d, 'state.json'), memory: path.join(d, 'memory.md'),
      session: path.join(d, 'session.md'), handoffs: path.join(d, 'handoffs'), owner: path.join(d, 'owner.json'),
    };
  };
  const ensure = () => fs.mkdirSync(dir(), { recursive: true });
  const state = () => readJson(files().state, {});
  const saveState = (s) => { ensure(); fs.writeFileSync(files().state, JSON.stringify(s, null, 2)); };
  const raw = () => readLines(files().log);
  function post(message) {
    const m = { id: crypto.randomUUID(), ts: new Date().toISOString(), ...message };
    ensure();
    fs.appendFileSync(files().log, `${JSON.stringify(m)}\n`);
    return m;
  }

  /** The conversation; a question with no reply after it (and not being answered now) is `unanswered`. */
  function history() {
    const list = raw();
    return list.map((m, i) => {
      if (m.role !== 'user') return m;
      const next = list[i + 1];
      const inFlight = busy && i === list.length - 1;
      const lost = next ? next.role === 'user' || next.kind === 'unanswered' : !inFlight;
      return lost ? { ...m, unanswered: true } : m;
    });
  }

  function memory() {
    let text = '';
    let updatedAt = null;
    try { text = fs.readFileSync(files().memory, 'utf8'); updatedAt = fs.statSync(files().memory).mtime.toISOString(); } catch { /* none yet */ }
    return { text, updatedAt };
  }

  // ---- the owning process (#112): one process answers ----------------------------------------
  function ownerInfo() {
    const o = readJson(files().owner, null);
    if (!o || !ownerAlive(o)) return null;
    return { pid: o.pid, host: o.host, since: o.started_at || null, self: o.pid === process.pid && o.host === os.hostname() };
  }
  function claim() {
    const o = ownerInfo();
    if (o && !o.self) {
      throw new Error(`The Oracle answers in another app process (pid ${o.pid} on ${o.host}${o.since ? `, since ${o.since}` : ''}): ask it there, or close that window.`);
    }
    if (!owner || !o) { ensure(); owner?.release(); owner = hold(files().owner, { role: 'oracle' }); }
  }

  // ---- budget ------------------------------------------------------------------------------
  function budgetState(now = new Date()) {
    const { dailyBudgetUsd } = oracleSettings(settings());
    const spentUsd = spentOn(dir(), now);
    const tomorrow = new Date(`${dayOf(now)}T00:00:00.000Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    return { spentUsd, limitUsd: dailyBudgetUsd, paused: dailyBudgetUsd > 0 && spentUsd >= dailyBudgetUsd, resumesAt: tomorrow.toISOString() };
  }
  function refusal() {
    const day = budgetState();
    if (day.paused) {
      return {
        reason: 'daily-budget', spentUsd: day.spentUsd, limitUsd: day.limitUsd, resumesAt: day.resumesAt,
        text: `Paused by budget: the Oracle spent ${day.spentUsd.toFixed(2)} USD today, its daily limit is ${day.limitUsd.toFixed(2)} USD. It resumes tomorrow (${day.resumesAt}), or raise the limit in Settings.`,
      };
    }
    const month = monthlyBlock(budget());
    return month ? { reason: 'monthly-budget', text: month } : null;
  }

  function recordUsage({ model, tokens, costUsd, sessionId }) {
    ensure();
    fs.appendFileSync(usageFile(dir()), `${JSON.stringify({ ts: new Date().toISOString(), provider: 'claude', model, tokens: tokens || {}, costUsd: costUsd || 0, sessionId: sessionId || null })}\n`);
  }

  // ---- the model, real or simulated ----------------------------------------------------------
  async function realTurn({ prompt, sessionId, model, effort }) {
    refuseReal('the Oracle\'s CLI (claude)');
    const { runTurn } = require('./engine/providers');
    const { render } = require('./engine/workflow');
    const { dedupeFlags } = require('./engine/capabilities');
    const { PROVIDERS } = require('./workflow-builder');
    const provider = Object.values(PROVIDERS).find((p) => p.type === 'claude-code');
    if (!resolveCommand(provider.command)) throw new Error(`The Oracle needs ${provider.command}, which is not installed.`);
    const { url, token } = await bridge.start();
    const mcp = mcpCommand();
    const server = { command: mcp.command, args: mcp.args, env: { ...mcp.env, SUPERVISOR_BRIDGE_URL: url, SUPERVISOR_BRIDGE_TOKEN: token } };
    ensure();
    let contextTokens = null;
    const res = await runTurn({
      provider, model, effort: effort && effort !== 'default' ? effort : undefined, providerSessionId: sessionId, prompt, cwd: dir(),
      extraArgs: dedupeFlags(readOnlyArgs(server), provider.args || []), timeoutMs: TIMEOUT_MS, render,
      hint: { stepId: 'oracle', visit: 1, agent: 'oracle' },
      onItem: (it) => { if (it?.kind === 'context' && Number(it.tokens)) contextTokens = Number(it.tokens); },
    });
    const u = res.usage || {};
    const sid = res.providerSessionId || sessionId;
    recordUsage({ model, tokens: u, costUsd: res.costUsd, sessionId: sid });
    return { text: String(res.text || '').trim(), costUsd: res.costUsd ?? null, tokens: u, sessionId: sid, contextTokens: contextTokens ?? ((u.input || 0) + (u.cache_read || 0) + (u.cache_write || 0)) };
  }

  // The simulated Oracle: what its tools see, the session it is in. `mockContextTokens` lets tests
  // report a large context (compaction without a model).
  async function mockTurn({ prompt, sessionId, screen, mockContextTokens, fresh }) {
    const { callTool } = require('./supervisor-tools');
    const count = async (name, pick = (x) => x) => {
      const out = await callTool(tools(), name, {});
      try { return out.isError ? '?' : pick(JSON.parse(out.text)).length; } catch { return '?'; }
    };
    let updates = '?';
    try {
      const s = JSON.parse((await callTool(tools(), 'seed_status', {})).text);
      updates = [...Object.values(s.workflows || {}), ...Object.values(s.skills || {})].filter((x) => x.updateAvailable).length;
    } catch { /* counted as unknown */ }
    const mem = memory().text.split('\n').filter((l) => l.trim()).length;
    const text = [
      'Simulated Oracle: no model was called.',
      screen ? `You are on: ${screen}.` : 'I was not told which screen you are on.',
      `Through my tools I see ${await count('list_runs', (r) => r.runs)} runs (${await count('active_runs')} in progress), ${await count('list_workflows')} workflows, ${await count('list_projects')} projects, ${await count('unpushed')} projects with local merges not pushed, and ${updates} workflows or skills with a newer default.`,
      fresh ? `This question started a new session from my skill, the memory (${mem} lines) and the last handoff note.` : 'This question continued the same session.',
      'Outside developer mode, the real Oracle reads them and answers (one model call per message).',
    ].join('\n\n');
    const prev = fresh ? 0 : Number(state().contextTokens) || 0;
    return {
      text, costUsd: 0, tokens: {}, sessionId: sessionId || `mock-${crypto.randomUUID()}`, simulated: true,
      contextTokens: Number(mockContextTokens) > 0 ? Number(mockContextTokens) : prev + Math.ceil((prompt.length + text.length) / 4),
    };
  }

  // ---- handoff notes -----------------------------------------------------------------------
  async function builtHandoff(reason) {
    const { callTool } = require('./supervisor-tools');
    let runs = [];
    try { runs = JSON.parse((await callTool(tools(), 'active_runs', {})).text); } catch { runs = []; }
    const msgs = history();
    const pending = msgs.filter((m) => m.unanswered);
    const recent = msgs.filter((m) => m.role === 'user' || m.role === 'oracle').slice(-RECENT_EXCHANGES * 2);
    return [
      `## Runs being watched\n${runs.length ? runs.map((r) => `- ${r.runId || r.run_id || r.id}: ${r.workflow || ''} ${r.status || ''}`.trim()).join('\n') : '- none in progress'}`,
      `## Pending questions\n${pending.length ? pending.map((m) => `- ${cut(m.text, 300)}`).join('\n') : '- none'}`,
      '## Promised actions\n- see the last exchanges',
      `## Last exchanges\n${recent.map((m) => `- ${m.role}: ${cut(String(m.text || ''), 500)}`).join('\n') || '- none'}`,
      `(Written by the app at a ${reason}, without a model call.)`,
    ].join('\n\n');
  }

  // Writes a handoff note from the current session: the session writes it (one model call), or
  // the app builds it from the state (simulated, no session, or the call failed).
  async function writeHandoff(reason, { mock, model, effort }) {
    const st = state();
    let body = '';
    let note = '';
    if (!mock && st.sessionId) {
      try { body = (await realTurn({ prompt: HANDOFF_PROMPT, sessionId: st.sessionId, model, effort })).text; } catch (e) { note = `(The session could not write it: ${e.message || e}.)`; }
    }
    if (!body) body = [await builtHandoff(reason), note].filter(Boolean).join('\n\n');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(files().handoffs, `${stamp}-${reason}.md`);
    fs.mkdirSync(files().handoffs, { recursive: true });
    fs.writeFileSync(file, `# Oracle handoff note (${reason}, ${new Date().toISOString()})\n\n${body.trim()}\n`);
    return { file, text: body.trim() };
  }

  function latestHandoff() {
    try {
      const last = fs.readdirSync(files().handoffs).filter((f) => f.endsWith('.md')).sort().at(-1);
      return last ? fs.readFileSync(path.join(files().handoffs, last), 'utf8') : '';
    } catch { return ''; }
  }

  // The first prompt of a session: the skill, the memory, the last handoff note, then the question.
  function openingPrompt(question) {
    const { resolveSkill } = require('./skills');
    let skill = '';
    try { skill = resolveSkill(skillsDirs(), SKILL_ID).body || ''; } catch { /* the rules below suffice */ }
    const mem = memory().text.trim();
    const handoff = latestHandoff().trim();
    const prompt = [
      skill || 'You are the Oracle of the Multiagent Orchestrator: read-only, grounded in your tools, answer in the owner\'s language and write everything for the product in English.',
      `## Memory (the owner's standing decisions; only the owner changes it)\n${mem || '(empty)'}`,
      handoff && `## Handoff note from your previous session\n${handoff}`,
      `## The owner's message\n${question}`,
    ].filter(Boolean).join('\n\n');
    ensure();
    fs.writeFileSync(files().session, prompt);
    return prompt;
  }

  function status() {
    const st = state();
    const a = agent();
    const day = budgetState();
    const s = oracleSettings(settings());
    return {
      busy, model: a.model || DEFAULT_MODEL, effort: a.effort || 'high', sessionId: st.sessionId || null,
      contextTokens: st.contextTokens || 0, compactAtTokens: s.compactAtTokens, compactNext: !!st.compactNext,
      paused: day.paused, today: { spentUsd: day.spentUsd, limitUsd: day.limitUsd, resumesAt: day.resumesAt },
      owner: ownerInfo(), memoryChars: memory().text.length,
    };
  }

  return {
    history,
    memory,
    state: status,

    /**
     * { question, screen, mock, mockContextTokens } → { message, messages, state }, or
     * { refused: { reason, text, ... }, message: null, messages, state } when a budget refuses it.
     */
    async ask({ question, screen, mock, mockContextTokens } = {}) {
      const q = String(question || '').trim();
      if (!q) throw new Error('Type a message for the Oracle.');
      claim();
      if (busy) throw new Error('The Oracle is still answering the previous message.');
      const refused = refusal();
      if (refused) return { refused, message: null, messages: history(), state: status() };
      busy = true;
      try {
        if (raw().at(-1)?.role === 'user') post({ role: 'system', kind: 'unanswered', text: 'The previous question got no answer (the app closed during the turn). This question continues the same conversation.' });
        const where = String(screen || '').trim() || null;
        post({ role: 'user', text: q, screen: where });
        const a = agent();
        const model = String(a.model || DEFAULT_MODEL);
        let message;
        try {
          let st = state();
          if (st.sessionId && (st.compactNext || (!mock && st.model !== model))) {
            const why = st.compactNext ? 'compaction' : 'model-change';
            const h = await writeHandoff(why, { mock, model: st.model || model, effort: a.effort });
            post({
              role: 'system', kind: why, handoff: path.basename(h.file),
              text: st.compactNext
                ? `The context reached ${st.contextTokens} tokens: a new session starts from the skill, the memory and the handoff note ${path.basename(h.file)}.`
                : `The model changed to ${model}: a new session starts from the skill, the memory and the handoff note ${path.basename(h.file)}.`,
            });
            st = { ...st, sessionId: null, compactNext: false, contextTokens: 0 };
            saveState(st);
          }
          const fresh = !st.sessionId;
          const prompt = fresh ? openingPrompt(questionText(q, where)) : questionText(q, where);
          const res = mock
            ? await mockTurn({ prompt, sessionId: st.sessionId, screen: where, mockContextTokens, fresh })
            : await realTurn({ prompt, sessionId: st.sessionId, model, effort: a.effort });
          const { compactAtTokens } = oracleSettings(settings());
          saveState({
            sessionId: res.sessionId || st.sessionId || null, model: mock ? st.model || model : model,
            contextTokens: res.contextTokens || 0, compactNext: (res.contextTokens || 0) >= compactAtTokens,
            sessionStartedAt: fresh ? new Date().toISOString() : st.sessionStartedAt || null,
          });
          message = post({
            role: 'oracle', text: res.text || '(no answer)', model: mock ? null : model, costUsd: res.costUsd ?? null,
            tokens: res.tokens || {}, contextTokens: res.contextTokens || 0, ...(res.simulated ? { simulated: true } : {}),
          });
        } catch (e) {
          message = post({ role: 'system', text: `The Oracle could not answer: ${e.message || e}`, error: true });
        }
        return { message, messages: history(), state: status() };
      } finally {
        busy = false;
      }
    },

    /**
     * A new session: writes a handoff note from the current one, forgets the provider session; the
     * messages and the memory are kept. → { handoff, messages, state }
     */
    async reset({ mock } = {}) {
      claim();
      if (busy) throw new Error('The Oracle is answering: reset after its answer.');
      busy = true;
      try {
        const a = agent();
        const st = state();
        const h = await writeHandoff('reset', { mock, model: st.model || a.model || DEFAULT_MODEL, effort: a.effort });
        saveState({ ...st, sessionId: null, compactNext: false, contextTokens: 0 });
        post({ role: 'system', kind: 'reset', handoff: path.basename(h.file), text: `New session: the next question starts from the skill, the memory and the handoff note ${path.basename(h.file)}.` });
        return { handoff: path.basename(h.file), messages: history(), state: status() };
      } finally {
        busy = false;
      }
    },

    /** Saves the memory (the owner's save only: the Oracle can only propose an entry). */
    saveMemory(text) {
      const t = String(text ?? '').replace(/\r\n/g, '\n');
      if (t.length > MAX_MEMORY) throw new Error(`The memory is too long (max ${MAX_MEMORY} characters).`);
      ensure();
      fs.writeFileSync(files().memory, t);
      return memory();
    },

    /** Lets another process answer (the service shuts down). */
    release() { owner?.release(); owner = null; },
  };
}

module.exports = {
  createOracle,
  DEFAULT_MODEL,
  DEFAULTS,
  HANDOFF_PROMPT,
  monthlyBlock,
  oracleSettings,
  questionText,
  readOnlyArgs,
  spentOn,
  usageRuns,
};
