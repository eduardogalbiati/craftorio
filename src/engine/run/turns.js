// One provider turn (#250, from src/engine/workflow.js): `invokeTurn` runs a session's turn against
// the provider with the agent's retry policy (a failed attempt's tool calls go to the next one,
// `attemptSummary`), quota errors and the fallback chain (`fallbackChain`, `nextFallback`, #262),
// refused tool calls, the idle watch (`warnIdle`) and the memory guard (`watchMemory`, #276), the
// templated `timeout` (`turnTimeout`), the turn's tokens and cost, and the cost of a stopped attempt
// (`countStoppedAttempt`, #233). `workingDir`: where the agent runs.

'use strict';

const fs = require('fs');
const {
  isPermissionDenial,
  isQuotaError,
  isRetryable,
  isToolTimeout,
  sleep,
} = require('../providers');
const { sessionCost } = require('../../usage');
const capabilities = require('../capabilities');
const suiteStep = require('../suite-step');
const { IdleWatch } = require('../idle');
const chain = require('../../shared/chain-model');
const { render } = require('./templates');
const { FALLBACK_ENTRY, parseDuration } = require('./load');
const { takeHandoff } = require('./outputs');
// the module too, for `providers.runTurn`: read when a turn starts, not bound when this file loads, so
// tests that fake the CLI on the module's exports (test/subagent-tokens-engine-308.test.js) reach it
const providers = require('../providers');

// Consecutive refused tool calls in one turn that are worth a warning (agent fighting its allowlist).
const DENIAL_WARN = 5;

// Silence with a command waiting that is worth a warning (an agent polling for text that never shows up).
const IDLE_WARN_MS = 5 * 60e3;
// bytes in GB (binary, like Task Manager), one decimal: the memory guard's messages (#276)
const gib = (bytes) => (bytes / 1024 ** 3).toFixed(1);

// What a failed attempt of a turn did (a process killed at its timeout writes no handoff note), for
// the next attempt: its tool calls, oldest first (the last ATTEMPT_CALLS), each with the first line
// of its result. calls: tool call id -> { name, input, result? }.
const ATTEMPT_CALLS = 60;
function attemptSummary(calls, err, attempt) {
  const line = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
  const all = [...calls.values()];
  const shown = all.slice(-ATTEMPT_CALLS);
  const rows = shown.map((c) => {
    const input = c.input || {};
    const what = line(input.command ?? input.file_path ?? input.path ?? input.pattern ?? JSON.stringify(input), 200);
    const out = !c.result ? 'no result: still running when the attempt stopped'
      : `${c.result.is_error ? 'error: ' : ''}${line(String(c.result.output ?? '').split('\n').find((l) => l.trim()) || '(no output)', 160)}`;
    return `- ${c.name || 'tool'}: ${what} → ${out}`;
  });
  return [
    '<previous_attempt>',
    `Your previous attempt of this turn (attempt ${attempt}) was stopped: ${line(err?.message, 200)}. What it wrote in the working`,
    'folder (files, commits) is still there. Continue from where it stopped: do not re-orient from `git status`, do not',
    're-run a command whose result is below unless something changed since, and keep the tests it already wrote.',
    `Its tool calls${all.length > shown.length ? ` (the last ${shown.length} of ${all.length})` : ''}:`,
    ...rows,
    '</previous_attempt>',
  ].join('\n');
}

function addUsage(total, u) {
  for (const k of Object.keys(total)) total[k] += (u && u[k]) || 0;
}

const methods = {
  // #262: an agent's fallback chain, fixed at its first quota error: its own or `defaults`' `fallbacks`,
  // else Settings' chain of the provider it runs on (the constructor's `fallbacks`).
  fallbackChain(agentName, agent) {
    let at = this.fallbackAt.get(agentName);
    if (!at) {
      const chain = Array.isArray(agent.fallbacks) ? agent.fallbacks : this.providerFallbacks[agent.provider] || [];
      at = { chain: chain.map(String), index: -1 };
      this.fallbackAt.set(agentName, at);
    }
    return at;
  },

  // The next usable entry of the agent's chain ({ provider, model }), or null when none is left.
  // A malformed entry (Settings' chains are not validated like the workflow's) or one naming a
  // provider this workflow does not define is skipped with a warning.
  nextFallback(agentName, agent) {
    const at = this.fallbackChain(agentName, agent);
    const current = `${agent.provider}:${agent.model}`;
    while (++at.index < at.chain.length) {
      const entry = at.chain[at.index];
      const m = FALLBACK_ENTRY.exec(entry);
      if (!m) {
        this.emitEvent('log', { level: 'warn', agent: agentName, message: `[${agentName}] fallback "${entry}" skipped: it must be "<provider>:<model>", e.g. "codex:gpt-6-luna".` });
        continue;
      }
      if (entry === current) continue;
      if (Object.hasOwn(this.wf.providers || {}, m[1])) return { provider: m[1], model: m[2] };
      this.emitEvent('log', { level: 'warn', agent: agentName, message: `[${agentName}] fallback "${entry}" skipped: the workflow does not define provider "${m[1]}".` });
    }
    return null;
  },

  // An agent's `timeout` for one turn (default 30m). A template is rendered with the run's context,
  // so the budget can grow with the run, e.g. with the number of issues of a grouped run (#101).
  // Times its model's timeout_factor (#262, `models`: e.g. 3x for Fable 5.1's slower turns), then
  // tonight's turn factor (#337, effectiveLimits().turns), read when the turn starts.
  turnTimeout(agent) {
    const v = typeof agent.timeout === 'string' && agent.timeout.includes('{{') ? render(agent.timeout, this.ctx).trim() : agent.timeout;
    return Math.round(parseDuration(v, 30 * 60e3) * (Number(this.modelLimits(agent.model).timeout_factor) || 1) * this.effectiveLimits().turns);
  },

  // #276: watches a process this run started (an agent CLI, a suite command) with the memory guard;
  // what it stops becomes a `process.killed` event (the second stop of the same command in a step
  // notifies the owner) and, for an agent, a line of its next prompt. onStop(ev): the caller's own use.
  watchMemory({ rootPid = null, protectChildren = false, stepId = null, session = null, agentName = null, onStop = null }) {
    if (!this.memoryGuard) return { stop() {} };
    return this.memoryGuard.watch({
      rootPid, protectedPids: [], protectChildren, step: stepId, session,
      onKill: (ev) => {
        const key = `${stepId}\n${ev.commandLine}`;
        const n = (this.memoryStops.get(key) || 0) + 1;
        this.memoryStops.set(key, n);
        this.emitEvent('process.killed', {
          step_id: stepId, session, pid: ev.pid, command_line: ev.commandLine, bytes: ev.bytes, limit_bytes: ev.limitBytes, ...(n === 2 ? { notify: true } : {}),
          message: `The memory guard stopped \`${ev.commandLine}\` (pid ${ev.pid}) at ${gib(ev.bytes)} GB: over the limit of ${gib(ev.limitBytes)} GB per process${n > 1 ? ` (stopped ${n} times in ${stepId})` : ''}.`,
        });
        if (agentName) this.memoryNotes.set(agentName, [...(this.memoryNotes.get(agentName) || []), ev]);
        onStop?.(ev);
      },
      // the agent CLI itself over the limit: never stopped (its turn would be lost), only reported
      onReport: (ev) => this.emitEvent('log', {
        level: 'warn', kind: 'memory_over_limit', step_id: stepId, pid: ev.pid, bytes: ev.bytes, limit_bytes: ev.limitBytes,
        message: `${agentName ? `[${agentName}] the agent CLI` : 'The step\'s command'} uses ${gib(ev.bytes)} GB, over the memory limit of ${gib(ev.limitBytes)} GB: not stopped (it is the turn itself).`,
      }),
      onLog: (l) => {
        if (this.memoryGuardOff) return;
        this.memoryGuardOff = true;
        this.emitEvent('log', { level: l.level || 'warn', kind: 'memory_guard_off', step_id: stepId, message: l.message });
      },
    });
  },

  // Runs one provider turn in `session` (with the agent's retry policy) and reports it:
  // session.message_sent / .stream / .message_received. The answer comes back without its
  // ```handoff block (res.handoff), with its tool calls (res.tools) and context size (res.context).
  async invokeTurn({ session, agentName, agent, provider, extraArgs, agentEnv, stepId, hint, attempts, attachments = [] }, turn, fullPrompt) {
    const timeoutMs = this.turnTimeout(agent);
    this.emitEvent('session.message_sent', { session_id: session.id, turn, step_id: stepId, prompt: fullPrompt, timeout_ms: timeoutMs, ...(attachments.length ? { attachments } : {}) });
    // a retry after a failed attempt that did work (a timeout, a crash) starts with what it did
    let prompt = fullPrompt;
    if (!provider) throw new Error(`Provider "${agent.provider}" is not defined.`);
    if (!this.machine.simulated) this.checkBudget(agent.provider);
    await this.contextGate(stepId);

    const retry = agent.retry || {};
    const maxAttempts = attempts || retry.max_attempts || 1;
    let delay = this.machine.simulated ? 1000 : parseDuration(retry.initial_delay, 5000);
    let lastErr;
    // #233: what this turn's attempts stopped before their result cost (the step's record counts it)
    let stoppedUsd = 0;

    for (let a = 1; a <= maxAttempts; a++) {
      const t0 = Date.now();
      this.setStatus(session, 'active');
      // tool calls of this turn: refused ones (allowlist) vs the ones that ran
      // subagents: the sub-agent calls of this turn (capabilities.subagents, Claude's Agent/Task tool)
      const tools = { ran: 0, denials: 0, streak: 0, maxStreak: 0, denied: [], subagents: 0 };
      // context window of each model request: the first one and the largest
      const context = { start: null, peak: null };
      // #320: the last request's context, and the cache tier the provider reported (Claude: 1h / 5m)
      const cache = { last: null, tier: null };
      const calls = new Map();
      // `full_suite: warn` (#177): the engine's suite step runs the whole suite; the agent's own run is noted
      const suiteWarn = this.wf.steps.find((s) => s.id === stepId)?.full_suite === 'warn' ? this.suiteCommand() : null;
      const track = (item) => {
        if (item.kind === 'context') {
          context.start ??= item.tokens; context.peak = Math.max(context.peak || 0, item.tokens); cache.last = item.tokens;
          if (item.tier) cache.tier = item.tier;
          return;
        }
        if (item.kind === 'tool_call') calls.set(item.id, { ...item });
        if (suiteWarn !== null && item.kind === 'tool_call' && suiteStep.isFullSuiteCommand(item.input?.command, suiteWarn)) {
          this.suiteRuns.agents++;
          this.emitEvent('log', { level: 'warn', kind: 'full_suite_by_agent', step_id: stepId, agent: agentName, command: String(item.input.command).slice(0, 200), message: `[${agentName}] started the whole test suite in ${stepId} (\`${String(item.input.command).slice(0, 120)}\`): the orchestrator runs it once per round after the step; agents run only the focused tests of the change.` });
        }
        if (item.kind === 'tool_call' && capabilities.CLAUDE_SUBAGENT_TOOLS.includes(item.name)) tools.subagents++;
        if (item.kind !== 'tool_result') return;
        if (calls.has(item.id)) calls.get(item.id).result = item;
        if (isToolTimeout(item)) {
          // #178: a command cut by the tool's timeout returned nothing; without an explicit `timeout` it hit the default
          const call = calls.get(item.id);
          const command = String(call?.input?.command ?? '').slice(0, 200);
          const explicit = call?.input?.timeout != null;
          this.toolTimeouts++;
          this.emitEvent('log', { level: 'warn', kind: 'tool_timeout', step_id: stepId, agent: agentName, command, timeout_ms: explicit ? +call.input.timeout : null, message: `[${agentName}] a command was cut by the tool's ${explicit ? `timeout (${call.input.timeout} ms)` : 'default timeout (no `timeout` given)'} in ${stepId || 'a delegated turn'}: \`${command.slice(0, 120)}\`. Give every test or build command an explicit timeout sized for it, or run a narrower filter.` });
        }
        if (!isPermissionDenial(item)) { tools.ran++; tools.streak = 0; return; }
        tools.denials++;
        tools.maxStreak = Math.max(tools.maxStreak, ++tools.streak);
        const call = calls.get(item.id);
        tools.denied.push(`${call?.name || 'tool'}: ${String(call?.input?.command ?? JSON.stringify(call?.input ?? '')).slice(0, 120)}`);
      };
      // this turn's own abort: the run's cancel, or the supervisor interrupting an idle wait
      const turnAbort = new AbortController();
      const cancel = () => turnAbort.abort();
      this.abort.signal.addEventListener('abort', cancel, { once: true });
      let interrupted = null;
      // only while the stall the supervisor decided on still holds: the command may have produced
      // output or finished while it was thinking
      const interrupt = (decision, stall) => {
        if (timed || !idle.stillStalled(stall)) return false;
        interrupted = decision;
        turnAbort.abort();
        return true;
      };
      // the supervisor on call stopping a step that runs far longer than usual (superviseSlow)
      const live = stepId && this.ctx.steps[stepId] ? this.liveTurns.get(stepId) || this.liveTurns.set(stepId, new Set()).get(stepId) : null;
      const stopSlow = (decision) => {
        if (timed) return false;
        interrupted = { ...decision, slow: true };
        turnAbort.abort();
        return true;
      };
      live?.add(stopSlow);
      const idle = new IdleWatch({ idleMs: this.idleWarnMs });
      const idleTimer = this.idleWarnMs > 0 && setInterval(() => this.warnIdle(idle, { session, agentName, stepId, turn, interrupt }), Math.min(30e3, Math.max(50, this.idleWarnMs / 4)));
      idleTimer?.unref?.();
      let timed = null;
      // #276: the memory guard watches the CLI's process tree while the turn runs (a mock turn has none)
      let memWatch = this.machine.simulated ? this.watchMemory({ stepId, session: session.id, agentName }) : null;
      const onSpawn = ({ pid, shim }) => {
        memWatch?.stop();
        memWatch = this.watchMemory({ rootPid: pid, protectChildren: shim, stepId, session: session.id, agentName });
      };
      const timing = () => {
        if (timed) return timed;
        memWatch?.stop();
        this.abort.signal.removeEventListener('abort', cancel);
        live?.delete(stopSlow);
        clearInterval(idleTimer);
        this.addStepTiming(stepId, (timed = idle.finish()));
        return timed;
      };
      try {
        const res = await providers.runTurn({
          provider, model: agent.model, effort: agent.effort, providerSessionId: session.providerSessionId,
          prompt, cwd: (session.cwd = this.workingDir(agent)), extraArgs, agentEnv, attachments,
          timeoutMs, attempt: a,
          signal: turnAbort.signal, hint, render, onSpawn,
          onItem: (item) => { track(item); idle.item(item); this.emitEvent('session.stream', { session_id: session.id, turn, item }); },
        });
        const { active_ms, waiting_ms, stalled_ms } = timing();
        res.tools = tools;
        res.context = context;
        res.stoppedCostUsd = stoppedUsd;
        [res.text, res.handoff] = takeHandoff(res.text);
        if (tools.maxStreak >= DENIAL_WARN) {
          // the agent is fighting its allowlist (cli_args): visible in the run, the supervisor's timeline and the run chat
          this.emitEvent('log', {
            level: 'warn', kind: 'permission_denials', step_id: stepId, agent: agentName, denials: tools.denials,
            message: `[${agentName}] ${tools.denials} tool calls refused by its allowlist in one turn of ${stepId} (${tools.maxStreak} in a row), e.g. ${tools.denied.slice(-2).join(' · ')}`,
          });
        }
        const dur = Date.now() - t0;
        session.activeMs += dur;
        if (res.providerSessionId) session.providerSessionId = res.providerSessionId;
        if (res.cliTotalCostUsd != null) session.cliTotalUsd = res.cliTotalCostUsd;
        addUsage(session.tokens, res.usage);
        session.costUsd += res.costUsd || 0;
        session.status = 'idle';
        // #320: the cache state of the session (its next turn resumes warm until lastTurnAt + the lifetime)
        session.lastTurnAt = Date.now();
        if (cache.last != null) session.contextTokens = cache.last;
        session.startContextTokens ??= context.start;
        if (cache.tier) session.cacheTier = cache.tier;
        this.emitEvent('session.message_received', {
          session_id: session.id, turn, step_id: stepId, text: res.text, usage: res.usage,
          // #308: usage is the whole turn; the main conversation's figures and the sub-agents' apart
          ...(res.usage_main ? { usage_main: res.usage_main } : {}), ...(res.subagents ? { subagents: res.subagents } : {}),
          ...(res.model_calls ? { model_calls: res.model_calls } : {}),
          cost_usd: res.costUsd, duration_ms: dur, active_ms, waiting_ms, stalled_ms, session: this.snapshot(session),
          context, ...(res.handoff ? { handoff: res.handoff } : {}), ...(tools.subagents ? { subagent_calls: tools.subagents } : {}),
          ...(res.cut ? { cut: true, requests: res.requests } : {}),
        });
        this.recordDecisions(agentName, stepId, res.text);
        return res;
      } catch (e) {
        timing();
        session.activeMs += Date.now() - t0;
        lastErr = e;
        const spent = this.countStoppedAttempt({ session, agent, stepId, turn, attempt: a }, e);
        stoppedUsd += spent.costUsd;
        if (this.abort.signal.aborted) break;
        if (interrupted?.slow) {
          lastErr = Object.assign(new Error(`[${agentName}] turn interrupted by the supervisor on call: ${stepId} ran far longer than usual`),
            { idleInterrupt: { instruction: interrupted.instruction || null, command: null } });
          this.emitEvent('log', { level: 'warn', kind: 'agent_interrupted', step_id: stepId, agent: agentName, message: lastErr.message });
          break;
        }
        if (interrupted) {
          const stall = idle.lastStall;
          lastErr = Object.assign(new Error(`[${agentName}] turn interrupted by the supervisor: no output while waiting on ${stall?.tool || 'a tool'}: ${stall?.command || '?'}`),
            { idleInterrupt: { instruction: interrupted.instruction || null, command: stall?.command || null } });
          this.emitEvent('log', { level: 'warn', kind: 'agent_interrupted', step_id: stepId, agent: agentName, message: lastErr.message });
          break;
        }
        this.emitEvent('log', { level: 'error', message: `[${agentName}] attempt ${a}/${maxAttempts} failed: ${e.message}${spent.note}` });
        // #262: out of credits or past the usage limit: another attempt on the same provider would fail too
        if (isQuotaError(this.wf.providers?.[agent.provider]?.type, e.message)) {
          this.emitEvent('log', { level: 'error', kind: 'usage_limit', step_id: stepId, agent: agentName, message: `[${agentName}] ${agent.provider} is out of credits or past its usage limit: not retried on it.` });
          break;
        }
        if (!isRetryable(e)) {
          this.emitEvent('log', { level: 'error', message: `[${agentName}] non-retryable error, giving up.` });
          break;
        }
        if (a < maxAttempts) {
          // a killed process writes no handoff note: the next attempt gets the summary of its tool
          // calls instead of re-orienting from `git status` (issue #101)
          if (calls.size) {
            prompt = `${attemptSummary(calls, e, a)}\n\n${fullPrompt}`;
            this.emitEvent('log', {
              level: 'info', kind: 'attempt_summary', step_id: stepId, agent: agentName, tool_calls: calls.size,
              message: `[${agentName}] attempt ${a + 1} starts with the summary of attempt ${a} (${calls.size} tool call${calls.size === 1 ? '' : 's'})`,
            });
          }
          this.setStatus(session, 'retrying');
          await sleep(delay, this.abort.signal);
          if (retry.backoff === 'exponential') delay *= 2;
        }
      }
    }
    throw lastErr;
  },

  // #233: an attempt that ended without its result (timeout, cancel, crash, usage limit) still paid
  // for the model calls it made: their tokens (summed by the adapter from the stream) are priced with
  // the run's price table and counted in the session, the step and the run, marked estimated; without
  // a price for the model its cost is "not recorded". Returns the cost and the note of its log line.
  countStoppedAttempt({ session, agent, stepId, turn, attempt }, e) {
    const p = e?.partial;
    if (!p || !(p.modelCalls || p.costUsd != null)) return { costUsd: 0, note: '' };
    const reported = p.costUsd != null;
    const costUsd = reported ? p.costUsd : sessionCost({ model: agent.model || session.model, tokens: p.usage || {} }, this.prices);
    if (p.usage) addUsage(session.tokens, p.usage);
    if (costUsd != null) session.costUsd += costUsd;
    if (costUsd != null && !reported) session.estimatedUsd = (session.estimatedUsd || 0) + costUsd;
    if (costUsd == null) session.costNotRecorded = true;
    const calls = `${p.modelCalls || 0} model call${p.modelCalls === 1 ? '' : 's'}`;
    this.emitEvent('session.attempt_stopped', {
      session_id: session.id, turn, step_id: stepId, attempt, error: e.message, usage: p.usage || null, model_calls: p.modelCalls || 0,
      cost_usd: costUsd, estimated: costUsd != null && !reported, ...(costUsd == null ? { cost_not_recorded: true } : {}),
      session: this.snapshot(session),
    });
    const note = reported ? ` (US$ ${costUsd.toFixed(2)})`
      : costUsd != null ? ` (US$ ${costUsd.toFixed(2)}, estimated from ${calls})`
        : ` (cost not recorded: no price for ${agent.model || 'the model'}, ${calls})`;
    return { costUsd: costUsd || 0, note };
  },

  // An agent silent for idleWarnMs while a command is waiting: probably polling for output that never
  // comes, or a hung process. Visible in the run, the run chat and the supervisor's timeline; on a
  // step's turn it also wakes the supervisor, when the workflow has one (superviseIdle).
  warnIdle(idle, { session, agentName, stepId, turn, interrupt }) {
    const stall = idle.check();
    if (!stall) return;
    const minutes = Math.round(stall.idle_ms / 6e3) / 10;
    this.emitEvent('log', {
      level: 'warn', kind: 'agent_idle', step_id: stepId, agent: agentName, session_id: session.id, turn,
      idle_ms: stall.idle_ms, tool: stall.tool, command: stall.command,
      message: `[${agentName}] no output for ${minutes} min in ${stepId || 'a delegated turn'} while waiting on ${stall.tool}: ${stall.command}`,
    });
    const step = this.supervisorCfg && this.wf.steps.find((s) => s.id === stepId);
    if (step) this.superviseIdle(step, stall, { agentName, interrupt }).catch((e) => this.emitEvent('log', { level: 'error', message: `Supervisor could not decide on ${stepId}: ${e.message}` }));
  },

  // Without a working_dir (workflow with no repository), the agent runs in the run folder.
  workingDir(agent) {
    const dir = render(agent.working_dir, this.ctx).trim();
    if (dir) return dir;
    fs.mkdirSync(this.runDir, { recursive: true });
    return this.runDir;
  },
};

module.exports = {
  addUsage,
  attemptSummary,
  DENIAL_WARN,
  gib,
  IDLE_WARN_MS,
  methods,
};
