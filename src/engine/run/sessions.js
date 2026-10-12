// Sessions, turns and handoff notes (#250, from src/engine/workflow.js): session records and their
// events (`openSession`, `setStatus`, `closeSession`, `snapshot`, `cacheState` #320), `sendToAgent`
// builds one turn and `agentTurn` runs it in the agent's session (modes persistent / ephemeral /
// handoff, `max_context` and `fresh_after_idle` rotation, the test-file and protected-file guards,
// cuts by `max_requests` #302), the handoff notes (`saveHandoff`, `requestHandoffNote`,
// `continueAfterCut`; `takeHandoff` reads one, src/engine/run/outputs.js) and the skills a prompt
// includes (`loadSkills`). The provider call itself is src/engine/run/turns.js.

'use strict';

const fs = require('fs');
const path = require('path');
const { emptyUsage, imageInput, isQuotaError } = require('../providers');
const { resolveSkill, skillPrompt } = require('../../skills');
const { totalTokens } = require('../../usage');
const capabilities = require('../capabilities');
const evidence = require('../../evidence');
const testPaths = require('../test-paths');
const chain = require('../../renderer/chain-model');
const sessionCache = require('../../session-cache');
const { render } = require('./templates');
const {
  parseDuration,
  parseRequests,
  parseTokens,
  renderFileList,
} = require('./load');
const { gib } = require('./turns');
const { kTokens } = require('./costs');

// Skills bundled with the app (skills/ folder at the root). Workspace skills take precedence.
const BUNDLED_SKILLS = path.join(__dirname, '..', '..', '..', 'skills');

// ---------------------------------------------------------------------------
// Handoff notes: at the end of each turn an agent that comes back (persistent or handoff session)
// leaves a short note for whoever continues in a fresh session. The engine removes it from the
// answer, saves it in runs/<id>/handoffs/ and starts the agent's next fresh session from it.
const HANDOFF_INSTRUCTIONS = [
  'Handoff note: your next turn in this run may start in a fresh session that does not have this conversation.',
  'Before the final ```json block (or at the very end if there is none), write a ```handoff block, at most 250 words of',
  'plain Markdown bullets, no code blocks inside:',
  '- Goal: what this agent is trying to achieve in the run',
  '- State: branch, commits (hashes), PR/MR, what is running',
  '- Done: what this turn did',
  '- Left: what is still open, in order',
  '- Decisions: each decision and why',
  '- Key files: path (what matters there)',
  '- Known problems: blockers, flaky things, what did not work',
  'The code is in git: point to files and commits instead of pasting code. The orchestrator removes this block from your answer.',
  'Write the note in English, whatever language the project instructions or the conversation use.',
].join('\n');

// Ends the prompt of a step with an output schema: project instructions (e.g. a CLAUDE.md asking for
// another chat language) must not turn the final message into prose the engine cannot parse.
const OUTPUT_LANGUAGE = 'Your final message must end with that JSON object, written in English (string values included), '
  + 'whatever language the project instructions or the conversation use. A summary in prose does not replace it.';

const HANDOFF_ONLY = 'Write only your ```handoff block now, following the format asked before (Goal, State, Done, Left, Decisions, Key files, Known problems; at most 250 words). Nothing else.';

// #302: a turn cut by its request budget (max_requests) gets this one wrap-up request in the same
// conversation (WRAP_UP_REQUESTS model requests at most, to commit), then its step visit continues
// in a fresh session from the note; the MAX_CUTS-th cut of a visit fails the step.
const WRAP_UP = 'Your turn reached its request budget (max_requests) and ends now. Commit what is consistent on your branch'
  + ' (a WIP commit is fine; the rules on protected files and test files still apply), then write only your ```handoff block,'
  + ' following the format asked before (Goal, State, Done, Left, Decisions, Key files, Known problems; at most 250 words):'
  + ' a fresh session continues this step from it. Nothing else.';
const WRAP_UP_REQUESTS = 10;
const MAX_CUTS = 3;

const methods = {
  // ---- sessions -------------------------------------------------------------
  // simulates: a simulated session's workflow provider (provider is `mock`), shown instead of it (#262);
  // fallbackFrom: { from: '<provider>:<model>', reason } the session an agent fell back from (#262)
  openSession({ agent, provider, model, effort = null, parentId, stepId, mode = null, simulates = null, fallbackFrom = null }) {
    const s = {
      id: agent === 'orchestrator' ? 'orchestrator' : `s${++this.nSession}`,
      agent, provider, model, effort, parentId, stepId, mode, simulates, fallbackFrom,
      openedAt: Date.now(), closedAt: null,
      turns: 0, activeMs: 0, tokens: emptyUsage(), costUsd: 0,
      status: 'idle', providerSessionId: null,
    };
    this.sessions.set(s.id, s);
    this.emitEvent('session.opened', { session_id: s.id, session: this.snapshot(s) });
    return s;
  },

  setStatus(s, status) {
    s.status = status;
    this.emitEvent('session.status', { session_id: s.id, status });
  },

  closeSession(s, status) {
    if (s.closedAt) return;
    s.closedAt = Date.now();
    s.status = status;
    this.emitEvent('session.closed', { session_id: s.id, status, session: this.snapshot(s) });
  },

  snapshot(s) {
    const duration = (s.closedAt || Date.now()) - s.openedAt;
    return {
      id: s.id, agent: s.agent, provider: s.provider, model: s.model, effort: s.effort || null,
      parent_id: s.parentId, step_id: s.stepId,
      opened_at: new Date(s.openedAt).toISOString(),
      closed_at: s.closedAt ? new Date(s.closedAt).toISOString() : null,
      duration_ms: duration, active_ms: s.activeMs, idle_ms: Math.max(0, duration - s.activeMs),
      turns: s.turns, tokens: { ...s.tokens }, cost_usd: +s.costUsd.toFixed(6),
      status: s.status, provider_session_id: s.providerSessionId, cwd: s.cwd || null, mode: s.mode || null,
      // #233: the part of cost_usd estimated from the stream of attempts killed before their result
      ...(s.estimatedUsd ? { estimated_cost_usd: +s.estimatedUsd.toFixed(6) } : {}),
      ...(s.costNotRecorded ? { cost_not_recorded: true } : {}),
      // the CLI's own running total of its session (Claude): seeds the per-turn cost when a resumed run continues it
      ...(s.cliTotalUsd != null ? { cli_total_cost_usd: s.cliTotalUsd } : {}),
      ...(s.simulates ? { simulates: s.simulates } : {}),
      ...(s.fallbackFrom ? { fallback_from: s.fallbackFrom } : {}),
      ...this.cacheState(s),
    };
  },

  // #320: the session's prompt-cache state (src/session-cache.js): when its last turn ended, its
  // context at the last request, whether its agent has a handoff note, and what its next turn re-reads
  cacheState(s) {
    if (s.agent === 'orchestrator') return {};
    // a simulated run keeps the subscription's hour, whatever key the machine has
    const auth = !this.mock && process.env.ANTHROPIC_API_KEY ? 'api_key' : 'subscription';
    const lifetime = sessionCache.cacheLifetimeMs(s.simulates || s.provider, { auth, tier: s.cacheTier || null });
    const state = {
      last_turn_at: s.lastTurnAt ? new Date(s.lastTurnAt).toISOString() : null,
      context_tokens: s.contextTokens ?? null,
      start_context_tokens: s.startContextTokens ?? null,
      has_note: this.handoffNotes.has(s.agent),
      fresh_after_idle_ms: s.freshAfterIdleMs ?? null,
      cache_lifetime_ms: lifetime,
      cold_resume_usd: sessionCache.cacheWriteUsd(s.contextTokens, this.prices[s.model], lifetime),
      // its last turn passed max_context: the next one starts a fresh session (agentTurn's rotation)
      ...(!s.closedAt && this.rotate.has(s.agent) && this.agentSessions.get(s.agent) === s.id ? { rotate_pending: true } : {}),
    };
    const closed = s.closedAt ? new Date(s.closedAt).toISOString() : null;
    return { ...state, next_turn: sessionCache.nextTurn({ ...state, agent: s.agent, mode: s.mode, closed_at: closed }) };
  },

  // Read once per run: editing the skill mid-run does not change what the agents already received.
  // Expands `uses:` from the skills' frontmatter: dependencies come first, each skill
  // once, cycles ignored. E.g. unit-test-writer-go uses testing-principles.
  loadSkills(names) {
    const out = [];
    const seen = new Set();
    const visit = (name, chain) => {
      if (!name || seen.has(name) || chain.includes(name)) return;
      const skill = this.loadSkill(name);
      for (const dep of skill.uses) visit(dep, [...chain, name]);
      seen.add(name);
      out.push(skill);
    };
    for (const n of names) visit(n, []);
    return out;
  },

  loadSkill(name) {
    this.skillCache ??= new Map();
    if (!this.skillCache.has(name)) {
      const skill = resolveSkill(this.skillsDirs, name);
      this.skillCache.set(name, skill);
      this.emitEvent('log', { level: 'info', message: `skill "${skill.name}" loaded from ${skill.path}` });
    }
    return this.skillCache.get(name);
  },

  // One turn of an agent. `session` in the YAML (agent or defaults):
  // - persistent (default): one conversation for the whole run. With `max_context` (e.g. 150k), a turn
  //   that ends above it makes the next turn start a fresh session from the agent's handoff note
  //   (never in the middle of a turn); with `fresh_after_idle` (e.g. 55m), so does a turn that comes
  //   longer than that after the last one (#247: a cold prompt cache after a long gate wait);
  // - ephemeral: a fresh session per turn with only the prompt;
  // - handoff: a fresh session per turn that starts from the agent's latest handoff note.
  // Persistent and handoff agents end each turn with a handoff note (runs/<id>/handoffs/).
  // opts.capabilities: the step's capabilities over the agent's; opts.retry: a schema retry
  // (no new note, no rotation); opts.editsTests: the step's `edits_tests` over the agent's.
  // `edits_tests: false`: the turn may not change test files (tests_paths, src/engine/test-paths.js).
  // The engine checks the checkout after the turn and sends it back with the list of files, at most
  // twice; after that the turn fails (the supervisor or the step's on_error take over). A snapshot or
  // a check that cannot run (git error) fails the turn too; only a folder outside git is unchecked.
  // `protect_files` (#220; opts.protectFiles: the step's over the agent's, rendered now): the same
  // guard on exactly these files (e.g. the acceptance tests written before the code), whatever
  // edits_tests says, so the agent may still add and edit its own tests.
  async sendToAgent(agentName, prompt, opts = {}) {
    const agent = { ...(this.wf.defaults || {}), ...this.wf.agents[agentName] };
    const guarded = !!this.wf.agents[agentName] && (opts.editsTests ?? agent.edits_tests) === false;
    const dir = guarded ? this.workingDir(agent) : null;
    const snap = guarded ? await testPaths.snapshot(dir, this.wf.tests_paths)
      .catch((e) => { throw new Error(`Could not snapshot the test files before ${agentName}'s turn in ${opts.stepId || 'a delegated turn'} (edits_tests: false): ${e.message}`); }) : null;
    const protect = this.wf.agents[agentName] ? renderFileList(opts.protectFiles ?? agent.protect_files, this.ctx) : [];
    const psnap = protect.length ? await testPaths.snapshot(this.workingDir(agent), protect)
      .catch((e) => { throw new Error(`Could not snapshot the protected files before ${agentName}'s turn in ${opts.stepId || 'a delegated turn'} (protect_files): ${e.message}`); }) : null;
    let res = await this.agentTurn(agentName, prompt, { ...opts, guarded, protect });
    res = await this.serveTestRequests(agentName, prompt, res, { ...opts, guarded, protect });
    for (let attempt = 1; snap; attempt++) {
      // an unchecked turn fails the step: passing it would let test changes through the guard
      const files = await testPaths.changedTestFiles(snap, { bases: this.baseRefs() })
        .catch((e) => { throw new Error(`Could not check the test files changed by ${agentName} in ${opts.stepId || 'a delegated turn'} (edits_tests: false): ${e.message}`); });
      if (!files.length) break;
      const stepId = opts.stepId || 'a delegated turn';
      this.emitEvent('tests.refused', { agent: agentName, step_id: opts.stepId || null, files, attempt });
      this.emitEvent('log', { level: 'warn', kind: 'tests_refused', agent: agentName, message: `[${agentName}] changed test files in ${stepId}, which it may not edit (edits_tests: false): ${files.join(', ')}` });
      if (attempt > 2) throw new Error(`${agentName} changed test files in ${stepId} and did not put them back: ${files.join(', ')}. Only the test writer edits tests.`);
      res = await this.agentTurn(agentName, this.testsRefusedPrompt(agentName, prompt, res.text, files, snap.head), { ...opts, guarded, protect, retry: true });
    }
    for (let attempt = 1; psnap; attempt++) {
      const files = await testPaths.changedTestFiles(psnap, { bases: this.baseRefs() })
        .catch((e) => { throw new Error(`Could not check the protected files changed by ${agentName} in ${opts.stepId || 'a delegated turn'} (protect_files): ${e.message}`); });
      if (!files.length) break;
      const stepId = opts.stepId || 'a delegated turn';
      this.emitEvent('tests.refused', { agent: agentName, step_id: opts.stepId || null, files, attempt, protected: true });
      this.emitEvent('log', { level: 'warn', kind: 'protected_refused', agent: agentName, message: `[${agentName}] changed protected files in ${stepId} (protect_files): ${files.join(', ')}` });
      if (attempt > 2) throw new Error(`${agentName} changed protected files in ${stepId} and did not put them back: ${files.join(', ')}.`);
      res = await this.agentTurn(agentName, this.protectedRefusedPrompt(agentName, prompt, res.text, files, psnap.head), { ...opts, guarded, protect, retry: true });
    }
    return res;
  },

  // opts.attachments: images for this turn ([{ name, path }] in the run folder, #129); a provider that
  // cannot open images still gets their paths, with one warning per step and agent.
  async agentTurn(agentName, prompt, turnOpts = {}) {
    // continued: { after, cuts } when this turn continues a visit whose previous turn was cut by its budget (#302)
    const { stepId, skills: stepSkills = [], capabilities: stepCaps, retry = false, guarded = false, attachments = [], continued = null } = turnOpts;
    let { hint } = turnOpts;
    const def = this.wf.agents[agentName];
    if (!def) throw new Error(`Unknown agent: ${agentName}`);
    const agent = { ...(this.wf.defaults || {}), ...def };
    const mode = agent.session || 'persistent';
    const persistent = mode === 'persistent';
    // agent skills go in the system prompt (1st turn); step skills, in the step prompt
    const agentSkills = this.loadSkills((agent.skills || []).map((n) => render(n, this.ctx).trim()));
    // #302: the turn's request budget (an empty templated value: none)
    const budgetText = agent.max_requests === undefined ? '' : render(String(agent.max_requests), this.ctx).trim();
    const budget = budgetText ? parseRequests(budgetText) : null;
    if (budgetText && !budget) throw new Error(`Agent "${agentName}": max_requests must be a whole number of model requests such as 40 (got "${budgetText}").`);

    // the conversation grew above max_context in its last turn: continue in a fresh one
    if (persistent && !retry && this.rotate.has(agentName)) {
      this.rotate.delete(agentName);
      const old = this.sessions.get(this.agentSessions.get(agentName));
      if (old) this.closeSession(old, 'success');
      this.agentSessions.delete(agentName);
    }
    // #247 `fresh_after_idle` (e.g. 55m, the prompt cache's lifetime): a persistent agent idle longer
    // than that (a long gate wait) continues in a fresh session from its handoff note; resuming would
    // rewrite its whole context at the cache-write price (the lesson of #244)
    const idleMax = persistent && !retry && agent.fresh_after_idle !== undefined ? parseDuration(agent.fresh_after_idle, null) : null;
    const warm = idleMax ? this.sessions.get(this.agentSessions.get(agentName)) : null;
    if (warm?.lastTurnAt && Date.now() - warm.lastTurnAt > idleMax && this.handoffNotes.has(agentName)) {
      this.closeSession(warm, 'success');
      this.agentSessions.delete(agentName);
      this.emitEvent('log', {
        level: 'info', kind: 'idle_rotation', agent: agentName, step_id: stepId,
        message: `[${agentName}] idle for ${Math.round((Date.now() - warm.lastTurnAt) / 60e3)} min (fresh_after_idle ${agent.fresh_after_idle}): this turn starts a fresh session from its handoff note`,
      });
    }
    let session = persistent ? this.sessions.get(this.agentSessions.get(agentName)) : null;
    if (!session) {
      // #262: the first session after a fallback records what it fell back from
      const fallback = this.fallbackAt.get(agentName);
      session = this.openSession({
        agent: agentName, provider: this.mock ? 'mock' : agent.provider, model: agent.model, effort: agent.effort || null,
        parentId: this.orchestrator.id, stepId, mode, simulates: this.mock ? agent.provider : null, fallbackFrom: fallback?.pending || null,
      });
      if (fallback) fallback.pending = null;
      if (persistent) this.agentSessions.set(agentName, session.id);
      // #320: shown in the session's cache state (a fresh session from the note past this idle time)
      if (persistent && agent.fresh_after_idle !== undefined) session.freshAfterIdleMs = parseDuration(agent.fresh_after_idle, null);
      this.resumeSession(agentName, session, persistent);
    }

    const turn = ++session.turns;
    const wantNote = mode !== 'ephemeral' && !retry;
    // a fresh session of an agent that already worked in this run (or the run it resumes) starts from its note
    const note = turn === 1 ? this.handoffNotes.get(agentName) : null;
    const parts = [];
    const caps = capabilities.merge(agent.capabilities, stepCaps);
    // agents with commands: the folders they may write to, and how to run commands unattended
    const runDirs = capabilities.runDirs(caps, this.runDir);
    for (const dir of runDirs) fs.mkdirSync(dir, { recursive: true });
    const agentEnv = capabilities.agentEnv(this.scratchWorkspace());
    const shotsDir = hint?.visit ? evidence.roundDir(this.runDir, stepId, hint.visit) : null;
    const commands = capabilities.commandGuide(caps, this.runDir, agentEnv, shotsDir);
    const guide = commands && [commands, this.depsGuide()].filter(Boolean).join('\n');
    // node_modules linked from the shared cache (#198): Claude refuses `npm ci` and deleting it
    const depsLinked = !!this.deps?.worktree?.entry;
    if (turn === 1 && (agent.system_prompt || agentSkills.length || guide)) {
      const system = [render(agent.system_prompt, this.ctx).trim(), guide, ...agentSkills.map((sk) => skillPrompt(sk, agentName))].filter(Boolean).join('\n\n');
      parts.push(`<system>\n${system}\n</system>`);
    }
    if (note && continued) {
      parts.push(`<handoff_note>\n${note.text}\n</handoff_note>\nThis step continues in a fresh session: continued after ${continued.after} requests; your note is above`
        + ` (your turn reached its request budget). The code is in git: re-read only the files you need.`);
    } else if (note) {
      parts.push(`<handoff_note>\n${note.text}\n</handoff_note>\nThis is a fresh session. The note above is what you wrote at the end of your previous turn in this run`
        + ` (step ${note.step}, visit ${note.visit}). The code is in git: re-read only the files you need.`);
    }
    // #276: what the memory guard stopped during this agent's previous turn, so it is not rerun unchanged
    const stops = this.memoryNotes.get(agentName);
    if (stops?.length) {
      this.memoryNotes.delete(agentName);
      parts.push(stops.map((s) => `The orchestrator stopped \`${s.commandLine}\` at ${gib(s.bytes)} GB for passing the memory limit`
        + ` (${gib(s.limitBytes)} GB per process). Do not run it again unchanged: find why it grows (e.g. a failing assertion that formats a huge object) or run a smaller part of it.`).join('\n'));
    }
    parts.push(wantNote ? `${prompt}\n\n---\n${HANDOFF_INSTRUCTIONS}` : prompt);
    const fullPrompt = parts.join('\n\n');

    const provider = this.mock ? { type: 'mock' } : this.wf.providers?.[agent.provider];
    // capabilities + isolation → this CLI's flags (see capabilities.js); cli_args still apply on top
    const providerType = this.wf.providers?.[agent.provider]?.type;
    const isolated = agent.isolation !== false;
    const denyEdits = guarded ? this.wf.tests_paths || testPaths.TESTS_PATHS : [];
    const denyCommands = depsLinked ? capabilities.DEPS_DENIED_COMMANDS : [];
    const { args: capArgs, notes } = capabilities.providerArgs(providerType, { caps, isolated, mcpServers: this.wf.mcp_servers || {}, denyEdits, denyCommands, runDir: runDirs.length ? this.runDir : null, env: agentEnv });
    // #302: only Claude Code can stop a turn after n requests (--max-turns)
    const enforced = budget && providerType === 'claude-code';
    if (budget && providerType && !enforced) notes.push(`max_requests (${budget}) not enforceable: ${providerType} has no request limit per turn`);
    const capsKey = `${agentName}|${capabilities.describe(caps)}|${guarded}`;
    if (!this.capsLogged.has(capsKey)) {
      this.capsLogged.add(capsKey);
      this.emitEvent('log', {
        level: 'info', kind: 'capabilities', agent: agentName,
        message: `capabilities: ${agentName} (${providerType || agent.provider}, ${isolated ? 'isolated' : 'not isolated'}): ${capabilities.describe(caps, providerType || agent.provider)}${guarded ? ' · test files: not editable' : ''}${notes.length ? ` · not enforced: ${notes.join('; ')}` : ''}`,
      });
    }
    // The provider's `skill_args` grants read access to each skill's folder, which lives
    // outside the working_dir (e.g. claude --add-dir <folder>), and to the folders it `reads` (#300). Every turn.
    const skillDirs = [...new Set([...agentSkills, ...stepSkills].flatMap((sk) => [sk.path, ...(sk.reads || []).map((r) => r.path)]))];
    const skillArgs = skillDirs.flatMap((dir) => (provider?.skill_args || []).map((a) => render(a, { skill_dir: dir })));
    // cli_args may be keyed by provider when the provider is picked at run time
    const cliArgs = Array.isArray(agent.cli_args) ? agent.cli_args : agent.cli_args?.[agent.provider] || [];
    const baseArgs = capabilities.dedupeFlags([...capArgs, ...cliArgs, ...skillArgs], provider?.args || []);
    // a --max-turns of the provider or cli_args wins over the budget
    const ownLimit = [...baseArgs, ...(provider?.args || [])].includes('--max-turns');
    const limitArgs = (n) => (enforced && !ownLimit ? ['--max-turns', String(n)] : []);
    const extraArgs = [...baseArgs, ...limitArgs(budget)];

    const visit = this.ctx.steps[String(stepId).split(':')[0]]?.visits || 0;
    // the agent's own provider (not `mock`): the simulation's usage_limits match it (#262)
    // maxRequests: the enforced budget (the simulation's request_budget ends a turn on it)
    hint = { ...(hint || { stepId, visit }), handoff: wantNote, provider: agent.provider, providerType, maxRequests: enforced && !ownLimit ? budget : null };
    // simulation: which answer of this step this is (mockSequences.invalid_answers: { step: n } makes the first n invalid)
    if (this.mock) { this.mockCalls ??= {}; hint.call = this.mockCalls[hint.stepId] = (this.mockCalls[hint.stepId] || 0) + 1; }

    const imagesKey = `${stepId}|${agentName}`;
    // the configured provider's type, so a simulation warns like the real run would
    if (attachments.length && !imageInput(providerType || provider?.type) && !this.imagesWarned.has(imagesKey)) {
      this.imagesWarned.add(imagesKey);
      this.emitEvent('log', {
        level: 'warn', kind: 'attachments_unsupported', step_id: stepId, agent: agentName, provider: providerType || agent.provider,
        message: `[${agentName}] ${stepId}: ${providerType || agent.provider} cannot open attached images; it only gets their paths (${attachments.map((f) => f.name).join(', ')})`,
      });
    }
    const call = { session, agentName, agent, provider, extraArgs, agentEnv, stepId, hint, attachments };
    let res;
    try {
      res = await this.invokeTurn(call, turn, fullPrompt);
    } catch (e) {
      // #262: out of credits / past its usage limit: the turn moves on to the next entry of the agent's
      // fallback chain, in a fresh session (from its handoff note), and the agent stays there for the run
      const next = !this.abort.signal.aborted && isQuotaError(providerType, e.message) ? this.nextFallback(agentName, agent) : null;
      if (persistent && !next) this.setStatus(session, 'error');
      else this.closeSession(session, 'failed');
      if (!next) throw e;
      if (persistent) this.agentSessions.delete(agentName);
      const from = `${agent.provider}:${agent.model}`;
      Object.assign(def, { provider: next.provider, model: next.model });
      this.ctx.agents[agentName] = { provider: next.provider, model: next.model };
      this.fallbackAt.get(agentName).pending = { from, reason: e.message };
      this.emitEvent('agent.fallback',{ agent: agentName, step_id: stepId, from, to: `${next.provider}:${next.model}`, reason: e.message });
      return this.agentTurn(agentName, prompt, turnOpts);
    }

    // metrics: context at the start and peak of the turn, tokens, and whether they were wasted
    const rec = {
      agent: agentName, step: stepId, visit, session: session.id, mode, fresh: turn === 1,
      context_start: res.context.start, context_peak: res.context.peak,
      tokens: totalTokens(res.usage), cost_usd: (res.costUsd || 0) + (res.stoppedCostUsd || 0), subagent_calls: res.tools.subagents || 0,
      waste: res.tools.ran === 0 && res.tools.denials > 0 ? 'refused' : null,
    };
    this.turnLog.push(rec);
    res.turnRec = rec;
    session.lastTurnAt = Date.now();
    if (res.cut) return this.continueAfterCut({ call: { ...call, extraArgs: [...baseArgs, ...limitArgs(WRAP_UP_REQUESTS)] }, rec, res, budget, prompt, turnOpts });
    const max = persistent && !retry ? parseTokens(render(String(agent.max_context ?? ''), this.ctx)) : null;
    if (max && res.context.peak > max) {
      this.rotate.add(agentName);
      this.emitEvent('log', {
        level: 'info', kind: 'context_rotation', agent: agentName, step_id: stepId, context: res.context.peak, max_context: max,
        message: `[${agentName}] context reached ${kTokens(res.context.peak)} (max_context ${kTokens(max)}): its next turn starts a fresh session from its handoff note`,
      });
    }
    if (wantNote) {
      const needed = mode === 'handoff' || this.rotate.has(agentName);
      let text = res.handoff;
      if (!text && needed) text = await this.requestHandoffNote(call, rec);
      let fallback = false;
      if (!text && needed) {
        fallback = true;
        text = `- (No handoff note: the agent did not write one.)\n- Its last answer (step ${stepId}), shortened:\n\n${String(res.text || '').slice(0, 1500)}`;
      }
      if (text) this.saveHandoff({ agentName, stepId, visit, session, text, fallback });
    }
    if (!persistent) this.closeSession(session, 'success');
    // #320: the snapshot after the whole turn (its note saved, its last request done)
    else this.emitEvent('session.updated', { session_id: session.id, session: this.snapshot(session) });
    return res;
  },

  // A turn that ended without its note, when the next one needs it: one cheap follow-up in the
  // same provider conversation asking only for the note.
  async requestHandoffNote(call, rec, ask = HANDOFF_ONLY) {
    const { session } = call;
    if (!session.providerSessionId) return null;
    try {
      const res = await this.invokeTurn({ ...call, hint: { ...call.hint, handoffOnly: true }, attempts: 1, attachments: [] }, ++session.turns, ask);
      rec.tokens += totalTokens(res.usage);
      rec.cost_usd += (res.costUsd || 0) + (res.stoppedCostUsd || 0);
      const plain = String(res.text || '').trim();
      return res.handoff || (plain && !plain.includes('```') ? plain.slice(0, 4000) : null);
    } catch (e) {
      session.status = 'idle';
      this.emitEvent('log', { level: 'warn', message: `[${call.agentName}] could not get a handoff note: ${e.message}` });
      return null;
    }
  },

  // #302: a turn that ended on its request budget (max_requests) produces no output: one wrap-up
  // request in the same conversation (commit, then the note; its cost is the cut turn's), then the
  // same step visit continues in a fresh session from that note. Not an attempt, a retry or a stall;
  // the MAX_CUTS-th cut of a visit fails the step.
  async continueAfterCut({ call, rec, res, budget, prompt, turnOpts }) {
    const { session, agentName, stepId } = call;
    const cuts = (turnOpts.continued?.cuts || 0) + 1;
    Object.assign(rec, { cut: true, requests: res.requests });
    this.emitEvent('log', {
      level: 'info', kind: 'context_budget', agent: agentName, step_id: stepId, requests: res.requests, max_requests: budget, context_peak: res.context.peak ?? 0,
      message: `[${agentName}] ${stepId}: the turn reached its request budget (${res.requests} requests, context ${kTokens(res.context.peak ?? 0)}): it wraps up and the step continues in a fresh session (cut ${cuts}/${MAX_CUTS})`,
    });
    const note = await this.requestHandoffNote(call, rec, WRAP_UP);
    // Stop pressed during the wrap-up: no continuation
    if (this.abort.signal.aborted) { this.closeSession(session, 'failed'); throw new Error('Cancelled'); }
    const text = note || `- (No handoff note: the turn was cut after ${res.requests} requests and its wrap-up wrote none.)\n- Re-read \`git status\` and \`git log\` to see where it stopped.`;
    this.saveHandoff({ agentName, stepId, visit: rec.visit, session, text, fallback: !note });
    this.closeSession(session, 'success');
    if (this.agentSessions.get(agentName) === session.id) this.agentSessions.delete(agentName);
    this.rotate.delete(agentName);
    if (cuts >= MAX_CUTS) throw new Error(`[${agentName}] ${stepId}: the budget was reached ${MAX_CUTS} times in one visit (max_requests ${budget}): the step stops.`);
    const next = await this.agentTurn(agentName, prompt, { ...turnOpts, continued: { after: res.requests, cuts } });
    next.cutRecs = [rec, ...(next.cutRecs || [])];
    return next;
  },

  // runs/<id>/handoffs/<step>-v<visit>-<agent>.md, one per turn (a second turn of the same visit,
  // e.g. a delegation, gets -2, -3...). The latest one per agent starts its next fresh session.
  saveHandoff({ agentName, stepId, visit, session, text, fallback }) {
    const dir = path.join(this.runDir, 'handoffs');
    const base = `${String(stepId).replace(/[^A-Za-z0-9_.-]+/g, '-')}-v${visit}-${agentName}`;
    let file = path.join(dir, `${base}.md`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base}-${n}.md`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, `# Handoff note: ${agentName}\n\n_Step ${stepId}, visit ${visit}, session ${session.id}, ${new Date().toISOString()}_\n\n${text.trim()}\n`);
    this.handoffNotes.set(agentName, { text: text.trim(), step: stepId, visit, path: file });
    this.emitEvent('handoff.saved', { agent: agentName, step_id: stepId, visit, session_id: session.id, path: file, note: text.trim(), fallback: fallback || undefined });
  },
};

module.exports = {
  BUNDLED_SKILLS,
  methods,
  OUTPUT_LANGUAGE,
};
