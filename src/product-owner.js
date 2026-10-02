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
//
// Registering an issue (#117, mode 'issue'): the same conversation drafts an issue with the owner,
// like the issue-tracker workflow's analyze + write steps in one turn (skills issue-triage and
// issue-writing, the code analyzer's cheaper model: ISSUE_AGENT). It may ask at most two short
// questions over the whole thread; each new message revises the whole draft (ISSUE_SCHEMA). The
// owner files it with a click (fileDraft: a new issue, or the addition appended to an existing
// issue's body as a dated section, or as a comment) or discards it (discardDraft); both are recorded
// in the conversation. Each issue thread (from its first message to the draft filed or discarded)
// has its own folder in the runs folder, <workspace>/runs/po-<projectId>-<stamp>/ (not a run: no
// events.jsonl, so run listings skip it): conversation.jsonl (the thread's messages), analysis/ (each
// turn's whole answer, with its evidence), attachments/ (the owner's files, moved there from the
// staging folder <workspace>/backlog/<projectId>.po/attachments/ when sent) and filed/ (every text
// sent to the platform). Clearing the conversation keeps these folders. A preview (simulated) never
// calls gh/glab.
//
// Splitting (#124, src/po-split.js): the plan answer's `splits` propose 2-4 child issues for each
// issue too big for one run; `applySplit` files them on the owner's click (the owner may move tasks
// or merge children first) and updates the parent. Epics (#138, src/epics.js): the answer's `epics`
// places issues in existing epics and proposes new ones (and epics to merge or split); `applyEpic`
// writes one of them on the owner's click. A registered issue's draft may name its epic: it joins it
// when the owner keeps "Place in epic" (on by default with the project's autoEpic option). Both are
// recorded in the conversation (`split`, `epicApplied`), so the drawer shows what was applied.
//
// Selected issues (#169, `selection`): the Backlog's "Send to Product Owner" attaches the selected
// issues to a plan question. The report gives them first and whole (bodies never clipped), the rules
// ask for groups of these issues only, with similar open issues that could join as each group's
// `suggested` (never in its `issues`: the owner adds one with a checkbox). Closed ones are left out of
// the groups and listed in the answer's `closed`. The user message records them (`issues`).

const fs = require('fs');
const path = require('path');
const backlog = require('./backlog');
const epics = require('./epics');
const poSplit = require('./po-split');
const { conflictsOf, sharedFiles } = require('./repo-performance');
const { storeFor } = require('./store');
const { readEvents } = require('./supervisor');

const MAX_REPORT = 60000;
const BODY_CLIP = 600;
const BODY_NAMED = 4000;
const HISTORY_RUNS = 20;
// the runs whose commits make the conflict map (#150: the files most runs edit, src/repo-performance.js)
const SHARED_FILE_RUNS = 50;
const SHARED_FILES = 15;
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
          // why this `inputs.mode` (validated: the owner can try it in the app; auto: engine, refactor, docs, tests)
          mode_reason: { type: 'string' },
          files: { type: 'array', items: { type: 'string' } },
          stage: { type: 'integer' },
          warnings: { type: 'array', items: { type: 'string' } },
          // #169: open issues not attached by the owner that could join this group (same files or area)
          suggested: {
            type: 'array',
            items: { type: 'object', required: ['issue', 'reason'], properties: { issue: { type: 'integer' }, reason: { type: 'string' } } },
          },
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
    // #124: issues too big for one run, each split into 2-4 children (tasks: the parent's task numbers)
    splits: {
      type: 'array',
      items: {
        type: 'object',
        required: ['issue', 'reasons', 'parent', 'children'],
        properties: {
          issue: { type: 'integer' },
          reasons: { type: 'array', items: { type: 'string' } },
          parent: { type: 'string', enum: ['umbrella', 'close'] },
          children: {
            type: 'array',
            items: {
              type: 'object',
              required: ['title', 'tasks', 'complexity', 'stage'],
              properties: {
                title: { type: 'string' },
                tasks: { type: 'array', items: { type: 'integer' } },
                complexity: { type: 'integer' },
                stage: { type: 'integer' },
                reason: { type: 'string' },
              },
            },
          },
        },
      },
    },
    // #138: issues to place in epics (`epic`: an id from the report's Epics), epics to create, merge or split
    epics: {
      type: 'object',
      properties: {
        place: { type: 'array', items: { type: 'object', required: ['issue', 'epic'], properties: { issue: { type: 'integer' }, epic: { type: 'string' }, reason: { type: 'string' } } } },
        create: { type: 'array', items: { type: 'object', required: ['title', 'goal', 'issues'], properties: { title: { type: 'string' }, goal: { type: 'string' }, issues: { type: 'array', items: { type: 'integer' } } } } },
        merge: { type: 'array', items: { type: 'object', required: ['epics', 'reason'], properties: { epics: { type: 'array', items: { type: 'string' } }, reason: { type: 'string' } } } },
        split: { type: 'array', items: { type: 'object', required: ['epic', 'reason'], properties: { epic: { type: 'string' }, reason: { type: 'string' } } } },
      },
    },
  },
};

const RULES = [
  'You are the Product Owner of this project\'s backlog, inside the orchestrator\'s Backlog screen. The owner asks you a question; answer it from the backlog report below and, when you need to, from the project\'s code (your working directory, read-only: docs/agents/code-map.md, grep).',
  'Propose groups of issues to implement in one run (same files, same feature, one reuses the other), pairs or sets that must not run in parallel (overlapping files, a repo-wide refactor or reformat), the order to run the groups in (`stage`: 1 first; groups of one stage may run in parallel), and the issues too vague to implement that should be enriched first.',
  'Use only issue numbers and workflow files listed in the report. Suggest the workflow inputs that matter (for example `mode`). Leave a list empty when the question is not about it.',
  'When the workflow has a `mode` input, set it on every group and say why in `mode_reason`: `validated` for a change the owner can try in the app (a screen, a dialog, a visible behaviour), `auto` for the engine, refactors, docs and tests.',
  'Split what is too big (`splits`): for an issue the report marks with split signals, propose 2-4 child issues. Each child has a title, the numbers of the parent\'s tasks it takes (every task in exactly one child, none dropped or invented), its complexity and its `stage` (children of one stage can run together). Say whether the parent becomes an umbrella linking its children or is closed in favour of them. Never split an issue without signals.',
  'Epics (`epics`): place each issue without an epic in an existing epic of its theme (`place`, the epic\'s id from the report); propose a new epic (a title, a one-paragraph goal, its member issues) when several issues share a theme and no epic exists; name epics to merge or split. Prefer grouping issues of the same epic in one run when they touch the same code.',
  'You never edit issues, never start runs and never answer a human gate: the owner applies a proposal with a click. Do not prescribe code changes.',
  'Write in English. The summary is Markdown, short, and answers the question.',
].join('\n');

// #169: added to RULES when the owner attached issues from the Backlog
const SELECTION_RULES = [
  'The owner attached issues to this question (the report\'s "Attached issues", in full): the question is about them. Propose groups and stages for these issues only: one run or separate runs, the workflow and its mode, the stage order, what must not run in parallel, and each group\'s size.',
  'For each group, list in `suggested` the other open issues to do that could join it (the same files or area), each with why. Never put an issue the owner did not attach in a group\'s `issues`: the owner decides whether a suggested issue joins.',
  'Leave the attached issues that are closed out of every group.',
].join('\n');

const clip =(s, n) => { s = String(s ?? '').trim(); return s.length > n ? `${s.slice(0, n)}… (${s.length - n} more characters)` : s; };
const minutes = (ms) => Math.round((ms || 0) / 60e3);

/** The complexity of an issue from its `complexity:n` label (null when it has none). */
function complexityOf(issue) {
  for (const l of issue?.labels || []) {
    const m = String(l?.name ?? l).match(/^complexity\s*[:=/-]?\s*(\d+)/i);
    if (m) return Number(m[1]);
  }
  return null;
}

// Whether a run hit the context limit (the engine's "context limit: ..." logs) or a test step ran out
// of time (a timeout on a step whose id names tests): a split signal for issues of its size (#124).
function limitsOf(runDir) {
  let hitContext = false;
  let hitTestTime = false;
  for (const e of readEvents(runDir)) {
    const msg = String(e.message || e.error || '');
    if (e.type === 'log' && /^context limit/i.test(msg)) hitContext = true;
    if (/test/i.test(String(e.stepId || e.step || '')) && /timed? ?out|time budget|ran far longer/i.test(msg)) hitTestTime = true;
  }
  return { hitContext, hitTestTime };
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
        ...(r.runDir ? limitsOf(r.runDir) : { hitContext: false, hitTestTime: false }),
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
 * With a `selection` (#169): a group keeps only the open attached issues; another open issue it names
 * becomes one of its `suggested` issues (open, not in the group, once per group); the closed attached
 * issues are listed in `closed`.
 */
// `mock`: a simulated answer, whose groups may carry a synthesized applied state (`simulated`, #148).
function normalizeAnswer(answer, { issues, history, workflows, epics: epicList = [], selection = [], mock = false }) {
  const numbers = new Set((issues || []).map((i) => i.number));
  const byNumber = new Map((issues || []).map((i) => [i.number, i]));
  const files = (workflows || []).map((w) => w.file);
  const fallback = files.includes('software-development.yaml') ? 'software-development.yaml' : files[0] || '';
  const keep = (list) => [...new Set((list || []).map(Number).filter((n) => numbers.has(n)))];
  const isOpen = (n) => byNumber.get(n)?.state === 'open';
  const attached = new Set(keep(selection));
  const closed = [...attached].filter((n) => !isOpen(n));
  const groups = (answer.groups || []).map((g, n) => {
    const named = keep(g.issues);
    const nums = attached.size ? named.filter((x) => attached.has(x) && isOpen(x)) : named;
    const moved = named.filter((x) => !attached.has(x)).map((issue) => ({ issue, reason: 'Named by the Product Owner for this group.' }));
    const suggested = [];
    for (const s of [...(g.suggested || []), ...(attached.size ? moved : [])]) {
      const x = Number(s?.issue);
      if (!isOpen(x) || attached.has(x) || nums.includes(x) || suggested.some((y) => y.issue === x)) continue;
      suggested.push({ issue: x, reason: String(s.reason || '') });
    }
    const size = sizeGroup(nums, issues, history);
    const simulated = mock && g.simulated ? keep(g.simulated.covered).filter((x) => nums.includes(x)) : [];
    return {
      name: String(g.name || `Group ${n + 1}`),
      issues: nums,
      workflow: files.includes(g.workflow) ? g.workflow : fallback,
      inputs: g.inputs && typeof g.inputs === 'object' && !Array.isArray(g.inputs) ? g.inputs : {},
      reason: String(g.reason || ''),
      ...(g.mode_reason ? { modeReason: String(g.mode_reason) } : {}),
      files: (g.files || []).map(String).slice(0, 20),
      stage: Number.isInteger(g.stage) && g.stage > 0 ? g.stage : n + 1,
      ...size,
      warnings: [...new Set([...size.warnings, ...(g.warnings || []).map(String)])],
      ...(suggested.length ? { suggested } : {}),
      ...(simulated.length ? { simulated: { covered: simulated, stage: Number.isInteger(g.simulated.stage) && g.simulated.stage > 0 ? g.simulated.stage : 1 } } : {}),
    };
  }).filter((g) => g.issues.length);
  return {
    summary: String(answer.summary || ''),
    groups,
    ...(closed.length ? { closed } : {}),
    conflicts: (answer.conflicts || []).map((c) => ({ issues: keep(c.issues), reason: String(c.reason || ''), files: (c.files || []).map(String).slice(0, 20) })).filter((c) => c.issues.length > 1),
    enrich: (answer.enrich || []).filter((e) => numbers.has(Number(e.issue))).map((e) => ({ issue: Number(e.issue), reason: String(e.reason || ''), link: ENRICH_ISSUE })),
    splits: normalizeSplits(answer.splits, byNumber, history),
    epics: normalizeEpics(answer.epics, byNumber, epicList),
  };
}

// One proposal per issue, kept to the split rules (po-split normalizeSplit): an issue without split signals is never split.
function normalizeSplits(list, byNumber, history) {
  const out = [];
  for (const s of list || []) {
    const issue = byNumber.get(Number(s?.issue));
    if (!issue || out.some((x) => x.issue === issue.number)) continue;
    const split = poSplit.normalizeSplit(s, issue, { complexity: complexityOf(issue), history });
    if (split) out.push(split);
  }
  return out;
}

// The epics section kept to what exists: open issues, known epics, a new epic with at least two members.
function normalizeEpics(raw, byNumber, epicList) {
  const ids = new Map((epicList || []).map((e) => [e.id, e]));
  const open = (n) => byNumber.get(Number(n))?.state === 'open' && !byNumber.get(Number(n))?.isEpic;
  const nums = (list) => [...new Set((list || []).map(Number).filter(open))];
  const place = [];
  for (const p of raw?.place || []) {
    const n = Number(p?.issue);
    const e = ids.get(String(p?.epic || '').trim());
    if (!open(n) || !e || byNumber.get(n).epic === e.id || place.some((x) => x.issue === n)) continue;
    place.push({ issue: n, epic: e.id, epicTitle: e.title, reason: String(p.reason || '') });
  }
  return {
    place,
    create: (raw?.create || []).map((c) => ({ title: String(c?.title || '').trim(), goal: String(c?.goal || '').trim(), issues: nums(c?.issues) }))
      .filter((c) => c.title && c.issues.length >= 2),
    merge: (raw?.merge || []).map((m) => ({ epics: [...new Set((m?.epics || []).map(String).filter((id) => ids.has(id)))], reason: String(m?.reason || '') }))
      .filter((m) => m.epics.length >= 2),
    split: (raw?.split || []).filter((s) => ids.has(String(s?.epic))).map((s) => ({ epic: String(s.epic), reason: String(s.reason || '') })),
  };
}

// Issues the Product Owner plans: open, and not already running, waiting, merged locally or done.
const plannable = (i) => i.state === 'open' && (!i.column || i.column === 'todo');

/**
 * The text context of a question: open issues (bodies clipped unless the question names them), the
 * queue, runs in progress, the local merges not pushed, the roadmap, the finished runs and the
 * workflows. Capped at MAX_REPORT characters. The issues the owner attached (`selection`, #169) come
 * first and whole, closed ones included (marked), outside the cap; the open issues then skip them.
 */
function backlogReport({ data, activeRuns = [], history = [], workflows = [], question = '', selection = [], shared = null }) {
  const named = new Set([...String(question).matchAll(/#(\d+)/g)].map((m) => Number(m[1])));
  const all = data?.issues || [];
  const attached = [...new Set(selection.map(Number))].map((n) => all.find((i) => i.number === n)).filter(Boolean);
  const issues = all.filter((i) => i.state === 'open' && !attached.includes(i));
  const issueText = (i, whole = false) => {
    const labels = (i.labels || []).map((l) => l.name).join(', ');
    const prs = (i.pullRequests || []).map((p) => `#${p.number}${p.draft ? ' (draft)' : ''}`).join(', ');
    const runs = (i.runs || []).slice(0, 3).map((r) => `${r.runId} ${r.status}`).join(', ');
    // #124: an issue too big for one run gets its signals and its numbered tasks (a split names them by number)
    const signals = plannable(i) ? poSplit.splitSignals(i, { complexity: complexityOf(i), history }) : [];
    const tasks = signals.length ? poSplit.parentTasks(i.body).slice(0, 60) : [];
    return [
      `### #${i.number} ${i.title}${i.isEpic ? ' (epic)' : ''}${i.state === 'open' ? '' : ' (closed: leave it out)'}`,
      `column: ${i.column || 'todo'}${labels ? ` · labels: ${labels}` : ''}${i.epic ? ` · epic ${i.epic}` : ''}${i.tasks?.total ? ` · ${i.tasks.total} tasks` : ''}${prs ? ` · open PRs: ${prs}` : ''}${i.queued ? ' · queued' : ''}${i.roadmap ? ` · roadmap stage ${i.roadmap.stage} (${i.roadmap.status})` : ''}${runs ? ` · runs: ${runs}` : ''}`,
      (whole ? String(i.body ?? '').trim() : clip(i.body, named.has(i.number) ? BODY_NAMED : BODY_CLIP)) || '(no description)',
      ...(signals.length ? [`Split signals: ${signals.join(' ')}`, `Tasks:\n${tasks.map((t) => `${t.n}. ${clip(t.text, 160)}`).join('\n')}`] : []),
    ].join('\n');
  };
  const epicList = data?.epics || [];
  const local = data?.local;
  const queue = data?.queue?.items || [];
  const stages = data?.roadmap?.stages || [];
  const sections = [
    `# Backlog of ${data?.projectId || 'the project'} (${issues.length} open issues, ${issues.filter(plannable).length} to do)`,
    `## Workflows\n${workflows.map((w) => `- ${w.file}: ${w.name}${w.inputs ? ` (inputs: ${Object.keys(w.inputs).join(', ')})` : ''}`).join('\n') || '(none)'}`,
    `## Queue\n${queue.map((q) => `- ${(q.issues || [q]).map((i) => `#${i.number}`).join(' + ')} → ${q.workflowName || q.workflow}`).join('\n') || '(empty)'}`,
    `## Runs in progress\n${activeRuns.map((r) => `- ${r.runId} ${r.workflow || ''} ${r.status}${r.waiting || r.gates?.length ? ' (waiting at a gate)' : ''}${r.issues?.length ? ` issues ${r.issues.map((i) => `#${i.number ?? i}`).join(', ')}` : ''}`).join('\n') || '(none)'}`,
    `## Merged locally, not pushed\n${local && !local.error ? `${local.ahead || 0} commits ahead${local.issues?.length ? `, issues ${local.issues.map((n) => `#${n}`).join(', ')}` : ''}` : '(unknown or none)'}`,
    `## Epics (id: title · members · open/closed)\n${epicList.map((e) => `- ${e.id}: ${e.title}${e.state === 'open' ? '' : ' (closed)'} · ${e.members.map((n) => `#${n}`).join(', ') || 'no members'} · ${e.progress?.open ?? 0} open, ${e.progress?.closed ?? 0} closed`).join('\n') || '(none)'}${data?.epicsError ? `\n(${data.epicsError})` : ''}`,
    `## Roadmap\n${stages.map((s, n) => `- stage ${n + 1}${s.name ? ` ${s.name}` : ''}: ${s.items.map((x) => `${(x.issues || []).map((i) => `#${i.number ?? i}`).join(' + ')} ${x.status}`).join('; ')}`).join('\n') || '(empty)'}`,
    `## Finished runs (newest first; agent time without gate waits)\n${history.map((h) => `- ${h.runId} ${h.workflow || ''} ${h.status} · issues ${h.issues.map((n) => `#${n}`).join(', ') || '-'} · complexity ${h.complexity ?? '?'} · ${h.agentMinutes} min · $${h.costUsd.toFixed(2)} · ${Math.round(h.tokens / 1e3)}k tokens${h.conflicts.count ? ` · ${h.conflicts.count} merge conflict(s)${h.conflicts.files.length ? ` in ${h.conflicts.files.join(', ')}` : ''}` : ''}`).join('\n') || '(none)'}`,
    // the conflict map (#150): parallel runs that edit the same file conflict when they merge
    ...(shared?.files?.length ? [`## Files most runs edit (of the last ${shared.runs} runs with commits; parallel runs that edit the same file conflict)\n${shared.files.map((f) => `- ${f.file}: ${f.runs} runs (${Math.round(f.share * 100)}%)`).join('\n')}`] : []),
  ];
  const whole = attached.length ? `## Attached issues (the owner's selection, in full)\n\n${attached.map((i) => issueText(i, true)).join('\n\n')}` : '';
  const head = [...sections, ...(whole ? [whole] : [])].join('\n\n');
  const out = [head, whole ? '## Other open issues' : '## Open issues'];
  // the attached issues are not counted: the cap only leaves out other issues
  let size = head.length - whole.length;
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
 * short description to enrich first. With a `selection` (#169): only the attached issues to do are
 * planned, and each group suggests up to two other issues to do of its topic.
 */
function mockAnswer({ data, question = '', selection = [] }) {
  const backlogTodo = (data?.issues || []).filter(plannable);
  const attached = new Set(selection.map(Number));
  const todo = attached.size ? backlogTodo.filter((i) => attached.has(i.number)) : backlogTodo;
  // issues of one epic group first (#138), then a shared label
  const topic = (i) => (i.epic ? `epic ${i.epic}` : null) || (i.labels || []).map((l) => l.name).find((n) => !/^complexity/i.test(n) && !/^(bug|enhancement|feature)$/i.test(n)) || null;
  const suggest = (nums) => {
    if (!attached.size) return [];
    const topics = new Set(nums.map((n) => topic(backlogTodo.find((i) => i.number === n))).filter(Boolean));
    return backlogTodo.filter((i) => !attached.has(i.number) && topics.has(topic(i))).slice(0, 2)
      .map((i) => ({ issue: i.number, reason: `Same area (${topic(i)}) as the attached issues (simulated).` }));
  };
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
      : g.issues.length > 1 ? `Same area (${/^epic /.test(g.topic) ? g.topic : `label ${g.topic}`}): likely the same files.` : 'On its own: no other issue shares its area.',
    files: [],
    stage,
    suggested: suggest(g.issues),
  });
  const splits = todo.map((i) => poSplit.proposeSplit(i, { complexity: complexityOf(i) })).filter(Boolean);
  const epicPlan = attached.size ? { place: [], create: [], merge: [], split: [] } : mockEpics(data);
  return {
    summary: [
      `**Simulated answer** (developer or simulated mode: no model was called)${question ? ` to: “${clip(question, 120)}”` : ''}.`,
      `${todo.length} ${attached.size ? 'attached ' : ''}issues to do:${groups.length + refactor.length} proposed run${groups.length + refactor.length === 1 ? '' : 's'}, grouped by epic, else by shared label; repo-wide changes first and alone, then stages of at most two runs.`,
      `${splits.length ? `${splits.length} issue${splits.length > 1 ? 's are' : ' is'} too big for one run: see the proposed splits.` : 'No issue is too big for one run.'} ${epicPlan.place.length + epicPlan.create.length ? `Epics: ${epicPlan.place.length} issue${epicPlan.place.length === 1 ? '' : 's'} to place, ${epicPlan.create.length} epic${epicPlan.create.length === 1 ? '' : 's'} to create.` : ''}`.trim(),
    ].join('\n\n'),
    splits,
    epics: epicPlan,
    groups: [
      ...refactor.map((i, n) => group({ issues: [i.number], refactor: true }, n + 1)),
      ...groups.map((g, n) => group(g, refactor.length + Math.floor(n / 2) + 1)),
    ],
    conflicts: refactor.flatMap((r) => others.slice(0, 2).map((o) => ({ issues: [r.number, o.number], reason: `#${r.number} looks like a repo-wide change: run it alone, with no other run open.`, files: [] }))),
    enrich: todo.filter((i) => String(i.body || '').trim().length < 120).map((i) => ({ issue: i.number, reason: 'The description is too short to implement without guessing.' })),
  };
}

// The simulated epics section: an open issue without an epic joins the epic whose members share its
// theme (its `area:` label, else its first topic label); themes of two or more issues without an epic become new epics.
function mockEpics(data) {
  const issues = (data?.issues || []).filter((i) => i.state === 'open' && !i.isEpic);
  const theme = (i) => {
    const names = (i.labels || []).map((l) => l.name).filter((n) => !/^(complexity|impact|epic)\b/i.test(n) && !/^(bug|enhancement|feature|documentation)$/i.test(n));
    return names.find((n) => /^area[:/]/i.test(n)) || names[0] || null;
  };
  const place = [];
  const loose = issues.filter((i) => !i.epic);
  for (const e of data?.epics || []) {
    const themes = new Set(issues.filter((i) => i.epic === e.id).map(theme).filter(Boolean));
    for (const i of loose) {
      if (theme(i) && themes.has(theme(i)) && !place.some((p) => p.issue === i.number)) place.push({ issue: i.number, epic: e.id, reason: `Shares the theme ${theme(i)} with the epic's members (simulated).` });
    }
  }
  const byTheme = new Map();
  for (const i of loose.filter((x) => !place.some((p) => p.issue === x.number))) {
    const t = theme(i);
    if (!t) continue;
    if (!byTheme.has(t)) byTheme.set(t, []);
    byTheme.get(t).push(i.number);
  }
  const title = (t) => { const s = t.replace(/^area[:/]\s*/i, '').replace(/[-_]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
  const create = [...byTheme].filter(([, ns]) => ns.length >= 2)
    .map(([t, ns]) => ({ title: title(t), goal: `The open issues about ${title(t).toLowerCase()} (label ${t}), tracked together (simulated).`, issues: ns }));
  return { place, create, merge: [], split: [] };
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
  fs.rmSync(poDir(backlogDir, projectId), { recursive: true, force: true });
  return [];
}

// The last exchanges, so a follow-up question has its context (answers as their summary only).
function previousExchanges(messages) {
  const recent = messages.filter((m) => m.role === 'user' || m.role === 'po').slice(-PREVIOUS_EXCHANGES * 2);
  if (!recent.length) return '';
  return `## Earlier in this conversation\n${recent.map((m) => (m.role === 'user' ? `Owner: ${clip(m.text, 500)}${m.issues?.length ? ` (attached ${m.issues.map((n) => `#${n}`).join(', ')})` : ''}` : `You: ${clip(m.answer?.summary || m.text, 1500)}`)).join('\n')}`;
}

// ---- registering an issue (#117) ---------------------------------------------------------------------
// The issue tracker's code analyzer (workflows/issue-tracker.yaml): cheaper than the planner's model.
const ISSUE_AGENT = { model: 'claude-sonnet-5', effort: 'medium' };
const MAX_QUESTIONS = 2;
const MAX_ATTACHMENT = 10 * 1024 * 1024;
const CLOSED_TITLES = 300;
const RELATIONS = ['duplicate', 'overlaps', 'related'];
const FILE_ACTIONS = ['append', 'comment', 'create'];

const ISSUE_SCHEMA = {
  type: 'object',
  required: ['reply', 'questions', 'draft', 'duplicates', 'existing_issue', 'addition', 'assumptions'],
  properties: {
    reply: { type: 'string' },
    questions: { type: 'array', items: { type: 'string' } },
    // title "" while a question is open
    draft: {
      type: 'object',
      required: ['title', 'body', 'labels', 'related'],
      properties: {
        title: { type: 'string' },
        body: { type: 'string' },
        labels: { type: 'array', items: { type: 'string' } },
        related: { type: 'array', items: { type: 'integer' } },
        // #138: the id of the existing epic it clearly belongs to ("" when none is clear)
        epic: { type: 'string' },
      },
    },
    duplicates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['number', 'relation'],
        properties: { number: { type: 'integer' }, relation: { type: 'string', enum: RELATIONS }, reason: { type: 'string' } },
      },
    },
    existing_issue: { type: 'integer' },
    addition: { type: 'string' },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
};

const ISSUE_RULES = [
  'You are the Product Owner of this project, registering an issue with its owner in a conversation inside the orchestrator\'s Backlog screen. The owner describes it in a few words (typed, dictated, sometimes with screenshots); you draft the issue; the owner reviews the draft and files it with a click.',
  'Analyse the request with the issue-triage skill, in the project\'s code (your working directory, read-only: docs/agents/code-map.md, grep): the code involved with evidence (file:line, today\'s behaviour), the files likely to change, impact and complexity, duplicates and overlapping issues from the backlog report (open and closed), open pull requests that already cover part of it, and the grouping advice.',
  'Write the draft with the issue-writing skill: a specific title; a context grounded in the evidence; "Decision (owner): ..." for every decision the owner stated; tasks as verifiable acceptance criteria (for a UI change, UI criteria: the controls, the states, what leads); "Related: #n". Add a short "Triage" section: impact and complexity with their reasons, the estimated files (marked as an estimate) and the grouping advice. Labels: `impact:<n>`, `complexity:<n>`, the kind, `area:<...>`.',
  `The owner is here. When the request is ambiguous in a way that changes the issue, ask at most ${MAX_QUESTIONS} short questions in the whole thread (in \`questions\`) and leave the draft's title empty; otherwise draft at once and list your assumptions in \`assumptions\`. Each new message of the owner refines the current draft: always return the whole draft again.`,
  'When the owner asks to add to an existing issue ("add this to #110"), or an open issue already covers the request (`relation: duplicate`), set `existing_issue` to its number and write in `addition` only the new part (a short context and the new tasks as a checklist), keeping what the issue already says; otherwise 0 and "".',
  'Epic: when the new issue clearly belongs to an existing epic of the report\'s Epics section, set `draft.epic` to its id; otherwise "" (and, when several issues share its theme with no epic, say so in `reply`).',
  'Language: answer the owner (`reply`, `questions`) in the language the owner writes in. The issue itself (title, body, labels, addition) is in English, the repository\'s language.',
  'You never file, edit or comment on issues and never start runs: the owner files the draft with a click. Do not prescribe code fixes beyond what the issue needs.',
].join('\n');

const poDir = (backlogDir, projectId) => path.join(backlogDir, `${path.basename(String(projectId))}.po`);
const attachDir = (backlogDir, projectId) => path.join(poDir(backlogDir, projectId), 'attachments');
const closesDraft = (m) => (m.filed && !m.filed.preview) || m.discarded;

/** Stores a file the owner pasted or dropped (base64 `data`) in the staging folder until it is sent: { name, path, size }. */
function saveAttachment(backlogDir, projectId, { name, data }) {
  const buf = Buffer.from(String(data || ''), 'base64');
  if (!buf.length) throw new Error('The file is empty.');
  if (buf.length > MAX_ATTACHMENT) throw new Error(`The file is larger than ${MAX_ATTACHMENT / 1024 / 1024} MB.`);
  const safe = path.basename(String(name || 'file')).replace(/[^\w.-]+/g, '-').slice(-80) || 'file';
  const dir = attachDir(backlogDir, projectId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${safe}`);
  fs.writeFileSync(file, buf);
  return { name: safe, path: file, size: buf.length };
}

// Only files of this conversation's attachments folder reach the prompt.
const isAttachment = (backlogDir, projectId, file) => {
  const dir = attachDir(backlogDir, projectId);
  const f = path.resolve(String(file || ''));
  return f.startsWith(dir + path.sep) && fs.existsSync(f);
};

/** The draft the owner can still file: the latest one, unless filed or discarded since. { index, message } or null. */
function currentDraft(messages) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (closesDraft(m)) return null;
    if (m.role === 'po' && m.mode === 'issue' && (m.issue?.draft || m.issue?.existingIssue)) return { index: i, message: m };
  }
  return null;
}

// The issue-mode messages since the last draft was filed or discarded.
function issueThread(messages) {
  const out = [];
  for (let i = messages.length - 1; i >= 0 && !closesDraft(messages[i]); i--) if (messages[i].mode === 'issue') out.unshift(messages[i]);
  return out;
}

// The questions the PO already asked in the open thread: MAX_QUESTIONS is a cap on the whole thread.
const questionsAsked = (messages) => issueThread(messages).filter((m) => m.role === 'po').reduce((n, m) => n + (m.issue?.questions?.length || 0), 0);

// The open thread's id (its folder's name in the runs folder), or a new one for its first message.
function threadOf(messages, projectId, now = new Date()) {
  const known = issueThread(messages).find((m) => m.thread)?.thread;
  return known || `po-${path.basename(String(projectId))}-${now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`;
}

// where: { backlogDir, projectId, runsDir }; without a runs folder the thread stays in the conversation's folder.
const threadDir = (where, thread) => path.join(where.runsDir || poDir(where.backlogDir, where.projectId), path.basename(String(thread)));

// Appends an issue-mode message to the conversation and to its thread's conversation.jsonl.
function recordIssueMessage(where, message) {
  const m = appendMessage(where.backlogDir, where.projectId, message);
  const dir = threadDir(where, m.thread);
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'conversation.jsonl'), `${JSON.stringify(m)}\n`);
  return m;
}

// Moves the staged attachments into the thread's attachments/ folder; returns their new paths.
function moveAttachments(where, thread, files) {
  if (!files.length) return [];
  const dir = path.join(threadDir(where, thread), 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  return files.map((f) => {
    const to = path.join(dir, path.basename(f));
    fs.copyFileSync(f, to);
    fs.rmSync(f, { force: true });
    return to;
  });
}

/** Keeps an issue answer to what exists (issue numbers of the backlog); a draft without a title is none. maxQuestions: what the thread has left. */
function normalizeIssueAnswer(raw, { issues, maxQuestions = MAX_QUESTIONS, epics: epicList = [] }) {
  const known = new Map((issues || []).map((i) => [i.number, i]));
  const epic = (epicList || []).find((e) => e.id === String(raw?.draft?.epic || '').trim());
  const d = raw?.draft || {};
  const title = String(d.title || '').trim();
  const existing = Number(raw?.existing_issue) || 0;
  const strings = (list) => (list || []).map((s) => String(s).trim()).filter(Boolean);
  return {
    reply: String(raw?.reply || ''),
    questions: strings(raw?.questions).slice(0, Math.max(0, maxQuestions)),
    draft: title ? {
      title,
      body: String(d.body || '').trim(),
      labels: [...new Set(strings(d.labels))],
      related: [...new Set((d.related || []).map(Number).filter((n) => known.has(n)))],
      ...(epic ? { epic: epic.id, epicTitle: epic.title } : {}),
    } : null,
    duplicates: (raw?.duplicates || []).filter((x) => known.has(Number(x.number))).map((x) => {
      const i = known.get(Number(x.number));
      return { number: i.number, title: i.title, state: i.state, relation: RELATIONS.includes(x.relation) ? x.relation : 'related', ...(x.reason ? { reason: String(x.reason) } : {}) };
    }),
    existingIssue: known.has(existing) ? existing : null,
    addition: known.has(existing) ? String(raw?.addition || '').trim() : '',
    assumptions: strings(raw?.assumptions),
  };
}

// The planner's report plus the closed issues' titles (duplicates may be closed).
function issueReport(args) {
  const closed = (args.data?.issues || []).filter((i) => i.state !== 'open').slice(0, CLOSED_TITLES);
  return `${backlogReport(args)}\n\n## Closed issues (titles only)\n${closed.map((i) => `- #${i.number} ${i.title}`).join('\n') || '(none)'}`;
}

// The thread's exchanges and the current draft in full, so the owner's next message revises it.
function issueContext(messages) {
  const thread = issueThread(messages);
  const parts = [previousExchanges(thread)];
  const open = currentDraft(messages)?.message.issue;
  if (open?.draft) parts.push(`## The current draft (revise it with the owner's new message)\n# ${open.draft.title}\nLabels: ${open.draft.labels.join(', ')}\n\n${clip(open.draft.body, BODY_NAMED * 2)}`);
  if (open?.existingIssue) parts.push(`## Current addition to #${open.existingIssue}\n${clip(open.addition, BODY_NAMED)}`);
  const asked = questionsAsked(messages);
  if (asked) {
    parts.push(asked >= MAX_QUESTIONS
      ? `## Questions\nYou already asked ${asked} questions in this thread, the most allowed: ask no more (\`questions\` empty), draft now and list your assumptions.`
      : `## Questions\nYou already asked ${asked} of at most ${MAX_QUESTIONS} questions in this thread: at most ${MAX_QUESTIONS - asked} more.`);
  }
  return parts.filter(Boolean).join('\n\n');
}

/**
 * The simulated issue answer: a short first request (under 8 words) gets one question; then a draft
 * built from the owner's messages, the open issues sharing two title words as overlaps, and "add
 * this to #n" as an addition to that issue.
 */
function mockIssueAnswer({ data, question = '', previous = [] }) {
  const issues = data?.issues || [];
  const thread = issueThread(previous);
  const said = [...thread.filter((m) => m.role === 'user').map((m) => m.text), question].map((t) => String(t).trim()).filter(Boolean);
  const target = Number(String(question).match(/\badd (?:this |it )?to #(\d+)/i)?.[1]) || 0;
  const empty = { title: '', body: '', labels: [], related: [] };
  if (said.length === 1 && question.split(/\s+/).filter(Boolean).length < 8 && !target) {
    return {
      reply: '**Simulated answer** (no model was called). One question before I draft it:',
      questions: ['Where does it happen (which screen or command), and what should happen instead?'],
      draft: empty, duplicates: [], existing_issue: 0, addition: '', assumptions: [],
    };
  }
  const words = (t) => new Set(String(t).toLowerCase().match(/[a-z]{4,}/g) || []);
  const asked = words(said.join(' '));
  const close = issues.filter((i) => i.state === 'open' && [...words(i.title)].filter((w) => asked.has(w)).length >= 2);
  const first = said[0].split(/(?<=[.!?])\s/)[0];
  const title = clip(first.charAt(0).toUpperCase() + first.slice(1), 80).replace(/[.!?]$/, '');
  const known = target && issues.some((i) => i.number === target) ? target : 0;
  // the epic most of the overlapping issues belong to (#138)
  const epic = close.map((i) => i.epic).find(Boolean) || '';
  return {
    reply: `**Simulated draft** (no model was called, no code was read). ${known ? `I would add this to #${known}: review the addition below.` : 'Review it below, or tell me what to change.'}`,
    questions: [],
    draft: {
      title,
      body: [
        '## Context', '', ...said.map((t) => `> ${t}`), '',
        `Decision (owner): ${said[said.length - 1]}`, '',
        '## Tasks', '', ...said.map((t) => `- [ ] ${t}`), '- [ ] Tests', '',
        ...(close.length ? [`Related: ${close.map((i) => `#${i.number}`).join(', ')}`] : []),
      ].join('\n'),
      labels: ['enhancement', 'impact:3', 'complexity:2'],
      related: close.map((i) => i.number),
      epic,
    },
    duplicates: close.map((i) => ({ number: i.number, relation: 'overlaps', reason: 'Shares words with the request (simulated).' })),
    existing_issue: known,
    addition: known ? `- [ ] ${question.replace(/\badd (?:this |it )?to #\d+:?\s*/i, '').trim() || said[0]}` : '',
    assumptions: ['Simulated: the code was not read.'],
  };
}

// ---- simulated scenarios (#148): the drawer's simulation-only picker forces the next answer ---------
// id → the mode it answers in (the drawer switches to it); 'error' answers in either mode.
const MOCK_SCENARIOS = {
  question: 'issue',
  draft: 'issue',
  duplicate: 'issue',
  'large-draft': 'issue',
  attachments: 'issue',
  groups: 'plan',
  'large-answer': 'plan',
  error: null,
};

/**
 * The simulated answer of a forced scenario (no model call), in the mode's raw shape (ANSWER_SCHEMA or
 * ISSUE_SCHEMA); 'error' throws, so the conversation records an error answer. `files`: the turn's
 * attachments (the 'attachments' scenario lists them in the draft).
 */
function mockScenario(scenario, { data, question = '', previous = [], files = [] }) {
  if (!(scenario in MOCK_SCENARIOS)) throw new Error(`Unknown simulated scenario: ${scenario}.`);
  if (scenario === 'error') throw new Error('Simulated error (scenario "error"): the Product Owner could not answer. Nothing was spent.');
  const issues = (data?.issues || []).filter((i) => i.state === 'open');
  const nums = issues.map((i) => i.number);
  const head = `**Simulated answer** (scenario "${scenario}": no model was called)`;
  const empty = { title: '', body: '', labels: [], related: [] };
  const issueAnswer = (x) => ({ reply: head, questions: [], draft: empty, duplicates: [], existing_issue: 0, addition: '', assumptions: ['Simulated: the code was not read.'], ...x });
  const draft = (title, body, extra = {}) => ({ title, body, labels: ['bug', 'impact:3', 'complexity:2'], related: nums.slice(0, 2), epic: '', ...extra });
  if (scenario === 'question') {
    return issueAnswer({ reply: `${head}. Two questions before I draft it:`, questions: ['Which screen or command shows it?', 'What should happen instead?'] });
  }
  if (scenario === 'draft') {
    return issueAnswer({ draft: draft(clip(question, 80) || 'Simulated issue', `## Context\n\n> ${question}\n\n## Tasks\n\n- [ ] Fix it\n- [ ] Tests\n`) });
  }
  if (scenario === 'duplicate') {
    const [dup, overlap] = nums;
    return issueAnswer({
      reply: `${head}. ${dup ? `#${dup} already covers this: add it there, or file it anyway.` : 'No open issue to compare with in this backlog.'}`,
      draft: draft(clip(question, 80) || 'Simulated duplicate', `## Context\n\n> ${question}\n`),
      duplicates: [
        ...(dup ? [{ number: dup, relation: 'duplicate', reason: 'Same symptom and same screen (simulated).' }] : []),
        ...(overlap ? [{ number: overlap, relation: 'overlaps', reason: 'Touches the same file (simulated).' }] : []),
      ],
      existing_issue: dup || 0,
      addition: dup ? `- [ ] ${question}` : '',
    });
  }
  if (scenario === 'large-draft') {
    const sections = Array.from({ length: 12 }, (_, n) => `## Part ${n + 1}\n\n${'A long paragraph of simulated context to scroll through. '.repeat(8)}\n\n${Array.from({ length: 6 }, (__, t) => `- [ ] Task ${n + 1}.${t + 1}: a step of the simulated work`).join('\n')}`);
    return issueAnswer({
      reply: `${head}. ${'A long reply to check the scroll position of the conversation. '.repeat(10)}`,
      draft: draft(`A very long simulated title that goes on to check how the drawer cuts a long title with an ellipsis (${clip(question, 40)})`, sections.join('\n\n'), { labels: ['enhancement', 'impact:4', 'complexity:5', 'area:backlog', 'area:renderer'] }),
      assumptions: Array.from({ length: 8 }, (_, n) => `Simulated assumption ${n + 1}: recorded instead of asking.`),
    });
  }
  if (scenario === 'attachments') {
    const names = files.map((f) => String(f).split(/[\\/]/).pop());
    return issueAnswer({
      draft: draft(clip(question, 80) || 'Simulated issue with screenshots', `## Context\n\n> ${question}\n\n## Screenshots (${names.length})\n\n${names.map((f) => `- ${f}`).join('\n') || '- (none attached)'}\n`),
    });
  }
  // plan scenarios: one group already applied, one partly, the rest still to apply. The applied state is
  // synthesized (`simulated.covered`, shown by the drawer as in the roadmap at `simulated.stage`), so
  // it shows whatever the backlog's roadmap, queue and runs hold; nothing is written to the roadmap.
  const todo = issues.filter(plannable);
  const [one, two, three, ...rest] = todo;
  const pairs = [];
  for (let n = 0; n < rest.length; n += 2) pairs.push(rest.slice(n, n + 2).map((i) => i.number));
  const group = (name, list, stage, reason, extra = {}) => ({ name, issues: list, workflow: 'software-development.yaml', inputs: {}, reason, files: ['src/renderer/views/backlog/backlog-po.js'], stage, ...extra });
  const groups = [
    ...(one ? [group('Already applied', [one.number], 1, 'Already in the roadmap (simulated).', { simulated: { covered: [one.number], stage: 1 } })] : []),
    ...(two ? [group('Partly applied', [two.number, ...(three ? [three.number] : [])], 1, 'One issue already in the roadmap, one not (simulated).', { simulated: { covered: [two.number], stage: 1 } })] : []),
    ...pairs.slice(0, scenario === 'large-answer' ? 12 : 4).map((p, n) => group(`Group ${n + 1}`, p, Math.floor(n / 2) + 2, 'Same area (simulated).')),
  ];
  const long = scenario === 'large-answer' ? `\n\n${Array.from({ length: 15 }, (_, n) => `Paragraph ${n + 1}. ${'A long simulated explanation of the plan to check the scroll position of the conversation. '.repeat(5)}`).join('\n\n')}` : '';
  return {
    summary: `${head}. ${groups.length} proposed run${groups.length === 1 ? '' : 's'}${groups.length > 1 ? ', the first one already applied and the second one partly' : ''}.${long}`,
    groups,
    conflicts: pairs.length > 1 ? [{ issues: [pairs[0][0], pairs[1][0]], reason: 'Both change the same file (simulated).', files: ['src/renderer/views/backlog/backlog-po.js'] }] : [],
    enrich: scenario === 'large-answer' ? todo.slice(0, 5).map((i) => ({ issue: i.number, reason: 'The description is too short (simulated).' })) : [],
    splits: [],
    epics: {},
  };
}

// The body filed for a new issue: the draft, with its Related line when the body has none.
const createBody = (draft) => (draft.related.length && !/^Related:/im.test(draft.body)
  ? `${draft.body}\n\nRelated: ${draft.related.map((n) => `#${n}`).join(', ')}\n` : `${draft.body}\n`);

/**
 * Files the current draft on the owner's click and records it in the conversation.
 * at: the draft message's ts (a draft revised, filed or discarded since is refused);
 * action: 'create' (a new issue), 'append' (a dated section at the end of issue `number`'s body) or
 * 'comment' (a comment on `number`). `number` defaults to the draft's existing issue; the text added
 * is the draft's addition for that issue, else the whole draft. `preview` never calls the CLI.
 * The text sent is kept in the thread's folder (runsDir) under filed/.
 * placeEpic (#138): a new issue joins the draft's epic (`epicList`: the cache's epics) once filed.
 * Returns { preview, action, command, body, filed, message, messages, skippedLabels? }.
 */
async function fileDraft({ backlogDir, projectId, runsDir, at, action, number, preview, platform, repo, cached = null, placeEpic = false, epicList = [], exec = backlog.execCli }) {
  if (!FILE_ACTIONS.includes(action)) throw new Error(`Unknown action: ${action} (${FILE_ACTIONS.join(', ')}).`);
  const messages = readConversation(backlogDir, projectId);
  const open = currentDraft(messages);
  if (!open || open.message.ts !== at) throw new Error('This draft was filed, discarded or revised since: use the latest draft.');
  const issue = open.message.issue;
  const where = { backlogDir, projectId, runsDir };
  const thread = threadOf(messages, projectId);
  const dir = path.join(threadDir(where, thread), 'filed');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  let command;
  let body;
  let file;
  let target = null;
  let skippedLabels = [];
  if (action === 'create') {
    if (!issue.draft) throw new Error('There is no draft to file yet.');
    body = createBody(issue.draft);
    let labels = issue.draft.labels;
    // gh refuses a label the repository does not have: file without it and say so
    const names = preview ? null : await backlog.repoLabels({ platform, repo, exec });
    if (names) { skippedLabels = labels.filter((l) => !names.includes(l)); labels = labels.filter((l) => names.includes(l)); }
    file = path.join(dir, `${stamp}-new.md`);
    command = backlog.issueCreateCommand({ platform, repo, title: issue.draft.title, labels, file, text: body });
  } else {
    target = Number(number) || issue.existingIssue;
    if (!target) throw new Error('Pick the issue to add to.');
    const addition = issue.existingIssue === target && issue.addition ? issue.addition : issue.draft ? `### ${issue.draft.title}\n\n${issue.draft.body}` : '';
    if (!addition) throw new Error('There is nothing to add yet.');
    if (action === 'comment') body = `${addition}\n`;
    else body = backlog.issueAppendBody({ original: preview ? cached?.body : (await backlog.fetchIssue({ platform, repo, number: target, exec })).body, addition });
    file = path.join(dir, `${stamp}-${target}.md`);
    command = backlog.issueSaveCommand({ platform, repo, number: target, mode: action === 'comment' ? 'comment' : 'replace', file, text: body });
  }
  const out = { preview: !!preview, action, command: command.display, body };
  const epic = action === 'create' && placeEpic && issue.draft?.epic ? (epicList || []).find((e) => e.id === issue.draft.epic) : null;
  if (preview) {
    const filed = { action, number: target, preview: true, draft: at, command: command.display, ...(epic ? { epic: epic.id } : {}) };
    const message = recordIssueMessage(where, { role: 'po', mode: 'issue', thread, text: `**Preview** (simulated): nothing was filed. The app would run \`${command.display}\`${epic ? `, then place the issue in the epic ${epic.id} ${epic.title}` : ''}.`, filed });
    return { ...out, filed, message, messages: readConversation(backlogDir, projectId) };
  }
  // gh reads the body from it; for glab it is the record of what was sent
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, body);
  const stdout = String(await exec(command.cli, command.args) || '');
  const url = stdout.match(/https?:\/\/\S+/)?.[0] || null;
  let filed;
  let text;
  if (action === 'create') {
    const n = Number(url?.match(/\/(\d+)\/?$/)?.[1]) || null;
    filed = { action, number: n, url, title: issue.draft.title, draft: at, labels: issue.draft.labels.filter((l) => !skippedLabels.includes(l)) };
    text = `Filed ${n ? `[#${n}](${url})` : url || 'the issue'}: ${issue.draft.title}.${skippedLabels.length ? ` Labels the repository does not have were left out: ${skippedLabels.join(', ')}.` : ''}`;
    if (epic && n) {
      try {
        await epics.applyEpic({ platform, repo, epic: { id: epic.id }, issues: [n], epics: epicList, dir, exec });
        filed.epic = epic.id;
        text += ` Placed in the epic ${epic.id} ${epic.title}.`;
      } catch (e) { text += ` It could not be placed in the epic ${epic.id}: ${e.message}`; }
    }
  } else {
    const issueUrl = cached?.url || null;
    filed = { action, number: target, url: action === 'comment' ? url || issueUrl : issueUrl, draft: at };
    const ref = filed.url ? `[#${target}](${filed.url})` : `#${target}`;
    text = action === 'comment' ? `Commented on ${ref}.` : `Added to ${ref}: a dated section at the end of its description, the rest kept as it was.`;
  }
  filed.folder = threadDir(where, thread);
  text += ` The conversation and the analysis are kept in \`${filed.folder}\`.`;
  const message = recordIssueMessage(where, { role: 'po', mode: 'issue', thread, text, filed });
  return { ...out, filed, message, messages: readConversation(backlogDir, projectId), ...(skippedLabels.length ? { skippedLabels } : {}) };
}

/** Discards the current draft (at: its ts): nothing is filed; recorded in the conversation and its thread's folder. Returns the conversation. */
function discardDraft(backlogDir, projectId, at, runsDir) {
  const messages = readConversation(backlogDir, projectId);
  const open = currentDraft(messages);
  if (!open || open.message.ts !== at) throw new Error('This draft was filed, discarded or revised since.');
  recordIssueMessage({ backlogDir, projectId, runsDir }, { role: 'po', mode: 'issue', thread: threadOf(messages, projectId), text: 'Draft discarded: nothing was filed.', discarded: at });
  return readConversation(backlogDir, projectId);
}

// ---- applying a plan answer's splits (#124) and epics (#138), on the owner's click ---------------------
// The answer message (its ts: `at`) a split or an epic belongs to, and whether it was applied already.
function planAnswer(messages, at) {
  const m = messages.find((x) => x.ts === at && x.role === 'po' && x.answer);
  if (!m) throw new Error('That answer is no longer in the conversation.');
  return m;
}
// Each apply keeps the texts it sent in its own folder of the runs folder, like an issue thread.
const applyDir = (where, kind) => path.join(threadDir(where, `po-${path.basename(String(where.projectId))}-${kind}-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`), 'filed');

/**
 * Files a proposed split (the owner may have moved tasks or merged children: `split` is the edited
 * proposal { issue, parent, children }) and records it in the conversation. data: the synced backlog.
 * Returns fileSplit's result plus { message, messages }.
 */
async function applySplit({ backlogDir, projectId, runsDir, at, split, preview, platform, repo, data, exec = backlog.execCli }) {
  const messages = readConversation(backlogDir, projectId);
  const answer = planAnswer(messages, at);
  const number = Number(split?.issue);
  if (!(answer.answer.splits || []).some((s) => s.issue === number)) throw new Error(`That answer proposes no split of #${number}.`);
  if (messages.some((m) => m.split && m.split.at === at && m.split.issue === number && !m.split.preview)) throw new Error(`#${number} was already split from this answer.`);
  const parent = (data?.issues || []).find((i) => i.number === number);
  const checked = poSplit.checkSplit(split, parent);
  const res = await poSplit.fileSplit({
    platform, repo, parent, split: checked, dir: applyDir({ backlogDir, projectId, runsDir }, `split-${number}`), preview, epicList: data?.epics || [], exec,
  });
  const refs = res.children.map((c) => (c.number ? `[#${c.number}](${c.url})` : c.title)).join(', ');
  const text = preview
    ? `**Preview** (simulated): nothing was filed. Splitting #${number} would run:\n${res.commands.map((c) => `- \`${c}\``).join('\n')}`
    : `Split #${number} into ${refs}. ${checked.parent === 'close' ? `#${number} was closed with a comment linking them.` : `#${number} is now an umbrella with a task list linking them.`}${res.skippedLabels ? ` Labels the repository does not have were left out: ${res.skippedLabels.join(', ')}.` : ''}${res.epicError ? ` The children could not join the parent's epic: ${res.epicError}` : ''}`;
  const message = appendMessage(backlogDir, projectId, {
    role: 'po', text, split: { at, issue: number, parent: checked.parent, children: res.children, ...(preview ? { preview: true } : {}) },
  });
  return { ...res, message, messages: readConversation(backlogDir, projectId) };
}

/**
 * Creates an epic or places issues in one, from an answer's epics section, and records it.
 * key: which proposal ('create:<n>' or 'place:<epic id>'); epic: { id } or { title, goal }; issues: the members.
 * Returns applyEpic's result plus { message, messages }.
 */
async function applyEpicProposal({ backlogDir, projectId, runsDir, at, key, epic, issues, preview, platform, repo, data, exec = backlog.execCli }) {
  const messages = readConversation(backlogDir, projectId);
  planAnswer(messages, at);
  if (messages.some((m) => m.epicApplied && m.epicApplied.at === at && m.epicApplied.key === key && !m.epicApplied.preview)) throw new Error('This epic proposal was already applied.');
  const known = new Set((data?.issues || []).filter((i) => i.state === 'open').map((i) => i.number));
  const members = (issues || []).map(Number).filter((n) => known.has(n));
  if (!members.length && epic?.id) throw new Error('Pick the issues to place in the epic.');
  const res = await epics.applyEpic({
    platform, repo, epic, issues: members, epics: data?.epics || [], dir: applyDir({ backlogDir, projectId, runsDir }, 'epic'), preview, exec,
  });
  const ref = res.epic.url ? `[${res.epic.id}](${res.epic.url})` : res.epic.id;
  const text = preview
    ? `**Preview** (simulated): nothing was written. The app would run:\n${res.commands.map((c) => `- \`${c}\``).join('\n')}`
    : `${epic?.id ? 'Placed' : `Created the epic ${ref} ${res.epic.title} and placed`} ${res.linked.map((n) => `#${n}`).join(', ') || 'no issue'}${epic?.id ? ` in the epic ${ref} ${res.epic.title}` : ' in it'}.`;
  const message = appendMessage(backlogDir, projectId, {
    role: 'po', text, epicApplied: { at, key, epic: res.epic, linked: res.linked, ...(preview ? { preview: true } : {}) },
  });
  return { ...res, message, messages: readConversation(backlogDir, projectId) };
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
 * @param agent     the Product Owner agent (model, effort); registering an issue uses ISSUE_AGENT
 * @param mode      'plan' (default) or 'issue' (#117: register an issue; `attachments`: paths saved by saveAttachment,
 *                  moved to the thread's folder in `runsDir`, which also keeps the thread and each turn's analysis)
 * @param scenario  with `mock` only: a MOCK_SCENARIOS id forcing the simulated answer (#148)
 * @returns { message, messages }  the answer ({ role: 'po', text, answer | issue, model, costUsd }) and the whole conversation
 */
async function ask({ backlogDir, projectId, runsDir, question, data, activeRuns, runs, workflows, folder, agent, skillsDirs, resolveCommand, budget, mock, mode = 'plan', attachments = [], selection = [], scenario = null }) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Ask a question.');
  const issueMode = mode === 'issue';
  // #169: the attached issues the backlog knows (plan mode only)
  const known = new Set((data?.issues || []).map((i) => i.number));
  const selected = issueMode ? [] : [...new Set((selection || []).map(Number))].filter((n) => known.has(n));
  const history = runHistory(runs, data?.issues);
  const previous = readConversation(backlogDir, projectId);
  const where = { backlogDir, projectId, runsDir };
  const thread = issueMode ? threadOf(previous, projectId) : null;
  const tag = issueMode ? { mode: 'issue', thread } : {};
  const record = (message) => (issueMode ? recordIssueMessage(where, message) : appendMessage(backlogDir, projectId, message));
  const staged = issueMode ? (attachments || []).filter((f) => isAttachment(backlogDir, projectId, f)).map((f) => path.resolve(f)) : [];
  const files = moveAttachments(where, thread, staged);
  record({ role: 'user', text: q, ...tag, ...(files.length ? { attachments: files } : {}), ...(selected.length ? { issues: selected } : {}) });
  const questionsLeft = MAX_QUESTIONS - questionsAsked(previous);
  let raw;
  let costUsd = 0;
  let model = 'simulated';
  let invalid = null;
  let analysis = '';
  try {
    // a scenario of the other mode is ignored (the default simulated answer)
    if (mock && scenario && (MOCK_SCENARIOS[scenario] ?? mode) === mode) {
      raw = mockScenario(scenario, { data, question: q, previous, files });
      analysis = `Simulated (scenario "${scenario}"): no model was called, no code was read.`;
    } else if (mock) {
      raw = issueMode ? mockIssueAnswer({ data, question: q, previous }) : mockAnswer({ data, question: q, selection: selected });
      analysis = 'Simulated: no model was called, no code was read.';
    } else {
      checkBudget(budget);
      let tokens;
      const shared = issueMode ? null : await sharedFiles({ runs: (runs || []).filter((r) => !r.mock).slice(0, SHARED_FILE_RUNS), repo: folder, store: storeFor(runsDir), limit: SHARED_FILES });
      const report = (issueMode ? issueReport : backlogReport)({ data, activeRuns, history, workflows, question: q, selection: selected, shared });
      ({ raw, costUsd, model, invalid, tokens, text: analysis } = await callAgent({
        mode, question: q, report, previous, attachments: files, selection: selected, folder, agent: issueMode ? ISSUE_AGENT : agent, skillsDirs, resolveCommand,
      }));
      recordUsage(backlogDir, { projectId, model, tokens, costUsd });
    }
  } catch (e) {
    const message = record({ role: 'po', ...tag, text: e.message, error: true, costUsd });
    return { message, messages: readConversation(backlogDir, projectId) };
  }
  let message;
  if (issueMode) {
    const issue = normalizeIssueAnswer(raw, { issues: data?.issues, maxQuestions: questionsLeft, epics: data?.epics });
    message = recordIssueMessage(where, { role: 'po', ...tag, text: issue.reply, issue, model, costUsd, ...(invalid ? { invalid } : {}) });
    // the turn's whole answer (code evidence, triage) next to the thread
    const dir = path.join(threadDir(where, thread), 'analysis');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${message.ts.replace(/[:.]/g, '-')}.md`), `${String(analysis || '').trim()}\n\n\`\`\`json\n${JSON.stringify(raw, null, 2)}\n\`\`\`\n`);
  } else {
    const answer = normalizeAnswer(raw, { issues: data?.issues, history, workflows, epics: data?.epics, selection: selected, mock: !!mock });
    message = appendMessage(backlogDir, projectId, {
      role: 'po', text: answer.summary, answer, model, costUsd, ...(invalid ? { invalid } : {}),
    });
  }
  return { message, messages: readConversation(backlogDir, projectId) };
}

// One read-only Claude Code turn in the project folder. An answer that does not validate is kept as
// prose (no second call: one call per question). Mode 'issue': the issue skills, ISSUE_SCHEMA, and
// read access to the attachments' folder.
async function callAgent({ mode = 'plan', question, report, previous, attachments = [], selection = [], folder, agent, skillsDirs, resolveCommand }) {
  const { extractJson, validateSchema, render } = require('./engine/workflow');
  const { runTurn } = require('./engine/providers');
  const { resolveSkill, skillPrompt } = require('./skills');
  const { providerArgs, normalize, dedupeFlags } = require('./engine/capabilities');
  const { PROVIDERS } = require('./workflow-builder');
  const provider = Object.values(PROVIDERS).find((p) => p.type === 'claude-code');
  if (!resolveCommand(provider.command)) throw new Error(`The Product Owner needs ${provider.command}, which is not installed.`);
  if (!folder || !fs.existsSync(folder)) throw new Error('The project has no folder on this machine: the Product Owner reads its code there.');
  const issueMode = mode === 'issue';
  const schema = issueMode ? ISSUE_SCHEMA : ANSWER_SCHEMA;
  const skills = (issueMode ? ['issue-triage', 'issue-writing'] : ['backlog-product-owner']).map((s) => resolveSkill(skillsDirs, s));
  const readOnly = providerArgs(provider.type, { caps: normalize({ tools: ['read'] }) }).args;
  const dirs = [...new Set(attachments.map((f) => path.dirname(f)))].flatMap((d) => ['--add-dir', d]);
  const extraArgs = dedupeFlags([...readOnly, ...dirs, ...skills.flatMap((skill) => (provider.skill_args || []).map((x) => render(x, { skill_dir: skill.path })))], provider.args || []);
  const prompt = [
    ...skills.map(skillPrompt),
    issueMode ? ISSUE_RULES : RULES,
    selection.length ? SELECTION_RULES : '',
    report,
    issueMode ? issueContext(previous) : previousExchanges(previous),
    issueMode ? `## The owner's new message\n${question}` : `## The owner's question\n${question}`,
    attachments.length ? `## Files the owner attached (read them; screenshots are images)\n${attachments.map((f) => `- ${f}`).join('\n')}` : '',
    `\n---\nAt the end of your response you MUST include a \`\`\`json block with an object that validates against this JSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``,
  ].filter(Boolean).join('\n\n');
  const res = await runTurn({
    provider, model: agent.model, effort: agent.effort && agent.effort !== 'default' ? agent.effort : undefined, prompt, cwd: folder, extraArgs,
    timeoutMs: 15 * 60e3, render, hint: { stepId: issueMode ? 'product-owner-issue' : 'product-owner', visit: 1, agent: 'product-owner', schema }, onItem: () => {},
  });
  let raw;
  let errs;
  try { raw = extractJson(res.text); errs = validateSchema(raw, schema); } catch (e) { errs = [e.message]; }
  if (errs.length) {
    const prose = String(res.text || '').replace(/```json[\s\S]*$/, '').trim() || 'The answer could not be read.';
    const fallback = issueMode
      ? { reply: prose, questions: [], draft: { title: '', body: '', labels: [], related: [] }, duplicates: [], existing_issue: 0, addition: '', assumptions: [] }
      : { summary: prose, groups: [], conflicts: [], enrich: [], splits: [], epics: {} };
    return { raw: fallback, costUsd: res.costUsd || 0, tokens: res.usage, model: agent.model, invalid: errs.join('; '), text: res.text || '' };
  }
  return { raw, costUsd: res.costUsd || 0, tokens: res.usage, model: agent.model, invalid: null, text: res.text || '' };
}

module.exports = {
  ANSWER_SCHEMA,
  applyEpicProposal,
  applySplit,
  ask,
  backlogReport,
  clearConversation,
  complexityOf,
  currentDraft,
  discardDraft,
  estimate,
  fileDraft,
  ISSUE_AGENT,
  ISSUE_SCHEMA,
  MOCK_SCENARIOS,
  mockAnswer,
  mockIssueAnswer,
  mockScenario,
  monthUsage,
  normalizeAnswer,
  normalizeIssueAnswer,
  readConversation,
  runHistory,
  saveAttachment,
  SELECTION_RULES,
  sizeGroup,
};
