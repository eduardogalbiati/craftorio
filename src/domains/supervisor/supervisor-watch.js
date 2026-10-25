// Supervisor watch mode: an opt-in companion that follows a running run and explains it in a chat.
//
// The person turns it on for one run (supervisor:watchRun). From then on the meaningful events of that
// run (the supervisor's timeline lines: steps started/finished, transitions, gates, warnings and
// errors, retries, limits, the end) are batched, and each batch is one turn of the supervisor in a
// single CLI conversation (resumed with the provider's resume_args), which posts a short update:
// what happened, whether it looks right, what comes next. The person can ask questions in the same
// conversation (supervisor:watchAsk). The supervisor is read-only, works in the run folder, never
// answers a human gate and never prescribes code fixes (skill: run-supervisor). An update whose
// first line is "FLAG: ..." raises a desktop notification. The watch stops when the run ends or
// when it is turned off; its cost is the sum of its turns. Simulated runs use the mock provider.
// Messages are pushed on `supervisor:watch` and appended to supervisor/watch.jsonl in the run folder.

const fs = require('fs');
const path = require('path');
const supervisor = require('./supervisor');
const registry = require('../../shared/providers');
const Language = require('../../shared/language');

// the provider type of the default model's CLI (Claude Code)
const DEFAULTS = { provider: registry.resolve('claude-opus-5-5').type, model: 'claude-opus-5-5', effort: '' };
const BATCH_MS = 20e3;
// events that do not wait for the batch window
const URGENT = new Set(['approval.requested', 'budget.exceeded', 'limit.exceeded', 'workflow.finished']);
const FLAG = /^\s*\**FLAG:?\**:?\s*(.+)$/i;

function watchLine(ev) {
  if (ev.type === 'limit.exceeded') return `${String(ev.ts || '').slice(11, 19)} limit ${ev.limit} reached (${ev.current ?? '?'} of ${ev.value})${ev.paused ? ', paused for a person' : ''}`;
  return supervisor.timelineLine(ev);
}
const isUrgent = (ev) => URGENT.has(ev.type) || (ev.type === 'log' && ev.level === 'error');

const RULES = [
  'You are watching this workflow run live for a person, in a chat (watch mode). You get the run\'s meaningful events in batches and the person\'s questions, in this one conversation.',
  'On each batch, post a short update in plain language (2 to 5 sentences, no headings): what happened, whether it looks right, and what comes next.',
  'Flag problems early (for example: the issue already has an open PR, the worktree started from an old base, a loop repeating the same failure, the cost growing fast) and recommend an action. When you flag something, make the first line of your reply "FLAG: <one-line summary>".',
  'Never approve, reject or answer a human gate: say that a gate waits for the person and what they should weigh. Never prescribe a code fix: say which step or agent of the workflow should handle it, with the evidence and your hypotheses.',
  'You are read-only. Your working directory is the run folder: read events.jsonl, sessions/ and handoffs/ when you need details.',
  'Answer briefly, in plain language, in the language the Language line names for chat replies (English when there is none).',
].join('\n');

/**
 * The watches of a service. `events` is the service's EventEmitter (run:event in, supervisor:watch
 * out); `liveRun(runId)` the run in progress; `runFolder(runId)`, `workflowDirs()`, `skillsDirs()`
 * and `language()` (Settings' language, #327: the [Language] line of each turn) are read at call
 * time; `notify(notice)` raises a desktop notification.
 */
function createWatches({ events, liveRun, runFolder, workflowDirs, skillsDirs, resolveCommand, notify = () => {}, batchMs = BATCH_MS, language = () => null }) {
  const watches = new Map();

  events.on('run:event', (ev) => {
    const w = watches.get(ev.run_id);
    if (!w?.on) return;
    if (ev.type === 'workflow.finished') w.finished = true;
    const line = watchLine(ev);
    if (!line) return;
    w.pending.push(line);
    if (isUrgent(ev)) { clearTimeout(w.timer); w.timer = null; w.due = true; pump(w); }
    else if (!w.timer) {
      w.timer = setTimeout(() => { w.timer = null; w.due = true; pump(w); }, batchMs);
      w.timer.unref?.();
    }
  });

  const publicState = (w) => ({
    runId: w.runId, on: w.on, busy: w.busy, provider: w.provider, model: w.model, effort: w.effort, costUsd: w.costUsd,
    messages: w.messages,
  });

  function post(w, message) {
    const m = { ts: new Date().toISOString(), ...message };
    w.messages.push(m);
    try {
      fs.mkdirSync(path.join(w.runDir, 'supervisor'), { recursive: true });
      fs.appendFileSync(path.join(w.runDir, 'supervisor', 'watch.jsonl'), `${JSON.stringify(m)}\n`);
    } catch { /* the transcript is a convenience */ }
    publish(w, m);
  }
  const publish = (w, message = null) => events.emit('supervisor:watch', { runId: w.runId, message, watch: { ...publicState(w), messages: undefined } });

  function prompt(w, body) {
    // every turn starts with the [Language] line, so a change applies from the next one (#327);
    // a new conversation (first turn, or a provider that cannot resume) gets the rules and the report
    const line = Language.languageLine({ language: language() });
    if (w.sessionId) return `${line}\n\n${body}`;
    const { resolveSkill, skillPrompt } = require('../agents/skills');
    const skill = resolveSkill(skillsDirs(), 'run-supervisor');
    return [skillPrompt(skill), line, RULES, supervisor.runReport(w.runDir, { workflowsDir: workflowDirs() }), body].join('\n\n');
  }
  const newEvents = (w) => (w.pending.length ? `New events in the run:\n${w.pending.join('\n')}` : '');

  async function turn(w, text) {
    const { runTurn } = require('../../engine/providers');
    const { render } = require('../../engine/workflow');
    w.abort = new AbortController();
    const res = await runTurn({
      provider: w.providerCfg, model: w.mock ? 'simulated' : w.model, effort: w.effort || undefined, providerSessionId: w.sessionId,
      prompt: text, cwd: w.runDir, extraArgs: w.extraArgs, timeoutMs: 10 * 60e3, signal: w.abort.signal, render,
      hint: { stepId: 'supervisor-watch', visit: 1, agent: 'supervisor' }, onItem: () => {},
    });
    if (w.providerCfg.type === 'mock' || w.providerCfg.resume_args) w.sessionId = res.providerSessionId || w.sessionId;
    return res;
  }

  // One turn at a time: the person's questions first, then the batch that is due.
  async function pump(w) {
    if (w.busy || !w.on) return;
    let body;
    if (w.questions.length) {
      const q = w.questions.shift();
      body = [newEvents(w), `The person asks: ${q}\nAnswer from the run's events, sessions and step outputs (read what you need), briefly.`].filter(Boolean).join('\n\n');
    } else if (w.due && (w.pending.length || w.greet)) {
      body = w.greet && !w.pending.length
        ? 'The person just started watching. Say in a few sentences where the run is now, whether it looks right, and what comes next.'
        : `${newEvents(w)}\n\nPost your update.`;
    } else {
      if (w.finished) stop(w, 'The run ended: the watch stopped.');
      return;
    }
    w.pending = [];
    w.due = false;
    w.greet = false;
    clearTimeout(w.timer);
    w.timer = null;
    w.busy = true;
    publish(w);
    try {
      const res = await turn(w, prompt(w, body));
      w.costUsd += res.costUsd || 0;
      const text = String(res.text || '').trim();
      const flag = text.split('\n')[0].match(FLAG)?.[1]?.trim() || null;
      if (w.on || w.finished) {
        post(w, { role: 'supervisor', text: text || '(no answer)', costUsd: res.costUsd ?? null, flag });
        if (flag) notify({ kind: 'run', event: 'flagged', title: `Supervisor: ${w.workflow}`, body: flag, target: { runId: w.runId, workflow: w.workflow } });
      }
    } catch (e) {
      if (w.on) post(w, { role: 'system', text: `The supervisor could not answer: ${e.message || e}`, error: true });
    } finally {
      w.busy = false;
      w.abort = null;
    }
    pump(w);
  }

  function stop(w, reason) {
    if (!w.on) return;
    w.on = false;
    clearTimeout(w.timer);
    w.timer = null;
    w.abort?.abort();
    post(w, { role: 'system', text: reason });
  }

  // The transcript of a watch this service does not hold (an earlier session of the app).
  function fromFile(runId) {
    let messages = [];
    try {
      messages = fs.readFileSync(path.join(runFolder(runId), 'supervisor', 'watch.jsonl'), 'utf8').split('\n')
        .map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
    } catch { /* never watched */ }
    return { runId, on: false, busy: false, ...DEFAULTS, costUsd: messages.reduce((s, m) => s + (m.costUsd || 0), 0), messages };
  }

  return {
    state: (runId) => { const w = watches.get(String(runId)); return w ? publicState(w) : fromFile(String(runId)); },

    start(runId, options = {}) {
      runId = String(runId);
      const run = liveRun(runId);
      if (!run) throw new Error('The run is not in progress: the supervisor can only watch a running run.');
      let w = watches.get(runId);
      if (w?.on) return publicState(w);
      const { PROVIDERS } = require('../workflow/workflow-builder');
      const type = options.provider || DEFAULTS.provider;
      const cli = Object.values(PROVIDERS).find((p) => p.type === type);
      if (!cli) throw new Error(`Unknown provider: ${type}`);
      const providerCfg = run.mock ? { type: 'mock' } : cli;
      if (!run.mock && !resolveCommand(cli.command)) throw new Error(`The supervisor needs ${cli.command}, which is not installed.`);
      const runDir = run.runDir;
      const { providerArgs, normalize, dedupeFlags } = require('../../engine/capabilities');
      const { render } = require('../../engine/workflow');
      const { resolveSkill } = require('../agents/skills');
      const skill = resolveSkill(skillsDirs(), 'run-supervisor');
      // read-only, like the supervisor inside a run (engine/capabilities.js)
      const readOnly = run.mock ? [] : providerArgs(cli.type, { caps: normalize({ tools: ['read'] }) }).args;
      const extraArgs = run.mock ? [] : dedupeFlags([...readOnly, ...(cli.skill_args || []).map((x) => render(x, { skill_dir: skill.path }))], cli.args || []);
      const model = String(options.model || DEFAULTS.model);
      const effort = ['low', 'medium', 'high', 'xhigh'].includes(options.effort) ? options.effort : '';
      const previous = w || fromFile(runId);
      w = {
        runId, runDir, mock: !!run.mock, workflow: run.wf?.metadata?.name || 'Workflow',
        provider: type, providerCfg, extraArgs, model, effort,
        on: true, busy: false, finished: false, greet: true, due: true, pending: [], questions: [], timer: null, abort: null,
        // the same conversation when the model and provider did not change
        sessionId: w && w.model === model && w.provider === type ? w.sessionId : null,
        costUsd: previous.costUsd || 0, messages: previous.messages || [],
      };
      watches.set(runId, w);
      post(w, { role: 'system', text: `Watching with ${w.mock ? 'the simulated supervisor' : `${model}${effort ? ` (${effort})` : ''}`}.` });
      pump(w);
      return publicState(w);
    },

    stop(runId) {
      const w = watches.get(String(runId));
      if (w) stop(w, 'Watch turned off.');
      return w ? publicState(w) : fromFile(String(runId));
    },

    ask(runId, question) {
      const w = watches.get(String(runId));
      const q = String(question || '').trim();
      if (!q) throw new Error('Type a question.');
      if (!w?.on) throw new Error('The watch is off: turn it on to ask the supervisor about this run.');
      post(w, { role: 'user', text: q });
      w.questions.push(q);
      pump(w);
      return publicState(w);
    },
  };
}

module.exports = {
  BATCH_MS,
  createWatches,
  DEFAULTS,
  watchLine,
};
