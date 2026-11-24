// The orchestrator's AI supervisor (skill: run-supervisor).
//
// The engine stays deterministic; the supervisor is only called
// - by the engine, when a step fails during a run (packages/engine/engine/workflow.js, superviseFailure):
//   it explains the failure and picks a recovery the engine validates; and when an agent is silent
//   while a command waits (superviseIdle): keep waiting, or interrupt the turn and retry the step;
//   and when a transition's action or pre-merge check fails (superviseActionError): go back to a
//   recovery step with an instruction, or escalate to the failure gate with a diagnosis;
//   and on call (superviseEscalation / superviseStall, onCallPrompt): before an escalation gate
//   (`kind: escalation`) asks the person about a problem, and on a stall the engine detected (the same
//   output N times, refused tool calls, a slow step): retry or resume a step with an instruction, route
//   the gate, ask the person for an action only they can take, or escalate with a diagnosis;
// - by a person, from the UI, for any run (analyzeRun): it explains what happened and recommends
//   actions such as resuming the run from a step (resumeSpec) with an instruction;
// - by a person, from Analytics, on the sessions of a date range (analyzeSessions): a report on what
//   they were used for, their complexity, patterns and suggestions;
// - by a person who watches a running run (packages/engine/domains/supervisor/supervisor-watch.js): updates in a chat on each batch
//   of meaningful events (timelineLine), and answers in the same conversation.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const registry = require('@craftorio/shared/providers');
const Language = require('@craftorio/shared/language');

// The supervisor's words reach the person and decisions.tsv, and its instructions reach the agents, so
// the language is pinned instead of following the task's (#94, #121): English, or the AI agents
// language of Settings › Language when the engine gives it (#327: the [Language] line, then this).
const WRITE_ENGLISH = 'Write your explanation, record, recommendation and instructions in English (the app\'s language), whatever language the task, the workflow or the person\'s messages use.';
const writeIn = (language) => (language
  ? `${Language.languageLine({ language })}\nWrite your explanation, record, recommendation and instructions in the language the Language line names for chat replies and prose, whatever language the task, the workflow or the person's messages use.`
  : WRITE_ENGLISH);

// Decision taken during a run. `retry` first: it is the mock provider's default.
const DECISION_SCHEMA = {
  type: 'object',
  required: ['explanation', 'action'],
  properties: {
    explanation: { type: 'string' },
    cause_class: { type: 'string', enum: ['format', 'instruction', 'context', 'environment', 'capability', 'workflow'] },
    action: { type: 'string', enum: ['retry', 'fix_output', 'goto', 'ask_human', 'fail'] },
    instruction: { type: 'string' },
    output: {},
    goto: { type: 'string' },
    // #380: with ask_human, a retry would fail the same way (e.g. the prompt and a guard contradict
    // each other): the gate offers `goto` (a way forward) instead of Retry
    retry_would_fail: { type: 'boolean' },
  },
};

// Decision on an agent silent while a command waits (agent_idle). `wait` first: the mock's default,
// and the safe one (a long foreground build prints nothing until it ends).
const IDLE_SCHEMA = {
  type: 'object',
  required: ['explanation', 'action'],
  properties: {
    explanation: { type: 'string' },
    action: { type: 'string', enum: ['wait', 'interrupt'] },
    instruction: { type: 'string' },
  },
};

// Decision on a failed transition action (a merge, a deploy command) or a pre-merge check, when the
// transition names recovery steps (`recover:`). `goto` first: the mock's default, the known conflict case.
// `goto` is limited to those steps; `escalate` sends the run to the transition's failure gate.
const actionSchema = (recover) => ({
  type: 'object',
  required: ['explanation', 'action'],
  properties: {
    explanation: { type: 'string' },
    cause_class: { type: 'string', enum: ['conflict', 'not_ready', 'environment', 'unknown'] },
    action: { type: 'string', enum: ['goto', 'escalate'] },
    goto: { type: 'string', enum: recover },
    instruction: { type: 'string' },
  },
});

// Decision of the supervisor on call (#41), before a person is asked about a problem: at an
// escalation gate (`kind: escalation`) or on a stall the engine detected. The first action is the
// mock's default and the safe one: `escalate` shows the gate with the diagnosis, `continue` lets the
// run go on as planned. `step` is limited to the agent steps the run already went through, `route`
// to the gate's own answers. At a gate, `recommend` (one of `answers`: approve / reject or a choice
// id), `recommendation` (why, one line) and `options` (up to 3) are what the person's card shows (#213).
/** @param {{ actions: string[], steps?: string[], routes?: string[], answers?: string[] }} options */
const onCallSchema = ({ actions, steps = [], routes = [], answers = [] }) => ({
  type: 'object',
  required: ['explanation', 'action'],
  properties: {
    explanation: { type: 'string' },
    cause_class: { type: 'string', enum: ['environment', 'permissions', 'instruction', 'capability', 'code', 'workflow', 'unknown'] },
    action: { type: 'string', enum: actions },
    instruction: { type: 'string' },
    step: steps.length ? { type: 'string', enum: steps } : { type: 'string' },
    ...(routes.length ? { route: { type: 'string', enum: routes } } : {}),
    user_action: { type: 'string' },
    ...(answers.length ? { recommend: { type: 'string', enum: answers } } : {}),
    recommendation: { type: 'string' },
    ...(answers.length ? { options: { type: 'array', maxItems: 3, items: { type: 'string' } } } : {}),
  },
});
const ESCALATION_ACTIONS = ['escalate', 'retry', 'resume', 'route', 'user_action'];
const STALL_ACTIONS = ['continue', 'retry', 'resume', 'user_action'];
// A step still running far longer than usual: it keeps running, or its turn is stopped and run again.
const SLOW_ACTIONS = ['wait', 'interrupt', 'user_action'];

// Analysis asked for by a person.
const ANALYSIS_SCHEMA = {
  type: 'object',
  required: ['summary', 'root_cause', 'recommendations'],
  properties: {
    summary: { type: 'string' },
    root_cause: { type: 'string' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'action'],
        properties: {
          title: { type: 'string' },
          action: { type: 'string', enum: ['resume', 'rerun', 'none'] },
          step: { type: 'string' },
          instruction: { type: 'string' },
        },
      },
    },
  },
};

const clip = (s, n) => { s = String(s ?? ''); return s.length > n ? `${s.slice(0, n)}\n… (${s.length - n} more characters)` : s; };
const tail = (s, n) => { s = String(s ?? ''); return s.length > n ? `… (${s.length - n} earlier characters)\n${s.slice(-n)}` : s; };

function readEvents(runDir) {
  try {
    return fs.readFileSync(path.join(runDir, 'events.jsonl'), 'utf8').split('\n')
      .map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

/** One line per meaningful event: the run's timeline as the supervisor reads it. */
function timelineLine(ev) {
  const t = String(ev.ts || '').slice(11, 19);
  switch (ev.type) {
    case 'workflow.started': return `${t} workflow ${ev.workflow} ${ev.version || ''} started${ev.resumed_from ? ` (resumed from ${ev.resumed_from.run_id} at ${ev.resumed_from.step})` : ''}`;
    case 'step.started': return `${t} ▶ ${ev.step_id} (visit ${ev.visit}${ev.agent ? `, ${ev.agent}` : ''})`;
    case 'step.finished': return `${t} ✓ ${ev.step_id}${ev.error ? ' FAILED' : ''}: ${clip(JSON.stringify(ev.output), 400)}`;
    case 'step.transition': return `${t} → ${ev.to} [${ev.when}]`;
    case 'approval.requested': return `${t} ? human approval at ${ev.step_id}: ${clip(ev.message, 200)}`;
    case 'approval.resolved': return ev.withdrawn ? `${t}   approval withdrawn by the engine's check: ${ev.reason}` : `${t}   human decided: ${ev.choice ?? (ev.approved ? 'approved' : 'rejected')}`;
    case 'log': return ev.level === 'info' ? null : `${t} [${ev.level}] ${clip(ev.message, 500)}`;
    case 'supervisor.decision': return `${t} supervisor on ${ev.step_id}: ${ev.action}${ev.goto ? ` → ${ev.goto}` : ''} — ${clip(ev.record || ev.explanation, 300)}`;
    case 'budget.exceeded': return `${t} budget exceeded for ${ev.provider}`;
    case 'workflow.finished': return `${t} ■ ${ev.status}${ev.error ? `: ${ev.error}` : ''}`;
    default: return null;
  }
}
const timeline = (events, max = 80) => events.map(timelineLine).filter(Boolean).slice(-max).join('\n');

/** Prompt for a decision on a failed step (engine-side). */
function decisionPrompt({ wf, step, error, answer, allowed, events, previous, handoffs, language }) {
  const def = { ...step };
  const stepYaml = yaml.dump(def, { lineWidth: 120 }).trim();
  return [
    `A step of the workflow "${wf.metadata?.name}" failed. Decide how the engine should recover, following the run-supervisor skill.`,
    wf.metadata?.description ? `Workflow: ${wf.metadata.description}` : '',
    `\n## Failing step\n\`\`\`yaml\n${clip(stepYaml, 6000)}\n\`\`\``,
    `\n## Error\n${clip(error, 3000)}`,
    answer ? `\n## The agent's last answer\n<answer>\n${tail(answer, 15000)}\n</answer>` : '\n## The agent\'s last answer\n(none: the agent did not answer)',
    previous?.length ? `\n## Your previous interventions on this step\n${previous.map((p, i) => `${i + 1}. ${p.action}: ${p.explanation}`).join('\n')}` : '',
    handoffs?.length ? `\n## The agents' handoff notes (their own summary of where they are, latest turn)\n${handoffs.map((h) => `### ${h.agent} (step ${h.step}, visit ${h.visit})\n${clip(h.text, 3000)}`).join('\n\n')}` : '',
    `\n## Recent timeline\n${timeline(events, 40) || '(empty)'}`,
    `\n## Your options (the engine validates them)`,
    `- fix_output: put in \`output\` the step's output rebuilt ONLY from the agent's answer above; it must validate against the step's output_schema${step.agents ? ' (not available for parallel steps)' : ''}.`,
    '- retry: run the step again; `instruction` is added to the agent\'s prompt.',
    `- goto: continue at one of these steps: ${allowed.length ? allowed.join(', ') : '(none)'}.`,
    '- ask_human: stop and ask the person (explain what they need to decide or change). When a retry would fail the same way (e.g. the prompt and a guard contradict each other), set `retry_would_fail: true` and put in `goto` the step of the list above to resume from: the person is offered that instead of a retry.',
    '- fail: end the run.',
    writeIn(language),
  ].filter(Boolean).join('\n');
}

/** Prompt for a decision on a failed transition action or pre-merge check (engine-side). */
function actionErrorPrompt({ wf, step, error, check, recover, gate, events, handoffs, language }) {
  return [
    `The action of a transition of the workflow "${wf.metadata?.name}" failed (step "${step.id}"). Decide where the run goes, following the run-supervisor skill.`,
    wf.metadata?.description ? `Workflow: ${wf.metadata.description}` : '',
    `\n## Error\n${clip(error, 3000)}`,
    check ? `\n## PR/MR state checked by the engine\n${check.state}: ${check.detail}` : '',
    handoffs?.length ? `\n## The agents' handoff notes (their own summary of where they are, latest turn)\n${handoffs.map((h) => `### ${h.agent} (step ${h.step}, visit ${h.visit})\n${clip(h.text, 3000)}`).join('\n\n')}` : '',
    `\n## Recent timeline\n${timeline(events, 40) || '(empty)'}`,
    `\n## Your options (the engine validates them)`,
    `- goto: a case you recognize that the workflow's agents can fix (e.g. the PR/MR conflicts with its base because another change was merged meanwhile): go back to one of ${recover.join(', ')}; \`instruction\` is added to that step's prompt. Give the evidence (the error text, the PR/MR state), never a code fix. The change goes through its checks and the human approval again.`,
    `- escalate: an unknown case, or one no agent can fix (permissions, the platform down): the run stops at the gate "${gate}", where the person sees your \`explanation\` as the diagnosis.`,
    writeIn(language),
  ].filter(Boolean).join('\n');
}

/** Prompt for a decision on an agent that has been silent while a command waits (engine-side). */
function idlePrompt({ wf, step, agent, idle, events, handoffs, language }) {
  const minutes = Math.round(idle.idle_ms / 6e3) / 10;
  return [
    `An agent of the workflow "${wf.metadata?.name}" has produced no output for ${minutes} minutes while a command is waiting. Decide whether the engine should keep waiting or interrupt the agent's turn, following the run-supervisor skill.`,
    `\n## Step\n${step.id} (agent ${agent})`,
    `\n## The command it is waiting on (${idle.tool})\n\`\`\`\n${clip(idle.command, 1000)}\n\`\`\``,
    handoffs?.length ? `\n## The agents' handoff notes (their own summary of where they are, latest turn)\n${handoffs.map((h) => `### ${h.agent} (step ${h.step}, visit ${h.visit})\n${clip(h.text, 3000)}`).join('\n\n')}` : '',
    `\n## Recent timeline\n${timeline(events, 40) || '(empty)'}`,
    `\n## Your options`,
    '- wait: the command can plausibly still finish (a long build or test suite in the foreground prints nothing until it ends).',
    '- interrupt: the wait cannot end on its own (polling for a text that may never appear, a background job with no exit check, an interactive prompt); the engine stops this turn and runs the step again with `instruction` added to the agent\'s prompt. Describe the evidence and what to do instead (e.g. run the command in the foreground with a timeout and read its exit code); never prescribe a code fix.',
    writeIn(language),
  ].filter(Boolean).join('\n');
}

/**
 * Prompt for the supervisor on call (engine-side): the run would stop to ask the person about a
 * problem (an escalation gate) or the engine detected a stall (`signals`). It tries to solve it first.
 * history: [{ step, visits, output }] of the steps the run went through.
 * gate.decision: a decision gate reached because a loop ran out (no `route`: only the person answers it).
 * running: the step is still running (a slow step): wait, interrupt its turn, or ask the person.
 */
function onCallPrompt({ wf, step, gate, signals, retryStep, steps, history, previous, events, handoffs, limits, running, language }) {
  const routes = gate?.routes || [];
  let intro = `The engine detected that the step "${step.id}" of the workflow "${wf.metadata?.name}" may be stuck. You are the supervisor on call: decide whether the run goes on as planned or how to unblock it, following the run-supervisor skill.`;
  if (gate?.decision) intro = `The workflow "${wf.metadata?.name}" reached the human gate "${step.id}" because a loop ran out of iterations. It is a decision gate: only the person answers it, but you are the supervisor on call: if the evidence shows the agents can still solve the problem, send the run back to them first, following the run-supervisor skill. Otherwise the gate opens for the person with your diagnosis.`;
  else if (gate) intro = `The workflow "${wf.metadata?.name}" reached the escalation gate "${step.id}": it would stop and ask the person about a problem. You are the supervisor on call: try to solve it first, following the run-supervisor skill. The person is only asked when you cannot, and then with your diagnosis.`;
  else if (running) intro = `The step "${step.id}" of the workflow "${wf.metadata?.name}" is still running, far longer than its usual duration. You are the supervisor on call: decide whether it keeps running or its turn is stopped, following the run-supervisor skill.`;
  let first = '- continue: nothing is stuck (e.g. the same answer is expected); the run goes on as planned.';
  if (gate) {
    first = '- escalate: you cannot solve it; the gate opens for the person with your diagnosis.'
      + `\n\nWrite the diagnosis for the owner, not for an agent (whatever your action, in case the gate opens): \`recommend\` is the button you advise (one of ${(gate.answers || []).join(', ') || 'the gate\'s answers'}); \`recommendation\` says why in plain words, one sentence under 25 words; \`options\` lists up to 3 alternatives, each one short sentence a person can act on; \`explanation\` holds the details (evidence, causes). The gate's card shows only the recommendation and the options; the explanation goes in its Details.`;
  }
  else if (running) first = '- wait: the step can plausibly still finish (a long build, a large change); it keeps running and you may be asked again later.';
  return [
    intro,
    wf.metadata?.description ? `Workflow: ${wf.metadata.description}` : '',
    gate ? `\n## What the gate would ask the person\n${clip(gate.message, 4000)}\n\nThe gate's answers and where they lead:\n${gate.transitions || '(none)'}` : '',
    signals?.length ? `\n## Stall signals (deterministic, from the engine)\n${signals.map((s) => `- ${s.step || step.id}: ${s.kind}: ${s.detail}`).join('\n')}` : '',
    history?.length ? `\n## Step history (visits and latest output)\n${history.map((h) => `- ${h.step} (${h.visits} visit${h.visits === 1 ? '' : 's'}): ${clip(JSON.stringify(h.output), 500)}`).join('\n')}` : '',
    previous?.length ? `\n## Your previous interventions here\n${previous.map((p, i) => `${i + 1}. ${p.action}: ${p.explanation}`).join('\n')}` : '',
    handoffs?.length ? `\n## The agents' handoff notes (their own summary of where they are, latest turn)\n${handoffs.map((h) => `### ${h.agent} (step ${h.step}, visit ${h.visit})\n${clip(h.text, 3000)}`).join('\n\n')}` : '',
    `\n## Recent timeline\n${timeline(events, 60) || '(empty)'}`,
    limits ? `\n## Your limits\n${limits}` : '',
    '\n## Your options (the engine validates them)',
    first,
    running ? '- interrupt: the step cannot end on its own (a hung process, a wait that never ends, an agent going in circles); the engine stops its running turn and runs the step again with `instruction` added to its agent\'s prompt.' : '',
    retryStep && !running ? `- retry: run "${retryStep}" again; \`instruction\` is added to its agent's prompt.` : '',
    running ? '' : `- resume: continue at one of these steps: ${steps.length ? steps.join(', ') : '(none)'}; \`step\` names it and \`instruction\` is added to its agent's prompt.`,
    gate && routes.length ? `- route: answer the gate yourself with \`route\` (one of ${routes.join(', ')}), only when the evidence shows that answer is what the problem calls for (e.g. the failure is not caused by the run's change).` : '',
    running
      ? '- user_action: only the person can unblock it (a process to stop, a permission to grant, a login): put the exact command or step in `user_action`; the person is told while the step keeps running.'
      : '- user_action: the fix is outside the run\'s permissions (a process to stop, a permission to grant, a login): put the exact command or step the person must take in `user_action`; the person is asked with it.',
    'Rules: never prescribe a code fix and never edit code; a problem in the code goes back to the workflow\'s agents (retry/resume) with the evidence and your hypotheses in `instruction`. A problem in how an agent works (refused commands, a wrong tool, a wait that never ends) gets a concrete instruction (e.g. call the gh CLI directly in the Bash tool).',
    writeIn(language),
  ].filter(Boolean).join('\n');
}

// The run's workflow file (runs record its basename). workflowsDir: a folder or a list of folders
// searched in order (workspace first, then the bundled defaults). Throws if it is gone.
// Not projectWorkflowFile (#799): a domain has no service ctx, and a workflow only the repository
// declares only leaves the steps out of the report.
function readRunWorkflow(workflowsDir, file) {
  const name = path.basename(file || '');
  const dirs = [].concat(workflowsDir || '');
  const found = dirs.map((d) => path.join(d, name)).find((p) => name && fs.existsSync(p)) || path.join(dirs[0], name);
  return yaml.load(fs.readFileSync(found, 'utf8'));
}

/** Text report of a run for a person's question (UI-side). */
function runReport(runDir, { workflowsDir } = {}) {
  const events = readEvents(runDir);
  const started = events.find((e) => e.type === 'workflow.started') || {};
  const finished = [...events].reverse().find((e) => e.type === 'workflow.finished');
  let steps = '';
  try {
    const wf = readRunWorkflow(workflowsDir, started.file);
    steps = (wf.steps || []).map((s) => `- ${s.id} (${s.type || (s.agents ? `parallel: ${s.agents.join(', ')}` : s.agent)})${s.on_error ? ` on_error→${s.on_error}` : ''}`).join('\n');
  } catch { /* workflow file gone */ }
  const answers = {};
  const handoffs = {}; // latest handoff note per agent
  // #308: per agent, its turns' tokens (usage: the whole turn) and the sub-agents' share of them
  const sessionAgent = {};
  const perAgent = {};
  const tokensOf = (u) => ['input', 'output', 'cache_read', 'cache_write'].reduce((s, k) => s + (Number(u?.[k]) || 0), 0);
  for (const ev of events) {
    if (ev.type === 'session.opened' && ev.session?.agent) sessionAgent[ev.session_id] = ev.session.agent;
    if (ev.type === 'session.message_received' && ev.step_id) (answers[ev.step_id] ??= []).push(ev.text);
    if (ev.type === 'session.message_received') {
      const a = (perAgent[ev.session?.agent || sessionAgent[ev.session_id] || ev.step_id || 'agent'] ??= { turns: 0, tokens: 0, subCalls: 0, subTokens: 0 });
      a.turns += 1;
      a.tokens += tokensOf(ev.usage);
      a.subCalls += Number(ev.subagents?.calls) || 0;
      a.subTokens += tokensOf(ev.subagents?.usage);
    }
    if (ev.type === 'handoff.saved' && ev.agent) handoffs[ev.agent] = ev;
  }
  const agentLines = Object.entries(perAgent).map(([agent, a]) => `- ${agent}: ${a.turns} turn${a.turns === 1 ? '' : 's'}, ${a.tokens} tokens${a.subCalls ? ` (of which sub-agents: ${a.subCalls} call${a.subCalls === 1 ? '' : 's'}, ${a.subTokens} tokens)` : ''}`);
  const failing = finished?.status === 'failed' ? [...events].reverse().find((e) => e.type === 'step.started')?.step_id : null;
  let files = [];
  try { files = require('../run/runs').runArtifacts(runDir).map((a) => `- ${a.rel}${a.step ? ` (${a.step})` : ''}${a.exists ? '' : ' [deleted]'}`); } catch { /* no artifacts */ }
  return [
    `# Run ${path.basename(runDir)}`,
    `Workflow: ${started.workflow} ${started.version || ''} (${started.file || '?'})${started.mock ? ' — simulated' : ''}`,
    `Status: ${finished ? finished.status : 'running or interrupted'}${finished?.error ? `\nError: ${finished.error}` : ''}`,
    `\n## Inputs\n${Object.entries(started.inputs || {}).map(([k, v]) => `- ${k}: ${clip(v, 600)}`).join('\n')}`,
    steps ? `\n## Workflow steps\n${steps}` : '',
    `\n## Timeline\n${timeline(events, 150)}`,
    agentLines.length ? `\n## Tokens per agent (every model call of its turns; sub-agents included in the turns recorded since #308)\n${agentLines.join('\n')}` : '',
    Object.keys(handoffs).length ? `\n## Handoff notes (each agent's own summary at the end of its latest turn: read them before the transcripts)\n${Object.values(handoffs).map((h) => `### ${h.agent} (step ${h.step_id}, visit ${h.visit})\n${clip(h.note, 2500)}`).join('\n\n')}` : '',
    failing && answers[failing] ? `\n## Answers of the step that was running (${failing}), every attempt\n${answers[failing].slice(-4).map((a, i, all) => `### Attempt ${answers[failing].length - all.length + i + 1}\n${tail(a, 6000)}`).join('\n\n')}` : '',
    files.length ? `\n## Files produced (in this folder)\n${files.join('\n')}` : '',
    `\nThe run folder is the current directory: events.jsonl (every event), sessions/<id>.jsonl (each agent's stream), handoffs/ (the agents' notes, one per turn), summary.json and the files above. Read them when you need more detail.`,
  ].filter(Boolean).join('\n');
}

/** Markdown of an analysis, saved in the run folder as an artifact. */
function analysisMarkdown(a, { question, model } = {}) {
  const recs = (a.recommendations || []).map((r, i) => `${i + 1}. **${r.title}**${r.action !== 'none' ? ` — \`${r.action}${r.step ? ` from ${r.step}` : ''}\`` : ''}${r.instruction ? `\n   > ${r.instruction}` : ''}`).join('\n');
  return [
    '# Supervisor analysis',
    `_${new Date().toISOString()}${model ? ` · ${model}` : ''}_`,
    question ? `\n**Question:** ${question}` : '',
    `\n## What happened\n${a.summary}`,
    `\n## Root cause\n${a.root_cause}`,
    recs ? `\n## Recommendations\n${recs}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * What a new run needs to resume a previous one from `fromStep`: the previous steps' outputs and
 * visits, the agents' provider conversations (so persistent agents keep their context) and their
 * latest handoff notes (handoff sessions, and agents with no conversation to resume, start from them).
 * stoppedAt (#799): the step a resume with no step goes on from (stoppedStep).
 */
function resumeSpec(runDir, fromStep) {
  const events = readEvents(runDir);
  const started = events.find((e) => e.type === 'workflow.started');
  if (!started) throw new Error('Not a run folder.');
  const steps = {};
  const sessions = {};
  const handoffs = {};
  const cliTotals = {};
  const sessionAccounts = {}; // #312: agent -> the account of its conversation (null: none)
  // #262: the run's agent overrides, then the fallbacks its agents took
  const agentOverrides = { ...(started.agent_overrides || {}) };
  let worktree = null; // the run's git worktree (worktree.ready / .kept / .removed): the resume continues there
  // its `type: workflow` steps' child runs (#175): a resume reuses the ones that succeeded and resumes the others
  const childRuns = new Map(); // run id -> { run_id, step_id, index?, label, status }
  for (const ev of events) {
    if (ev.type === 'step.finished' && !ev.error) steps[ev.step_id] = { output: ev.output, visits: ev.visit };
    if (ev.type === 'workflow.child_started' && ev.child_run_id) childRuns.set(ev.child_run_id, { run_id: ev.child_run_id, step_id: ev.step_id, ...(ev.index !== undefined ? { index: ev.index } : {}), label: ev.label ?? null, status: 'running' });
    if (ev.type === 'workflow.child_finished' && childRuns.has(ev.child_run_id)) childRuns.get(ev.child_run_id).status = ev.status;
    if (ev.session?.agent && ev.session.provider_session_id && ev.session.provider !== 'mock') sessions[ev.session.agent] = ev.session.provider_session_id;
    noteSessionAccount(ev, sessionAccounts);
    // #233: the CLI's running total per CLI session, so the resumed turn costs only its own part
    if (ev.session?.provider_session_id && ev.session.cli_total_cost_usd != null) cliTotals[ev.session.provider_session_id] = ev.session.cli_total_cost_usd;
    if (/^worktree\./.test(ev.type) && ev.dir) worktree = { dir: ev.dir, branch: ev.branch || worktree?.branch || null };
    if (ev.type === 'handoff.saved' && ev.agent && ev.note) handoffs[ev.agent] = { text: ev.note, step: ev.step_id, visit: ev.visit, path: ev.path };
    // #262: an agent that fell back stays on its fallback (its conversation is there)
    const to = ev.type === 'agent.fallback' && ev.agent && /^([^:]+):(.+)$/.exec(String(ev.to || ''));
    if (to) agentOverrides[ev.agent] = { ...agentOverrides[ev.agent], provider: to[1], model: to[2] };
  }
  // attachments: the images attached to inputs (#129), the previous run's copies (the new run copies them again)
  return { runId: path.basename(runDir), file: started.file, inputs: started.inputs || {}, attachments: started.attachments || null, mock: !!started.mock, projectId: started.project_id || null,
    // runs recorded before groups have a single `issue`
    issues: started.issues || (started.issue ? [started.issue] : null), personas: started.personas || null, fromStep, stoppedAt: stoppedStep(events), steps, sessions, sessionAccounts, cliTotals, handoffs, worktree,
    childRuns: [...childRuns.values()], agentOverrides: Object.keys(agentOverrides).length ? agentOverrides : null };
}

// #799: where a run stopped: a failed run's step that reported the error with no step started after
// it (an error its on_error route took on is past), else the last step started; null for a run that
// ended well or never reached a step
function stoppedStep(events) {
  let lastStarted = null;
  let failedAt = null;
  let status = null;
  for (const ev of events) {
    if (ev.type === 'step.started') { lastStarted = ev.step_id; failedAt = null; }
    if (ev.type === 'step.finished') failedAt = ev.error ? ev.step_id : null;
    if (ev.type === 'workflow.finished') ({ status } = ev);
  }
  if (status === 'success') return null;
  return (status === 'failed' && failedAt) || lastStarted;
}

// #312: the account (its name, null for none) of the conversation resumeSpec keeps for an agent: a
// resumed run continues it only on that account (resumeSession, packages/engine/engine/run/resume.js)
function noteSessionAccount(ev, accounts) {
  if (ev.session?.agent && ev.session.provider_session_id && ev.session.provider !== 'mock') accounts[ev.session.agent] = ev.session.account || null;
}

/**
 * The human gate a resume from `fromStep` would go past on the previous run's decision: the last
 * human_approval step before it (in the workflow's order) that the previous run decided (approved
 * or rejected). null = none. A resume never reuses a gate's decision: it starts at the gate instead.
 */
function skippedGate(wf, fromStep, steps) {
  const at = (wf.steps || []).findIndex((s) => s.id === fromStep);
  if (at < 0) return null;
  return wf.steps.slice(0, at).filter((s) => s.type === 'human_approval' && steps?.[s.id]).map((s) => s.id).pop() || null;
}

// The previous outputs a resumed run starts from, without any gate's decision: a gate reached
// again asks again, and no template reads an old approval as a current one.
function withoutGateDecisions(wf, steps) {
  const gates = new Set((wf.steps || []).filter((s) => s.type === 'human_approval').map((s) => s.id));
  return Object.fromEntries(Object.entries(steps || {}).filter(([id]) => !gates.has(id)));
}

// The workflow's supervisor settings (orchestrator.supervisor + providers), from the run's workflow file.
function supervisorConfig(runDir, workflowsDir) {
  const started = readEvents(runDir).find((e) => e.type === 'workflow.started') || {};
  let wf = {};
  try { wf = readRunWorkflow(workflowsDir, started.file) || {}; } catch { /* workflow file gone */ }
  const orch = wf.orchestrator || {};
  const providerName = orch.supervisor?.provider || orch.provider || 'claude';
  const provider = wf.providers?.[providerName] || DEFAULT_PROVIDER;
  return { started, wf, provider, providerName, model: orch.supervisor?.model || orch.model || DEFAULT_MODEL };
}
// Claude Code's workflow definition (its adapter's), without effort or resume arguments
const DEFAULT_PROVIDER = (({ type, command, args, skill_args }) => ({ type, command, args, skill_args }))(registry.byId('claude').definition);
const DEFAULT_MODEL = 'claude-sonnet-5-5';


/**
 * Asks the supervisor about a run (a person's question from the UI). Simulated runs use the mock
 * provider. The analysis is saved as supervisor/analysis-<time>.md in the run folder.
 * attachments: images for this question (#129, paths or { path, name }), copied into the run's
 * supervisor/attachments/ and given to this question's turn only.
 * @returns { analysis, artifactPath, model, costUsd, steps }
 */
async function analyzeRun({ runDir, question, workflowsDir, skillsDirs, resolveCommand, attachments = [], language = null }) {
  const { extractJson, validateSchema } = require('../../engine/run/outputs');
  const { render } = require('../../engine/run/templates');
  const { runTurn, storeAttachments } = require('../../engine/providers');
  const images = storeAttachments(attachments, path.join(runDir, 'supervisor', 'attachments'));
  const { resolveSkill, skillPrompt } = require('../agents/skills');
  const cfg = supervisorConfig(runDir, workflowsDir);
  const skill = resolveSkill(skillsDirs, 'run-supervisor');
  const schema = ANALYSIS_SCHEMA;
  const prompt = [
    skillPrompt(skill),
    'A person asks you, the run supervisor, about this workflow run. Explain what happened and recommend what to do next.',
    question ? `Their question: ${question}` : 'They want to know what happened and, if something went wrong, how to fix it.',
    'Recommendations can be: resume (continue the run from a step, reusing the previous outputs and agent conversations, with an instruction for that step), rerun (start again from the first step with the same inputs), or none (something the person must do, e.g. change an input or the workflow).',
    `Write the summary and root cause in Markdown. ${writeIn(language)}`,
    runReport(runDir, { workflowsDir }),
    `\n---\nAt the end of your response you MUST include a \`\`\`json block with an object that validates against this JSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``,
  ].join('\n\n');
  const mock = !!cfg.started.mock;
  const provider = mock ? { type: 'mock' } : cfg.provider;
  if (!mock && !resolveCommand(provider.command)) throw new Error(`The supervisor needs ${provider.command}, which is not installed.`);
  // read-only and isolated, like the supervisor inside a run (engine/capabilities.js)
  const { providerArgs, normalize, dedupeFlags } = require('../../engine/capabilities');
  const readOnly = providerArgs(provider.type, { caps: normalize({ tools: ['read'] }) }).args;
  const extraArgs = dedupeFlags([...readOnly, ...(provider.skill_args || []).map((x) => render(x, { skill_dir: skill.path }))], provider.args || []);
  const turn = (text) => runTurn({
    provider, model: cfg.model, prompt: text, cwd: runDir, extraArgs, timeoutMs: 15 * 60e3, render, attachments: images,
    hint: { stepId: 'supervisor', visit: 1, schema }, onItem: () => {},
  });
  let res = await turn(prompt);
  let cost = res.costUsd || 0;
  let analysis;
  for (let attempt = 0; ; attempt++) {
    let errs;
    try { analysis = extractJson(res.text); errs = validateSchema(analysis, schema); } catch (e) { errs = [e.message]; }
    if (!errs.length) break;
    if (attempt >= 1) throw new Error(`The supervisor's answer did not validate: ${errs.join('; ')}`);
    res = await turn(`${prompt}\n\n---\nYou already answered:\n<previous_answer>\n${String(res.text).slice(-20000)}\n</previous_answer>\nIt did not validate (${errs.join('; ')}). Reply again with only the corrected \`\`\`json block.`);
    cost += res.costUsd || 0;
  }
  const model = mock ? 'simulated' : cfg.model;
  const artifactPath = path.join(runDir, 'supervisor', `analysis-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  fs.mkdirSync(path.dirname(artifactPath), { recursive: true });
  fs.writeFileSync(artifactPath, analysisMarkdown(analysis, { question, model }));
  return { analysis, artifactPath, model, costUsd: cost, steps: (cfg.wf.steps || []).map((x) => x.id) };
}

// Report on the sessions of a date range (Analytics screen).
const SESSIONS_REPORT_SCHEMA = {
  type: 'object',
  required: ['summary', 'uses', 'complexity', 'patterns', 'suggestions'],
  properties: {
    summary: { type: 'string' },
    uses: { type: 'array', items: { type: 'object', required: ['type', 'share', 'examples'], properties: { type: { type: 'string' }, share: { type: 'string' }, examples: { type: 'string' } } } },
    complexity: { type: 'string' },
    patterns: { type: 'array', items: { type: 'string' } },
    suggestions: { type: 'array', items: { type: 'string' } },
  },
};

function sessionsReportMarkdown(r, { from, to, scope, model } = {}) {
  const list = (xs) => (xs || []).map((x) => `- ${x}`).join('\n');
  return [
    `# Sessions report: ${from} to ${to}`,
    `_${new Date().toISOString()} · ${scope === 'machine' ? 'every CLI session on this machine' : 'orchestrator runs'}${model ? ` · ${model}` : ''}_`,
    `\n## Summary\n${r.summary}`,
    r.uses?.length ? `\n## What the sessions were used for\n${r.uses.map((u) => `- **${u.type}** (${u.share}): ${u.examples}`).join('\n')}` : '',
    `\n## Complexity\n${r.complexity}`,
    r.patterns?.length ? `\n## Patterns\n${list(r.patterns)}` : '',
    r.suggestions?.length ? `\n## Suggestions\n${list(r.suggestions)}` : '',
  ].filter(Boolean).join('\n');
}

/**
 * Asks the supervisor to analyze the sessions of a date range (a person's request from Analytics):
 * what they were used for, complexity, patterns, suggestions. Read-only; no run folder, so it uses the
 * default supervisor (Claude Code) unless `mock`. The report is saved as <reportsDir>/sessions-<time>.md.
 * @param report  the text digest of the range (analytics.analyticsReport)
 * @param attachments images for this question (#129), copied into <reportsDir>/attachments/
 * @returns { report, reportPath, markdown, model, costUsd }
 */
async function analyzeSessions({ report, from, to, scope, question, reportsDir, skillsDirs, resolveCommand, mock = false, provider: forced, model: forcedModel, attachments = [], language = null }) {
  const { extractJson, validateSchema } = require('../../engine/run/outputs');
  const { render } = require('../../engine/run/templates');
  const { runTurn, storeAttachments } = require('../../engine/providers');
  const images = storeAttachments(attachments, path.join(reportsDir, 'attachments'));
  const { resolveSkill, skillPrompt } = require('../agents/skills');
  const skill = resolveSkill(skillsDirs, 'run-supervisor');
  const schema = SESSIONS_REPORT_SCHEMA;
  const prompt = [
    skillPrompt(skill),
    Language.languageLine({ language }), // #327
    'A person asks you, the orchestrator\'s supervisor, to analyze the AI coding sessions below (Claude Code, Codex CLI, Grok Build) over a date range.',
    'Explain what the sessions were used for (types such as coding, debugging, docs writing, research, review, with their share and examples), how complex they were, the patterns you see (cost, cache use, idle time, retries, failed tool calls, interruptions, compactions, projects) and concrete suggestions to use the agents and the workflows better.',
    'Base every claim on the numbers and prompts below; say when the data is too thin. Do not prescribe code changes to the user\'s projects. Write in Markdown, in the language the Language line names for documents.',
    question ? `Their question: ${question}` : '',
    report,
    `\n---\nAt the end of your response you MUST include a \`\`\`json block with an object that validates against this JSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``,
  ].filter(Boolean).join('\n\n');
  const provider = mock ? { type: 'mock' } : forced || DEFAULT_PROVIDER;
  const model = mock ? 'simulated' : forcedModel || DEFAULT_MODEL;
  if (!mock && !resolveCommand(provider.command)) throw new Error(`The supervisor needs ${provider.command}, which is not installed.`);
  fs.mkdirSync(reportsDir, { recursive: true });
  const { providerArgs, normalize, dedupeFlags } = require('../../engine/capabilities');
  const readOnly = providerArgs(provider.type, { caps: normalize({ tools: ['read'] }) }).args;
  const extraArgs = dedupeFlags([...readOnly, ...(provider.skill_args || []).map((x) => render(x, { skill_dir: skill.path }))], provider.args || []);
  const turn = (text) => runTurn({
    provider, model, prompt: text, cwd: reportsDir, extraArgs, timeoutMs: 15 * 60e3, render, attachments: images,
    hint: { stepId: 'supervisor', visit: 1, schema }, onItem: () => {},
  });
  let res = await turn(prompt);
  let cost = res.costUsd || 0;
  let out;
  for (let attempt = 0; ; attempt++) {
    let errs;
    try { out = extractJson(res.text); errs = validateSchema(out, schema); } catch (e) { errs = [e.message]; }
    if (!errs.length) break;
    if (attempt >= 1) throw new Error(`The supervisor's answer did not validate: ${errs.join('; ')}`);
    res = await turn(`${prompt}\n\n---\nYou already answered:\n<previous_answer>\n${String(res.text).slice(-20000)}\n</previous_answer>\nIt did not validate (${errs.join('; ')}). Reply again with only the corrected \`\`\`json block.`);
    cost += res.costUsd || 0;
  }
  const markdown = sessionsReportMarkdown(out, { from, to, scope, model });
  const reportPath = path.join(reportsDir, `sessions-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  fs.writeFileSync(reportPath, markdown);
  return { report: out, reportPath, markdown, model, costUsd: cost };
}

module.exports = {
  actionErrorPrompt,
  actionSchema,
  ANALYSIS_SCHEMA,
  analysisMarkdown,
  analyzeRun,
  analyzeSessions,
  DECISION_SCHEMA,
  decisionPrompt,
  ESCALATION_ACTIONS,
  IDLE_SCHEMA,
  idlePrompt,
  onCallPrompt,
  onCallSchema,
  readEvents,
  resumeSpec,
  runReport,
  SESSIONS_REPORT_SCHEMA,
  sessionsReportMarkdown,
  skippedGate,
  SLOW_ACTIONS,
  STALL_ACTIONS,
  supervisorConfig,
  timeline,
  timelineLine,
  withoutGateDecisions,
};
