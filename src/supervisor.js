// The orchestrator's AI supervisor (skill: run-supervisor).
//
// The engine stays deterministic; the supervisor is only called
// - by the engine, when a step fails during a run (src/engine/workflow.js, superviseFailure):
//   it explains the failure and picks a recovery the engine validates; and when an agent is silent
//   while a command waits (superviseIdle): keep waiting, or interrupt the turn and retry the step;
// - by a person, from the UI, for any run (analyzeRun): it explains what happened and recommends
//   actions such as resuming the run from a step (resumeSpec) with an instruction.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

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
    case 'approval.resolved': return `${t}   human decided: ${ev.choice ?? (ev.approved ? 'approved' : 'rejected')}`;
    case 'log': return ev.level === 'info' ? null : `${t} [${ev.level}] ${clip(ev.message, 500)}`;
    case 'supervisor.decision': return `${t} supervisor on ${ev.step_id}: ${ev.action}${ev.goto ? ` → ${ev.goto}` : ''} — ${clip(ev.explanation, 300)}`;
    case 'budget.exceeded': return `${t} budget exceeded for ${ev.provider}`;
    case 'workflow.finished': return `${t} ■ ${ev.status}${ev.error ? `: ${ev.error}` : ''}`;
    default: return null;
  }
}
const timeline = (events, max = 80) => events.map(timelineLine).filter(Boolean).slice(-max).join('\n');

/** Prompt for a decision on a failed step (engine-side). */
function decisionPrompt({ wf, step, error, answer, allowed, events, previous, handoffs }) {
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
    '- ask_human: stop and ask the person (explain what they need to decide or change).',
    '- fail: end the run.',
    'Explain in the language of the workflow\'s task, for the person running it.',
  ].filter(Boolean).join('\n');
}

/** Prompt for a decision on an agent that has been silent while a command waits (engine-side). */
function idlePrompt({ wf, step, agent, idle, events, handoffs }) {
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
    'Explain in the language of the workflow\'s task, for the person running it.',
  ].filter(Boolean).join('\n');
}

// The run's workflow file (runs record its basename). workflowsDir: a folder or a list of folders
// searched in order (workspace first, then the bundled defaults). Throws if it is gone.
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
  for (const ev of events) {
    if (ev.type === 'session.message_received' && ev.step_id) (answers[ev.step_id] ??= []).push(ev.text);
    if (ev.type === 'handoff.saved' && ev.agent) handoffs[ev.agent] = ev;
  }
  const failing = finished?.status === 'failed' ? [...events].reverse().find((e) => e.type === 'step.started')?.step_id : null;
  let files = [];
  try { files = require('./runs').runArtifacts(runDir).map((a) => `- ${a.rel}${a.step ? ` (${a.step})` : ''}${a.exists ? '' : ' [deleted]'}`); } catch { /* no artifacts */ }
  return [
    `# Run ${path.basename(runDir)}`,
    `Workflow: ${started.workflow} ${started.version || ''} (${started.file || '?'})${started.mock ? ' — simulated' : ''}`,
    `Status: ${finished ? finished.status : 'running or interrupted'}${finished?.error ? `\nError: ${finished.error}` : ''}`,
    `\n## Inputs\n${Object.entries(started.inputs || {}).map(([k, v]) => `- ${k}: ${clip(v, 600)}`).join('\n')}`,
    steps ? `\n## Workflow steps\n${steps}` : '',
    `\n## Timeline\n${timeline(events, 150)}`,
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
 */
function resumeSpec(runDir, fromStep) {
  const events = readEvents(runDir);
  const started = events.find((e) => e.type === 'workflow.started');
  if (!started) throw new Error('Not a run folder.');
  const steps = {};
  const sessions = {};
  const handoffs = {};
  let worktree = null; // the run's git worktree (worktree.ready / .kept / .removed): the resume continues there
  for (const ev of events) {
    if (ev.type === 'step.finished' && !ev.error) steps[ev.step_id] = { output: ev.output, visits: ev.visit };
    if (ev.session?.agent && ev.session.provider_session_id && ev.session.provider !== 'mock') sessions[ev.session.agent] = ev.session.provider_session_id;
    if (/^worktree\./.test(ev.type) && ev.dir) worktree = { dir: ev.dir, branch: ev.branch || worktree?.branch || null };
    if (ev.type === 'handoff.saved' && ev.agent && ev.note) handoffs[ev.agent] = { text: ev.note, step: ev.step_id, visit: ev.visit, path: ev.path };
  }
  return { runId: path.basename(runDir), file: started.file, inputs: started.inputs || {}, mock: !!started.mock, projectId: started.project_id || null, issue: started.issue || null, personas: started.personas || null, fromStep, steps, sessions, handoffs, worktree };
}

// The workflow's supervisor settings (orchestrator.supervisor + providers), from the run's workflow file.
function supervisorConfig(runDir, workflowsDir) {
  const started = readEvents(runDir).find((e) => e.type === 'workflow.started') || {};
  let wf = {};
  try { wf = readRunWorkflow(workflowsDir, started.file) || {}; } catch { /* workflow file gone */ }
  const orch = wf.orchestrator || {};
  const providerName = orch.supervisor?.provider || orch.provider || 'claude';
  const provider = wf.providers?.[providerName] || { type: 'claude-code', command: 'claude', args: ['-p', '--output-format', 'stream-json', '--verbose', '--model', '{{ model }}'], skill_args: ['--add-dir', '{{ skill_dir }}'] };
  return { started, wf, provider, providerName, model: orch.supervisor?.model || orch.model || 'claude-sonnet-5' };
}


/**
 * Asks the supervisor about a run (a person's question from the UI). Simulated runs use the mock
 * provider. The analysis is saved as supervisor/analysis-<time>.md in the run folder.
 * @returns { analysis, artifactPath, model, costUsd, steps }
 */
async function analyzeRun({ runDir, question, workflowsDir, skillsDirs, resolveCommand }) {
  const { extractJson, validateSchema, render } = require('./engine/workflow');
  const { runTurn } = require('./engine/providers');
  const { resolveSkill, skillPrompt } = require('./skills');
  const cfg = supervisorConfig(runDir, workflowsDir);
  const skill = resolveSkill(skillsDirs, 'run-supervisor');
  const schema = ANALYSIS_SCHEMA;
  const prompt = [
    skillPrompt(skill),
    'A person asks you, the run supervisor, about this workflow run. Explain what happened and recommend what to do next.',
    question ? `Their question: ${question}` : 'They want to know what happened and, if something went wrong, how to fix it.',
    'Recommendations can be: resume (continue the run from a step, reusing the previous outputs and agent conversations, with an instruction for that step), rerun (start again from the first step with the same inputs), or none (something the person must do, e.g. change an input or the workflow).',
    'Write the summary and root cause in Markdown, in the language of the task.',
    runReport(runDir, { workflowsDir }),
    `\n---\nAt the end of your response you MUST include a \`\`\`json block with an object that validates against this JSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``,
  ].join('\n\n');
  const mock = !!cfg.started.mock;
  const provider = mock ? { type: 'mock' } : cfg.provider;
  if (!mock && !resolveCommand(provider.command)) throw new Error(`The supervisor needs ${provider.command}, which is not installed.`);
  // read-only and isolated, like the supervisor inside a run (engine/capabilities.js)
  const { providerArgs, normalize, dedupeFlags } = require('./engine/capabilities');
  const readOnly = providerArgs(provider.type, { caps: normalize({ tools: ['read'] }) }).args;
  const extraArgs = dedupeFlags([...readOnly, ...(provider.skill_args || []).map((x) => render(x, { skill_dir: skill.path }))], provider.args || []);
  const turn = (text) => runTurn({
    provider, model: cfg.model, prompt: text, cwd: runDir, extraArgs, timeoutMs: 15 * 60e3, render,
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

module.exports = { analyzeRun, supervisorConfig, DECISION_SCHEMA, IDLE_SCHEMA, ANALYSIS_SCHEMA, decisionPrompt, idlePrompt, runReport, analysisMarkdown, resumeSpec, timeline, readEvents };
