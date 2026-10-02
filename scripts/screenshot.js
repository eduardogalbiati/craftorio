// UI screenshots for tests and PRs: opens one screen of the app with simulated data, saves a PNG and
// quits by itself. The caller only chooses what to show; it never writes its own Electron script.
//
//   npx electron scripts/screenshot.js --view <view> [options]      (or: npm run screenshot -- ...)
//
//   --view <name>      dashboard, sessions, projects, project, backlog, artifacts, workflows, agents,
//                      skills, usage, analytics, supervisor, settings, duo, arena, run-chat, run
//                      (default dashboard)
//   --tab <name>       settings: general | agents | execution | about; workflows: runs | definitions
//   --mode <name>      backlog: list | kanban | roadmap | epics
//   --run <mock|dir>   run-chat: a simulated software-development run (default) or a copy of a run folder
//   --workflow <file>  the workflow of the simulated run (default software-development.yaml)
//   --input <k=v>      run: a workflow input of the Start panel (repeatable), e.g. mode=validated
//   --stop-at <step>   run: approves every gate but this step's and captures once it waits there
//                      (e.g. --input mode=validated --stop-at developer_check: the two-column gate
//                      with Run App and its Artifacts panel)
//   --keep-awake <s>   off | idle | active | error: the Keep awake switch (#162, Workflows header,
//                      Settings › Execution, the sidebar's moon-off item); active and error show
//                      demo states (2 runs, roadmap stage 3/6; a blocker that failed to start)
//   --click <css>      clicks this element once the view is open (repeatable, in order)
//   --context <css>    then right-clicks this element (repeatable): e.g. an artifact's copy menu
//   --theme <t>        dark | light | system: the theme Electron reports (prefers-color-scheme)
//   --size <WxH>       window content size (default 1400x900)
//   --ref <git ref>    captures the app as it is at this ref (e.g. main, for the "original" shots)
//   --out <dir>        output folder (default runs/screenshots); --name <file> without .png
//                      (run evidence: --out <run_dir>/evidence/<step>/round-<n> --name <issue>-<screen>-<state>)
//   --side <s>         original | modified: saves <name>.<side>.png, the two images of a pair
//                      (default original with --ref, modified with --caption, else no suffix)
//   --caption <text>   records this shot with its caption and commit in <run_dir>/evidence/manifest.json
//                      (src/evidence.js): needs --out <run_dir>/evidence/<step>/round-<n>
//   --wait <ms>        extra time before the capture (default 1500; run: 20000)
//   --timeout <ms>     hard limit: the app exits with code 1 after it (default 90000)
//
// Always a scratch workspace in the temp folder, removed at the end: simulated runs only
// (MULTIAGENT_AUTH=off, developer mode on), no sign-in, and HOME/USERPROFILE/APPDATA/GH_CONFIG_DIR
// point inside it, so the screens never show this machine's CLI sessions, usage or accounts. Demo
// data: a project `demo-app` with a few issues (the Backlog's sync never calls gh) and, for the
// views that list runs, one simulated run; backlog and duo also get an accepted Write & Review run
// on issue #12, whose Save to issue only previews (backlog:save-doc is forced to preview). The
// simulated run of artifacts, and the live run of `run --stop-at`, get demo screenshots (two
// rounds, an original/modified pair) for the Artifacts panel and the image viewer, e.g.
// `--view run --input mode=validated --stop-at developer_check --click ".run-gate-side [data-iv-thumb]"`
// opens the viewer (then `--click '.iv [data-iv-zoom="in"]'` zooms).
// Prints `screenshot: <path>` and exits 0, or exits 1 with the error.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync, execFileSync } = require('child_process');
const evidence = require('../src/evidence');

const VIEWS = {
  dashboard: {}, sessions: {}, projects: {}, project: {}, artifacts: {}, agents: {}, skills: {}, usage: {}, analytics: {}, duo: {}, arena: {},
  supervisor: {},
  backlog: { modes: ['list', 'kanban', 'roadmap', 'epics'] },
  workflows: { tabs: ['runs', 'definitions'] },
  settings: { tabs: ['general', 'agents', 'execution', 'about'] },
  'run-chat': { run: true },
  run: { live: true },
};
const THEMES = ['dark', 'light', 'system'];
const KEEP_AWAKE = ['off', 'idle', 'active', 'error'];

function parseArgs(argv) {
  const a = { view: 'dashboard', tab: null, mode: null, run: 'mock', workflow: 'software-development.yaml', clicks: [], contexts: [], inputs: {}, stopAt: null, keepAwake: null, theme: null, size: [1400, 900], ref: null, out: null, name: null, side: null, caption: null, wait: null, timeout: 90000 };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => { const v = argv[++i]; if (v === undefined) throw new Error(`${k} needs a value`); return v; };
    const ms = () => { const v = Number(next()); if (!Number.isFinite(v) || v < 0) throw new Error(`${k} takes milliseconds`); return v; };
    if (k === '--view') a.view = next();
    else if (k === '--tab') a.tab = next();
    else if (k === '--mode') a.mode = next();
    else if (k === '--run') a.run = next();
    else if (k === '--workflow') a.workflow = next();
    else if (k === '--click') a.clicks.push(next());
    else if (k === '--context') a.contexts.push(next());
    else if (k === '--stop-at') a.stopAt = next();
    else if (k === '--keep-awake') a.keepAwake = next();
    else if (k === '--input') {
      const m = /^([\w-]+)=(.*)$/s.exec(next());
      if (!m) throw new Error('--input takes key=value');
      a.inputs[m[1]] = m[2];
    }
    else if (k === '--theme') a.theme = next();
    else if (k === '--size') {
      const m = /^(\d+)x(\d+)$/i.exec(next());
      if (!m) throw new Error('--size takes WIDTHxHEIGHT, e.g. 1400x900');
      a.size = [+m[1], +m[2]];
    } else if (k === '--ref') a.ref = next();
    else if (k === '--out') a.out = next();
    else if (k === '--name') a.name = next();
    else if (k === '--caption') a.caption = next();
    else if (k === '--side') a.side = next();
    else if (k === '--wait') a.wait = ms();
    else if (k === '--timeout') a.timeout = ms();
    else throw new Error(`Unknown argument: ${k}`);
  }
  const v = VIEWS[a.view];
  if (!v) throw new Error(`Unknown view: ${a.view}. Views: ${Object.keys(VIEWS).join(', ')}`);
  if (a.tab && !v.tabs?.includes(a.tab)) throw new Error(`--tab ${a.tab} does not apply to ${a.view}${v.tabs ? ` (tabs: ${v.tabs.join(', ')})` : ''}`);
  if (a.mode && !v.modes?.includes(a.mode)) throw new Error(`--mode ${a.mode} does not apply to ${a.view}${v.modes ? ` (modes: ${v.modes.join(', ')})` : ''}`);
  if (a.theme && !THEMES.includes(a.theme)) throw new Error(`--theme takes ${THEMES.join(' | ')}`);
  if (a.keepAwake && !KEEP_AWAKE.includes(a.keepAwake)) throw new Error(`--keep-awake takes ${KEEP_AWAKE.join(' | ')}`);
  if ((a.stopAt || Object.keys(a.inputs).length) && a.view !== 'run') throw new Error('--stop-at and --input apply to --view run');
  a.wait ??= v.live ? 20000 : 1500;
  a.name ??= [a.view, a.tab, a.mode, a.theme].filter(Boolean).join('-');
  if (!/^[\w.-]+$/.test(a.name)) throw new Error(`--name must be a plain file name: ${a.name}`);
  if (a.side && !SIDES.includes(a.side)) throw new Error(`--side takes ${SIDES.join(' | ')}`);
  if (a.caption && !(a.out && runOfRound(path.resolve(a.out)))) throw new Error('--caption needs --out <run_dir>/evidence/<step>/round-<n>');
  a.side ??= a.ref ? 'original' : a.caption ? 'modified' : null;
  return a;
}

const SIDES = ['original', 'modified'];
const fileName = (a) => `${a.name}${a.side ? `.${a.side}` : ''}.png`;
// <run_dir>/evidence/<step>/round-<n> → <run_dir>, else null
function runOfRound(dir) {
  const runDir = path.resolve(dir, '..', '..', '..');
  return evidence.roundOf(runDir, path.resolve(dir)) ? runDir : null;
}

/** Records a shot of a round folder (its caption and commit) in the run's evidence manifest; returns the manifest. */
function recordShot(dir, { file, caption, commit = null }) {
  const runDir = runOfRound(dir);
  if (!runDir) throw new Error(`Not a round folder of a run's evidence (<run_dir>/evidence/<step>/round-<n>): ${dir}`);
  const rel = path.relative(runDir, path.resolve(dir, path.basename(file))).split(path.sep).join('/');
  return evidence.writeManifest(runDir, { captions: { [rel]: { caption, commit } } });
}

// ---- simulated data ------------------------------------------------------------------------
const DEMO_REPO = 'https://github.com/example/demo-app';
// #124: an issue too big for one run (complexity 5, 12 tasks in two areas of the code): the Product
// Owner's plan answer proposes its split. #138: two epics (#14, #13), members with `epic`, #9 in none.
const BIG_TASKS = [
  'One app per workspace: a lock file in `src/workspace.js`', 'A second app opens read-only, with a banner', 'Run owners recorded in `src/runs.js`',
  'Only the owner resumes a run', 'Queue claims survive a restart (`src/store.js`)', 'Roadmap writes are atomic (`src/roadmap.js`)',
  'Resume dialog lists the steps (`src/renderer/run.js`)', 'Duplicate runs are flagged on the card (`src/renderer/backlog.js`)', 'Safe-write notice in the run header (`src/renderer/run.js`)',
  'Roadmap status derived from runs, shown in `src/renderer/backlog-roadmap.js`', 'Docs: run safety in the README', 'Tests',
];
const DEMO_ISSUES = [
  { number: 16, title: 'Keyboard focus is lost after closing a dialog', state: 'open', labels: [{ name: 'ui', color: '#c5def5' }, { name: 'complexity:1', color: '#ededed' }], body: '- [ ] Focus returns to the control that opened the dialog\n- [ ] Tests' },
  { number: 15, title: 'Run safety: one app per workspace, run owners, safe writes and a resume dialog that lists the steps', state: 'open', labels: [{ name: 'enhancement', color: '#a2eeef' }, { name: 'complexity:5', color: '#5319e7' }, { name: 'impact:5', color: '#d93f0b' }], body: ['## Context', '', 'Two apps on one workspace overwrite each other\'s runs and queue.', '', 'Decision (owner): one app per workspace; every write is safe.', '', '## Tasks', '', ...BIG_TASKS.map((t) => `- [ ] ${t}`)].join('\n') },
  { number: 14, title: 'Workspace safety and recovery', state: 'open', labels: [{ name: 'epic', color: '#5319e7' }], body: 'Runs, queues and roadmaps survive crashes, renames and a second app.' },
  { number: 13, title: 'Run reports', state: 'open', labels: [{ name: 'epic', color: '#5319e7' }], body: 'Everything a run produces, shared outside the app.' },
  { number: 12, title: 'Export a run report as Markdown', state: 'open', labels: [{ name: 'enhancement', color: '#a2eeef' }, { name: 'server', color: '#fbca04' }, { name: 'complexity:2', color: '#ededed' }, { name: 'impact:3', color: '#d93f0b' }], body: '- [x] Report layout\n- [ ] Export button\n- [ ] Tests' },
  { number: 11, title: 'Crash when the workspace folder is renamed', state: 'open', labels: [{ name: 'bug', color: '#d73a4a' }, { name: 'impact:5', color: '#d93f0b' }, { name: 'complexity:4', color: '#5319e7' }], body: 'Steps to reproduce: rename the folder while the app is open.' },
  { number: 10, title: 'Dark scrollbars in the terminal dock', state: 'open', labels: [{ name: 'ui', color: '#c5def5' }, { name: 'complexity:1', color: '#ededed' }, { name: 'impact:1', color: '#d93f0b' }], body: '' },
  { number: 9, title: 'Add a /health endpoint', state: 'open', labels: [{ name: 'enhancement', color: '#a2eeef' }, { name: 'server', color: '#fbca04' }, { name: 'complexity:3', color: '#ededed' }], body: '- [ ] Endpoint\n- [ ] Docs' },
  { number: 8, title: 'Document the workflow YAML', state: 'closed', labels: [{ name: 'docs', color: '#0075ca' }], body: '' },
];

function demoBacklog(projectId, taskProgress) {
  const day = (n) => new Date(Date.UTC(2026, 0, 20 - n, 12)).toISOString();
  const issues = DEMO_ISSUES.map((i, n) => ({
    ...i, url: `${DEMO_REPO}/issues/${i.number}`, author: 'octocat', assignees: [],
    tasks: taskProgress(i.body), createdAt: day(n + 3), updatedAt: day(n),
    ...(DEMO_EPICS.find((e) => e.members.includes(i.number)) ? { epic: DEMO_EPICS.find((e) => e.members.includes(i.number)).id } : {}),
    ...(i.labels.some((l) => l.name === 'epic') ? { isEpic: true } : {}),
  }));
  const epics = DEMO_EPICS.map((e) => {
    const members = e.members.map((m) => issues.find((i) => i.number === m));
    const closed = members.filter((i) => i.state !== 'open').length;
    return { ...e, url: `${DEMO_REPO}/issues/${e.number}`, state: 'open', progress: { open: members.length - closed, closed, total: members.length } };
  });
  return { projectId, platform: 'github', repo: DEMO_REPO, syncedAt: new Date().toISOString(), issues, epics, epicsError: null };
}
const DEMO_EPICS = [
  { id: '#14', number: 14, kind: 'issue', title: 'Workspace safety and recovery', members: [11, 8] },
  { id: '#13', number: 13, kind: 'issue', title: 'Run reports', members: [12] },
];

// Demo GitHub Actions minutes (Usage): near the quota, as in the month that motivated the monitor.
function demoActionsUsage() {
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const item = (sku, quantity, price) => ({ date, product: 'actions', sku, unitType: 'minutes', quantity, grossAmount: quantity * price, netAmount: 0 });
  const { summarizeActionsUsage } = require('../src/actions-usage'); // only apps that have the channel ask
  return { login: 'demo-user', ...summarizeActionsUsage({ usageItems: [item('Actions Linux', 353, 0.008), item('Actions Windows', 560, 0.016), item('Actions macOS', 35, 0.08)] }, { includedMinutes: 2000, now }) };
}

// A local-hero run that merged #11 into the local main, not pushed yet (the Backlog's "Merged
// locally" column and Push bar): its summary and the project's cached push status.
function demoLocalMerge(ws, projectId) {
  const runId = '20260118-120000-demo0011';
  const commit = 'b7e4c2a91f0d3e5a6c8b9d0e1f2a3b4c5d6e7f80';
  fs.mkdirSync(path.join(ws.runs, runId), { recursive: true });
  fs.writeFileSync(path.join(ws.runs, runId, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'software-development-local-hero', project_id: projectId, status: 'success', mock: false,
    started_at: '2026-01-18T12:00:00.000Z', finished_at: '2026-01-18T12:40:00.000Z', duration_ms: 2400000,
    issues: [{ number: 11, url: `${DEMO_REPO}/issues/11`, title: DEMO_ISSUES.find((x) => x.number === 11).title }], inputs: {}, sessions: [],
    local_merge: { branch: 'fix/workspace-rename', base: 'main', commit },
  }, null, 2));
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.local.json`), JSON.stringify({
    base: 'main', ahead: 2, behind: 0, fetchError: null, error: null, checkedAt: new Date().toISOString(), issues: [11],
    commits: [
      { sha: commit, subject: 'Survive a renamed workspace folder', issues: [11] },
      { sha: 'a1c3e5f7092b4d6f8a0c2e4f6b8d0f1a3c5e7b9d', subject: 'Test the rename with a scratch workspace', issues: [] },
    ],
  }, null, 2));
}

// The Product Owner registering an issue (#117): a short request with a screenshot, one question,
// the owner's answer, then a draft (long title, labels, Related, a close issue: #12), then a plan
// answer whose groups the demo roadmap already holds (#140), then a question about issues sent from
// the selection with a suggested extra issue (#169). Shown with `--click "#btn-bl-po"`;
// `--click "[data-po-act=create]"` previews the filing (po:file previews here).
function demoPoConversation(ws, projectId) {
  const at = (s) => new Date(Date.UTC(2026, 0, 20, 10, 0, s)).toISOString();
  const shot = path.join(ws.backlog, `${projectId}.po`, 'attachments', '1768903200000-run-report.png');
  fs.mkdirSync(path.dirname(shot), { recursive: true });
  fs.writeFileSync(shot, '');
  const body = [
    '## Context', '', 'The run report (#12) exports Markdown only (`src/report.js:41`, `exportMarkdown`). The owner shares reports with people who do not read Markdown.', '',
    'Decision (owner): a PDF export next to the Markdown one, same layout.', '',
    '## Tasks', '', '- [ ] **Export as PDF** in the run report menu, next to Markdown', '- [ ] The PDF keeps the report layout (headings, tables, cost)', '- [ ] Tests: a mock run exports a PDF with the report title', '',
    '## Triage', '', 'Impact 3 (sharing reports), complexity 2 (one renderer, estimate: `src/report.js`, `src/renderer/run.js`). Group with #12.', '',
    'Related: #12',
  ].join('\n');
  const big = DEMO_ISSUES.find((x) => x.number === 15);
  const poSplit = require('../src/po-split');
  const split = poSplit.normalizeSplit(poSplit.proposeSplit(big, { complexity: 5 }), big, { complexity: 5 });
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
    { ts: at(110), role: 'po', mode: 'plan', model: 'claude-opus-5-5', costUsd: 0.21, text: 'Three runs: the rename crash first, then the server work together, then the small UI and docs fixes.', answer: {
      summary: 'Three runs.',
      groups: [
        { name: 'Rename crash', issues: [11], workflow: 'software-development-local-hero.yaml', inputs: { mode: 'auto' }, reason: 'It blocks the rest.', files: ['src/workspace.js'], stage: 1, complexity: 4, guessed: false, estimate: null, warnings: [] },
        { name: 'Reports and health', issues: [12, 9], workflow: 'software-development-local-hero.yaml', inputs: { mode: 'auto' }, reason: 'Both add a server route: one run avoids a merge conflict in src/server.', files: ['src/server.js'], stage: 2, complexity: 5, guessed: false, estimate: { minutes: 35, costUsd: 1.8, basis: '3 past runs' }, warnings: [] },
        { name: 'Scrollbars and docs', issues: [10, 8], workflow: 'software-development.yaml', inputs: { mode: 'validated' }, reason: 'Two small fixes the owner can check in the app.', files: ['src/renderer/style.css'], stage: 3, complexity: 1, guessed: true, estimate: null, warnings: [] },
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
    // suggested extra issue (#10, unchecked until the owner keeps it)
    { ts: at(130), role: 'user', mode: 'plan', text: 'What is the best strategy to put these issues in the roadmap? Should any other open issue join them?', issues: [16, 8] },
    { ts: at(150), role: 'po', mode: 'plan', model: 'claude-opus-5-5', costUsd: 0.09, text: 'One validated run for #16; **#10** touches the same styles and could join it. #8 is closed: left out.', answer: {
      summary: 'One run.',
      groups: [
        { name: 'Keyboard focus', issues: [16], workflow: 'software-development.yaml', inputs: { mode: 'validated' }, modeReason: 'A behaviour the owner can try in the app.', reason: 'A small UI fix on its own.', files: ['src/renderer/app.js'], stage: 1, complexity: 1, guessed: false, estimate: null, warnings: [],
          suggested: [{ issue: 10, reason: 'Same area (ui): the dialog and dock styles, one validated run.' }] },
      ],
      closed: [8],
      conflicts: [], enrich: [], splits: [], epics: { place: [], create: [], merge: [], split: [] },
    } },
  ];
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.po.jsonl`), messages.map((m) => JSON.stringify(m)).join('\n') + '\n');
}

// A roadmap (Backlog › Roadmap, src/roadmap.js): stage 1 done (the local-hero run of #11), then a
// group of two issues (with the Product Owner's reasons, mode auto), then one UI issue (mode
// validated, no stage note); planned, so nothing starts. `--click "[data-rm-edit]"` opens the first
// planned item's Edit form (the workflow's inputs: select, checkbox, text).
function demoRoadmap(ws, projectId) {
  const issue = (n) => {
    const i = DEMO_ISSUES.find((x) => x.number === n);
    return { number: n, url: `${DEMO_REPO}/issues/${n}`, title: i.title, body: i.body, knownPullRequests: [] };
  };
  const item = (id, workflow, numbers, extra = {}) => ({
    id, workflow, workflowName: workflow.replace(/\.yaml$/, ''), inputs: { language: 'js', mode: 'auto' }, mock: false,
    ...issue(numbers[0]), ...(numbers.length > 1 ? { issues: numbers.map(issue) } : {}), status: 'planned', runId: null, runs: [], error: null, ...extra,
  });
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.roadmap.json`), JSON.stringify({
    state: 'planned', simulated: false, error: null, pausedBy: null, updatedAt: new Date().toISOString(),
    stages: [
      { id: 'stage-1', name: 'Stability first', note: 'The rename crash blocks the rest.', items: [item('item-1', 'software-development-local-hero.yaml', [11], { status: 'done', runId: '20260118-120000-demo0011', runs: ['20260118-120000-demo0011'] })] },
      { id: 'stage-2', name: 'Reports and health', note: 'Both touch the server: one run, no conflict.', items: [item('item-2', 'software-development-local-hero.yaml', [12, 9], {
        reason: 'Both add a server route and share the report formatter: one run avoids a merge conflict in src/server.',
        modeReason: 'Auto: server code with no screen to try.',
        origin: new Date(Date.UTC(2026, 0, 20, 10, 1, 50)).toISOString(), // the demo Product Owner's plan answer
      })] },
      { id: 'stage-3', name: '', note: '', items: [item('item-3', 'software-development.yaml', [10], {
        inputs: { language: 'js', mode: 'validated' }, reason: 'A small UI fix on its own.', modeReason: 'Validated: a screen the owner can try in the app.',
      })] },
    ],
  }, null, 2));
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

// Finished (not simulated) runs over the last 30 days with Claude, Codex and Grok sessions, so the
// Analytics screen has tokens per day, provider, model and project (mock runs are left out of it).
function demoAnalyticsRuns(ws, projectId) {
  const models = { claude: ['claude-opus-5-5', 'claude-sonnet-5'], codex: ['gpt-6-luna'], grok: ['grok-5-build'] };
  const statuses = ['success', 'success', 'success', 'failed', 'success', 'cancelled'];
  for (let i = 0; i < 18; i++) {
    const started = new Date(Date.now() - (i * 1.6 + 0.3) * 864e5);
    const runId = `${started.toISOString().slice(0, 10).replace(/-/g, '')}-1200${String(i).padStart(2, '0')}-demo${String(i).padStart(4, '0')}`;
    const sessions = ['claude', 'claude', 'codex', i % 3 ? null : 'grok'].filter(Boolean).map((provider, k) => {
      const scale = 1 + ((i * 7 + k * 3) % 5);
      return {
        id: `s${k}`, agent: ['developer', 'reviewer', 'tester', 'researcher'][k], provider, model: models[provider][k % models[provider].length], step_id: 'implement',
        opened_at: started.toISOString(), closed_at: new Date(started.getTime() + 6e5 * scale).toISOString(),
        duration_ms: 6e5 * scale, active_ms: 4e5 * scale, idle_ms: 2e5 * scale, turns: 3 * scale,
        tokens: { input: 4000 * scale, output: 9000 * scale, cache_read: 180000 * scale, cache_write: 12000 * scale, reasoning: 0 },
        cost_usd: provider === 'codex' ? 0 : +(0.35 * scale).toFixed(2), status: 'success', provider_session_id: `demo-${i}-${k}`,
      };
    });
    fs.mkdirSync(path.join(ws.runs, runId), { recursive: true });
    fs.writeFileSync(path.join(ws.runs, runId, 'summary.json'), JSON.stringify({
      run_id: runId, workflow: i % 2 ? 'software-development' : 'ai-arena', project_id: i % 4 ? projectId : null, status: statuses[i % statuses.length], mock: false,
      started_at: started.toISOString(), finished_at: new Date(started.getTime() + 36e5).toISOString(), duration_ms: 36e5,
      timing: { waiting_ms: 6e5 }, inputs: {}, sessions,
    }, null, 2));
  }
}

// Simulation: the Backlog's sync answers with the cached demo issues instead of calling gh, and the
// Usage screen's GitHub Actions minutes are demo data. `keepAwake`: a demo state of Keep awake, or null.
function simulateChannels(ipcMain, keepAwake = null) {
  const handle = ipcMain.handle.bind(ipcMain);
  const handlers = {};
  ipcMain.handle = (channel, fn) => {
    handlers[channel] = fn;
    if (channel === 'usage:actions') return handle(channel, () => demoActionsUsage());
    if (channel === 'keepAwake:state' && keepAwake) return handle(channel, () => keepAwake);
    // the supervisor's report on the sessions (Analytics) uses the mock provider
    if (channel === 'analytics:analyze') return handle(channel, (e, arg) => fn(e, { ...arg, mock: true }));
    // the Backlog's Product Owner answers from its simulated self (no model call)
    if (channel === 'po:ask') return handle(channel, (e, arg) => fn(e, { ...arg, mock: true }));
    // and its filing of a drafted issue (#117) only previews: never calls gh/glab
    if (channel === 'po:file') return handle(channel, (e, arg) => fn(e, { ...arg, preview: true }));
    // a split (#124) and an epic (#138) applied from a plan answer only preview too
    if (channel === 'po:split' || channel === 'po:epic') return handle(channel, (e, arg) => fn(e, { ...arg, preview: true }));
    // the app-wide Supervisor chat too (#28)
    if (channel === 'supervisor:chat') return handle(channel, (e, arg) => fn(e, { ...arg, mock: true }));
    // Save to issue (Write & Review) only previews: never calls gh/glab
    if (channel === 'backlog:save-doc') return handle(channel, (e, arg) => fn(e, { ...arg, preview: true }));
    return handle(channel, channel === 'backlog:sync' ? (e, arg) => handlers['backlog:get'](e, { projectId: arg?.projectId }) : fn);
  };
}

// --keep-awake active | error: what main answers (built by the app tree's src/keep-awake.js, absent
// at an older --ref); off and idle are the real state from the setting.
function demoKeepAwake(appDir, which) {
  if (which !== 'active' && which !== 'error') return null;
  let ka;
  try { ka = require(path.join(appDir, 'src', 'keep-awake')); } catch { return null; }
  const work = ka.workToDo({ runs: [{ waiting: false }, { waiting: true }], roadmaps: [{ projectId: 'demo-app', state: 'running', stage: 3, of: 6 }] });
  const s = which === 'active'
    ? { available: true, enabled: true, holding: true, work, error: null }
    : { available: true, enabled: true, holding: false, work, error: 'Could not keep the computer awake: the system refused the request (demo).' };
  return { ...s, label: ka.keepAwakeLabel(s) };
}

// The commit checked out in the repository (the "modified" shots), or null.
function gitHead(repo) {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

// The app tree at a git ref, for the "original" screenshots: an index of its own (the repository's index
// and working tree are untouched) and the current node_modules through a junction.
function extractRef(repo, ref, dest) {
  const git = (args, env = {}) => execFileSync('git', args, { cwd: repo, env: { ...process.env, ...env }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const sha = git(['rev-parse', '--verify', `${ref}^{commit}`]).trim();
  const env = { GIT_INDEX_FILE: path.join(path.dirname(dest), 'ref.index') };
  git(['read-tree', sha], env);
  git(['checkout-index', '-a', `--prefix=${dest.replace(/\\/g, '/')}/`], env);
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(dest, 'node_modules'), 'junction');
  return sha;
}

// Removes the scratch folder. The node_modules junction goes first, on its own: if it can't be
// removed, the folder is left in the temp dir rather than risk deleting through it.
function removeScratch(dir) {
  const link = path.join(dir, 'app', 'node_modules');
  try {
    if (fs.lstatSync(link, { throwIfNoEntry: false })) fs.unlinkSync(link);
  } catch {
    return;
  }
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 }); } catch { /* temp folder */ }
}

/** The usage: this file's header comment, without the comment markers. */
function usage() {
  const lines = fs.readFileSync(__filename, 'utf8').split(/\r?\n/);
  const end = lines.findIndex((l) => !l.startsWith('//'));
  return lines.slice(0, end).map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
}

// ---- the capture (Electron main process) -----------------------------------------------------
function main() {
  const { app, nativeTheme, ipcMain } = require('electron');
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log(usage());
    app.exit(0);
    return;
  }
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`screenshot: ${e.message}`);
    app.exit(2);
    return;
  }
  const repo = path.join(__dirname, '..');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-shot-'));
  const cleanup = () => removeScratch(scratch);
  const fail = (e) => {
    console.error(`screenshot: ${e?.message || e}`);
    cleanup();
    app.exit(1);
  };
  // The hard limit holds whatever happens below (a view that never loads, a hung run).
  setTimeout(() => fail(new Error(`timed out after ${args.timeout} ms`)), args.timeout);
  process.on('uncaughtException', fail);
  process.on('unhandledRejection', fail);

  const home = path.join(scratch, 'home');
  const wsDir = path.join(scratch, 'workspace');
  for (const d of [home, path.join(home, 'AppData'), path.join(scratch, 'user-data')]) fs.mkdirSync(d, { recursive: true });
  Object.assign(process.env, {
    MULTIAGENT_AUTH: 'off',
    MULTIAGENT_WORKSPACE: wsDir,
    MULTIAGENT_MOCK_DELAY_SCALE: '0.02',
    HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData'),
    GH_CONFIG_DIR: path.join(home, 'gh'), GLAB_CONFIG_DIR: path.join(home, 'glab'),
  });
  app.setPath('userData', path.join(scratch, 'user-data'));
  if (args.theme) nativeTheme.themeSource = args.theme;

  let appDir = repo;
  let sha = null; // the commit captured with --ref (the manifest records it)
  if (args.ref) {
    appDir = path.join(scratch, 'app');
    sha = extractRef(repo, args.ref, appDir);
    console.log(`app at ${args.ref} (${sha.slice(0, 12)})`);
  }
  const src = (m) => require(path.join(appDir, 'src', m));
  const workspace = src('workspace');
  const ws = workspace.setupWorkspace(wsDir, { persist: false });

  const setup = (async () => {
    // the repository is set afterwards: createProject would clone it
    const projects = src('projects');
    const created = await projects.createProject(ws.projects, { name: 'demo-app', description: 'Sample project (simulated data)' });
    const project = projects.updateProject(ws.projects, created.id, { repo: DEMO_REPO });
    workspace.writeSettings(ws, { developerMode: true, lastWorkflow: 'software-development.yaml', lastProject: project.id, keepAwake: !!args.keepAwake && args.keepAwake !== 'off' });
    fs.mkdirSync(ws.backlog, { recursive: true });
    fs.writeFileSync(path.join(ws.backlog, `${project.id}.json`), JSON.stringify(demoBacklog(project.id, src('backlog').taskProgress), null, 2));
    if (args.view === 'backlog') demoLocalMerge(ws, project.id);
    if (args.view === 'backlog') demoRoadmap(ws, project.id);
    if (args.view === 'backlog') demoPoConversation(ws, project.id);
    // also on Artifacts: a second run group (its document.md) for Collapse all / Expand all (#126)
    if (['artifacts', 'backlog', 'duo'].includes(args.view)) demoEnrichRun(ws, project.id);
    if (args.view === 'analytics') demoAnalyticsRuns(ws, project.id);
    // Run App's setup at a gate is prefilled from the worktree's package.json (#108)
    if (args.view === 'run' && project.folder) {
      fs.mkdirSync(project.folder, { recursive: true });
      fs.writeFileSync(path.join(project.folder, 'package.json'), JSON.stringify({ name: 'demo-app', private: true, scripts: { start: 'node server.js' } }, null, 2));
    }
    let run = null;
    if (VIEWS[args.view].run || ['artifacts', 'workflows', 'project', 'usage', 'dashboard'].includes(args.view)) run = recordRun(project);
    return { project, run };
  })();

  // A finished run in the scratch workspace: a copy of a run folder, or a simulated run (scripts/run.js
  // --mock, as Node inside this Electron binary).
  function recordRun(project) {
    if (args.run !== 'mock') {
      const from = path.resolve(args.run);
      if (!fs.existsSync(path.join(from, 'events.jsonl'))) throw new Error(`--run ${args.run} is not a run folder (no events.jsonl)`);
      const to = path.join(ws.runs, path.basename(from));
      fs.cpSync(from, to, { recursive: true });
      return readRun(to);
    }
    const r = spawnSync(process.execPath, [path.join(appDir, 'scripts', 'run.js'), '--mock', '--auto-approve', '--file', args.workflow, '--repo', project.folder, '--task', 'Add a /health endpoint'], {
      cwd: appDir, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, encoding: 'utf8', timeout: Math.max(1000, args.timeout - 20000), windowsHide: true,
    });
    const dirs = runDirs();
    if (!dirs.length) throw new Error(`the simulated run did not start: ${(r.stderr || r.error?.message || '').trim().slice(-500)}`);
    return { ...readRun(dirs[0]), simulated: true };
  }
  function readRun(dir) {
    let summary = {};
    try { summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch { /* interrupted run */ }
    return { runId: summary.run_id || path.basename(dir), workflow: summary.workflow || null, dir };
  }
  // the scratch workspace's run folders, newest first
  function runDirs() {
    return fs.readdirSync(ws.runs).map((d) => path.join(ws.runs, d)).filter((d) => fs.existsSync(path.join(d, 'events.jsonl')))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  }

  // Demo screenshots of a simulated run (#146, #145): captures of this window saved as two rounds
  // (developer round 1 in History, evidence round 1 the final set) with original/modified pairs, a
  // modified-only state and a small image (opens at 100% in the viewer), then the manifest.
  async function demoEvidence(win, runDir) {
    const shot = await grab(win);
    const { width, height } = shot.getSize();
    const save = (step, round, name, img) => {
      const dir = evidence.roundDir(runDir, step, round);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), img.toPNG());
    };
    save('developer', 1, '146-artifacts-panel-default.modified.png', shot.crop({ x: 0, y: 0, width: Math.round(width * 0.8), height: Math.round(height * 0.8) }));
    await new Promise((r) => setTimeout(r, 50)); // the final round captures last
    save('evidence', 1, '146-artifacts-panel-default.original.png', shot.crop({ x: 0, y: 0, width: Math.round(width * 0.8), height: Math.round(height * 0.8) }));
    save('evidence', 1, '146-artifacts-panel-default.modified.png', shot);
    save('evidence', 1, '145-image-viewer-small.modified.png', shot.crop({ x: 0, y: 0, width: 320, height: 200 }));
    const rel = (step, name) => `evidence/${step}/round-1/${name}`;
    evidence.writeManifest(runDir, {
      base: 'main', branch: 'feat/demo-evidence', commit: '3f9c2ab71d0e', baseCommit: 'a17b0c4e9f21',
      captions: {
        [rel('developer', '146-artifacts-panel-default.modified.png')]: { caption: 'Artifacts panel (first try)' },
        [rel('evidence', '146-artifacts-panel-default.modified.png')]: { caption: 'Artifacts panel with the run\'s screenshots' },
        [rel('evidence', '145-image-viewer-small.modified.png')]: { caption: 'A small image (opens at 100%)' },
      },
    });
  }

  app.on('browser-window-created', (_e, win) => {
    win.setMinimumSize(400, 300);
    win.setContentSize(...args.size);
    win.webContents.on('console-message', (ev) => { if (ev.level === 'error') console.log(`[renderer:error] ${ev.message}`); });
    win.webContents.once('did-finish-load', () => capture(win).catch(fail));
  });

  async function capture(win) {
    const { project, run } = await setup;
    const js = (code) => win.webContents.executeJavaScript(`(async () => { ${code} })()`);
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    // waits up to 10 s for the element: views load their data asynchronously
    const click = (sel) => js(`
      const sel = ${JSON.stringify(sel)};
      for (let i = 0; i < 100 && !document.querySelector(sel); i++) await new Promise((r) => setTimeout(r, 100));
      const el = document.querySelector(sel);
      if (!el) throw new Error('nothing matches ' + sel);
      el.click();`);
    // a right-click at the element's center (an artifact's copy menu, #114)
    const context = (sel) => js(`
      const sel = ${JSON.stringify(sel)};
      for (let i = 0; i < 100 && !document.querySelector(sel); i++) await new Promise((r) => setTimeout(r, 100));
      const el = document.querySelector(sel);
      if (!el) throw new Error('nothing matches ' + sel);
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));`);
    await pause(1500); // the app's first load (account, settings, workflows)
    const v = args.view;
    if (v === 'project') await js(`openProjectView(${JSON.stringify(project.id)})`);
    else if (v === 'run-chat') {
      if (!run) throw new Error('no run to show');
      await js(`window.openRunChat({ runId: ${JSON.stringify(run.runId)}, workflow: ${JSON.stringify(run.workflow)} })`);
    } else if (v === 'run') {
      // a live simulated run started from the Start panel; gates are approved as they come
      await js(`
        await api.setSettings({ developerMode: true, lastWorkflow: ${JSON.stringify(args.workflow)} });
        document.querySelector('#btn-quick-start').click();
        await new Promise((r) => setTimeout(r, 500));
        document.querySelector('#project-select').value = ${JSON.stringify(project.id)};
        document.querySelector('#in-task').value = 'Add a /health endpoint';
        for (const [k, val] of Object.entries(${JSON.stringify(args.inputs)})) {
          const el = document.getElementById('in-' + k);
          if (!el) throw new Error('the workflow has no input ' + k);
          el.value = val;
        }
        document.querySelector('#mock-toggle').checked = true;
        if (!document.body.classList.contains('dev-mode')) throw new Error('developer mode is off: refusing to start a real run');
        document.querySelector('#btn-start').click();`);
      // --stop-at: that step's gate stays open and the capture happens once it shows
      const approve = setInterval(() => js(`
        for (const card of document.querySelectorAll('#run-gates:not(.hidden) .run-gate')) {
          if (${JSON.stringify(args.stopAt || '')} && card.querySelector('.run-gate-head')?.textContent.includes(${JSON.stringify(`step: ${args.stopAt}`)})) continue;
          card.querySelector('.run-gate-actions button[data-choice]:not(:disabled), .run-gate-actions button[data-answer="true"]:not(:disabled)')?.click();
          break;
        }`).catch(() => {}), 1000);
      try {
        if (args.stopAt) {
          let shown = false;
          for (const end = Date.now() + Math.max(args.wait, 45000); !shown && Date.now() < end;) {
            await pause(1000);
            shown = await js(`return [...document.querySelectorAll('#run-gates .run-gate-head')].some((h) => h.textContent.includes(${JSON.stringify(`step: ${args.stopAt}`)}))`);
          }
          if (!shown) throw new Error(`the run never waited at ${args.stopAt}`);
          // demo screenshots in the live run, for its gate's Artifacts panel and the viewer
          const live = runDirs()[0];
          if (live) {
            await demoEvidence(win, live);
            await js(`ArtifactsPanel.refreshRun(${JSON.stringify(path.basename(live))})`);
          }
          await pause(2500); // the gate's Artifacts panel and changed files load
        } else await pause(args.wait);
      } finally {
        clearInterval(approve);
      }
    } else {
      if (v === 'artifacts' && run?.simulated) await demoEvidence(win, run.dir);
      await click(`.nav-item[data-view="${v}"]`);
    }
    await pause(500);
    if (args.tab && v === 'settings') await click(`.settings-tab[data-stab="${args.tab}"]`);
    if (args.tab && v === 'workflows') await click(`[data-wtab="${args.tab}"]`);
    if (args.mode) await click(`#view-backlog [data-mode="${args.mode}"]`);
    // the demo runs are simulated, which Artifacts hides by default
    if (v === 'artifacts') await js(`const c = document.querySelector('#art-show-sim'); if (c && !c.checked) c.click();`);
    for (const sel of args.clicks) { await click(sel); await pause(500); }
    for (const sel of args.contexts) { await context(sel); await pause(500); }
    if (v !== 'run') await pause(args.wait);

    const out = path.resolve(args.out || path.join(repo, 'runs', 'screenshots'));
    fs.mkdirSync(out, { recursive: true });
    const file = path.join(out, fileName(args));
    fs.writeFileSync(file, (await grab(win)).toPNG());
    console.log(`screenshot: ${file}`);
    if (args.caption) {
      recordShot(out, { file, caption: args.caption, commit: sha || gitHead(repo) });
      console.log(`manifest: ${evidence.manifestPath(runOfRound(out))}`);
    }
    win.destroy();
    cleanup();
    app.exit(0);
  }

  // capturePage fails now and then with Chromium's UnknownVizError while the compositor is busy
  // (several apps at once): a few tries before giving up
  async function grab(win) {
    for (let attempt = 1; ; attempt++) {
      try {
        const img = await win.webContents.capturePage();
        if (!img.isEmpty()) return img;
        if (attempt >= 4) throw new Error('the captured image is empty');
      } catch (e) {
        if (attempt >= 4) throw e;
      }
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }

  simulateChannels(ipcMain, demoKeepAwake(appDir, args.keepAwake));
  require(path.join(appDir, 'src', 'main'));
}

// Electron's main process runs the capture; plain Node (the tests) only imports the helpers.
if (process.type === 'browser') main();

module.exports = {
  fileName,
  parseArgs,
  recordShot,
  usage,
  VIEWS,
};
