// The Backlog's Product Owner (#105; skill: backlog-product-owner): a built-in agent (src/agents.js)
// that reads a project's backlog and proposes which issues to run together, which must not run in
// parallel, in what order, how big each group is and which issues to enrich first.
//
// One agent call per question, read-only, in the project folder (it may grep the code to estimate
// the files an issue touches). The context is bounded: issue bodies are clipped unless the question
// names the issue, the whole report is capped (MAX_REPORT), and only the last exchanges of the
// conversation are repeated. The answer is structured (ANSWER_SCHEMA); sizes, estimates and size
// warnings are computed here from the issues' `complexity:n` labels and past runs, not left to the
// model. It never edits issues, never starts runs and never answers a gate: the Backlog's Assign and
// Add to roadmap buttons apply a proposal only on the owner's click.
// Simulated (developer mode, MULTIAGENT_SIMULATION_ONLY): mockAnswer builds the answer from the
// backlog itself, with no model call and no cost.
// The conversation is kept per project in <workspace>/backlog/<projectId>.po.jsonl until cleared.
// Each real call's cost and tokens also go to <workspace>/backlog/product-owner.usage.jsonl, which
// clearing does not touch: monthUsage feeds them to the monthly budget check (they are in no run).

const fs = require('fs');
const path = require('path');
const { readEvents } = require('./supervisor');

const MAX_REPORT = 60000;
const BODY_CLIP = 600;
const BODY_NAMED = 4000;
const HISTORY_RUNS = 20;
const PREVIOUS_EXCHANGES = 3;
// Past evidence (30 Sep 2026): a group of complexity 7 hit the context limit, grouped runs hit the test time budget.
const CONTEXT_WARN_AT = 7;
const TEST_TIME_WARN_AT = 5;
const DEFAULT_COMPLEXITY = 3;
const ENRICH_ISSUE = 'https://github.com/eduardogalbiati/multiagent-orchestrator/issues/103';

const ANSWER_SCHEMA = {
  type: 'object',
  required: ['summary', 'groups', 'conflicts', 'enrich'],
  properties: {
    summary: { type: 'string' },
    groups: {
      type: 'array',
      items: {
        type: 'object',
        required: ['issues', 'workflow', 'reason'],
        properties: {
          name: { type: 'string' },
          issues: { type: 'array', items: { type: 'integer' } },
          workflow: { type: 'string' },
          inputs: { type: 'object' },
          reason: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          stage: { type: 'integer' },
          warnings: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    conflicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['issues', 'reason'],
        properties: {
          issues: { type: 'array', items: { type: 'integer' } },
          reason: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    enrich: {
      type: 'array',
      items: { type: 'object', required: ['issue', 'reason'], properties: { issue: { type: 'integer' }, reason: { type: 'string' } } },
    },
  },
};

const RULES = [
  'You are the Product Owner of this project\'s backlog, inside the orchestrator\'s Backlog screen. The owner asks you a question; answer it from the backlog report below and, when you need to, from the project\'s code (your working directory, read-only: docs/agents/code-map.md, grep).',
  'Propose groups of issues to implement in one run (same files, same feature, one reuses the other), pairs or sets that must not run in parallel (overlapping files, a repo-wide refactor or reformat), the order to run the groups in (`stage`: 1 first; groups of one stage may run in parallel), and the issues too vague to implement that should be enriched first.',
  'Use only issue numbers and workflow files listed in the report. Suggest the workflow inputs that matter (for example `mode`). Leave a list empty when the question is not about it.',
  'You never edit issues, never start runs and never answer a human gate: the owner applies a proposal with a click. Do not prescribe code changes.',
  'Write in English. The summary is Markdown, short, and answers the question.',
].join('\n');

const clip = (s, n) => { s = String(s ?? '').trim(); return s.length > n ? `${s.slice(0, n)}… (${s.length - n} more characters)` : s; };
const minutes = (ms) => Math.round((ms || 0) / 60e3);

/** The complexity of an issue from its `complexity:n` label (null when it has none). */
function complexityOf(issue) {
  for (const l of issue?.labels || []) {
    const m = String(l?.name ?? l).match(/^complexity\s*[:=/-]?\s*(\d+)/i);
    if (m) return Number(m[1]);
  }
  return null;
}

// Merge conflicts a run hit, and the files they name, from its events.jsonl.
function conflictsOf(runDir) {
  const messages = [];
  const files = new Set();
  for (const e of readEvents(runDir)) {
    const msg = e.type === 'log' ? e.message : e.type === 'workflow.finished' ? e.error : null;
    if (!msg || !/conflict/i.test(msg)) continue;
    messages.push(clip(msg, 200));
    for (const m of String(msg).matchAll(/[\w@.-]+(?:\/[\w@.-]+)*\.[a-z]{1,5}\b/gi)) files.add(m[0]);
  }
  return { count: messages.length, files: [...files].slice(0, 10), messages: messages.slice(0, 3) };
}

/**
 * The project's finished runs, newest first (at most HISTORY_RUNS, simulated runs left out): issues,
 * complexity, agent time (without gate waits), cost, tokens, merge conflicts and the files they hit.
 */
function runHistory(runs, issues) {
  const byNumber = new Map((issues || []).map((i) => [i.number, i]));
  return (runs || [])
    .filter((r) => !r.mock && r.status !== 'interrupted' && r.finishedAt)
    .slice(0, HISTORY_RUNS)
    .map((r) => {
      const nums = (r.issues || []).map((i) => Number(i?.number ?? i)).filter(Boolean);
      const known = nums.map((n) => complexityOf(byNumber.get(n))).filter((c) => c != null);
      return {
        runId: r.runId,
        workflow: r.workflow,
        status: r.status,
        issues: nums,
        complexity: known.length ? known.reduce((a, c) => a + c, 0) : null,
        agentMinutes: minutes((r.durationMs || 0) - (r.gateWaitMs || 0)),
        costUsd: r.costUsd || 0,
        tokens: r.tokens?.total || 0,
        conflicts: r.runDir ? conflictsOf(r.runDir) : { count: 0, files: [], messages: [] },
      };
    });
}

/**
 * Time and cost of a group of `complexity`, from past runs of a similar size (±2), else from every
 * past run with a known complexity; null when there are none. Always an estimate.
 */
function estimate(complexity, history) {
  const sized = (history || []).filter((h) => h.complexity && h.status === 'success');
  const near = sized.filter((h) => Math.abs(h.complexity - complexity) <= 2);
  const base = near.length ? near : sized;
  if (!base.length) return null;
  const perPoint = (k) => base.reduce((a, h) => a + h[k] / h.complexity, 0) / base.length;
  return {
    minutes: Math.round(perPoint('agentMinutes') * complexity),
    costUsd: Math.round(perPoint('costUsd') * complexity * 100) / 100,
    basis: `${base.length} past run${base.length > 1 ? 's' : ''}${near.length ? ` of complexity ${complexity - 2} to ${complexity + 2}` : ' of any size'}`,
  };
}

/** Size of a group: complexity sum, estimate and the size warnings. */
function sizeGroup(numbers, issues, history) {
  const byNumber = new Map((issues || []).map((i) => [i.number, i]));
  const known = numbers.map((n) => complexityOf(byNumber.get(n)));
  const complexity = known.reduce((a, c) => a + (c ?? DEFAULT_COMPLEXITY), 0);
  const warnings = [];
  if (complexity >= CONTEXT_WARN_AT) warnings.push(`Complexity ${complexity}: likely to hit the context limit (a group of complexity 7 did). Split it.`);
  else if (numbers.length > 1 && complexity >= TEST_TIME_WARN_AT) warnings.push(`Complexity ${complexity} in one run: the test step may exceed its time budget.`);
  return { complexity, guessed: known.some((c) => c == null), estimate: estimate(complexity, history), warnings };
}

/**
 * Keeps an answer to what exists (issue numbers of the backlog, workflow files) and adds each
 * group's size. Groups left with no issue are dropped.
 */
function normalizeAnswer(answer, { issues, history, workflows }) {
  const numbers = new Set((issues || []).map((i) => i.number));
  const files = (workflows || []).map((w) => w.file);
  const fallback = files.includes('software-development.yaml') ? 'software-development.yaml' : files[0] || '';
  const keep = (list) => [...new Set((list || []).map(Number).filter((n) => numbers.has(n)))];
  const groups = (answer.groups || []).map((g, n) => {
    const nums = keep(g.issues);
    const size = sizeGroup(nums, issues, history);
    return {
      name: String(g.name || `Group ${n + 1}`),
      issues: nums,
      workflow: files.includes(g.workflow) ? g.workflow : fallback,
      inputs: g.inputs && typeof g.inputs === 'object' && !Array.isArray(g.inputs) ? g.inputs : {},
      reason: String(g.reason || ''),
      files: (g.files || []).map(String).slice(0, 20),
      stage: Number.isInteger(g.stage) && g.stage > 0 ? g.stage : n + 1,
      ...size,
      warnings: [...new Set([...size.warnings, ...(g.warnings || []).map(String)])],
    };
  }).filter((g) => g.issues.length);
  return {
    summary: String(answer.summary || ''),
    groups,
    conflicts: (answer.conflicts || []).map((c) => ({ issues: keep(c.issues), reason: String(c.reason || ''), files: (c.files || []).map(String).slice(0, 20) })).filter((c) => c.issues.length > 1),
    enrich: (answer.enrich || []).filter((e) => numbers.has(Number(e.issue))).map((e) => ({ issue: Number(e.issue), reason: String(e.reason || ''), link: ENRICH_ISSUE })),
  };
}

// Issues the Product Owner plans: open, and not already running, waiting, merged locally or done.
const plannable = (i) => i.state === 'open' && (!i.column || i.column === 'todo');

/**
 * The text context of a question: open issues (bodies clipped unless the question names them), the
 * queue, runs in progress, the local merges not pushed, the roadmap, the finished runs and the
 * workflows. Capped at MAX_REPORT characters.
 */
function backlogReport({ data, activeRuns = [], history = [], workflows = [], question = '' }) {
  const named = new Set([...String(question).matchAll(/#(\d+)/g)].map((m) => Number(m[1])));
  const issues = (data?.issues || []).filter((i) => i.state === 'open');
  const issueText = (i) => {
    const labels = (i.labels || []).map((l) => l.name).join(', ');
    const prs = (i.pullRequests || []).map((p) => `#${p.number}${p.draft ? ' (draft)' : ''}`).join(', ');
    const runs = (i.runs || []).slice(0, 3).map((r) => `${r.runId} ${r.status}`).join(', ');
    return [
      `### #${i.number} ${i.title}`,
      `column: ${i.column || 'todo'}${labels ? ` · labels: ${labels}` : ''}${prs ? ` · open PRs: ${prs}` : ''}${i.queued ? ' · queued' : ''}${i.roadmap ? ` · roadmap stage ${i.roadmap.stage} (${i.roadmap.status})` : ''}${runs ? ` · runs: ${runs}` : ''}`,
      clip(i.body, named.has(i.number) ? BODY_NAMED : BODY_CLIP) || '(no description)',
    ].join('\n');
  };
  const local = data?.local;
  const queue = data?.queue?.items || [];
  const stages = data?.roadmap?.stages || [];
  const sections = [
    `# Backlog of ${data?.projectId || 'the project'} (${issues.length} open issues, ${issues.filter(plannable).length} to do)`,
    `## Workflows\n${workflows.map((w) => `- ${w.file}: ${w.name}${w.inputs ? ` (inputs: ${Object.keys(w.inputs).join(', ')})` : ''}`).join('\n') || '(none)'}`,
    `## Queue\n${queue.map((q) => `- ${(q.issues || [q]).map((i) => `#${i.number}`).join(' + ')} → ${q.workflowName || q.workflow}`).join('\n') || '(empty)'}`,
    `## Runs in progress\n${activeRuns.map((r) => `- ${r.runId} ${r.workflow || ''} ${r.status}${r.waiting || r.gates?.length ? ' (waiting at a gate)' : ''}${r.issues?.length ? ` issues ${r.issues.map((i) => `#${i.number ?? i}`).join(', ')}` : ''}`).join('\n') || '(none)'}`,
    `## Merged locally, not pushed\n${local && !local.error ? `${local.ahead || 0} commits ahead${local.issues?.length ? `, issues ${local.issues.map((n) => `#${n}`).join(', ')}` : ''}` : '(unknown or none)'}`,
    `## Roadmap\n${stages.map((s, n) => `- stage ${n + 1}${s.name ? ` ${s.name}` : ''}: ${s.items.map((x) => `${(x.issues || []).map((i) => `#${i.number ?? i}`).join(' + ')} ${x.status}`).join('; ')}`).join('\n') || '(empty)'}`,
    `## Finished runs (newest first; agent time without gate waits)\n${history.map((h) => `- ${h.runId} ${h.workflow || ''} ${h.status} · issues ${h.issues.map((n) => `#${n}`).join(', ') || '-'} · complexity ${h.complexity ?? '?'} · ${h.agentMinutes} min · $${h.costUsd.toFixed(2)} · ${Math.round(h.tokens / 1e3)}k tokens${h.conflicts.count ? ` · ${h.conflicts.count} merge conflict(s)${h.conflicts.files.length ? ` in ${h.conflicts.files.join(', ')}` : ''}` : ''}`).join('\n') || '(none)'}`,
  ];
  const head = sections.join('\n\n');
  const out = [head, '## Open issues'];
  let size = head.length;
  for (const i of issues) {
    const t = issueText(i);
    if (size + t.length > MAX_REPORT) { out.push(`… ${issues.length - (out.length - 2)} more issues left out (context cap).`); break; }
    out.push(t);
    size += t.length;
  }
  return out.join('\n\n');
}

/**
 * The simulated answer: groups of to-do issues that share a label (complexity at most 6 per group),
 * the issues that look like a repo-wide refactor kept apart from the others, and the issues with a
 * short description to enrich first.
 */
function mockAnswer({ data, question = '' }) {
  const todo = (data?.issues || []).filter(plannable);
  const topic = (i) => (i.labels || []).map((l) => l.name).find((n) => !/^complexity/i.test(n) && !/^(bug|enhancement|feature)$/i.test(n)) || null;
  const refactor = todo.filter((i) => /refactor|reformat|rename|move files|lint/i.test(i.title));
  const others = todo.filter((i) => !refactor.includes(i));
  const groups = [];
  for (const i of others) {
    const c = complexityOf(i) ?? DEFAULT_COMPLEXITY;
    const g = topic(i) && groups.find((x) => x.topic === topic(i) && x.size + c <= 6);
    if (g) { g.issues.push(i.number); g.size += c; } else groups.push({ topic: topic(i), issues: [i.number], size: c });
  }
  const group = (g, stage) => ({
    name: g.topic || `#${g.issues[0]}`,
    issues: g.issues,
    workflow: 'software-development.yaml',
    inputs: {},
    reason: g.refactor ? 'A repo-wide change: alone in its own stage, before the others.'
      : g.issues.length > 1 ? `Same area (label ${g.topic}): likely the same files.` : 'On its own: no other issue shares its area.',
    files: [],
    stage,
  });
  return {
    summary: [
      `**Simulated answer** (developer or simulated mode: no model was called)${question ? ` to: “${clip(question, 120)}”` : ''}.`,
      `${todo.length} issues to do: ${groups.length + refactor.length} proposed run${groups.length + refactor.length === 1 ? '' : 's'}, grouped by shared label; repo-wide changes first and alone, then stages of at most two runs.`,
    ].join('\n\n'),
    groups: [
      ...refactor.map((i, n) => group({ issues: [i.number], refactor: true }, n + 1)),
      ...groups.map((g, n) => group(g, refactor.length + Math.floor(n / 2) + 1)),
    ],
    conflicts: refactor.flatMap((r) => others.slice(0, 2).map((o) => ({ issues: [r.number, o.number], reason: `#${r.number} looks like a repo-wide change: run it alone, with no other run open.`, files: [] }))),
    enrich: todo.filter((i) => String(i.body || '').trim().length < 120).map((i) => ({ issue: i.number, reason: 'The description is too short to implement without guessing.' })),
  };
}

// ---- the conversation ---------------------------------------------------------------------------
const chatFile = (backlogDir, projectId) => path.join(backlogDir, `${path.basename(String(projectId))}.po.jsonl`);

function readConversation(backlogDir, projectId) {
  try {
    return fs.readFileSync(chatFile(backlogDir, projectId), 'utf8').split('\n')
      .map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

function appendMessage(backlogDir, projectId, message) {
  const m = { ts: new Date().toISOString(), ...message };
  fs.mkdirSync(backlogDir, { recursive: true });
  fs.appendFileSync(chatFile(backlogDir, projectId), `${JSON.stringify(m)}\n`);
  return m;
}

function clearConversation(backlogDir, projectId) {
  fs.rmSync(chatFile(backlogDir, projectId), { force: true });
  return [];
}

// The last exchanges, so a follow-up question has its context (answers as their summary only).
function previousExchanges(messages) {
  const recent = messages.filter((m) => m.role === 'user' || m.role === 'po').slice(-PREVIOUS_EXCHANGES * 2);
  if (!recent.length) return '';
  return `## Earlier in this conversation\n${recent.map((m) => (m.role === 'user' ? `Owner: ${clip(m.text, 500)}` : `You: ${clip(m.answer?.summary || m.text, 1500)}`)).join('\n')}`;
}

// ---- usage: every real call, for the monthly budgets ------------------------------------------------
const usageFile = (backlogDir) => path.join(backlogDir, 'product-owner.usage.jsonl');

function recordUsage(backlogDir, { projectId, model, tokens, costUsd }) {
  fs.mkdirSync(backlogDir, { recursive: true });
  fs.appendFileSync(usageFile(backlogDir), `${JSON.stringify({ ts: new Date().toISOString(), projectId, provider: 'claude', model, tokens: tokens || {}, costUsd: costUsd || 0 })}\n`);
}

/**
 * The Product Owner's calls this month, every project, as sessions for usage.withPeerUsage
 * ([{ provider, model, tokens, costUsd }]): its spend is in no run, so budgetBaseline misses it.
 */
function monthUsage(backlogDir, now = new Date()) {
  const month = now.toISOString().slice(0, 7);
  let lines = [];
  try { lines = fs.readFileSync(usageFile(backlogDir), 'utf8').split('\n'); } catch { return []; }
  return lines.map((l) => { try { return l ? JSON.parse(l) : null; } catch { return null; } })
    .filter((u) => u && String(u.ts).slice(0, 7) === month)
    .map((u) => ({ provider: u.provider, model: u.model, tokens: u.tokens, costUsd: u.costUsd }));
}

/** Throws when Claude Code already reached a blocking monthly budget (`budget`: usage.budgetBaseline plus monthUsage). */
function checkBudget(budget) {
  const b = budget?.claude;
  if (b?.blockOnLimit && ((b.limitUsd && b.usedUsd >= b.limitUsd) || (b.limitTokens && b.usedTokens >= b.limitTokens))) {
    throw new Error(`${b.name || 'Claude Code'} already reached its monthly budget. Raise it in Usage to ask the Product Owner.`);
  }
}

/**
 * Asks the Product Owner a question about a project's backlog and records the exchange.
 * @param data      the backlog with its runs (the service's withIssueRuns)
 * @param runs      the project's runs (runs.runsForProject), for the history
 * @param agent     the Product Owner agent (model, effort)
 * @returns { message, messages }  the answer ({ role: 'po', text, answer, model, costUsd }) and the whole conversation
 */
async function ask({ backlogDir, projectId, question, data, activeRuns, runs, workflows, folder, agent, skillsDirs, resolveCommand, budget, mock }) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Ask a question.');
  const history = runHistory(runs, data?.issues);
  const previous = readConversation(backlogDir, projectId);
  appendMessage(backlogDir, projectId, { role: 'user', text: q });
  let raw;
  let costUsd = 0;
  let model = 'simulated';
  let invalid = null;
  try {
    if (mock) {
      raw = mockAnswer({ data, question: q });
    } else {
      checkBudget(budget);
      let tokens;
      ({ raw, costUsd, model, invalid, tokens } = await callAgent({
        question: q, report: backlogReport({ data, activeRuns, history, workflows, question: q }), previous, folder, agent, skillsDirs, resolveCommand,
      }));
      recordUsage(backlogDir, { projectId, model, tokens, costUsd });
    }
  } catch (e) {
    const message = appendMessage(backlogDir, projectId, { role: 'po', text: e.message, error: true, costUsd });
    return { message, messages: readConversation(backlogDir, projectId) };
  }
  const answer = normalizeAnswer(raw, { issues: data?.issues, history, workflows });
  const message = appendMessage(backlogDir, projectId, {
    role: 'po', text: answer.summary, answer, model, costUsd, ...(invalid ? { invalid } : {}),
  });
  return { message, messages: readConversation(backlogDir, projectId) };
}

// One read-only Claude Code turn in the project folder. An answer that does not validate is kept as
// prose (no second call: one call per question).
async function callAgent({ question, report, previous, folder, agent, skillsDirs, resolveCommand }) {
  const { extractJson, validateSchema, render } = require('./engine/workflow');
  const { runTurn } = require('./engine/providers');
  const { resolveSkill, skillPrompt } = require('./skills');
  const { providerArgs, normalize, dedupeFlags } = require('./engine/capabilities');
  const { PROVIDERS } = require('./workflow-builder');
  const provider = Object.values(PROVIDERS).find((p) => p.type === 'claude-code');
  if (!resolveCommand(provider.command)) throw new Error(`The Product Owner needs ${provider.command}, which is not installed.`);
  if (!folder || !fs.existsSync(folder)) throw new Error('The project has no folder on this machine: the Product Owner reads its code there.');
  const skill = resolveSkill(skillsDirs, 'backlog-product-owner');
  const readOnly = providerArgs(provider.type, { caps: normalize({ tools: ['read'] }) }).args;
  const extraArgs = dedupeFlags([...readOnly, ...(provider.skill_args || []).map((x) => render(x, { skill_dir: skill.path }))], provider.args || []);
  const prompt = [
    skillPrompt(skill),
    RULES,
    report,
    previousExchanges(previous),
    `## The owner's question\n${question}`,
    `\n---\nAt the end of your response you MUST include a \`\`\`json block with an object that validates against this JSON Schema:\n\`\`\`json\n${JSON.stringify(ANSWER_SCHEMA, null, 2)}\n\`\`\``,
  ].filter(Boolean).join('\n\n');
  const res = await runTurn({
    provider, model: agent.model, effort: agent.effort && agent.effort !== 'default' ? agent.effort : undefined, prompt, cwd: folder, extraArgs,
    timeoutMs: 15 * 60e3, render, hint: { stepId: 'product-owner', visit: 1, agent: 'product-owner', schema: ANSWER_SCHEMA }, onItem: () => {},
  });
  let raw;
  let errs;
  try { raw = extractJson(res.text); errs = validateSchema(raw, ANSWER_SCHEMA); } catch (e) { errs = [e.message]; }
  if (errs.length) {
    const prose = String(res.text || '').replace(/```json[\s\S]*$/, '').trim();
    return { raw: { summary: prose || 'The answer could not be read.', groups: [], conflicts: [], enrich: [] }, costUsd: res.costUsd || 0, tokens: res.usage, model: agent.model, invalid: errs.join('; ') };
  }
  return { raw, costUsd: res.costUsd || 0, tokens: res.usage, model: agent.model, invalid: null };
}

module.exports = {
  ANSWER_SCHEMA,
  ask,
  backlogReport,
  clearConversation,
  complexityOf,
  estimate,
  mockAnswer,
  monthUsage,
  normalizeAnswer,
  readConversation,
  runHistory,
  sizeGroup,
};
