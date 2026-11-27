// Any workflow run as a chat, rebuilt from its events (live run:event, or a past run's
// events.jsonl): one message per agent turn, the orchestrator's transitions and loops as system
// lines, human gates with their answers, the supervisor's interventions, and fan-out steps
// (`agents: [...]`) grouped. No DOM here: runchat.js renders it, a test feeds it engine events.
// #110: a machine step's message with a message_key reads in the interface language (I18n.translated).
// Browser: window.RunChatModel; Node: module.exports.
(function (root) {
  const i18n = () => (typeof module === 'object' && module.exports ? require('@craftorio/shared/i18n') : root.I18n);
  const t = (...a) => i18n()?.t(...a) ?? a[0];
  // A session's provider is the workflow's provider key (claude, codex, grok) or its type; in a
  // simulation it is "mock", so the model name tells which CLI it stands for (the provider registry,
  // packages/shared/providers/, resolves both).
  const registry = typeof module === 'object' && module.exports ? require('@craftorio/shared/providers') : root.Providers;
  const cost = () => (typeof module === 'object' && module.exports ? require('@craftorio/shared/session-cost') : root.SessionCost);
  // a finished run's total (#72): its sessions', as on every screen (with the user's prices, Usage ›
  // Prices); a summary without them: what it says, marked unknown / partial by SessionCost.totalMarks (#117)
  const endCost = (s, run, prices) => {
    const total = s.sessions?.length ? cost().runCost(s.sessions, prices) : { usd: s.cost_usd ?? run.cost, approx: s.cost_approx || run.costApprox, ...cost().totalMarks(s.cost_usd ?? run.cost, run.costMissing) };
    return { cost: total.usd, costApprox: !!total.approx, costUnknown: !!total.unknown, costPartial: !!total.partial };
  };
  // the CLI adapter named by an id, a type or a CLI name (a model name is not a provider), else null
  const cliNamed = (key) => {
    const a = registry.resolve(key);
    return a?.cli && [a.id, a.type, a.cli].includes(key) ? a : null;
  };
  const cliOf = (provider, model) => {
    const byModel = registry.resolve(model);
    return cliNamed(provider) || (byModel?.cli ? byModel : null);
  };
  function providerType(provider, model = '') {
    return cliOf(provider, model)?.type || provider || '';
  }
  // The CLI's short name for a hover card ("Claude"), '' when the session is on no known CLI.
  providerType.short = (provider, model = '') => cliOf(provider, model)?.short || '';
  const baseStep = (id) => String(id || '').split(':')[0];
  const subStep = (id) => String(id || '').split(':')[1] || null;
  const MAX_ACTIVITY = 200; // per turn
  const MAX_TEXT = 4000; // per activity entry

  // Removes the last ```<lang> fenced block from a text: [text without it, block content | null].
  function takeBlock(text, lang) {
    const open = `\`\`\`${lang}`;
    const i = text.lastIndexOf(open);
    if (i < 0 || !/^\s*\n/.test(text.slice(i + open.length))) return [text, null];
    const rest = text.slice(i + open.length);
    const end = rest.indexOf('```');
    if (end < 0) return [text, null];
    return [text.slice(0, i) + rest.slice(end + 3), rest.slice(0, end).trim()];
  }

  // An agent's answer: the prose, the structured output (```json, the step's schema) and the
  // decision log (```decisions), shown collapsed.
  function splitAnswer(text) {
    let prose = String(text || '');
    let json, decisions;
    [prose, json] = takeBlock(prose, 'json');
    [prose, decisions] = takeBlock(prose, 'decisions');
    return { prose: prose.trim(), json, decisions };
  }

  const PrCard = typeof module === 'object' && module.exports ? require('@craftorio/shared/pr-card.js') : root.PrCard;
  const displayName = typeof module === 'object' && module.exports ? require('@craftorio/shared/display-name.js').displayName : root.displayName;
  // what the run chat shows about a session's agent (the hover card): recorded in the events,
  // so a replayed run shows what was actually used
  // simulates (#262): a simulated session's workflow provider (provider is `mock`)
  const sessionInfo = (s) => ({ agent: s.agent, provider: s.provider, model: s.model, effort: s.effort || null, mode: s.mode || null, simulates: s.simulates || null });

  const clip = (s, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const brief = (v) => clip(typeof v === 'string' ? v : JSON.stringify(v ?? ''), 600);
  // a sub-agent call (Claude's Agent/Task tool, capabilities.subagents): its type and what it was asked
  // #795: the orchestrator's messages (steps with no agent): the step types that are not the orchestrator's
  // work (gates wait for a person, the PR monitor has its card), how a log line says it waits, the
  // statuses a step ends well with (any other one is a failure: `missing`, `broken`, `fail`, `blocked`...;
  // no status at all is a step that just ended), the suite's command line ("suite: <cmd> (round N,
  // timeout M min, log <path>)"), and a log path made relative to the run folder (run-log-path.js)
  const NOT_MACHINE = ['agent', 'human_approval', 'human_edit', 'pr_monitor'];
  const WAITING = ['memory_hold', 'screenshot_slot', 'suite_env_rerun', 'suite_slot'];
  // (one status per line: these are step statuses, not the roadmap's states of roadmap-model.js, #349)
  const ENDED_WELL = [
    'done',
    'linked',
    'local',
    'none',
    'not_run',
    'ok',
    'pass',
    'passed',
    'skipped',
    'success',
    'unchanged',
    'written',
  ];
  const SUITE_LINE = /^suite: (.+) \(round (\d+), timeout (\d+) min, log (\S+)\)$/;
  const MAX_FAILURES = 5;
  const MAX_NOTES = 5;
  const logRel = typeof module === 'object' && module.exports ? require('@craftorio/shared/run-log-path.js').runLogPath : root.runLogPath;
  // the first line of an engine text, after its "<step>: " prefix
  const firstLine = (s, step) => clip(String(s || '').split('\n')[0].replace(new RegExp(`^${String(step).replace(/\W/g, '\\$&')}: `), ''), 400);
  // #795: what a finished machine step's output says, onto its orchestrator message
  const machineCounts = (o, c) => (o.passed != null || o.failed != null || c
    ? { passed: o.passed ?? c?.passed ?? null, failed: typeof o.failed === 'number' ? o.failed : c?.failed ?? null } : null);
  const machineFailures = (o) => (Array.isArray(o.failures) ? o.failures : []).slice(0, MAX_FAILURES)
    .map((f) => ({ test: clip(String(f?.test || f?.name || f || ''), 300), file: f?.file ? String(f.file) : null }));
  // #110: a machine step's message as the catalog's text for its message_key (interface language), else its first line
  // a parameter named in message_param_keys (e.g. an install hint's prose) is itself translated by its key
  const machineParams = (o) => Object.fromEntries(Object.entries(o.message_params || {})
    .map(([k, v]) => [k, o.message_param_keys?.[k] ? i18n()?.translated(o.message_param_keys[k], v) || v : v]));
  const machineSummary = (o, step) => {
    const english = firstLine(o.message, step);
    return (o.message_key && i18n()?.translated(o.message_key, english, machineParams(o))) || english;
  };
  function machineOutcome(it, ev) {
    const o = ev.output || {};
    const failed = !!ev.error || (o.status != null && !ENDED_WELL.includes(o.status));
    // #49: a secret scan that was skipped is never shown as passed
    const notRun = o.status === 'not_run' || (o.kind === 'secret_scan' && o.status === 'skipped');
    // #117: any other skipped step (Rule checks with no check command) reads "Skipped", never "Passed"
    const skipped = !notRun && o.status === 'skipped';
    Object.assign(it, {
      state: failed ? 'failed' : notRun ? 'not_run' : skipped ? 'skipped' : 'passed', finishedAt: ev.ts || null, durationMs: ev.duration_ms ?? o.duration_ms ?? null,
      round: o.round ?? it.round, log: logRel(o.log) || it.log, command: o.command || it.command, waitingReason: null,
      counts: machineCounts(o, it.counts), failures: machineFailures(o),
      scope: o.scope || it.scope, why: o.selection?.why ? firstLine(o.selection.why, it.step) : it.why,
      // why it did not simply pass (test ids missing, a broken red check, a skipped check), in the engine's words
      // #110: the engine's English as the catalog's text for its message_key, in the interface language
      summary: o.status && !['pass', 'passed', 'ok', 'success'].includes(o.status) && o.message ? machineSummary(o, it.step) : null,
      error: ev.error ? clip(String(o.error || o.message || 'unknown error'), 600) : null,
    });
    if (o.timeout_ms) it.timeoutMin = Math.round(o.timeout_ms / 60e3);
  }
  const subagentOf = (name, input) => (['Agent', 'Task'].includes(name) && input && typeof input === 'object'
    ? { type: String(input.subagent_type || 'general-purpose'), description: clip(String(input.description || ''), 200) } : null);

  class RunChatModel {
    /** `prices`: the user's prices (settings.prices), which price a turn with no recorded cost (#117). */
    constructor({ prices } = {}) {
      this.prices = prices || {};
      this.items = [];
      this.byId = new Map();
      this.run = { id: null, workflow: '', status: null, cost: 0 };
      this.seq = 0;
      this.n = 0;
      this.sessions = new Map(); // session id → { agent, provider, model }
      this.turns = new Map(); // `${session}:${turn}` → { stepId, activity }
      this.active = new Map(); // who is working now: key → { agent, provider, model, stepId, state, supervisor? }
      this.visits = {}; // step id → visits so far
      this.groups = new Map(); // fan-out step running → its group item
      this.gates = new Map(); // approval id → gate item
      this.sides = new Map(); // agent → 'left' | 'right', given when it first speaks
      this.touched = [];
      this.prCard = null; // #809: the PR monitor's card item
      this.machine = new Map(); // #795: step id → its orchestrator message while the step runs
    }

    // #795: the orchestrator message a `log` event belongs to: its step's, else (the suite's command
    // line carries no step id) the open one writing to that log, else the one its message names
    // ("<step id>: …", as the screenshot slot's wait), else the last one opened
    machineItem(ev, logPath) {
      if (ev.step_id) return this.machine.get(baseStep(ev.step_id)) || null;
      const named = /^([\w-]+): /.exec(String(ev.message || ''));
      if (!logPath) return (named && WAITING.includes(ev.kind) && this.machine.get(named[1])) || null;
      const open = [...this.machine.values()];
      return open.find((it) => logPath && it.log === logPath) || open.at(-1) || null;
    }

    // Each agent gets a side the first time it speaks, alternating left, right, left… in order
    // of appearance, and keeps it for the whole run. Built from the events only, so a replay
    // gives the same sides as the live run. The orchestrator and the supervisor have none.
    sideOf(agent) {
      if (!agent || agent === 'orchestrator' || /^_?supervisor$/.test(agent)) return null;
      if (!this.sides.has(agent)) this.sides.set(agent, this.sides.size % 2 ? 'right' : 'left');
      return this.sides.get(agent);
    }

    // The readable name of an agent (display-name.js), with the Agents menu's names of this run.
    nameOf(agent) {
      return displayName(agent, this.run.agentNames);
    }

    // The readable name of a step (#245): the run's own display names, else its id made readable.
    stepName(stepId) {
      return displayName(stepId, this.run.stepNames);
    }

    add(item) {
      item.id = `i${++this.n}`;
      this.items.push(item);
      this.byId.set(item.id, item);
      this.touched.push(item.id);
      return item;
    }

    touch(item) {
      if (!this.touched.includes(item.id)) this.touched.push(item.id);
    }

    system(ev, level, text) {
      return this.add({ kind: 'system', level, text, ts: ev.ts });
    }

    // Gates still waiting for an answer.
    pendingGates() {
      return [...this.gates.values()].filter((g) => !g.resolved && !g.closed);
    }

    // Applies one event; returns the ids of the items it added or changed (in order).
    apply(ev) {
      this.touched = [];
      if (ev.seq) {
        if (ev.seq <= this.seq) return []; // already applied (replay + live overlap)
        this.seq = ev.seq;
      }
      const fn = HANDLERS[ev.type];
      if (fn) fn.call(this, ev);
      // its latest event: the time so far of a run that ended without workflow.finished (#288)
      if (ev.ts) this.run.lastTs = ev.ts;
      return this.touched;
    }
  }

  const HANDLERS = {
    'workflow.started'(ev) {
      // the issues the run implements; runs recorded before groups have a single `issue`
      const issues = ev.issues || (ev.issue ? [ev.issue] : []);
      Object.assign(this.run, {
        id: ev.run_id, workflow: ev.workflow || ev.file || 'workflow', version: ev.version, mock: !!ev.mock,
        runDir: ev.run_dir, status: 'running', startedAt: ev.ts, issues,
        // agents from the Agents menu show their own name (runs recorded before agent_names: the personas)
        // (#245: before them, the YAML's display names)
        agentNames: { ...ev.display?.agents, ...Object.fromEntries(Object.entries(ev.personas || {}).map(([k, p]) => [k, p?.name]).filter(([, n]) => n)), ...(ev.agent_names || {}) },
        stepNames: ev.display?.steps || null, // step id → name (#245)
        // its chain (#134): what follows it, and the run whose chain started it
        chain: ev.then || ev.from ? { then: ev.then || null, from: ev.from || null, state: ev.then ? 'waiting' : undefined } : null,
      });
      const inputs = ev.inputs || {};
      this.add({
        kind: 'start', ts: ev.ts, workflow: this.run.workflow, version: ev.version, mock: !!ev.mock,
        task: String(inputs.task || '').trim(), inputs, issues, resumedFrom: ev.resumed_from || null,
      });
    },

    // the chain edited while the run goes (#134)
    'run.then'(ev) {
      this.run.chain = { ...(this.run.chain || {}), then: ev.then || null, state: ev.then ? 'waiting' : undefined };
    },

    'session.opened'(ev) {
      const s = ev.session || {};
      this.sessions.set(ev.session_id, sessionInfo(s));
    },

    'session.message_sent'(ev) {
      const s = this.sessions.get(ev.session_id) || {};
      this.turns.set(`${ev.session_id}:${ev.turn}`, { stepId: ev.step_id, activity: [] });
      if (s.agent === 'orchestrator' || subStep(ev.step_id) === 'supervisor') return;
      this.active.set(ev.session_id, { ...s, stepId: baseStep(ev.step_id), state: 'thinking', turn: ev.turn, side: this.sideOf(s.agent) });
    },

    // Tool calls and thinking are kept per turn (shown collapsed under the answer); they also
    // say what the agent is doing right now.
    'session.stream'(ev) {
      const item = ev.item || {};
      const a = this.active.get(ev.session_id);
      const st = { thinking: 'thinking', text: 'writing', tool_call: 'reading' }[item.kind];
      if (a && st) a.state = st;
      const t = this.turns.get(`${ev.session_id}:${ev.turn}`);
      if (!t || t.activity.length >= MAX_ACTIVITY) return;
      const last = t.activity.at(-1);
      if (item.kind === 'thinking' && item.text) {
        // streamed reasoning arrives in pieces
        if (last?.kind === 'thinking') last.text = clip(last.text + item.text);
        else t.activity.push({ kind: 'thinking', text: clip(String(item.text)) });
      } else if (item.kind === 'tool_call') {
        const subagent = subagentOf(item.name, item.input);
        t.activity.push({ kind: 'tool', name: item.name || 'tool', input: brief(item.input), ...(subagent ? { subagent } : {}) });
      } else if (item.kind === 'tool_result' && item.is_error && last?.kind === 'tool') {
        last.error = true;
      }
    },

    'session.message_received'(ev) {
      const known = this.sessions.get(ev.session_id) || {};
      const s = ev.session ? { ...known, ...sessionInfo({ ...known, ...ev.session }) } : known;
      this.sessions.set(ev.session_id, s);
      this.active.delete(ev.session_id);
      const { usd, approx, unknown } = cost().turnCost(ev, this.prices, s.model); // #72: a turn of unknown cost counts the CLI's figure, marked
      this.run.cost += usd;
      this.run.costApprox ||= approx;
      this.run.costMissing ||= !!unknown; // #117
      const total = cost().totalMarks(this.run.cost, this.run.costMissing);
      Object.assign(this.run, { costUnknown: total.unknown, costPartial: total.partial });
      const t = this.turns.get(`${ev.session_id}:${ev.turn}`) || { activity: [] };
      this.turns.delete(`${ev.session_id}:${ev.turn}`);
      const stepId = baseStep(ev.step_id);
      const sub = subStep(ev.step_id);
      if (sub === 'supervisor') return; // its decision is shown instead
      const u = ev.usage || {};
      const group = !sub ? this.groups.get(stepId) : null;
      this.add({
        kind: 'turn', ts: ev.ts, sessionId: ev.session_id, turn: ev.turn, agent: s.agent || '?', provider: s.provider, simulates: s.simulates || null,
        model: s.model || '', effort: s.effort || null, mode: s.mode || null, side: this.sideOf(s.agent || '?'), stepId, sub, visit: this.visits[stepId] || 1, text: String(ev.text || ''), activity: t.activity,
        tokensIn: (u.input || 0) + (u.cache_read || 0) + (u.cache_write || 0), tokensOut: u.output || 0,
        cost: approx ? ev.cost_usd || 0 : usd, costUnknown: approx, durationMs: ev.duration_ms || 0, parent: group?.id,
        // the engine takes the ```handoff block out of the answer; context = { start, peak } tokens
        handoff: ev.handoff || null, context: ev.context || null, fresh: ev.turn === 1,
      });
    },

    'session.closed'(ev) {
      this.active.delete(ev.session_id);
    },

    'step.started'(ev) {
      this.visits[ev.step_id] = ev.visit || 1;
      this.run.stepId = ev.step_id; // the step it is at (where an interrupted run stopped, #288)
      const agents = String(ev.agent || '').split(' · ').filter(Boolean);
      if (agents.length > 1) {
        for (const a of agents) this.sideOf(a); // a fan-out's agents get their sides in the step's order
        this.groups.set(ev.step_id, this.add({ kind: 'group', ts: ev.ts, stepId: ev.step_id, visit: ev.visit || 1, agents, done: false }));
      }
      // #795: a step with no agent (a suite, a check, a merge...) is the orchestrator's: one message per
      // visit, updated in place by its step.log, log and step.finished events
      if (!agents.length && !NOT_MACHINE.includes(ev.step_type)) {
        this.machine.set(ev.step_id, this.add({
          kind: 'orchestrator', ts: ev.ts, step: ev.step_id, stepId: ev.step_id, visit: ev.visit || 1, round: ev.visit || 1,
          name: this.stepName(ev.step_id), state: 'running', startedAt: ev.ts, finishedAt: null, durationMs: null,
          log: null, command: null, timeoutMin: null, counts: null, failures: [], waitingReason: null, notes: [], error: null,
          scope: null, why: null, summary: null,
        }));
      }
    },

    // #795: the log a deterministic step writes to (its live terminal follows it); not the base check's
    'step.log'(ev) {
      const it = this.machine.get(ev.step_id);
      if (!it || ev.base) return;
      Object.assign(it, { log: logRel(ev.path) || it.log, command: ev.command || it.command });
      if (ev.timeout_ms) it.timeoutMin = Math.round(ev.timeout_ms / 60e3);
      this.touch(it);
    },

    // #795: the memory came back: the step waiting for it goes on
    'memory.hold'(ev) {
      const it = this.machine.get(ev.step_id);
      if (!it) return;
      if (ev.recovered && it.state === 'waiting') Object.assign(it, { state: 'running', waitingReason: null });
      this.touch(it);
    },

    'step.finished'(ev) {
      const group = this.groups.get(ev.step_id);
      if (group) {
        this.groups.delete(ev.step_id);
        Object.assign(group, { done: true, failed: (ev.output?.failed || []).map((f) => f.agent), error: !!ev.error });
        this.touch(group);
      }
      // #795: the orchestrator message becomes the step's outcome (an error is on it, not a second item)
      const it = this.machine.get(ev.step_id);
      if (it) {
        this.machine.delete(ev.step_id);
        machineOutcome(it, ev);
        this.touch(it);
        return;
      }
      if (ev.error) this.add({ kind: 'fail', ts: ev.ts, stepId: ev.step_id, text: String(ev.output?.error || 'unknown error') });
    },

    'step.transition'(ev) {
      if (ev.to === 'end') {
        this.system(ev, ev.status && ev.status !== 'success' ? 'warn' : 'transition', `${ev.from} → end${ev.status ? ` (${ev.status})` : ''}${ev.when && ev.when !== '(sequential)' ? ` · ${ev.when}` : ''}`);
        return;
      }
      // going back to a step that already ran is a loop (a fix round, a retry...)
      const back = (this.visits[ev.to] || 0) > 0;
      const when = ev.when && ev.when !== '(sequential)' ? ev.when : '';
      this.system(ev, back ? 'loop' : when ? 'transition' : 'plain', `${back ? '↺ ' : ''}${ev.from} → ${ev.to}${when ? ` · ${when}` : ''}`);
    },

    'step.waiting'(ev) {
      const s = Math.round((ev.interval_ms || 0) / 1000);
      this.system(ev, 'loop', `/loop: ${ev.step_id} checks again in ${s >= 60 ? `${Math.round(s / 60)}m` : `${s}s`}`);
    },

    // `wait:` the engine checked the PR/MR or CI run itself, without an agent turn
    'step.probe'(ev) {
      const then = {
        poll: 'no agent turn', output: 'step finished by the orchestrator', agent: `calling ${ev.step_id}'s agent`,
        check: 'before asking for approval', precheck: 'right before the merge',
      }[ev.action] || ev.action;
      this.system(ev, ev.action === 'agent' ? 'transition' : 'loop', `Orchestrator check (${ev.probe}) on ${ev.step_id}: ${clip(String(ev.detail || ev.state), 200)} · ${then}`);
    },

    'step.goal'(ev) {
      this.system(ev, ev.met ? 'transition' : 'loop', `/goal ${ev.met ? 'met' : 'not met yet'}: ${ev.goal} (iteration ${ev.iteration})`);
    },

    'approval.requested'(ev) {
      const gate = this.add({
        kind: 'gate', ts: ev.ts, approvalId: ev.approval_id, stepId: ev.step_id, message: String(ev.message || ''),
        choices: ev.choices || [{ id: true, label: ev.approve?.label || t('run_chat_model.approve') }, { id: false, label: ev.reject?.label || t('run_chat_model.reject') }], feedback: ev.feedback || null,
        // the summary card (#213): { headline, body, recommendation, options, user_action } and an
        // Approve / Reject gate's labels and help
        brief: ev.brief || null, approve: ev.approve || null, reject: ev.reject || null,
        // #124: the supervisor on call's diagnosis, with the answer it held back for the owner
        supervisor: ev.supervisor || null,
        // the Markdown report that leads the message (#290: the release summary), '' without one
        report: ev.report || '',
        // Run locally ({ install, command, url }), the folder to open and the diff's base ref, when the gate offers them
        localPreview: ev.local_preview || null, workDir: ev.work_dir || null, diffBase: ev.diff_base || null,
        // Run App without a config (#108): the step has local_preview: true
        runApp: !!ev.run_app,
        // #30: a check_environment gate's cause ({ reason, dir, manager, install, command }), said in one line
        environment: ev.environment || null,
        // "Accept and save to issue #n" ({ choice, issue }) in a run about an issue (#125)
        saveToIssue: ev.save_to_issue || null,
        resolved: null, closed: false,
      });
      this.gates.set(ev.approval_id, gate);
    },

    'approval.resolved'(ev) {
      const gate = this.gates.get(ev.approval_id);
      // withdrawn: the PR/MR stopped being mergeable while the gate was open (the engine's check)
      const choice = ev.withdrawn ? 'withdrawn' : String(ev.choice ?? ev.approved);
      const saved = ev.intent === 'save_to_issue' && gate?.saveToIssue?.issue ? `Accept and save to issue #${gate.saveToIssue.issue.number}` : null;
      const label = ev.withdrawn ? `Withdrawn before anyone answered: ${ev.reason || 'the check failed'}` : saved || gate?.choices.find((c) => String(c.id) === choice)?.label || choice;
      if (gate) {
        gate.resolved = { choice, label, intent: ev.intent || null };
        this.touch(gate);
      }
      this.add({ kind: 'reply', ts: ev.ts, stepId: gate?.stepId || ev.step_id, label, feedback: ev.feedback || '', by: ev.by || 'user' });
    },

    'supervisor.started'(ev) {
      this.active.set(`supervisor:${ev.step_id}`, { agent: 'supervisor', supervisor: true, stepId: ev.step_id, state: 'reading' });
      this.system(ev, 'supervisor', `Supervisor called on ${ev.step_id}: ${clip(String(ev.error || 'step failed'), 200)}`);
    },

    'supervisor.decision'(ev) {
      this.active.delete(`supervisor:${ev.step_id}`);
      this.add({
        kind: 'supervisor', ts: ev.ts, stepId: ev.step_id, action: ev.action, goto: ev.goto || null,
        // a failed merge/action: the record says where the run went back to, when and why
        // on call (#41): the action only the person can take goes with it
        explanation: `${ev.record || ev.explanation || ''}${ev.user_action ? `\nAction only you can take: ${ev.user_action}` : ''}`,
        instruction: String(ev.instruction || ''), causeClass: ev.cause_class || null,
        // #71: the answer the supervisor on call gave a gate nobody was asked at
        answered: ev.kind === 'escalation' && ev.action === 'route' ? String(ev.route ?? '') : null,
      });
    },

    'action.executed'(ev) {
      this.system(ev, ev.exit_code && !ev.skipped ? 'warn' : 'plain', `$ ${ev.command} ${ev.skipped ? '(not executed: simulation)' : `→ exit ${ev.exit_code}`}`);
    },

    log(ev) {
      // #795: a deterministic step's log lines fold into its orchestrator message (no line each)
      const message = String(ev.message || '');
      const line = !ev.step_id ? SUITE_LINE.exec(message) : null;
      const it = this.machineItem(ev, line && (logRel(line[4]) || line[4]));
      if (it) {
        if (line) {
          Object.assign(it, { state: 'running', waitingReason: null, command: line[1], round: Number(line[2]), timeoutMin: Number(line[3]), log: logRel(line[4]) || line[4] });
        } else if (WAITING.includes(ev.kind)) {
          Object.assign(it, { state: 'waiting', waitingReason: clip(message, 400) });
        } else {
          // the suite's selection (which files and why: no status yet) is the scope's reason, kept to the end
          if (ev.kind === 'suite' && ev.status == null) it.why = firstLine(message, it.step);
          if (typeof ev.failures === 'number') it.counts = { passed: it.counts?.passed ?? null, failed: ev.failures };
          it.notes = [...it.notes, clip(message, 400)].slice(-MAX_NOTES);
        }
        this.touch(it);
        return;
      }
      if (ev.level === 'warn' || ev.level === 'error') this.system(ev, ev.level, clip(message, 400));
      // a persistent conversation that outgrew max_context: the agent's next turn starts fresh from its note
      else if (ev.kind === 'context_rotation') this.system(ev, 'plain', clip(String(ev.message || ''), 400));
    },

    // `merge: local`: the work is on the local base only; the Backlog's Push sends it to origin
    'worktree.merged'(ev) {
      this.system(ev, 'plain', `Merged locally into ${ev.base}${ev.commit ? ` (${String(ev.commit).slice(0, 8)})` : ''}${ev.rebased ? ', rebased first' : ''}: not pushed yet. Push it from the Backlog.`);
    },

    // Run locally at a gate: the approval shows the change was tried
    'local_preview.started'(ev) {
      this.system(ev, 'plain', `Local preview started at ${ev.step_id}: ${ev.command} in ${ev.dir}${ev.url ? ` (${ev.url})` : ''}${ev.workspace === 'real' ? ', on the real workspace' : ', scratch workspace, simulation only'}`);
    },
    'local_preview.stopped'(ev) {
      this.system(ev, ev.exit_code && !ev.reason ? 'warn' : 'plain', `Local preview stopped${ev.reason ? ` (${ev.reason})` : ev.exit_code != null ? ` (exit ${ev.exit_code})` : ''}`);
    },

    // #809: the PR monitor's card, one item per run updated in place by each read; a failed read keeps
    // the last lines and read time and says why (packages/shared/pr-card.js gives the texts)
    'pr.monitor'(ev) {
      const card = this.prCard || (this.prCard = this.add({ kind: 'pr_card', ts: ev.ts, lines: [], checkedAt: null }));
      const lines = PrCard.lines(ev, { fork: !!ev.fork });
      Object.assign(card, {
        stepId: baseStep(ev.step_id), url: ev.url || card.url || '', number: ev.number ?? card.number ?? null,
        state: ev.state || card.state || null, fork: !!ev.fork, error: ev.error || null,
        checkedAt: ev.checked_at || card.checkedAt, lines: lines.length ? lines : card.lines,
      });
      // #810: Merge / Merge ignoring protection / Close from the read's merge_options, and what blocks the merge
      // (a failed read keeps the last choices, as it keeps the last lines)
      card.mergeOptions = ev.merge_options || (ev.error ? card.mergeOptions : null) || null;
      // #811: what the PR asks for (a failed read keeps the last list), the fix rounds asked from the card
      if (Array.isArray(ev.requests) || !ev.error) card.requests = PrCard.requests(ev.requests);
      card.fixes = card.fixes || [];
      card.fixLimit = PrCard.fixLimit(card.fixes);
      card.buttons = PrCard.buttons(card.mergeOptions, { fork: card.fork, state: card.state, requests: card.requests, fixes: card.fixes });
      card.blocked = ev.merge_options ? PrCard.blocked(ev) : PrCard.ended(card.state) ? '' : card.blocked || '';
      // the engine repeats a failed merge's (merge_error) or close's (close_error) message on each read until the next try
      const ended = PrCard.ended(card.state);
      card.mergeError = ended ? null : ev.merge_error || card.mergeError || null;
      card.closeError = ended ? null : ev.close_error || null;
      this.touch(card);
    },

    // #810: a merge tried from the card: landed → merged, no buttons; refused → the platform's message, the
    // card's state and buttons as they were (it never reads as merged)
    'pr.merge'(ev) {
      const card = this.prCard;
      if (!card) return;
      if (ev.merged) Object.assign(card, { state: 'merged', buttons: [], blocked: '', mergeError: null });
      else card.mergeError = String(ev.error || '') || t('pr_card.merge_refused');
      this.touch(card);
    },

    // #811: a fix asked from the card (transitions.js queuePrFix / prFixOutcome): one round per `round`, updated in
    // place (requested → fixed with its commit, or failed with why), its tokens; no second ask while one runs
    'pr.fix'(ev) {
      const card = this.prCard;
      if (!card) return;
      card.fixes = PrCard.foldFix(card.fixes || [], ev);
      card.fixLimit = PrCard.fixLimit(card.fixes);
      card.buttons = PrCard.buttons(card.mergeOptions, { fork: card.fork, state: card.state, requests: card.requests, fixes: card.fixes });
      this.touch(card);
    },

    'limit.exceeded'(ev) { this.system(ev, 'error', `Limit exceeded: ${ev.limit}`); },

    // #262: an agent's provider was out of credits: its turn moved on to the next provider · model
    'agent.fallback'(ev) {
      const stepId = baseStep(ev.step_id);
      this.add({ kind: 'fallback', ts: ev.ts, agent: ev.agent || '?', stepId, sub: subStep(ev.step_id), visit: this.visits[stepId] || 1, from: String(ev.from || ''), to: String(ev.to || ''), reason: String(ev.reason || '') });
    },

    // #312: an account hit its usage limit: the turn moved to the provider's next account (a
    // 'fallback' item with variant 'account'), or no account was left and the run waits for credits
    'agent.account_switch'(ev) {
      const stepId = baseStep(ev.step_id);
      this.add({ kind: 'fallback', variant: 'account', ts: ev.ts, agent: ev.agent || '?', stepId, sub: subStep(ev.step_id), visit: this.visits[stepId] || 1, from: String(ev.from || ''), to: String(ev.to || ''), reason: String(ev.reason || ''), until: ev.until || null });
    },
    'run.waiting_credits'(ev) {
      const stepId = baseStep(ev.step_id);
      this.add({ kind: 'fallback', variant: 'credits', ts: ev.ts, agent: ev.agent || '?', stepId, sub: subStep(ev.step_id), visit: this.visits[stepId] || 1, provider: String(ev.provider || ''), until: ev.until || null, reason: '' });
    },

    // #276: the memory guard stopped a process of the run
    'process.killed'(ev) { this.system(ev, 'warn', ev.message || `The memory guard stopped ${ev.command_line}`); },

    'budget.exceeded'(ev) {
      this.system(ev, ev.blocked ? 'error' : 'warn', `${ev.provider} reached its monthly budget${ev.blocked ? ': turn blocked' : ' (not blocking)'}`);
    },

    'workflow.finished'(ev) {
      const s = ev.summary || {};
      Object.assign(this.run, { status: ev.status, error: ev.error || null });
      this.active.clear();
      for (const g of this.pendingGates()) { g.closed = true; this.touch(g); }
      // a fan-out that threw (too few agents answered) gets no step.finished
      for (const group of this.groups.values()) { Object.assign(group, { done: true, error: ev.status !== 'success' }); this.touch(group); }
      this.groups.clear();
      // #795: a step the run ended in (stopped, interrupted) gets no step.finished
      for (const it of this.machine.values()) { Object.assign(it, { state: ev.status === 'success' ? 'passed' : 'failed', finishedAt: ev.ts || null, waitingReason: null }); this.touch(it); }
      this.machine.clear();
      // tested (#396): 'not green' when the run went on without a green suite; 'no tests' (#71)
      this.add({ kind: 'end', ts: ev.ts, status: ev.status, error: String(ev.error || ''), ...endCost(s, this.run, this.prices), durationMs: s.duration_ms || 0, tested: s.tested || null });
    },
  };

  const api = { RunChatModel, splitAnswer, providerType };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunChatModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
