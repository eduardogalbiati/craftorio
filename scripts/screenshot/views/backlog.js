// Screenshot seed of the Backlog (--view backlog, #249): its modes, the options only it takes (--live,
// --roadmap, --po) and its demo data: the release flow (views/releases.js), the demo roadmap
// (views/roadmap.js) and its Conflict map (#150; #354: drawn on the project's page, the Roadmap links
// to it; demoConflictMap, also on views/project.js), the release run of --release (#291), the Product
// Owner's conversation, a Backlog Refresh run, the committed cards (views/discovery.js), an issue
// enriched by Write & Review (demoEnrichRun, also on Artifacts and Duo), the tests known to fail on
// the base (#405, demoBaseFailures) and the project's package.json. Opens the Backlog, or the Roadmap screen in its roadmap mode (views/roadmap.js).

const fs = require('fs');
const path = require('path');
const {
  DEMO_ISSUES,
  DEMO_REPO,
  gitRepo,
  writeDemoPackage,
} = require('../helpers');
const { demoCommittedCards } = require('./discovery');
const {
  demoLocalMerge,
  demoReleaseRun,
  demoReleases,
} = require('./releases');
const { demoRoadmap } = require('./roadmap');

// The Roadmap's Conflict map (#150): 20 runs, three hot files (one named by merge conflicts), a quiet
// one, and a long import line most runs changed.
function demoConflictMap(ws, projectId) {
  const runIds = Array.from({ length: 20 }, (_, k) => `20261011-${String(220000 - k * 3700).padStart(6, '0')}-${(0xa1c0 + k).toString(16)}`);
  const entry = (file, n, conflicts = 0, from = 0) => ({ file, runs: n, runIds: runIds.slice(from, from + n), lastRun: runIds[from], conflicts });
  const map = {
    source: 'runs', runs: runIds.length, runIds, builtAt: new Date().toISOString(),
    files: [entry('packages/ui-kit/app.js', 14, 3), entry('apps/desktop/renderer/index.html', 13, 1), entry('packages/engine/service/index.js', 11), entry('README.md', 7, 0, 4), entry('packages/engine/engine/runner.js', 3, 0, 9)],
    lines: [{ file: 'packages/engine/service/index.js', line: 12, text: "const { backlog, gates, notifications, projects, roadmap, runs, settings, usage, workflows } = require('./areas');", runs: 12, runIds: runIds.slice(0, 12) }],
  };
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.conflict-map.json`), JSON.stringify(map, null, 2));
}

// The Product Owner registering an issue (#117): a short request with a screenshot, one question,
// the owner's answer, then a draft (long title, labels, Related, a close issue: #12), then a plan
// answer whose groups the demo roadmap already holds (#140), then a question about issues sent from
// the selection with a suggested extra issue (#169). Shown with `--click "#btn-bl-po"`;
// `--click "[data-po-act=create]"` previews the filing (po:file previews here).
function demoPoConversation(ws, projectId, po = null) {
  const at = (s) => new Date(Date.UTC(2026, 0, 20, 10, 0, s)).toISOString();
  const shot = path.join(ws.backlog, `${projectId}.po`, 'attachments', '1768903200000-run-report.png');
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  fs.writeFileSync(shot, '');
  const body = [
    '## Context', '', 'The run report (#12) exports Markdown only (`src/report.js:41`, `exportMarkdown`). The owner shares reports with people who do not read Markdown.', '',
    'Decision (owner): a PDF export next to the Markdown one, same layout.', '',
    '## Tasks', '', '- [ ] **Export as PDF** in the run report menu, next to Markdown', '- [ ] The PDF keeps the report layout (headings, tables, cost)', '- [ ] Tests: a mock run exports a PDF with the report title', '',
    '## Triage', '', 'Impact 3 (sharing reports), complexity 2 (one renderer, estimate: `src/report.js`, `apps/desktop/renderer/run.js`). Group with #12.', '',
    'Related: #12',
  ].join('\n');
  const big = DEMO_ISSUES.find((x) => x.number === 15);
  const poSplit = require('@multiagent/engine/domains/po/po-split');
  const split = poSplit.normalizeSplit(poSplit.proposeSplit(big, { complexity: 5 }), big, { complexity: 5 });
  // #242: a long title and a long task line with inline Markdown, so the card must fit the drawer
  split.title = `${split.title || big.title}: keep every run's worktree, branch and logs safe when the app closes, crashes or the workspace moves to another disk`;
  if (split.tasks?.[0]) split.tasks[0] = { ...split.tasks[0], text: `**Recovery inbox per workspace**: list the runs left behind with \`events.jsonl\` and their branches, offer Resume or Discard, and link [the storage doc](https://example.com/storage) from the empty state; ${split.tasks[0].text}` };
  const messages = [
    { ts: at(0), role: 'user', mode: 'issue', text: 'export the report as pdf', attachments: [shot] },
    { ts: at(20), role: 'po', mode: 'issue', model: 'claude-sonnet-5', costUsd: 0.04, text: 'One question before I draft it:', issue: { reply: 'One question before I draft it:', questions: ['Should the PDF replace the Markdown export, or sit next to it?'], draft: null, duplicates: [], existingIssue: null, addition: '', assumptions: [] } },
    { ts: at(40), role: 'user', mode: 'issue', text: 'Next to it, same layout as the Markdown report.' },
    { ts: at(70), role: 'po', mode: 'issue', model: 'claude-sonnet-5', costUsd: 0.11, text: 'Drafted below. **#12** builds the report this exports: run them together.', issue: {
      reply: 'Drafted below.', questions: [],
      draft: { title: 'Export the run report as a PDF next to the Markdown export, keeping the same layout', body, labels: ['enhancement', 'impact:3', 'complexity:2', 'area:renderer'], related: [12], epic: '#13', epicTitle: 'Run reports' },
      duplicates: [{ number: 12, title: 'Export a run report as Markdown', state: 'open', relation: 'overlaps', reason: 'Same report and menu.' }],
      existingIssue: null, addition: '', assumptions: ['The PDF uses the same template as the Markdown export.'],
    } },
    // a plan answer (#140) against the demo roadmap: #12 + #9 is its stage 2, added from this answer
    // (In roadmap · Stage 2), #11 its done stage 1, planned before (Already in the roadmap), #10 + #8
    // only partly planned (Add the rest)
    { ts: at(90), role: 'user', mode: 'plan', text: 'Analyze the backlog and propose runs' },
    { ts: at(110), role: 'po', mode: 'plan', model: 'claude-opus-5-5', costUsd: 0.21, calibration: 2, cost: 1, text: 'Three runs: the rename crash first, then the server work together, then the small UI and docs fixes.', answer: {
      summary: 'Three runs.',
      cost: 1,
      estimateUsd: 27.4,
      estimateMissing: 1,
      groups: [
        { name: 'Rename crash', issues: [11], workflow: 'software-development-local-hero.yaml', inputs: { mode: 'auto' }, reason: 'It blocks the rest.', files: ['packages/engine/domains/workspace/workspace.js'], stage: 1, complexity: 4, guessed: false, estimate: null, warnings: [] },
        { name: 'Reports and health', issues: [12, 9], workflow: 'software-development-local-hero.yaml', inputs: { mode: 'auto' }, reason: 'Both add a server route: one run avoids a merge conflict in packages/engine/server.', files: ['packages/engine/server.js'], stage: 2, complexity: 5, guessed: false, estimate: { minutes: 35, costUsd: 1.8, basis: '3 past runs' }, warnings: [],
          inputs: { mode: 'auto', unit_tests: 'run_existing', e2e_tests: 'write', screenshots: 'off' },
          costEstimate: { usd: 15.8, perPoint: 3.16, complexity: 5, runs: 12, estimated: false, basis: 'Median cost per step and complexity point of the last 12 successful runs of software-development-local-hero.yaml, × complexity 5 (test ×0.35, evidence ×0.5, developer_screenshots off).' },
          cost: { level: 1, name: 'Economy', inputs: { unit_tests: 'run_existing', e2e_tests: 'write', screenshots: 'off' }, grouping: 'Grouped to pay the run overhead once (same area or files).', notAdjustable: ['Agents: not adjustable (the workflow has no model or effort input)'] } },
        { name: 'Scrollbars and docs', issues: [10, 8], workflow: 'software-development.yaml', inputs: { mode: 'validated' }, reason: 'Two small fixes the owner can check in the app.', files: ['packages/ui-kit/style.css'], stage: 3, complexity: 1, guessed: true, estimate: null, warnings: [] },
      ],
      conflicts: [], enrich: [],
      // #124: the big issue split along its two areas; #138: #15 placed in an epic, a new one for the UI fixes
      splits: [split],
      epics: {
        place: [{ issue: 15, epic: '#14', epicTitle: 'Workspace safety and recovery', reason: 'Run safety is this epic\'s theme.' }],
        create: [{ title: 'UI polish', goal: 'Small fixes to how the app looks and behaves with the keyboard, shipped together.', issues: [10, 16] }],
        merge: [],
        split: [],
      },
    } },
    // #169: issues sent from the Backlog's selection (#8 closed meanwhile: left out), a group with a
    // suggested extra issue (#10, unchecked until the owner keeps it); #189: planned for Quality, for this question only
    { ts: at(130), role: 'user', mode: 'plan', text: 'What is the best strategy to put these issues in the roadmap? Should any other open issue join them?', issues: [16, 8], calibration: 5, calibrationOverride: true },
    { ts: at(150), role: 'po', mode: 'plan', model: 'claude-opus-5-5', costUsd: 0.09, calibration: 5, calibrationOverride: true, text: 'One validated run for #16; **#10** touches the same styles and could join it. #8 is closed: left out.', answer: {
      summary: 'One run.',
      groups: [
        { name: 'Keyboard focus', issues: [16], workflow: 'software-development.yaml', inputs: { mode: 'validated' }, modeReason: 'A behaviour the owner can try in the app.', reason: 'A small UI fix on its own.', files: ['packages/ui-kit/app.js'], stage: 1, complexity: 1, guessed: false, estimate: null, warnings: [],
          suggested: [{ issue: 10, reason: 'Same area (ui): the dialog and dock styles, one validated run.' }] },
      ],
      closed: [8],
      conflicts: [], enrich: [], splits: [], epics: { place: [], create: [], merge: [], split: [] },
    } },
    // #240: a request from the Oracle, mechanical (no model call, US$ 0): one card with its result
    { ts: at(160), role: 'request', text: 'Request from the Oracle: roadmap.add (The owner wants it in tonight\'s runs)', request: { from: 'oracle', kind: 'roadmap.add', ref: 'demo-request-1' }, reason: 'The owner wants it in tonight\'s runs', params: { issues: [16] } },
    { ts: at(161), role: 'po', text: 'Done: #16: added to the roadmap in stage 3 (software-development.yaml).', request: { from: 'oracle', kind: 'roadmap.add', ref: 'demo-request-1' }, costUsd: 0 },
  ];
  // --po stopped | failed (#180): the last answer stopped by the owner, or failed, with what was written kept
  const partial = 'Two runs so far: **#16** on its own (validated), then **#10** with the dock styles.\n\nI was checking whether #15 fits under complexity 5';
  const roadmapQ = { ts: at(170), role: 'user', mode: 'plan', text: 'Build a roadmap' };
  if (po === 'stopped') messages.push(roadmapQ, { ts: at(230), role: 'po', mode: 'plan', costUsd: 0, stopped: true, text: partial });
  if (po === 'failed') messages.push(roadmapQ, { ts: at(230), role: 'po', mode: 'plan', costUsd: 0, error: true, text: `Timed out after 900s\n\nWritten before the error:\n\n${partial}` });
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.po.jsonl`), messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
}

// An accepted, simulated Write & Review run that enriched #12 (#103): the Backlog card shows
// "enriched", its chat (click the badge) has Save to issue, whose preview is all a screenshot does.
const DEMO_ENRICH_RUN = '20260119-090000-demo0012';
function demoEnrichRun(ws, projectId) {
  const dir = path.join(ws.runs, DEMO_ENRICH_RUN);
  const i = DEMO_ISSUES.find((x) => x.number === 12);
  const issues = [{ number: i.number, url: `${DEMO_REPO}/issues/${i.number}`, title: i.title }];
  const document = `# Export a run report as Markdown\n\n## Context\nOwners copy run results by hand into PR descriptions and notes.\n\n## Decisions\n- One Markdown file per run, written into the run folder.\n\n## Acceptance criteria\n- [ ] An Export button in Run Details writes report.md\n- [ ] The report lists steps, agents, costs and the final answer\n- [ ] Tests cover a run with a failed step\n`;
  const inputs = { prompt: `Enrich issue #12 into a complete issue.\nIssue #12: ${i.title}`, goal: 'A complete issue someone else can implement without asking.', document_skill: 'issue-writing', project_path: '', threshold: 8, max_rounds: 5, writer_provider: 'claude', writer_model: 'claude-opus-5-5', writer_effort: 'high', reviewer_provider: 'codex', reviewer_model: 'gpt-6-luna', reviewer_effort: 'high' };
  const at = (m) => new Date(Date.UTC(2026, 0, 19, 9, m)).toISOString();
  const base = { run_id: DEMO_ENRICH_RUN };
  const summary = { run_id: DEMO_ENRICH_RUN, workflow: 'writer-reviewer', project_id: projectId, issues, status: 'success', mock: true, started_at: at(0), finished_at: at(6), duration_ms: 360000, inputs, sessions: [] };
  const events = [
    { ...base, seq: 1, ts: at(0), type: 'workflow.started', workflow: 'writer-reviewer', file: 'writer-reviewer.yaml', project_id: projectId, issues, inputs, mock: true, run_dir: dir },
    { ...base, seq: 2, ts: at(1), type: 'step.started', step_id: 'write', visit: 1 },
    { ...base, seq: 3, ts: at(2), type: 'step.finished', step_id: 'write', output: { message: 'First complete version of the issue.', document } },
    { ...base, seq: 4, ts: at(3), type: 'step.finished', step_id: 'review', output: { score: 9, summary: 'Complete and verifiable.', notes: [] } },
    { ...base, seq: 5, ts: at(4), type: 'step.finished', step_id: 'signoff', output: { ready: true, summary: 'Ready: every part of the goal is met. Accept it.', checks: [{ item: 'Verifiable acceptance criteria', ok: true }] } },
    { ...base, seq: 6, ts: at(6), type: 'workflow.finished', status: 'success', summary },
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'document.md'), document);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
}

// Backlog Refresh (#161): a refresh run that started 25 h ago and updated #15 and #12 (their
// "refreshed" badge, within a day of its end), and the project's folder a git repository whose main
// got 14 commits since: the Backlog's banner says "Backlog refreshed 25 h ago · 14 merges since".
function demoBacklogRefresh(ws, folder, projectId) {
  const runId = '20260119-210000-demo0161';
  const dir = path.join(ws.runs, runId);
  const started = new Date(Date.now() - 25 * 3600e3).toISOString();
  const finished = new Date(Date.now() - 23.5 * 3600e3).toISOString();
  const inputs = { project_path: folder, git_platform: 'gh', base_branch: 'main', since: '24 hours ago', issues: [] };
  const summary = { run_id: runId, workflow: 'backlog-refresh', project_id: projectId, status: 'success', mock: false, started_at: started, finished_at: finished, duration_ms: 5400000, inputs, sessions: [] };
  const base = { run_id: runId };
  const events = [
    { ...base, seq: 1, ts: started, type: 'workflow.started', workflow: 'backlog-refresh', file: 'backlog-refresh.yaml', project_id: projectId, inputs, mock: false, run_dir: dir },
    { ...base, seq: 2, ts: finished, type: 'workflow.finished', status: 'success', summary },
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(dir, 'applied-safe.json'), JSON.stringify({
    repo: DEMO_REPO.replace('https://github.com/', ''), platform: 'gh', mode: 'safe', at: finished,
    results: [{ number: 15, result: 'updated', changes: ['body (3 edits)'] }, { number: 12, result: 'updated', changes: ['body (1 edit)', 'complexity:3 -> complexity:2'] }, { number: 9, result: 'skipped', reason: 'edited after the review' }],
  }, null, 2));
  const git = gitRepo(folder);
  git(['init', '-q', '-b', 'main']);
  for (let n = 0; n < 15; n++) {
    fs.writeFileSync(path.join(folder, 'CHANGES.md'), `change ${n}\n`);
    git(['add', '-A']);
    // the first one before the refresh, 14 merges after it
    git(['commit', '-q', '-m', n ? `Merge change ${n} (#${60 + n})` : 'Initial commit'], new Date(Date.now() - (n ? 22 - n : 30) * 3600e3).toISOString());
  }
}

// #405: two tests known to fail on the base (packages/engine/domains/project/base-health.js store), one with its bug issue
function demoBaseFailures(ws, projectId) {
  const dir = path.join(ws.backlog, 'base-health');
  const at = (h) => new Date(Date.now() - h * 3600e3).toISOString();
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${projectId}.json`), JSON.stringify({
    lastGreen: { commit: 'a1b2c3d4e5f6', at: at(14) },
    failures: [
      { test: 'splits a long run into resumable parts', file: 'test/slow/engine-run-split-250.slow.test.js', first_seen: at(13), last_seen: at(1), runs: ['20261015-011200-aa11', '20261015-093000-bb22'], issue: { number: 412, url: `${DEMO_REPO}/issues/412` } },
      { test: 'rule names stay sorted', file: 'test/workflow-rules-352.test.js', first_seen: at(3), last_seen: at(3), runs: ['20261015-113000-cc33'], issue: null },
    ],
  }, null, 2));
}

function seed({ args, ws, project }) {
  demoLocalMerge(ws, project.id);
  // #260: the "Released" badge on the issues the history shipped
  demoReleases(ws, project.id);
  demoRoadmap(ws, project.id, args.live, args.budget, args.roadmap);
  // #405: the Roadmap's "known failures on the base" line
  demoBaseFailures(ws, project.id);
  // #150: the Roadmap's Conflict map
  demoConflictMap(ws, project.id);
  // #291: the release v0.10 of the roadmap's cut line, in a state (needs the history: Backlog only)
  if (args.release) demoReleaseRun(ws, project.id, args.release);
  demoPoConversation(ws, project.id, args.po);
  if (project.folder) demoBacklogRefresh(ws, project.folder, project.id);
  // #258: the committed cards, as badges on their issues
  demoCommittedCards(ws, project.id);
  demoEnrichRun(ws, project.id);
  writeDemoPackage(project.folder);
}

// #254: the Roadmap screen has its own menu entry
const open = ({ args, click }) => click(args.mode === 'roadmap' ? '.nav-item[data-view="roadmap"]' : '.nav-item[data-view="backlog"]');

async function afterOpen({ args, click, js, pause }) {
  if (args.mode && args.mode !== 'roadmap') await click(`#view-backlog [data-mode="${args.mode}"]`);
  // #291: the Roadmap's Releases filter on a choice ('next', or a version)
  if (args.releaseFilter) {
    await js(`const s = document.querySelector('[data-rm-release-filter]'); if (s) { s.value = ${JSON.stringify(args.releaseFilter)}; s.dispatchEvent(new Event('change', { bubbles: true })); }`);
    await pause(800);
  }
  // --po (#180): the Product Owner's drawer, asking (working, writing) or with its last answer
  // (#235: with --workflow, the workflow it plans with, as if the owner had chosen it for the project)
  if (args.po && args.workflowGiven) await js(`localStorage.setItem('po.workflow.' + window.BacklogActions.projectId(), ${JSON.stringify(args.workflow)});`);
  if (['working', 'writing'].includes(args.po)) await js('window.BacklogPO.ask(\'Analyze the backlog and propose runs\'); await new Promise((r) => setTimeout(r, 500));');
  else if (args.po) await js('await window.BacklogPO.open();');
}

module.exports = {
  afterOpen,
  demoConflictMap,
  demoEnrichRun,
  modes: ['list', 'kanban', 'roadmap', 'epics'],
  open,
  // the options only this view takes, and their values: the Live roadmap (#164), more states of the
  // roadmap card (#282, #284; #395: an item parked at its gate), the Product Owner's drawer (#180)
  options: { live: ['off', 'on', 'refilling', 'empty', 'budget'], roadmap: ['parked', 'states'], po: ['working', 'writing', 'stopped', 'failed'] },
  seed,
};
