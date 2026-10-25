// #289: an expanded run card (packages/ui-kit/run-list.js renderRunList) shows, under the sessions, an
// Artifacts column with the Details screen's filter (Produced / Show all, category and kind chips,
// the markup of ArtifactsPanel.filtersHtml) and a Repository column (branch, base, totals, the
// commits newest first, Review changes → DiffViewer). Acceptance tests, written before the code,
// through the whole page (test/agent-chat-page-harness.js) with the page global renderRunList and a
// fake window.api: listArtifacts (artifacts:list) and runDiff (run:diff) answer with fixtures.
//
// Test ids: run-card-artifacts, run-card-repository, run-card-artifact-filter (holds
// [data-artifact-filter="produced|all"], [data-artifact-category], [data-artifact-kind]),
// run-card-artifact (a file row with its step as a label), run-card-commits, run-card-commit
// (data-sha = the full sha), run-card-commits-more, run-card-review-changes, run-card-repo-state,
// run-card-repo-totals, run-card-repo-branch.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('./mini-dom');
const { loadPage, settle, deferred } = require('./agent-chat-page-harness');

const file = (rel, category, kind, step) => ({
  path: `C:/ws/runs/r1/${rel}`, name: rel.split('/').pop(), rel, kind, category, step, size: 10, mtime: '2026-10-08T10:00:00Z', exists: true, location: 'run',
});
// 4 produced (Result, Screenshots & images, Tests, Reports) + 3 process (a log, a handoff note, the decision log)
const FILES = [
  file('logs/developer.log', 'process', 'text', 'developer'),
  file('result.md', 'result', 'markdown', 'developer'),
  file('handoffs/developer.md', 'process', 'markdown', 'developer'),
  file('e2e/scenarios.json', 'tests', 'json', 'test_writer'),
  file('screenshots/home.png', 'screenshots', 'image', 'evidence'),
  file('decisions.tsv', 'process', 'table', 'orchestrator'),
  file('report.md', 'reports', 'markdown', 'reviewer'),
];
const PROCESS_ONLY = FILES.filter((f) => f.category === 'process');
const INTERNAL = file('scratch/skills/code-review/SKILL.md', 'internal', 'markdown', 'orchestrator');

const sha = (n) => `${String(n).repeat(7)}${'0'.repeat(33)}`;
const COMMITS = [6, 5, 4, 3, 2, 1].map((n) => ({ sha: sha(n), short: String(n).repeat(7), subject: `Change number ${n}`, author: 'dev', date: `2026-10-08T10:0${n}:00.000Z` }));
const DIFF = {
  simulated: false, unavailable: null, base: 'main', branch: 'fix/widget-289', mergeBase: 'abc', commits: COMMITS, commit: null,
  files: [
    { file: 'src/a.js', status: 'modified', added: 5, deleted: 1 },
    { file: 'src/b.js', status: 'added', added: 7, deleted: 0 },
    { file: 'src/c.js', status: 'deleted', added: 0, deleted: 2 },
  ],
};
const RUN = {
  runId: 'r1', status: 'success', workflow: 'software-development', task: 'Fix the widget', startedAt: '2026-10-08T10:00:00Z', durationMs: 60000,
  branch: 'fix/widget-289', base: 'main', artifactCount: FILES.length,
  sessions: [{ id: 's1', agent: 'developer', provider: 'claude-code', model: 'claude-sonnet-5', status: 'success', turns: 2 }],
};

/** The page with one run, expanded, in a list box; `api` overrides the fixtures' answers. */
async function cardPage({ api = {}, run = RUN } = {}) {
  const page = await loadPage({ api: { listArtifacts: async () => [{ artifacts: FILES }], runDiff: async () => DIFF, runDiffFile: async () => ({}), ...api } });
  page.run("document.body.insertAdjacentHTML('beforeend', '<div id=\"box\"></div>')");
  page.sandbox.__runs = [run];
  page.run("__rl = { runs: __runs, expanded: new Set(['r1']), arts: new Map(), msgs: new Map() }; __opts = { prefix: 'project', box: '#box', empty: 'No runs yet', start() {}, rerender: () => renderRunList(__rl, __opts), reload() {}, loadMore() {} }; renderRunList(__rl, __opts)");
  await settle();
  assert.ok(page.$('#box [data-testid="run-list-row"][data-run="r1"] .pr-body'), 'the run\'s row is expanded');
  return page;
}
const body = (page) => page.$('#box [data-testid="run-list-row"][data-run="r1"] .pr-body');
const col = (page, id) => {
  const el = page.$(`#box [data-run="r1"] [data-testid="${id}"]`);
  assert.ok(el, `the expanded card has [data-testid="${id}"]`);
  return el;
};
const all = (page, sel) => page.document.querySelectorAll(`#box [data-run="r1"] ${sel}`);
const fileRows = (page) => all(page, '[data-testid="run-card-artifact"]');
const fileNames = (page) => fileRows(page).map((r) => textOf(r));
const commitRows = (page) => all(page, '[data-testid="run-card-commit"]');
const headCount = (page) => {
  const m = /(\d+) of (\d+)/.exec(textOf(col(page, 'run-card-artifacts')));
  assert.ok(m, 'the Artifacts head says "n of m"');
  return [Number(m[1]), Number(m[2])];
};
const isOn = (el) => el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true';
const buttonNamed = (root, re) => root.querySelectorAll('button').find((b) => re.test(textOf(b)) || re.test(b.getAttribute('aria-label') || ''));
const click = async (el) => { assert.ok(el, 'the element to click exists'); el.click(); await settle(); };

// ---- layout ---------------------------------------------------------------------------------------

test('#289 the expanded body has the Artifacts column before the Repository column, both under the sessions', async () => {
  const page = await cardPage();
  const arts = col(page, 'run-card-artifacts');
  const repo = col(page, 'run-card-repository');
  const order = body(page).querySelectorAll('[data-testid]').map((el) => el.getAttribute('data-testid'));
  const sessionsAt = order.indexOf('run-session-card');
  assert.ok(sessionsAt >= 0, 'the sessions table is in the body');
  assert.ok(order.indexOf('run-card-artifacts') < order.indexOf('run-card-repository'), `Artifacts before Repository: ${order.join(', ')}`);
  assert.ok(sessionsAt < order.indexOf('run-card-artifacts'), 'the sessions come before the columns');
  assert.equal(arts.contains(repo), false, 'two separate columns');
});

test('#289 expanding a card never asks for a file\'s diff (run:diff-file)', async () => {
  const page = await cardPage();
  col(page, 'run-card-repository');
  assert.equal(page.callsTo('runDiffFile').length, 0);
  assert.equal(page.callsTo('runDiff').length, 1, 'the Repository column asked run:diff once');
  assert.ok(JSON.stringify(page.callsTo('runDiff')[0]).includes('r1'), 'for this run');
});

// ---- the Artifacts column -----------------------------------------------------------------------------

test('#289 the default view lists the produced files only, grouped by category, "4 of 7", each row with its step and no step grouping', async () => {
  const page = await cardPage();
  assert.deepEqual(headCount(page), [4, 7]);
  const names = fileNames(page);
  assert.equal(names.length, 4, `four produced rows: ${names.join(' | ')}`);
  // category order: Result, Screenshots & images, Tests, Reports
  assert.match(names[0], /result\.md/);
  assert.match(names[1], /home\.png/);
  assert.match(names[2], /scenarios\.json/);
  assert.match(names[3], /report\.md/);
  const text = textOf(col(page, 'run-card-artifacts'));
  for (const heading of ['Result', 'Screenshots & images', 'Tests', 'Reports']) assert.ok(text.includes(heading), `the heading ${heading}`);
  assert.doesNotMatch(text, /developer\.log|handoffs|decisions\.tsv/, 'no process file in Produced');
  assert.equal(all(page, '.pr-arts-group').length, 0, 'no grouping by step any more');
  assert.match(names[2], /test[_ ]writer/, 'the row carries its step as a label');
  assert.match(names[1], /evidence/);
});

test('#289 "Show all" adds the process files (logs, handoff notes, decisions) and the head reads "7 of 7"', async () => {
  const page = await cardPage();
  await click(col(page, 'run-card-artifact-filter').querySelector('[data-artifact-filter="all"]'));
  assert.deepEqual(headCount(page), [7, 7]);
  assert.equal(fileRows(page).length, 7);
  const text = fileNames(page).join(' | ');
  assert.match(text, /developer\.log/);
  assert.match(text, /handoffs|developer\.md/);
  assert.match(text, /decisions\.tsv/);
  assert.equal(isOn(col(page, 'run-card-artifact-filter').querySelector('[data-artifact-filter="all"]')), true);
});

test('#289 an internal file is never listed, in Produced or in Show all', async () => {
  const page = await cardPage({ api: { listArtifacts: async () => [{ artifacts: [...FILES, INTERNAL] }] }, run: { ...RUN, artifactCount: FILES.length + 1 } });
  assert.doesNotMatch(fileNames(page).join(' | '), /SKILL\.md/);
  await click(col(page, 'run-card-artifact-filter').querySelector('[data-artifact-filter="all"]'));
  assert.doesNotMatch(fileNames(page).join(' | '), /SKILL\.md/);
  assert.equal(fileRows(page).length, 7);
});

test('#289 a category chip narrows the list to that category and shows its count', async () => {
  const page = await cardPage();
  const chip = col(page, 'run-card-artifact-filter').querySelector('[data-artifact-category="tests"]');
  assert.ok(chip, 'a Tests chip');
  assert.match(textOf(chip), /Tests\s*1/);
  await click(chip);
  const names = fileNames(page);
  assert.equal(names.length, 1);
  assert.match(names[0], /scenarios\.json/);
  assert.equal(isOn(col(page, 'run-card-artifact-filter').querySelector('[data-artifact-category="tests"]')), true);
});

test('#289 a kind chip narrows the list to that kind', async () => {
  const page = await cardPage();
  const chip = col(page, 'run-card-artifact-filter').querySelector('[data-artifact-kind="markdown"]');
  assert.ok(chip, 'a Markdown chip (two markdown files among the produced ones)');
  await click(chip);
  const names = fileNames(page);
  assert.equal(names.length, 2, names.join(' | '));
  assert.match(names[0], /result\.md/);
  assert.match(names[1], /report\.md/);
});

test('#289 a run whose files are all process says "Nothing produced yet" with a "Show all (3)" button that lists them', async () => {
  const page = await cardPage({ api: { listArtifacts: async () => [{ artifacts: PROCESS_ONLY }] }, run: { ...RUN, artifactCount: PROCESS_ONLY.length } });
  const arts = col(page, 'run-card-artifacts');
  assert.match(textOf(arts), /Nothing produced yet/);
  assert.equal(fileRows(page).length, 0);
  const show = buttonNamed(arts, /Show all \(\d+\)/);
  assert.ok(show, 'a "Show all (n)" button');
  assert.match(textOf(show), /Show all \(3\)/);
  await click(show);
  assert.equal(fileRows(page).length, 3);
});

test('#289 a run with no files has no Artifacts column but keeps the Repository column', async () => {
  const page = await cardPage({ api: { listArtifacts: async () => [{ artifacts: [] }] }, run: { ...RUN, artifactCount: 0 } });
  assert.equal(page.$('#box [data-run="r1"] [data-testid="run-card-artifacts"]'), null);
  col(page, 'run-card-repository');
});

test('#289 the filter goes back to Produced when the row is collapsed and expanded again', async () => {
  const page = await cardPage();
  await click(col(page, 'run-card-artifact-filter').querySelector('[data-artifact-filter="all"]'));
  assert.deepEqual(headCount(page), [7, 7]);
  await click(page.$('#box [data-run="r1"] .pr-row'));
  assert.equal(page.$('#box [data-run="r1"] .pr-body'), null, 'collapsed');
  await click(page.$('#box [data-run="r1"] .pr-row'));
  assert.deepEqual(headCount(page), [4, 7]);
  assert.equal(isOn(col(page, 'run-card-artifact-filter').querySelector('[data-artifact-filter="produced"]')), true);
});

test('#289 while the files load the Artifacts column says Loading', async () => {
  const pending = deferred();
  const page = await cardPage({ api: { listArtifacts: () => pending.promise } });
  assert.match(textOf(col(page, 'run-card-artifacts')), /Loading/);
});

test('#289 when the files cannot be read the Artifacts column says so with a Retry that loads them again', async () => {
  let calls = 0;
  const page = await cardPage({ api: { listArtifacts: async () => { if (calls++ === 0) throw new Error('disk gone'); return [{ artifacts: FILES }]; } } });
  const arts = col(page, 'run-card-artifacts');
  assert.match(textOf(arts), /Could not load/);
  const retry = arts.querySelector('[data-art-retry]') || buttonNamed(arts, /^Retry$/);
  assert.ok(retry, 'a Retry button');
  await click(retry);
  assert.equal(calls, 2, 'the files were asked again');
  assert.equal(fileRows(page).length, 4);
});

// ---- the Repository column ----------------------------------------------------------------------------

test('#289 the Repository column shows the branch, the base, the totals and the five newest commits with a "Show 1 more"', async () => {
  const page = await cardPage();
  assert.match(textOf(col(page, 'run-card-repo-branch')), /fix\/widget-289/);
  assert.match(textOf(col(page, 'run-card-repository')), /\bmain\b/);
  const totals = textOf(col(page, 'run-card-repo-totals'));
  assert.match(totals, /6 commits/);
  assert.match(totals, /3 files/);
  assert.match(totals, /\+12/);
  assert.match(totals, /[−-]3/);
  col(page, 'run-card-commits');
  const rows = commitRows(page);
  assert.equal(rows.length, 5);
  assert.equal(rows[0].getAttribute('data-sha'), COMMITS[0].sha, 'newest first');
  const name = (r) => `${r.getAttribute('aria-label') || ''} ${textOf(r)}`;
  assert.match(name(rows[0]), /6666666/);
  assert.match(name(rows[0]), /Change number 6/);
  const more = col(page, 'run-card-commits-more');
  assert.match(textOf(more), /Show 1 more/);
  await click(more);
  assert.equal(commitRows(page).length, 6);
  assert.equal(commitRows(page)[5].getAttribute('data-sha'), COMMITS[5].sha);
});

test('#289 the state badge says "not merged" for a run without a local merge', async () => {
  const page = await cardPage();
  assert.match(textOf(col(page, 'run-card-repo-state')), /not merged/i);
});

test('#289 the state badge says "Merged locally" with the merge commit for a run merged into its base', async () => {
  const merge = { branch: 'fix/widget-289', base: 'main', commit: '9d25ca2f1b3c4d5e6f708192a3b4c5d6e7f80910' };
  const page = await cardPage({ run: { ...RUN, summary: { local_merge: merge }, localMerge: merge } });
  const badge = textOf(col(page, 'run-card-repo-state'));
  assert.match(badge, /Merged locally/);
  assert.match(badge, /9d25ca2/);
});

test('#289 Review changes opens the diff viewer on the run; a commit row opens it on that commit', async () => {
  const page = await cardPage();
  const opened = [];
  page.sandbox.DiffViewer = { open: (a) => opened.push(a), close() {}, isOpen: () => false };
  await click(col(page, 'run-card-review-changes'));
  assert.equal(opened.length, 1);
  assert.equal(opened[0].runId, 'r1');
  assert.equal(opened[0].commit ?? null, null, 'the whole branch, not one commit');
  await click(commitRows(page)[1]);
  assert.equal(opened.length, 2);
  assert.equal(opened[1].runId, 'r1');
  assert.ok([COMMITS[1].sha, COMMITS[1].short].includes(opened[1].commit), `the clicked commit: ${opened[1].commit}`);
});

test('#289 Review changes is disabled, with a title that says why, when the run made no commits', async () => {
  const page = await cardPage({ api: { runDiff: async () => ({ ...DIFF, commits: [], files: [] }) } });
  const btn = col(page, 'run-card-review-changes');
  assert.equal(btn.disabled, true);
  assert.notEqual(String(btn.getAttribute('title') || '').trim(), '');
  assert.match(textOf(col(page, 'run-card-repository')), /This run made no commits/);
});

test('#289 a simulated run says nothing was committed', async () => {
  const page = await cardPage({ api: { runDiff: async () => ({ simulated: true, unavailable: null, base: null, commits: [], commit: null, files: [] }) }, run: { ...RUN, mock: true } });
  assert.match(textOf(col(page, 'run-card-repository')), /Simulated: nothing was committed/);
});

test('#289 a run whose branch is gone says so', async () => {
  const page = await cardPage({ api: { runDiff: async () => ({ simulated: false, unavailable: 'The branch of this run is gone.', base: null, commits: [], commit: null, files: [] }) } });
  assert.match(textOf(col(page, 'run-card-repository')), /branch is gone/);
});

test('#289 when run:diff fails the Repository column says so with a Retry that asks again and then lists the commits', async () => {
  let calls = 0;
  const page = await cardPage({ api: { runDiff: async () => { if (calls++ === 0) throw new Error('git not found'); return DIFF; } } });
  const repo = col(page, 'run-card-repository');
  assert.match(textOf(repo), /Could not load/);
  const retry = buttonNamed(repo, /^Retry$/);
  assert.ok(retry, 'a Retry button');
  await click(retry);
  assert.equal(calls, 2, 'run:diff was asked again');
  assert.equal(commitRows(page).length, 5);
});

// ---- keyboard ---------------------------------------------------------------------------------------

test('#289 keyboard order: the view switch, then the chips, then the file rows, then the commit rows', async () => {
  const page = await cardPage();
  const focusable = body(page).querySelectorAll('button, [tabindex], a[href], input, select, textarea');
  const at = (el) => {
    const target = focusable.includes(el) ? el : el.querySelectorAll('button, [tabindex], a[href]')[0];
    assert.ok(target, 'the element is focusable or holds a focusable control');
    return focusable.indexOf(target);
  };
  const switches = all(page, '[data-artifact-filter]');
  const chips = all(page, '[data-artifact-category], [data-artifact-kind]');
  assert.equal(switches.length, 2);
  assert.ok(chips.length >= 4, 'a chip per produced category');
  const lastSwitch = Math.max(...switches.map(at));
  const firstChip = Math.min(...chips.map(at));
  const lastChip = Math.max(...chips.map(at));
  const firstFile = Math.min(...fileRows(page).map(at));
  const lastFile = Math.max(...fileRows(page).map(at));
  const firstCommit = Math.min(...commitRows(page).map(at));
  assert.ok(lastSwitch < firstChip, `switch (${lastSwitch}) before chips (${firstChip})`);
  assert.ok(lastChip < firstFile, `chips (${lastChip}) before files (${firstFile})`);
  assert.ok(lastFile < firstCommit, `files (${lastFile}) before commits (${firstCommit})`);
});
