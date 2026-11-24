// The Backlog's Product Owner (#105; skill: backlog-product-owner): a built-in agent (packages/engine/domains/agents/agents.js)
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
// Simulated (developer mode, CRAFTORIO_SIMULATION_ONLY): mockAnswer builds the answer from the
// backlog itself, with no model call and no cost.
// Calibration (#189, apps/desktop/renderer/po-calibration.js): a plan question is planned with the agent's saved
// Speed ↔ Quality step, or a step for that question only; the prompt states its parameters, the simulated
// answer follows them, normalizeAnswer caps the runs per stage, and the answer records the step.
// Cost (#205, PoCalibration.cost): the saved Economy ↔ Generous step (`cost`), or one for the question
// ("plan this one cheap"). It sets the largest group (groupCap: cost wins over the calibration), packs
// groups of one area or files into one run at Economy (packGroups), sets the test, screenshot and
// agent inputs the group's workflow declares (costInputs; "not adjustable" when it has none) and adds
// a test-backfill stage after each stage with untested issues (testBatchStages). The answer records both
// steps and the plan's estimated total (#206, packages/engine/domains/usage/cost-estimate.js when the runs are given).
// Conflict map (#150, packages/engine/domains/project/conflict-map.js): the report's "## Conflict map" lists the files and lines most
// runs change (the saved map; when missing, the turn runs without it and builds it in the background once
// its agent is done, for the next Analyze (#526); capped at CONFLICT_MAP_CAP); the answer keeps groups
// touching one hot file in different stages and lists the hot spots in `decongest`, each with a fix the
// owner may file as an issue with a click.
// Live progress (#180, packages/engine/domains/chat/chat-progress.js): ask's `onItem` gets the turn's items as they arrive
// (a simulated turn streams fake steps first); its `signal` stops the turn, keeping what was written.
// The conversation is kept per project in <workspace>/backlog/<projectId>.po.jsonl until cleared.
// Each real call's cost and tokens also go to <workspace>/backlog/product-owner.usage.jsonl, which
// clearing does not touch: monthUsage feeds them to the monthly budget check (they are in no run).
// #280: a line is the agents' shared record (packages/engine/domains/agents/agents-usage.js); every call is a one-shot session.
//
// #785 (po-chosen-inputs.js): a group keeps only the inputs chosen, with their reasons (`input_reasons`), and
// the prompt names the project's `runDefaults`. Mode 'auto' (the drawer): the answer's `intent` says plan or register.
// #791 (po-kinds.js): each issue of a plan gets a kind; a group holds one kind, on that kind's workflow
// and inputs from the project (`workflowKinds`), and Economy never packs two kinds into one run.
// Registering an issue (#117, mode 'issue'): the same conversation drafts an issue with the owner,
// like the issue-tracker workflow's analyze + write steps in one turn (skills issue-triage and
// issue-writing, the code analyzer's cheaper model: ISSUE_AGENT); the draft carries its clarity score
// (#166, skill clarity-score) with each gap as an open question. It may ask at most two short
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
// A discovery card's commit (#258, packages/engine/domains/discovery/discovery-commit.js): `proposeCommit` proposes the issues a
// Ready card becomes (one read-only turn, mode 'commit': titles, the card's acceptance criteria as
// tasks, complexity, workflow), kept to the card by normalizeSplit; `mock` answers with the
// rule-based split. The owner edits and files it in the Discovery board's commit dialog.
// Splitting (#124, packages/engine/domains/po/po-split.js): the plan answer's `splits` propose 2-4 child issues for each
// issue too big for one run; `applySplit` files them on the owner's click (the owner may move tasks
// or merge children first) and updates the parent. Epics (#138, packages/engine/domains/backlog/epics.js): the answer's `epics`
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
//
// Its inbox (#240, packages/engine/domains/agents/agent-inbox.js): `handleRequest` takes another agent's request (the Oracle's)
// of a kind in REQUEST_KINDS. The mechanical kinds run the code of the owner's buttons, given by the
// service (`perform`); `plan` is a question to its model (`ask`). The request and its result are in
// the conversation, tagged `request: { from, kind, ref }`.

const fs = require('fs');
const path = require('path');
const agentInbox = require('../agents/agent-inbox');
const agentsUsage = require('../agents/agents-usage');
const backlog = require('../backlog/backlog');
const { filedIssue } = require('../backlog/local-backlog');
const { isArchived } = require('@craftorio/shared/backlog-archive');
const costEstimate = require('../usage/cost-estimate');
const DefaultWorkflow = require('@craftorio/shared/default-workflow');
const discoveryCommit = require('../discovery/discovery-commit');
const epics = require('../backlog/epics');
const poCalibration = require('@craftorio/shared/po-calibration');
const RoadmapModel = require('@craftorio/shared/roadmap-model');
const poSplit = require('./po-split');
const poMockups = require('./po-mockups');
const poChosen = require('./po-chosen-inputs');
const {
  kindGroups,
  kindOf,
  kindsSection,
} = require('./po-kinds');
const poFileIssues = require('./po-file-issues');
const { decongestIssue } = poFileIssues;
const { draftCommand } = require('./po-draft-command');
const { separateSharedFiles } = require('./po-hot-files');
const { mockSteps, partialText } = require('../chat/chat-progress');
const {
  hotSpots,
  readConflictMap,
  withConflictMap,
} = require('../project/conflict-map');
const { conflictsOf } = require('../project/repo-performance');
const { storeFor } = require('../workspace/store');
const { readEvents } = require('../supervisor/supervisor');
const Language = require('@craftorio/shared/language');
const TimeZone = require('../analytics/time-zone');

const MAX_REPORT = 60000;
const BODY_CLIP = 600;
const BODY_NAMED = 4000;
const HISTORY_RUNS = 20;
// the conflict map's section of the report (#150, packages/engine/domains/project/conflict-map.js): its rows and its size
const CONFLICT_MAP_FILES = 15;
const CONFLICT_MAP_LINES = 10;
const CONFLICT_MAP_CAP = 4000;
const PREVIOUS_EXCHANGES = 3;
// Past evidence (30 Sep 2026): a group of complexity 7 hit the context limit, grouped runs hit the test time budget.
const CONTEXT_WARN_AT = 7;
const TEST_TIME_WARN_AT = 5;
const DEFAULT_COMPLEXITY = 3;
// how to enrich an issue: the README's Write doc section (#648: the Backlog's Enrich starts write-doc)
const ENRICH_GUIDE = 'https://github.com/eduardogalbiati/craftorio#write-doc-workflowswrite-docyaml';

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
          // why this `inputs.validation` (validated: the owner can try it in the app)
          mode_reason: { type: 'string' },
          input_reasons: { type: 'object' }, // #785: { input: one short line }
          files: { type: 'array', items: { type: 'string' } },
          stage: { type: 'integer' },
          warnings: { type: 'array', items: { type: 'string' } },
          // #169: open issues not attached by the owner that could join this group (same files or area)
          suggested: {
            type: 'array',
            items: { type: 'object', required: ['issue', 'reason'], properties: { issue: { type: 'integer' }, reason: { type: 'string' } } },
          },
          // #791: the kind of each issue of the group (one kind per group), with a one-line reason
          issue_kinds: {
            type: 'array',
            items: {
              type: 'object',
              required: ['issue', 'kind', 'reason'],
              properties: { issue: { type: 'integer' }, kind: { type: 'string', enum: [...DefaultWorkflow.KINDS] }, reason: { type: 'string' } },
            },
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
    // #150: the conflict map's hot spots, each with a fix in the repository's terms (the owner files it as an issue)
    decongest: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'fix'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          fix: { type: 'string' },
          runs: { type: 'integer' },
          of: { type: 'integer' },
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
    // #670: the issues proposed from a spec (docs/work/<item>), each screen task naming its mockup;
    // the engine checks their mockup coverage (po-mockups.js specProposal)
    spec: {
      type: 'object',
      properties: {
        issues: { type: 'array', items: { type: 'object', required: ['title', 'body'], properties: { title: { type: 'string' }, body: { type: 'string' } } } },
      },
    },
  },
};

const RULES = [
  'You are the Product Owner of this project\'s backlog, inside the orchestrator\'s Backlog screen. The owner asks you a question; answer it from the backlog report below and, when you need to, from the project\'s code (your working directory, read-only: docs/agents/code-map.md, grep).',
  'Propose groups of issues to implement in one run (same files, same feature, one reuses the other), pairs or sets that must not run in parallel (overlapping files, a repo-wide refactor or reformat), the order to run the groups in (`stage`: 1 first; groups of one stage may run in parallel), and the issues too vague to implement that should be enriched first.',
  'Use only issue numbers and workflow files listed in the report. Leave a list empty when the question is not about it.',
  'Classify each issue (`issue_kinds`: feature, fix or refactor, with a one-line reason; a `bug` label suggests fix and a `refactor` label suggests refactor, the content decides when a label is missing or wrong) and never put two kinds in one group: a Fix and a Feature never share a run. A group gets its kind\'s workflow and inputs (the section "The project\'s workflow of each kind of issue"), else the default workflow (marked "(default)" in the report\'s Workflows), unless an issue needs another one; then say why in the group\'s `reason`.',
  'A group\'s `inputs` hold only what it needs different from the project\'s run defaults and the workflow\'s defaults: never repeat a default, never an empty string. Give each decision that matters a one-line reason in `input_reasons` ({ input: reason }), also for a default worth saying. When the workflow has a `validation` input, set `validated` for a change the owner can try in the app (a screen, a dialog, a visible behaviour) and say why in `mode_reason`; the engine, refactors, docs and tests stay at `auto`, its default.',
  'Split what is too big (`splits`): for an issue the report marks with split signals, propose 2-4 child issues. Each child has a title, the numbers of the parent\'s tasks it takes (every task in exactly one child, none dropped or invented), its complexity and its `stage` (children of one stage can run together). Say whether the parent becomes an umbrella linking its children or is closed in favour of them. Never split an issue without signals.',
  'Conflict map (the report\'s conflict-map section, when it has one): two groups expected to touch the same hot file or hot line go to different stages, or into one group when they belong together; every conflict you report names the hot file that causes it in `files`. List each hot spot (marked "hot") in `decongest` with a fix in the repository\'s terms (one item per line, sorted; a per-feature file plus a generated aggregate; a split by screen or module) and its `runs` and `of`.',
  'Shared test files count too: two groups of one stage that add scenarios to the same `.feature` file (or tests to the same test file) conflict in it at the merge, like a shared source file: put them in different stages or one group, and name that file in the conflict\'s `files`.',
  'Epics (`epics`): place each issue without an epic in an existing epic of its theme (`place`, the epic\'s id from the report); propose a new epic (a title, a one-paragraph goal, its member issues) when several issues share a theme and no epic exists; name epics to merge or split. Prefer grouping issues of the same epic in one run when they touch the same code.',
  'You never edit issues, never start runs and never answer a human gate: the owner applies a proposal with a click. Do not prescribe code changes.',
  'Write in the AI agents language the Language line names. The summary is Markdown, short, and answers the question.',
].join('\n');

// #169: added to RULES when the owner attached issues from the Backlog
const SELECTION_RULES = [
  'The owner attached issues to this question (the report\'s "Attached issues", in full): the question is about them. Propose groups and stages for these issues only: one run or separate runs, the workflow and its mode, the stage order, what must not run in parallel, and each group\'s size.',
  'For each group, list in `suggested` the other open issues to do that could join it (the same files or area, and the same kind: a bug never joins a feature\'s run), each with why. Never put an issue the owner did not attach in a group\'s `issues`: the owner decides whether a suggested issue joins.',
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
// `calibration` (#189, 1..5): the step it was planned with, recorded on the answer; a stage with more
// groups than the step's parallel runs is cut into consecutive stages (the later stages move down),
// and a group over the step's max complexity gets a warning.
// `defaultWorkflow` (#195, #790): the project's; a group without a known workflow gets it (or its fallback).
// `cost` (#205, 1..5): the Cost step it was planned with, recorded on the answer, applied to the groups
// (see the header); `runs` (#206): the past runs, for each group's `costEstimate` and the plan's `estimateUsd`.
// `workflow` (#235): the workflow the owner chose in the drawer: every group gets it (never another
// one), with `inputs` (the owner's choices for its options) in its inputs; the Cost step is skipped
// when it does not apply to that workflow (poCalibration.costApplies: tests first, or no such inputs). `runDefaults`: #785.
// `workflowKinds` (#791): the project's { feature, fix: { name, inputs } }: one group per kind (po-kinds.js).
function normalizeAnswer(answer, { issues, history, workflows, epics: epicList = [], selection = [], mock = false, calibration = null, defaultWorkflow = null, cost = null, runs = null, prices = {}, workflow = null, inputs = null, spec = null, runDefaults = null, workflowKinds = null }) {
  const numbers = new Set((issues || []).map((i) => i.number));
  const byNumber = new Map((issues || []).map((i) => [i.number, i]));
  const files = (workflows || []).map((w) => w.file);
  const fallback = files.length ? DefaultWorkflow.resolve(defaultWorkflow, files).file : '';
  const chosen = workflow && files.includes(workflow) ? workflow : null;
  const chosenInputs = chosen && inputs && typeof inputs === 'object' && !Array.isArray(inputs) ? inputs : {};
  const inputsOf = (file) => (workflows || []).find((w) => w.file === file)?.inputs;
  const keep = (list) => [...new Set((list || []).map(Number).filter((n) => numbers.has(n)))];
  const isOpen = (n) => byNumber.get(n)?.state === 'open';
  const attached = new Set(keep(selection));
  const closed = [...attached].filter((n) => !isOpen(n));
  const plan = { attached, byNumber, chosen, chosenInputs, fallback, files, inputsOf, isOpen, keep, mock, runDefaults, sizeOf: (part) => sizeGroup(part, issues, history), workflowKinds };
  const groups = (answer.groups || []).flatMap((g, n) => kindGroups(g, n, plan));
  const level = calibration == null ? null : poCalibration.clamp(calibration);
  const costOff = !!chosen && !poCalibration.costApplies((workflows || []).find((w) => w.file === chosen));
  const costLevel = cost == null || costOff ? null : poCalibration.cost.clamp(cost);
  const planned = costedGroups(groups, { level, costLevel, issues, history, workflows, runs, prices });
  const known = planned.map((g) => g.costEstimate?.usd ?? g.estimate?.costUsd).filter((x) => x != null);
  return {
    summary: String(answer.summary || ''),
    ...(level ? { calibration: level } : {}),
    ...(costLevel ? { cost: costLevel } : {}),
    ...(known.length ? { estimateUsd: Math.round(known.reduce((a, x) => a + x, 0) * 100) / 100, estimateMissing: planned.length - known.length } : {}),
    groups: planned.map((g) => ({ ...g, inputsChosen: true })), // #785: an answer recorded before has every input at its default
    ...(closed.length ? { closed } : {}),
    conflicts: (answer.conflicts || []).map((c) => ({ issues: keep(c.issues), reason: String(c.reason || ''), files: (c.files || []).map(String).slice(0, 20) })).filter((c) => c.issues.length > 1),
    decongest: normalizeDecongest(answer.decongest),
    enrich: (answer.enrich || []).filter((e) => numbers.has(Number(e.issue))).map((e) => ({ issue: Number(e.issue), reason: String(e.reason || ''), link: ENRICH_GUIDE })),
    splits: normalizeSplits(answer.splits, byNumber, history),
    epics: normalizeEpics(answer.epics, byNumber, epicList),
    // #670: a spec's proposal with its mockup coverage (po-mockups.js specProposal)
    ...(spec ? { spec } : {}),
  };
}

// #150: the answer's hot spots to decongest, each with a file and a fix; `line` only when given.
function normalizeDecongest(list) {
  const count = (x) => (Number.isInteger(Number(x)) && Number(x) > 0 ? Number(x) : null);
  return (Array.isArray(list) ? list : []).filter((d) => d && String(d.file || '').trim()).slice(0, 20).map((d) => ({
    file: String(d.file).trim(),
    ...(count(d.line) ? { line: count(d.line) } : {}),
    fix: String(d.fix || ''),
    ...(count(d.runs) ? { runs: count(d.runs) } : {}),
    ...(count(d.of) ? { of: count(d.of) } : {}),
  }));
}

// #150: the report's "## Conflict map": the files and lines more than one run changed, hot spots
// marked, most-changed first, kept under CONFLICT_MAP_CAP characters (the least-changed rows go).
function conflictMapSection(map) {
  if (!map?.files?.length && !map?.lines?.length) return null;
  const hot = new Set(hotSpots(map).map((s) => (s.kind === 'line' ? `${s.file}:${s.line}` : s.file)));
  const unit = map.source === 'git' ? 'commits' : 'runs';
  const head = `## Conflict map (of the last ${map.runs} ${map.source === 'git' ? 'commits of the branch: no run merged yet' : 'finished runs with commits'}; groups that touch the same hot file conflict when they merge: put them in different stages, or in one group)`;
  const files = (map.files || []).filter((f) => f.runs > 1).slice(0, CONFLICT_MAP_FILES)
    .map((f) => `- ${f.file}: ${f.runs} ${unit} of ${map.runs}${f.conflicts ? ` · named by ${f.conflicts} merge conflict(s)` : ''}${hot.has(f.file) ? ' · hot' : ''}`);
  const lines = (map.lines || []).slice(0, CONFLICT_MAP_LINES)
    .map((l) => `- ${l.file}:${l.line}: ${l.runs} ${unit} · \`${clip(l.text, 80)}\`${hot.has(`${l.file}:${l.line}`) ? ' · hot' : ''}`);
  if (!files.length && !lines.length) return null;
  const out = [head];
  let size = head.length;
  const add = (title, rows) => {
    if (!rows.length || size + title.length + 2 > CONFLICT_MAP_CAP) return;
    out.push(title);
    size += title.length + 1;
    for (const r of rows) {
      if (size + r.length + 1 > CONFLICT_MAP_CAP) break;
      out.push(r);
      size += r.length + 1;
    }
  };
  add('Files most runs change:', files);
  add('Lines several runs change (a shared list or import):', lines);
  return out.join('\n');
}

// #189: the groups kept to a calibration step: at most `maxRuns` groups per stage (in the answer's
// order; the rest of a stage goes to the next stages, renumbered 1..n) and a warning on a group over
// `maxComplexity`.
function calibrateGroups(groups, step) {
  const stages = [...new Set(groups.map((g) => g.stage))].sort((a, b) => a - b);
  const out = [];
  let next = 1;
  for (const s of stages) {
    const of = groups.filter((g) => g.stage === s);
    const per = step.maxRuns || of.length;
    of.forEach((g, n) => {
      const over = g.complexity > step.maxComplexity ? [`Complexity ${g.complexity}: over ${step.maxComplexity}, the most a group gets at ${step.name}.`] : [];
      out.push({ ...g, stage: next + Math.floor(n / per), warnings: [...new Set([...g.warnings, ...over])] });
    });
    next += Math.ceil(of.length / per);
  }
  return out;
}

// #205: the groups planned with both steps: packed at Economy, given the Cost step's inputs, kept to
// the calibration's runs per stage and to the combined group cap (cost wins), then a test-backfill stage
// after each stage with untested issues; each with its estimate from the past runs (#206).
function costedGroups(groups, { level, costLevel, issues, history, workflows, runs, prices }) {
  let out = groups;
  const costStep = costLevel ? poCalibration.cost.step(costLevel) : null;
  if (costStep) {
    const cap = poCalibration.groupCap(level ?? poCalibration.DEFAULT, costLevel);
    if (costStep.pack) out = packGroups(out, cap, { issues, history });
    // #235: a tests-first workflow's test inputs are not the Cost step's to set
    out = out.map((g) => (poCalibration.testsFirst((workflows || []).find((w) => w.file === g.workflow) || { file: g.workflow }) ? g : { ...g, ...costInputs(g, costStep, workflows) }));
    const base = level ? poCalibration.step(level) : { maxRuns: null };
    out = calibrateGroups(out, { ...base, maxComplexity: cap, name: poCalibration.plannedFor(level ?? poCalibration.DEFAULT, costLevel, 'en') });
    if (costStep.testBatch) out = testBatchStages(out, { issues, history, workflows });
  } else if (level) {
    out = calibrateGroups(out, poCalibration.step(level));
  }
  if (!runs) return out;
  return out.map((g) => {
    const e = costEstimate.estimateItem(g, runs, { issues, prices, complexity: g.complexity });
    return e ? { ...g, costEstimate: e } : g;
  });
}

// A group's areas: its name, its files, its issues' epic and topic labels (two groups that share one
// are in the same area: likely the same files).
const GENERIC_LABEL = /^(complexity|bug$|enhancement$|feature$|good first issue$|help wanted$)/i;
function areasOf(g, byNumber) {
  const out = new Set([`name:${g.name.toLowerCase()}`, ...(g.files || []).map((f) => `file:${f.toLowerCase()}`)]);
  for (const n of g.issues) {
    const i = byNumber.get(n);
    if (i?.epic) out.add(`epic:${i.epic}`);
    for (const l of i?.labels || []) { const name = String(l?.name ?? l); if (!GENERIC_LABEL.test(name)) out.add(`label:${name.toLowerCase()}`); }
  }
  return out;
}

const PACKED = 'Grouped to pay the run overhead once (same area or files).';

/**
 * #205 (Economy): a stage's groups of the same workflow and area (areasOf) packed into one run while
 * the sum of their complexity stays within `cap`; the packed group's reason says so (PACKED).
 * #791: never two kinds in one run, even on one workflow.
 */
function packGroups(groups, cap, { issues, history }) {
  const byNumber = new Map((issues || []).map((i) => [i.number, i]));
  const out = [];
  for (const g of groups) {
    const areas = areasOf(g, byNumber);
    const into = out.find((h) => h.stage === g.stage && h.workflow === g.workflow && h.kind === g.kind && !h.simulated && !g.simulated
      && h.complexity + g.complexity <= cap && [...areasOf(h, byNumber)].some((a) => areas.has(a)));
    if (!into) { out.push(g); continue; }
    const nums = [...into.issues, ...g.issues];
    const size = sizeGroup(nums, issues, history);
    const own = (x) => (x.warnings || []).filter((w) => !/^Complexity \d+/.test(w));
    Object.assign(into, {
      issues: nums, kindReasons: [...(into.kindReasons || []), ...(g.kindReasons || [])],
      inputs: { ...g.inputs, ...into.inputs },
      ...(into.inputReasons || g.inputReasons ? { inputReasons: { ...g.inputReasons, ...into.inputReasons } } : {}),
      reason: [into.reason, `With ${g.name}: ${g.reason}`.trim(), into.packed ? '' : PACKED].filter(Boolean).join(' '),
      files: [...new Set([...into.files, ...g.files])].slice(0, 20),
      ...size,
      warnings: [...new Set([...size.warnings, ...own(into), ...own(g)])],
      packed: true,
      ...(into.suggested || g.suggested ? { suggested: [...(into.suggested || []), ...(g.suggested || [])].filter((s) => !nums.includes(s.issue)) } : {}),
    });
  }
  return out;
}

// The Cost step's values of the #203/#205 inputs; a cheaper agent (`cheapAgents`) for each model or
// effort input a workflow declares (none in the bundled development workflows: "not adjustable").
const CHEAP_MODEL = 'claude-sonnet-5-5';
const CHEAP_EFFORT = 'medium';
function costInputs(g, step, workflows) {
  const declared = (workflows || []).find((w) => w.file === g.workflow)?.inputs || {};
  const allowed = (k, v) => !!declared[k] && (!Array.isArray(declared[k].enum) || declared[k].enum.map(String).includes(v));
  const want = { unit_tests: step.unitTests, e2e_tests: step.e2eTests, screenshots: step.screenshots };
  const set = {};
  for (const [k, v] of Object.entries(want)) if (allowed(k, v)) set[k] = v;
  const notAdjustable = [];
  if (step.cheapAgents) {
    // the developer keeps its model and its effort (#286: developer_effort stays out until a
    // measured run shows medium is as good); the test writer, evidence and verifier get the cheaper model
    const agentInputs = Object.keys(declared).filter((k) => /_(effort|model)$/.test(k) && !/^develop/.test(k));
    for (const k of agentInputs) {
      const v = /_effort$/.test(k) ? CHEAP_EFFORT : CHEAP_MODEL;
      if (allowed(k, v)) set[k] = v;
    }
    if (!agentInputs.length) notAdjustable.push('Agents: not adjustable (the workflow has no model or effort input)');
  }
  for (const k of Object.keys(want)) if (!declared[k]) notAdjustable.push(`${k}: not adjustable (the workflow has no such input)`);
  return {
    inputs: { ...g.inputs, ...set },
    cost: {
      level: step.level, name: step.name, inputs: set,
      ...(g.packed ? { grouping: PACKED } : {}),
      ...(notAdjustable.length ? { notAdjustable } : {}),
    },
  };
}

// Issues whose unit tests a group leaves for later (#203): run existing or off.
const untested = (g) => ['run_existing', 'off'].includes(g.inputs?.unit_tests);
// #631: test-batch.yaml is now test-backfill.yaml (the old name an alias)
const TEST_BACKFILL = 'test-backfill.yaml';

/**
 * #205 (Economy): after each stage with untested issues, a stage with one test-backfill item for them
 * (the stages after move down). Without the test-backfill workflow the groups stay as they are.
 */
function testBatchStages(groups, { issues, history, workflows }) {
  if (!(workflows || []).some((w) => w.file === TEST_BACKFILL)) return groups;
  const stages = [...new Set(groups.map((g) => g.stage))].sort((a, b) => a - b);
  const out = [];
  let next = 1;
  for (const s of stages) {
    const of = groups.filter((g) => g.stage === s);
    out.push(...of.map((g) => ({ ...g, stage: next })));
    const nums = [...new Set(of.filter(untested).flatMap((g) => g.issues))];
    next += 1;
    if (!nums.length) continue;
    const size = sizeGroup(nums, issues, history);
    out.push({
      name: `Test backfill (stage ${next - 1})`, issues: nums, workflow: TEST_BACKFILL, inputs: {},
      reason: 'Economy: these issues ran with their existing tests only; one test writer session writes their unit tests together, after their stage.',
      files: [], stage: next, ...size, estimate: null, warnings: [], testBatch: true,
    });
    next += 1;
  }
  return out;
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
function backlogReport({ data, activeRuns = [], history = [], workflows = [], question = '', selection = [], conflictMap = null, defaultWorkflow = null, workflow = null }) {
  const byDefault = DefaultWorkflow.resolve(defaultWorkflow, workflows.map((w) => w.file)).file;
  // #235: the workflow the owner chose for this plan replaces the default
  const mark = (file) => (workflow ? (file === workflow ? ' (chosen by the owner: every group uses it)' : '') : file === byDefault ? ' (default)' : '');
  const named = new Set([...String(question).matchAll(/#(\d+)/g)].map((m) => Number(m[1])));
  const all = data?.issues || [];
  // #238: an archived issue is out of the plans, even when the owner selected it
  const attached = [...new Set(selection.map(Number))].map((n) => all.find((i) => i.number === n)).filter((i) => i && !isArchived(i));
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
    `## Workflows\n${workflows.map((w) => `- ${w.file}${mark(w.file)}: ${w.name}${w.inputs ? ` (inputs: ${Object.keys(w.inputs).join(', ')})` : ''}`).join('\n') || '(none)'}`,
    `## Queue\n${queue.map((q) => `- ${(q.issues || [q]).map((i) => `#${i.number}`).join(' + ')} → ${q.workflowName || q.workflow}`).join('\n') || '(empty)'}`,
    `## Runs in progress\n${activeRuns.map((r) => `- ${r.runId} ${r.workflow || ''} ${r.status}${r.waiting || r.gates?.length ? ' (waiting at a gate)' : ''}${r.issues?.length ? ` issues ${r.issues.map((i) => `#${i.number ?? i}`).join(', ')}` : ''}`).join('\n') || '(none)'}`,
    `## Merged locally, not pushed\n${local && !local.error ? `${local.ahead || 0} commits ahead${local.issues?.length ? `, issues ${local.issues.map((n) => `#${n}`).join(', ')}` : ''}` : '(unknown or none)'}`,
    `## Epics (id: title · members · open/closed)\n${epicList.map((e) => `- ${e.id}: ${e.title}${e.state === 'open' ? '' : ' (closed)'} · ${e.members.map((n) => `#${n}`).join(', ') || 'no members'} · ${e.progress?.open ?? 0} open, ${e.progress?.closed ?? 0} closed`).join('\n') || '(none)'}${data?.epicsError ? `\n(${data.epicsError})` : ''}`,
    // #555: a release entry is a line of its own; the stages keep their numbers (the issues' `roadmap stage`, roadmap.move)
    `## Roadmap\n${stages.map((s, n) => (RoadmapModel.isRelease(s) ? `- release ${s.name}${s.status ? ` (${s.status})` : ''}` : `- stage ${RoadmapModel.stageNumber(data.roadmap, n)}${s.name ? ` ${s.name}` : ''}: ${s.items.map((x) => `${(x.issues || []).map((i) => `#${i.number ?? i}`).join(' + ')} ${x.status}`).join('; ')}`)).join('\n') || '(empty)'}`,
    `## Finished runs (newest first; agent time without gate waits)\n${history.map((h) => `- ${h.runId} ${h.workflow || ''} ${h.status} · issues ${h.issues.map((n) => `#${n}`).join(', ') || '-'} · complexity ${h.complexity ?? '?'} · ${h.agentMinutes} min · $${h.costUsd.toFixed(2)} · ${Math.round(h.tokens / 1e3)}k tokens${h.conflicts.count ? ` · ${h.conflicts.count} merge conflict(s)${h.conflicts.files.length ? ` in ${h.conflicts.files.join(', ')}` : ''}` : ''}`).join('\n') || '(none)'}`,
    // the conflict map (#150): parallel runs that edit the same file conflict when they merge
    ...[conflictMapSection(conflictMap)].filter(Boolean),
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
 * The simulated answer: groups of to-do issues that share a label (complexity at most the calibration's per group),
 * the issues that look like a repo-wide refactor kept apart from the others, and the issues with a
 * short description to enrich first. With a `selection` (#169): only the attached issues to do are
 * planned, and each group suggests up to two other issues to do of its topic.
 */
// `calibration` (#189): the step's max complexity per group and parallel runs per stage (Speed: every
// group of a stage at once, after the refactors; Quality: two per stage).
// `workflow`: the default development workflow (#195) every group gets.
// `cost` (#205): the group cap is groupCap (cost wins); at a packing step (Economy) the issues without
// a shared area are packed together too, "to pay the run overhead once".
// `conflictMap` (#150): groups whose issues name the same hot file go to different stages (listed as a
// conflict naming the file), and the map's hot spots are the answer's `decongest`.
// #791: an issue joins a group of its topic and its kind only (kindOf: the labels), each group
// classifying its issues in `issue_kinds`; normalizeAnswer gives each kind the project's workflow.
function mockAnswer({ data, question = '', selection = [], calibration = poCalibration.DEFAULT, workflow = DefaultWorkflow.LOCAL, cost = null, conflictMap = null }) {
  const costStep = cost == null ? null : poCalibration.cost.step(cost);
  const step = { ...poCalibration.step(calibration), ...(costStep ? { maxComplexity: poCalibration.groupCap(calibration, cost) } : {}) };
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
  const kindIn = (n) => kindOf(todo.find((i) => i.number === n));
  const groups = [];
  for (const i of others) {
    const c = complexityOf(i) ?? DEFAULT_COMPLEXITY;
    const { kind } = kindOf(i);
    const g = topic(i) ? groups.find((x) => x.topic === topic(i) && x.kind === kind && x.size + c <= step.maxComplexity)
      : costStep?.pack && groups.find((x) => x.packed && x.kind === kind && x.size + c <= step.maxComplexity);
    if (g) { g.issues.push(i.number); g.size += c; } else groups.push({ topic: topic(i), kind, issues: [i.number], size: c, packed: !topic(i) && !!costStep?.pack });
  }
  const group = (g, stage) => ({
    name: g.topic || (g.packed && g.issues.length > 1 ? 'Small issues' : `#${g.issues[0]}`),
    issues: g.issues,
    workflow,
    inputs: {},
    reason: g.refactor ? 'A repo-wide change: alone in its own stage, before the others.'
      : g.packed && g.issues.length > 1 ? 'Grouped to pay the run overhead once: small issues of no shared area (simulated).'
      : g.issues.length > 1 ? `Same area (${/^epic /.test(g.topic) ? g.topic : `label ${g.topic}`}): likely the same files.` : 'On its own: no other issue shares its area.',
    files: [],
    stage,
    suggested: suggest(g.issues),
    issue_kinds: g.issues.map((n) => (g.refactor ? { issue: n, kind: 'refactor', reason: 'The title says it is a repo-wide refactor or reformat.', reasonKey: 'po.kind.reason_title_refactor' } : { issue: n, ...kindIn(n) })),
  });
  const splits = todo.map((i) => poSplit.proposeSplit(i, { complexity: complexityOf(i) })).filter(Boolean);
  const epicPlan = attached.size ? { place: [], create: [], merge: [], split: [] } : mockEpics(data);
  const perStage = step.maxRuns || Math.max(1, groups.length);
  const planned = [
    ...refactor.map((i, n) => group({ issues: [i.number], refactor: true }, n + 1)),
    ...groups.map((g, n) => group(g, refactor.length + Math.floor(n / perStage) + 1)),
  ];
  const spots = conflictMap ? hotSpots(conflictMap) : [];
  const hotConflicts = separateSharedFiles(planned, [...new Set(spots.map((s) => s.file))], todo);
  return {
    summary: [
      `**Simulated answer** (developer or simulated mode: no model was called)${question ? ` to: “${clip(question, 120)}”` : ''}. Planned for ${cost == null ? poCalibration.label(calibration, 'en') : poCalibration.plannedFor(calibration, cost, 'en')}.`,
      `${todo.length} ${attached.size ? 'attached ' : ''}issues to do:${groups.length + refactor.length} proposed run${groups.length + refactor.length === 1 ? '' : 's'}, grouped by epic, else by shared label (complexity ${step.maxComplexity} at most per run); repo-wide changes first and alone, then ${step.maxRuns ? `stages of at most ${step.maxRuns} runs` : 'one stage with every other run'}.`,
      `${splits.length ? `${splits.length} issue${splits.length > 1 ? 's are' : ' is'} too big for one run: see the proposed splits.` : 'No issue is too big for one run.'} ${epicPlan.place.length + epicPlan.create.length ? `Epics: ${epicPlan.place.length} issue${epicPlan.place.length === 1 ? '' : 's'} to place, ${epicPlan.create.length} epic${epicPlan.create.length === 1 ? '' : 's'} to create.` : ''}`.trim(),
    ].join('\n\n'),
    splits,
    epics: epicPlan,
    groups: planned,
    conflicts: [
      ...refactor.flatMap((r) => others.slice(0, 2).map((o) => ({ issues: [r.number, o.number], reason: `#${r.number} looks like a repo-wide change: run it alone, with no other run open.`, files: [] }))),
      ...hotConflicts,
    ],
    decongest: spots.map((s) => ({ file: s.file, ...(s.kind === 'line' ? { line: s.line } : {}), fix: s.fix, runs: s.runs, of: s.of })),
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

// ---- its inbox (#240) -----------------------------------------------------------------------------
// The kinds another agent may ask for; `plan` is the only judgment kind (a question to the model).
const REQUEST_KINDS = [
  'issue.file',
  'issue.update',
  'plan',
  'queue.assign',
  'roadmap.add',
  'roadmap.move',
  'roadmap.regroup',
  'roadmap.skip',
];
const JUDGMENT_KINDS = ['plan'];
// #241: the kinds that publish to the issue tracker: an Oracle request of one waits for the owner's
// click by day (under the Night watch, its permissions decide)
const CONFIRM_KINDS = [
  'issue.file',
  'issue.update',
];

/**
 * Another agent's request (#240): { kind, params, reason, from, ref } → { ok, text, costUsd, error?, ownerTs }.
 * `perform(kind, params)` runs a mechanical kind with the owner's buttons' code (→ { text });
 * `ask({ question, request })` asks the model a plan question tagged with the request (→ { message }).
 */
function handleRequest({ backlogDir, projectId, request, perform, ask: askModel, wait, check, after }) {
  return agentInbox.handle(request, {
    kinds: REQUEST_KINDS,
    judgment: JUDGMENT_KINDS,
    role: 'po',
    record: (message) => appendMessage(backlogDir, projectId, message),
    perform,
    ask: (params, tag, reason) => askModel({ question: String(params.question || reason || '').trim(), request: tag }),
    // #241: a card waiting for the owner's click (the Night watch did not allow it), and the night log
    wait,
    check,
    after,
  });
}

/** The owner's Do it / Dismiss / Undo on a request card (#241, agent-inbox.js act): { ref, action } → { ok, text, ... }. */
function actRequest({ backlogDir, projectId, input, perform, restore, after }) {
  return agentInbox.act(input, {
    history: () => readConversation(backlogDir, projectId),
    role: 'po',
    record: (message) => appendMessage(backlogDir, projectId, message),
    perform,
    restore,
    after,
  });
}

// The last exchanges, so a follow-up question has its context (answers as their summary only).
function previousExchanges(messages) {
  const recent = messages.filter((m) => m.role === 'user' || m.role === 'po').slice(-PREVIOUS_EXCHANGES * 2);
  if (!recent.length) return '';
  return `## Earlier in this conversation\n${recent.map((m) => (m.role === 'user' ? `Owner: ${clip(m.text, 500)}${m.issues?.length ? ` (attached ${m.issues.map((n) => `#${n}`).join(', ')})` : ''}` : `You: ${clip(m.answer?.summary || m.text, 1500)}`)).join('\n')}`;
}

// ---- registering an issue (#117) ---------------------------------------------------------------------
// The issue tracker's code analyzer (workflows/issue-tracker.yaml): cheaper than the planner's model.
const ISSUE_AGENT = { model: 'claude-sonnet-5-5', effort: 'medium' };
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
  'Write the draft with the issue-writing skill: a specific title; a context grounded in the evidence; "Decision (owner): ..." for every decision the owner stated; tasks as verifiable acceptance criteria (for a UI change, UI criteria: the controls, the states, what leads); "Related: #n"; an "## Expected files" section before the tasks, one repository-relative path per line ("- `src/x.js`: why", a file to create marked "(new)"), only the files the change is expected to modify or create, not the ones read as evidence. Add a short "Triage" section: impact and complexity with their reasons and the grouping advice. Labels: `impact:<n>`, `complexity:<n>`, the kind, `area:<...>`.',
  'Score the draft with the clarity-score skill: end its "Triage" section with `Clarity: <n>%` ("needs grilling" below 85%) and write every gap the owner has not closed as an open question with the default you took, never as a silent assumption. The interview (Grill me) is not held here: it runs in a discovery card\'s thread.',
  `The owner is here. When the request is ambiguous in a way that changes the issue, ask at most ${MAX_QUESTIONS} short questions in the whole thread (in \`questions\`) and leave the draft's title empty; otherwise draft at once and list your assumptions in \`assumptions\`. Each new message of the owner refines the current draft: always return the whole draft again.`,
  'When the owner asks to add to an existing issue ("add this to #110"), or an open issue already covers the request (`relation: duplicate`), set `existing_issue` to its number and write in `addition` only the new part (a short context, the files it is expected to modify or create in an "## Expected files" section, and the new tasks as a checklist), keeping what the issue already says; otherwise 0 and "".',
  'Epic: when the new issue clearly belongs to an existing epic of the report\'s Epics section, set `draft.epic` to its id; otherwise "" (and, when several issues share its theme with no epic, say so in `reply`).',
  'Language: answer the owner (`reply`, `questions`) in the AI agents language the Language line names, whatever language the owner writes in. The issue itself (title, body, addition) is in the issues language it names; label names, `#n` references and `- [ ]` checkboxes stay as they are, and existing issue text is never rewritten only to translate it.',
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
  return copyToThread(where, appendMessage(where.backlogDir, where.projectId, message));
}

function copyToThread(where, m) {
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
function mockIssueAnswer({ data, question = '', previous = [], headings: h = Language.issueHeadings() }) {
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
        `${h.decision} ${said[said.length - 1]}`, '',
        h.tasks, '', ...said.map((t) => `- [ ] ${t}`), '- [ ] Tests', '',
        ...(close.length ? [`${h.related} ${close.map((i) => `#${i.number}`).join(', ')}`] : []),
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
// #180: the fake steps a simulated turn streams to the live view before its answer
const MOCK_STEPS = [
  { name: 'Read', input: { file_path: 'README.md' } },
  { name: 'Grep', input: { pattern: 'roadmap' } },
  { name: 'Bash', input: { command: 'gh issue list --state open' } },
];

/**
 * The simulated answer of a forced scenario (no model call), in the mode's raw shape (ANSWER_SCHEMA or
 * ISSUE_SCHEMA); 'error' throws, so the conversation records an error answer. `files`: the turn's
 * attachments (the 'attachments' scenario lists them in the draft).
 */
function mockScenario(scenario, { data, question = '', previous = [], files = [], workflow = DefaultWorkflow.LOCAL }) {
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
    return issueAnswer({ draft: draft(clip(question, 80) || 'Simulated issue', `## Context\n\n> ${question}\n\n## Expected files\n\n- \`src/app.js\`: where the fix goes (simulated)\n\n## Tasks\n\n- [ ] Fix it\n- [ ] Tests\n`) });
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
  const group = (name, list, stage, reason, extra = {}) => ({ name, issues: list, workflow, inputs: {}, reason, files: ['fronts/build/views/backlog/backlog-po.js'], stage, ...extra });
  const groups = [
    ...(one ? [group('Already applied', [one.number], 1, 'Already in the roadmap (simulated).', { simulated: { covered: [one.number], stage: 1 } })] : []),
    ...(two ? [group('Partly applied', [two.number, ...(three ? [three.number] : [])], 1, 'One issue already in the roadmap, one not (simulated).', { simulated: { covered: [two.number], stage: 1 } })] : []),
    ...pairs.slice(0, scenario === 'large-answer' ? 12 : 4).map((p, n) => group(`Group ${n + 1}`, p, Math.floor(n / 2) + 2, 'Same area (simulated).')),
  ];
  const long = scenario === 'large-answer' ? `\n\n${Array.from({ length: 15 }, (_, n) => `Paragraph ${n + 1}. ${'A long simulated explanation of the plan to check the scroll position of the conversation. '.repeat(5)}`).join('\n\n')}` : '';
  return {
    summary: `${head}. ${groups.length} proposed run${groups.length === 1 ? '' : 's'}${groups.length > 1 ? ', the first one already applied and the second one partly' : ''}.${long}`,
    groups,
    conflicts: pairs.length > 1 ? [{ issues: [pairs[0][0], pairs[1][0]], reason: 'Both change the same file (simulated).', files: ['fronts/build/views/backlog/backlog-po.js'] }] : [],
    enrich: scenario === 'large-answer' ? todo.slice(0, 5).map((i) => ({ issue: i.number, reason: 'The description is too short (simulated).' })) : [],
    splits: [],
    epics: {},
  };
}

/**
 * Files the current draft on the owner's click and records it in the conversation.
 * at: the draft message's ts (a draft revised, filed or discarded since is refused);
 * action: 'create' (a new issue), 'append' (a dated section at the end of issue `number`'s body) or
 * 'comment' (a comment on `number`). `number` defaults to the draft's existing issue; the text added
 * is the draft's addition for that issue, else the whole draft. `preview` never calls the CLI.
 * The text sent is kept in the thread's folder (runsDir) under filed/.
 * placeEpic (#138): a new issue joins the draft's epic (`epicList`: the cache's epics) once filed.
 * timeZone (#273): the owner's zone (settings.timeZone), the day of an appended "## Update" section.
 * issuesLanguage (#328): the issues language code, the Related line added and the epic's body line.
 * Returns { preview, action, command, body, filed, message, messages, skippedLabels? }.
 */
async function fileDraft({ backlogDir, projectId, runsDir, at, action, number, preview, platform, repo, cached = null, placeEpic = false, epicList = [], timeZone = null, issuesLanguage = null, exec = backlog.execCli }) {
  if (!FILE_ACTIONS.includes(action)) throw new Error(`Unknown action: ${action} (${FILE_ACTIONS.join(', ')}).`);
  const messages = readConversation(backlogDir, projectId);
  const open = currentDraft(messages);
  if (!open || open.message.ts !== at) throw new Error('This draft was filed, discarded or revised since: use the latest draft.');
  const issue = open.message.issue;
  const where = { backlogDir, projectId, runsDir };
  const thread = threadOf(messages, projectId);
  const dir = path.join(threadDir(where, thread), 'filed');
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  // #35: with no repository, the command adds to the local backlog instead of calling a CLI (po-draft-command.js)
  const { command, body, file, target, skippedLabels } = await draftCommand({ action, issue, number, preview, platform, repo, cached, backlogDir, projectId, dir, stamp, timeZone, issuesLanguage, exec });
  const out = { preview: !!preview, action, command: command.display, body };
  const epic = action === 'create' && placeEpic && issue.draft?.epic ? (epicList || []).find((e) => e.id === issue.draft.epic) : null;
  if (preview) {
    const filed = { action, number: target, preview: true, draft: at, command: command.display, ...(epic ? { epic: epic.id } : {}) };
    const message = recordIssueMessage(where, { role: 'po', mode: 'issue', thread, text: `**Preview** (simulated): nothing was filed. The app would ${command.local ? command.display : `run \`${command.display}\``}${epic ? `, then place the issue in the epic ${epic.id} ${epic.title}` : ''}.`, filed });
    return { ...out, filed, message, messages: readConversation(backlogDir, projectId) };
  }
  // gh reads the body from it; for glab it is the record of what was sent
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, body);
  const { url, number: n } = filedIssue(await (command.run ? command.run() : exec(command.cli, command.args)), command);
  let filed;
  let text;
  if (action === 'create') {
    filed = { action, number: n, url, title: issue.draft.title, draft: at, labels: issue.draft.labels.filter((l) => !skippedLabels.includes(l)), ...(command.local ? { local: true } : {}) };
    text = `Filed ${n && url ? `[#${n}](${url})` : n ? `#${n} in the local backlog` : url || 'the issue'}: ${issue.draft.title}.${skippedLabels.length ? ` Labels the repository does not have were left out: ${skippedLabels.join(', ')}.` : ''}`;
    if (epic && n) {
      try {
        await epics.applyEpic({ platform, repo, epic: { id: epic.id }, issues: [n], epics: epicList, dir, issuesLanguage, exec });
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
 * timeZone (#273): the owner's zone, the day of the umbrella's "## Update" section.
 * Returns fileSplit's result plus { message, messages }.
 */
async function applySplit({ backlogDir, projectId, runsDir, at, split, preview, platform, repo, data, timeZone = null, issuesLanguage = null, exec = backlog.execCli }) {
  const messages = readConversation(backlogDir, projectId);
  const answer = planAnswer(messages, at);
  const number = Number(split?.issue);
  if (!(answer.answer.splits || []).some((s) => s.issue === number)) throw new Error(`That answer proposes no split of #${number}.`);
  if (messages.some((m) => m.split && m.split.at === at && m.split.issue === number && !m.split.preview)) throw new Error(`#${number} was already split from this answer.`);
  const parent = (data?.issues || []).find((i) => i.number === number);
  const checked = poSplit.checkSplit(split, parent);
  const res = await poSplit.fileSplit({
    platform, repo, parent, split: checked, dir: applyDir({ backlogDir, projectId, runsDir }, `split-${number}`), preview, epicList: data?.epics || [], timeZone, issuesLanguage, exec,
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
async function applyEpicProposal({ backlogDir, projectId, runsDir, at, key, epic, issues, preview, platform, repo, data, issuesLanguage = null, exec = backlog.execCli }) {
  const messages = readConversation(backlogDir, projectId);
  planAnswer(messages, at);
  if (messages.some((m) => m.epicApplied && m.epicApplied.at === at && m.epicApplied.key === key && !m.epicApplied.preview)) throw new Error('This epic proposal was already applied.');
  const known = new Set((data?.issues || []).filter((i) => i.state === 'open').map((i) => i.number));
  const members = (issues || []).map(Number).filter((n) => known.has(n));
  if (!members.length && epic?.id) throw new Error('Pick the issues to place in the epic.');
  const res = await epics.applyEpic({
    platform, repo, epic, issues: members, epics: data?.epics || [], dir: applyDir({ backlogDir, projectId, runsDir }, 'epic'), preview, issuesLanguage, exec,
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

// A hot spot (#150) or a spec's issues (#670) filed as new issues: po-file-issues.js, on this conversation
const conversation = () => ({ appendMessage, applyDir, planAnswer, readConversation });
const fileDecongest = (args) => poFileIssues.fileDecongest(conversation(), args);
const fileSpec = (args) => poFileIssues.fileSpec(conversation(), args);

// ---- usage: every real call, for the monthly budgets ------------------------------------------------
const usageFile = (backlogDir) => path.join(backlogDir, 'product-owner.usage.jsonl');

// #280: each question is a fresh CLI call (callAgent), so every line starts a session: one-shot
function recordUsage(backlogDir, { projectId, model, tokens, costUsd, sessionId }) {
  agentsUsage.appendTurn(usageFile(backlogDir), { agent: 'product-owner', projectId, model, tokens, costUsd, sessionId, startReason: 'one-shot' });
}

/** Every recorded call, every project, oldest first (Analytics' Agents tab, #280; `opts`: agentsUsage.readLines'). */
const usageLines = (backlogDir, opts) => agentsUsage.readLines(usageFile(backlogDir), opts);

/**
 * The Product Owner's calls this month, every project, as sessions for usage.withPeerUsage
 * ([{ provider, model, tokens, costUsd }]): its spend is in no run, so budgetBaseline misses it.
 * The month is the owner's local one (settings.timeZone, #273; default UTC).
 */
function monthUsage(backlogDir, now = new Date(), timeZone = 'UTC') {
  const month = TimeZone.monthKey(now, timeZone);
  return usageLines(backlogDir)
    .filter((u) => u.ts && TimeZone.monthKey(u.ts, timeZone) === month)
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
 * @param mode      'plan' (default), 'auto' (#785: poChosen.turnMode) or 'issue' (#117: register an issue; `attachments`: paths
 *                  saved by saveAttachment, moved to the thread's folder in `runsDir`, which also keeps the thread and each turn's analysis)
 * @param scenario  with `mock` only: a MOCK_SCENARIOS id forcing the simulated answer (#148)
 * @param onItem    #180: the turn's items as they arrive (packages/engine/domains/chat/chat-progress.js); a simulated turn then
 *                  streams fake steps (MOCK_STEPS) and its text first
 * @param signal    #180: an AbortSignal that stops the turn; the prose written so far is recorded,
 *                  marked `stopped` (a failure keeps it too, after the error)
 * @param calibration #189: a step (1..5) for this question only; else one the question asks for
 *                  ("plan this one for quality"), else the agent's saved `calibration`. A plan answer
 *                  and its question record the step used (`calibration`, `calibrationOverride` when not the saved one).
 * @param cost      #205: a Cost step (1..5) for this question only; else one the question asks for
 *                  ("plan this one cheap"), else the agent's saved `cost` (recorded as `cost`, `costOverride`).
 * @returns { message, messages }  the answer ({ role: 'po', text, answer | issue, model, costUsd }) and the whole conversation
 */
// `defaultWorkflow` (#195, #790): the project's default; the plan's groups get it unless an issue needs another.
// `workflow` / `inputs` (#235): the workflow the owner chose in the drawer and its options: every
// group gets them (recorded on the messages: lastWorkflow); no Cost step where it does not apply.
// `timeZone` (#273): the owner's zone (settings.timeZone): the turn's prompt names it and the local time.
// `workflowKinds` (#791): the project's workflow and inputs of a Feature and a Fix (already resolved):
// the prompt names them, and the answer's groups get their kind's (normalizeAnswer).
async function ask({ backlogDir, projectId, runsDir, question, data, activeRuns, runs, workflows, folder, agent, skillsDirs, resolveCommand, budget, mock, mode = 'plan', attachments = [], selection = [], scenario = null, onItem = null, signal = null, calibration = null, defaultWorkflow = null, cost = null, prices = {}, workflow = null, inputs = null, request = null, timeZone = null, language = null, runDefaults = null, workflowKinds = null }) {
  const q = String(question || '').trim();
  if (!q) throw new Error('Ask a question.');
  const byDefault = DefaultWorkflow.resolve(defaultWorkflow, (workflows || []).map((w) => w.file)).file;
  const previous = readConversation(backlogDir, projectId);
  const turnMode = poChosen.turnMode(mode, { draftOpen: !!currentDraft(previous), mock, scenarioMode: MOCK_SCENARIOS[scenario], question: q });
  let issueMode = turnMode === 'issue';
  const chosenWf = issueMode || !workflow ? null : (workflows || []).find((w) => w.file === workflow) || null;
  const chosen = chosenWf?.file || null;
  const costOff = poChosen.costOff(chosenWf, workflows, byDefault);
  const saved = poCalibration.clamp(agent?.calibration);
  const level = poCalibration.clamp(calibration, null) ?? poCalibration.fromQuestion(q) ?? saved;
  const savedCost = poCalibration.cost.clamp(agent?.cost);
  const costLevel = costOff ? null : poCalibration.cost.clamp(cost, null) ?? poCalibration.costFromQuestion(q) ?? savedCost;
  const calib = issueMode ? {} : {
    calibration: level, ...(level !== saved ? { calibrationOverride: true } : {}),
    ...(costLevel == null ? {} : { cost: costLevel, ...(costLevel !== savedCost ? { costOverride: true } : {}) }),
    ...(chosen ? { workflow: chosen } : {}),
  };
  // the owner's options, recorded on the question only (lastWorkflow)
  const chosenInputs = chosen && inputs && typeof inputs === 'object' && !Array.isArray(inputs) && Object.keys(inputs).length ? { inputs } : {};
  // #169: the attached issues the backlog knows (plan mode only)
  const known = new Set((data?.issues || []).map((i) => i.number));
  const selected = issueMode ? [] : [...new Set((selection || []).map(Number))].filter((n) => known.has(n));
  const history = runHistory(runs, data?.issues);
  const where = { backlogDir, projectId, runsDir };
  let thread = issueMode ? threadOf(previous, projectId) : null;
  // #240: a plan question another agent sent (handleRequest): its messages carry the request
  let tag = issueMode ? { mode: 'issue', thread } : request ? { request } : {};
  const record = (message) => (issueMode ? recordIssueMessage(where, message) : appendMessage(backlogDir, projectId, message));
  const staged = issueMode ? (attachments || []).filter((f) => isAttachment(backlogDir, projectId, f)).map((f) => path.resolve(f)) : [];
  const files = moveAttachments(where, thread, staged);
  const asked = record({ role: 'user', text: q, ...tag, ...calib, ...chosenInputs, ...(files.length ? { attachments: files } : {}), ...(selected.length ? { issues: selected } : {}) });
  const questionsLeft = MAX_QUESTIONS - questionsAsked(previous);
  let raw;
  let costUsd = 0;
  let model = 'simulated';
  let invalid = null;
  let analysis = '';
  // #180: the prose written so far, kept when the turn fails or is stopped
  const written = [];
  const seen = (item) => {
    if (item?.kind === 'text') written.push(String(item.text || ''));
    onItem?.(item);
  };
  try {
    if (mock) {
      let failure = null;
      try {
        // a scenario of the other mode is ignored (the default simulated answer)
        if (scenario && (MOCK_SCENARIOS[scenario] ?? turnMode) === turnMode) {
          raw = mockScenario(scenario, { data, question: q, previous, files, workflow: chosen || byDefault });
          analysis = `Simulated (scenario "${scenario}"): no model was called, no code was read.`;
        } else {
          // #150: the saved conflict map only (a simulated question builds nothing)
          raw = issueMode ? mockIssueAnswer({ data, question: q, previous, headings: Language.issueHeadings(language?.issues) }) : mockAnswer({ data, question: q, selection: selected, calibration: level, workflow: chosen || byDefault, cost: costLevel, conflictMap: readConflictMap(backlogDir, projectId) });
          analysis = 'Simulated: no model was called, no code was read.';
        }
      } catch (e) { failure = e; }
      // #180: with a live view, the simulated turn streams fake steps and its text first
      if (onItem) {
        await mockSteps(seen, {
          steps: MOCK_STEPS, signal, json: failure ? null : { simulated: true },
          text: failure ? 'Simulated: the answer had started when the error came.' : raw.summary || raw.reply || '',
        });
      }
      if (failure) throw failure;
    } else {
      checkBudget(budget);
      let tokens;
      let sessionId;
      // #150 / #526: the saved conflict map, a few seconds' wait at most; built in the background when missing
      const mapOf = issueMode ? null : { backlogDir, projectId, runs, repo: folder, store: storeFor(runsDir) };
      ({ raw, costUsd, model, invalid, tokens, sessionId, text: analysis } = await withConflictMap(mapOf, (conflictMap) => callAgent({
        mode: turnMode, question: q, report: (turnMode === 'plan' ? backlogReport : issueReport)({ data, activeRuns, history, workflows, question: q, selection: selected, conflictMap, defaultWorkflow: byDefault, workflow: chosen }),
        previous, attachments: files, selection: selected, folder, agent: issueMode ? ISSUE_AGENT : agent, skillsDirs, resolveCommand, onItem: seen, signal, calibration: level, cost: costLevel, workflow: chosen, costOff, timeZone, language, runDefaults, workflowKinds,
      })));
      recordUsage(backlogDir, { projectId, model, tokens, costUsd, sessionId });
    }
  } catch (e) {
    const partial = partialText(written);
    const message = signal?.aborted
      ? record({ role: 'po', ...tag, text: partial || 'Stopped before answering.', stopped: true, costUsd })
      : record({ role: 'po', ...tag, text: partial ? `${e.message}\n\nWritten before the error:\n\n${partial}` : e.message, error: true, costUsd });
    return { message, messages: readConversation(backlogDir, projectId) };
  }
  if (turnMode === 'auto' && raw?.intent === 'register') {
    // the question went out before the intent was known: tagged now, in the conversation and its thread
    issueMode = true;
    thread = threadOf(previous, projectId);
    tag = { mode: 'issue', thread };
    copyToThread(where, poChosen.retagQuestion(chatFile(backlogDir, projectId), asked, tag));
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
    // #670: a question naming a spec: its issues (the model's, or one per phase when simulated) and their mockup coverage
    const spec = poMockups.specProposal({ folder, question: q, issues: raw?.spec?.issues, mock: !!mock });
    const answer = normalizeAnswer(raw, { issues: data?.issues, history, workflows, epics: data?.epics, selection: selected, mock: !!mock, calibration: level, defaultWorkflow: byDefault, cost: costLevel, runs: (runs || []).filter((r) => !r.mock), prices, workflow: chosen, inputs, spec, runDefaults, workflowKinds });
    message = appendMessage(backlogDir, projectId, {
      role: 'po', ...tag, text: answer.summary, answer, model, costUsd, ...calib, ...(invalid ? { invalid } : {}),
    });
  }
  return { message, messages: readConversation(backlogDir, projectId) };
}

// ---- a discovery card's commit (#258) ---------------------------------------------------------------
// The split of a Ready card into the issues it is committed as (packages/engine/domains/discovery/discovery-commit.js files them
// on the owner's click): the model's proposal kept to the card's acceptance criteria
// (normalizeSplit), or the rule-based one (proposeSplit: the simulated answer, and the fallback).
const COMMIT_SCHEMA = {
  type: 'object',
  required: ['issues'],
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        required: ['title', 'tasks'],
        properties: {
          title: { type: 'string' },
          tasks: { type: 'array', items: { type: 'string' } },
          complexity: { type: 'integer' },
          workflow: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
};

const COMMIT_RULES = [
  'You are the Product Owner of this project. A discovery card reached Ready and its owner commits it to the backlog: propose the issues it becomes, from the card below and, when you need to, from the project\'s code (your working directory, read-only: docs/agents/code-map.md, grep).',
  'One issue when one run can deliver the card; two or more when its parts can ship on their own, touch unrelated areas of the code or hold more than about eight tasks. List the issues in the order to deliver them.',
  'Each issue has a title written with the issue-writing skill, the card\'s acceptance criteria it takes as `tasks` (copied as written; every criterion in exactly one issue, none dropped or invented), its `complexity` (1 to 5), the `workflow` that implements it (a file of the Workflows list; the default unless the issue needs another) and, when the card is split, a one-line `reason`.',
  'You never file issues and never start runs: the owner edits your proposal and files it with a click. Write the issues in the issues language the Language line names (the criteria copied as written).',
].join('\n');

function commitReport({ card, tasks, workflows, workflow }) {
  return [
    `## Discovery card ${card.id}: ${card.title}`,
    `Type: ${card.type}. Clarity: ${card.clarity?.score ?? 'not scored'}%.`,
    `### Document\n${clip(card.document, MAX_REPORT) || '(empty)'}`,
    `### Acceptance criteria (the tasks to hand out)\n${tasks.length ? tasks.map((t) => `- [ ] ${t}`).join('\n') : '(none written: derive the tasks from the document)'}`,
    `## Workflows\n${(workflows || []).map((w) => `- \`${w.file}\`${w.file === workflow ? ' (default)' : ''}: ${w.name || w.file}`).join('\n')}`,
  ].join('\n\n');
}

/**
 * The Product Owner's proposal for committing a discovery card: the issues it becomes.
 * `mock`: the rule-based proposal (no model call, no cost). The other options are ask's.
 * @returns {Promise<{ split: { issues: { title, tasks, complexity, workflow, reason }[] }, model: string, costUsd: number, invalid?: string }>}
 */
async function proposeCommit({ backlogDir, projectId, card, workflows, defaultWorkflow = null, folder, agent, skillsDirs, resolveCommand, budget, mock, language = null }) {
  const files = (workflows || []).map((w) => w.file);
  const workflow = DefaultWorkflow.resolve(defaultWorkflow, files).file;
  if (mock) return { split: discoveryCommit.proposeSplit(card, { workflow }), model: 'simulated', costUsd: 0 };
  checkBudget(budget);
  const report = commitReport({ card, tasks: discoveryCommit.cardTasks(card), workflows, workflow });
  const { raw, costUsd, model, invalid, tokens, sessionId } = await callAgent({ mode: 'commit', report, folder, agent, skillsDirs, resolveCommand, language });
  recordUsage(backlogDir, { projectId, model, tokens, costUsd, sessionId });
  return { split: discoveryCommit.normalizeSplit(raw, card, { workflow, workflows: files }), model, costUsd, ...(invalid ? { invalid } : {}) };
}

// What each mode of a Product Owner turn brings: its skills, rules, answer schema and step id.
const TURNS = {
  commit: { skills: ['issue-writing'], rules: COMMIT_RULES, schema: COMMIT_SCHEMA, stepId: 'product-owner-commit', fallback: () => ({ issues: [] }) },
  issue: {
    skills: ['issue-triage', 'issue-writing', 'clarity-score'], rules: ISSUE_RULES, schema: ISSUE_SCHEMA, stepId: 'product-owner-issue',
    fallback: (prose) => ({ reply: prose, questions: [], draft: { title: '', body: '', labels: [], related: [] }, duplicates: [], existing_issue: 0, addition: '', assumptions: [] }),
  },
  plan: {
    skills: ['backlog-product-owner'], rules: RULES, schema: ANSWER_SCHEMA, stepId: 'product-owner',
    fallback: (prose) => ({ summary: prose, groups: [], conflicts: [], enrich: [], splits: [], epics: {} }),
  },
};
TURNS.auto = poChosen.autoTurn(TURNS.plan, TURNS.issue);

// One read-only Claude Code turn in the project folder. An answer that does not validate is kept as
// prose (no second call: one call per question). Mode 'issue': the issue skills, ISSUE_SCHEMA, and
// read access to the attachments' folder. A plan turn states its calibration (#189) and its Cost step
// (#205) after the rules. Mode 'commit' (#258): the card's report only, COMMIT_SCHEMA.
// #235: the prompt's section for the workflow the owner chose (it replaces the default; the
// orchestrator puts every group on it and adds the owner's options to the groups' inputs)
function workflowSection(workflow, costOff) {
  return [
    `## Workflow: ${workflow} (chosen by the owner)`,
    `The owner fixed the workflow of this plan: give every group \`${workflow}\`, never another workflow and no test-backfill stage. The owner's choices for its options are added to every group's inputs: do not set them yourself.`,
    ...(costOff ? ['This workflow writes its acceptance tests first and runs them every time: there is no Cost step for this plan; do not name one (no "Economy" or "Generous") in the summary.'] : []),
  ].join('\n');
}

// #235: the workflow (and its options) last chosen in the drawer for the project, as its plan
// questions recorded them: { workflow, inputs }, or null (the live roadmap's refill plans with it)
function lastWorkflow(backlogDir, projectId) {
  const list = readConversation(backlogDir, projectId);
  for (let i = list.length - 1; i >= 0; i--) if (list[i].role === 'user' && list[i].workflow) return { workflow: list[i].workflow, inputs: list[i].inputs || {} };
  return null;
}

// #670: a spec's mockups go into each screen task of a plan or issue turn (only when the question
// names a spec that has some)
function mockupsFor(mode, folder, question) {
  return ['auto', 'issue', 'plan'].includes(mode) ? poMockups.mockupSection({ folder, question }) : '';
}

async function callAgent({ mode = 'plan', question = '', report, previous = [], attachments = [], selection = [], folder, agent, skillsDirs, resolveCommand, onItem = () => {}, signal = null, calibration = null, cost = null, workflow = null, costOff = false, timeZone = null, language = null, runDefaults = null, workflowKinds }) {
  // the run modules, not engine/workflow: the engine reaches this module through refactor-priority (#378)
  const { extractJson, validateSchema } = require('../../engine/run/outputs');
  const { render } = require('../../engine/run/templates');
  const { runTurn, isImagePath } = require('../../engine/providers');
  const { resolveSkill, skillPrompt } = require('../agents/skills');
  const { providerArgs, normalize, dedupeFlags } = require('../../engine/capabilities');
  const { PROVIDERS } = require('../workflow/workflow-builder');
  const provider = PROVIDERS.claude;
  if (!resolveCommand(provider.command)) throw new Error(`The Product Owner needs ${provider.command}, which is not installed.`);
  if (!folder || !fs.existsSync(folder)) throw new Error('The project has no folder on this machine: the Product Owner reads its code there.');
  const issueMode = mode === 'issue';
  const planMode = ['auto', 'plan'].includes(mode);
  const turn = TURNS[mode] || TURNS.plan;
  const { schema } = turn;
  const skills = turn.skills.map((s) => resolveSkill(skillsDirs, s));
  const readOnly = providerArgs(provider.type, { caps: normalize({ tools: ['read'] }) }).args;
  // images go as the turn's attachments (#129: checked against the limits, Read on their folder);
  // other files are listed with read access to their folder
  const images = attachments.filter(isImagePath);
  const others = attachments.filter((f) => !isImagePath(f));
  const dirs = [...new Set(others.map((f) => path.dirname(f)))].flatMap((d) => ['--add-dir', d]);
  const extraArgs = dedupeFlags([...readOnly, ...dirs, ...skills.flatMap((skill) => (provider.skill_args || []).map((x) => render(x, { skill_dir: skill.path })))], provider.args || []);
  const prompt = [
    ...skills.map(skillPrompt),
    turn.rules,
    planMode ? poCalibration.promptSection(calibration ?? agent?.calibration) : '',
    planMode && !costOff ? poCalibration.costPromptSection(cost ?? agent?.cost, poCalibration.clamp(calibration ?? agent?.calibration)) : '',
    planMode && workflow ? workflowSection(workflow, costOff) : '',
    kindsSection(workflowKinds, planMode),
    poChosen.runDefaultsSection(runDefaults, mode),
    selection.length ? SELECTION_RULES : '',
    mockupsFor(mode, folder, question),
    report,
    issueMode ? issueContext(previous) : planMode ? previousExchanges(previous) : '',
    timeZone ? `## The owner's time\n${TimeZone.nowLine(timeZone)}` : '',
    Language.languageLine({ language }), // #327: once per turn, English when unset
    issueMode ? `## The owner's new message\n${question}` : planMode ? `## The owner's question\n${question}` : '',
    others.length ? `## Files the owner attached (read them)\n${others.map((f) => `- ${f}`).join('\n')}` : '',
    `\n---\nAt the end of your response you MUST include a \`\`\`json block with an object that validates against this JSON Schema:\n\`\`\`json\n${JSON.stringify(schema, null, 2)}\n\`\`\``,
  ].filter(Boolean).join('\n\n');
  const res = await runTurn({
    provider, model: agent.model, effort: agent.effort && agent.effort !== 'default' ? agent.effort : undefined, prompt, cwd: folder, extraArgs, attachments: images,
    timeoutMs: 15 * 60e3, render, hint: { stepId: turn.stepId, visit: 1, agent: 'product-owner', schema }, onItem, signal,
  });
  let raw;
  let errs;
  try { raw = extractJson(res.text); errs = validateSchema(raw, schema); } catch (e) { errs = [e.message]; }
  if (errs.length) {
    const prose = String(res.text || '').replace(/```json[\s\S]*$/, '').trim() || 'The answer could not be read.';
    return { raw: turn.fallback(prose), costUsd: res.costUsd || 0, tokens: res.usage, sessionId: res.providerSessionId || null, model: agent.model, invalid: errs.join('; '), text: res.text || '' };
  }
  return { raw, costUsd: res.costUsd || 0, tokens: res.usage, sessionId: res.providerSessionId || null, model: agent.model, invalid: null, text: res.text || '' };
}

module.exports = {
  actRequest,
  ANSWER_SCHEMA,
  applyEpicProposal,
  applySplit,
  ask,
  backlogReport,
  calibrateGroups,
  checkBudget,
  clearConversation,
  complexityOf,
  CONFIRM_KINDS,
  costedGroups,
  costInputs,
  currentDraft,
  decongestIssue,
  discardDraft,
  estimate,
  fileDecongest,
  fileDraft,
  fileSpec,
  handleRequest,
  ISSUE_AGENT,
  ISSUE_SCHEMA,
  kindOf,
  lastWorkflow,
  MOCK_SCENARIOS,
  mockAnswer,
  mockIssueAnswer,
  mockScenario,
  monthUsage,
  normalizeAnswer,
  normalizeIssueAnswer,
  packGroups,
  proposeCommit,
  readConversation,
  recordUsage,
  REQUEST_KINDS,
  runHistory,
  saveAttachment,
  SELECTION_RULES,
  sizeGroup,
  testBatchStages,
  usageLines,
};
