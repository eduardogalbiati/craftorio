// #12: Plan & Design › Docs, the Items rows (fronts/plan/views/docs/docs-list.js itemsHtml) of items that
// already have their GitHub issues or are done. Real folders in a temp dir (docs/work/<item>/*.md) are read
// by listItems (packages/engine/fronts/plan/domains/docs.js) and drawn by DocsList.itemsHtml in a vm sandbox
// (app.js's esc, the real English t). The contract is the HTML: no "Create epic and phase issues"
// (data-docs-issues) once any document has an `issue:` field, the issue shown in the row instead; no
// "Write the plan" when a plan exists; a built plan with a passed test.md reads "Done" with its stage chain
// complete, and done rows come after the rows in progress.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..', '..');
const DOCS_LIST = path.join(__dirname, '..', 'views', 'docs', 'docs-list.js');

const fm = (fields) => `---\n${Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join('\n')}\n---\n`;
const intent = (item, extra = {}) => `${fm({ item, stage: 'plan', status: 'accepted', date: '2026-10-31', translation: 'intent.pt-BR.md', ...extra })}\n# Intent: ${item}\n\n## Problem\n\nP.\n`;
const spec = (item, status, extra = {}) => `${fm({ item, stage: 'design', status, date: '2026-10-31', translation: 'spec.pt-BR.md', ...extra })}\n# Spec: ${item}\n\n## Requirements\n\n**R1. One.** It works.\n`;
const plan = (item, statuses, extra = {}) => `${fm({ item, stage: 'build', status: 'accepted', date: '2026-11-01', translation: 'plan.pt-BR.md', ...extra })}
# Plan: ${item}

## Progress

| Step | Status | Run | Commit / PR |
|---|---|---|---|
${statuses.map((s, i) => `| ${i + 1}. Step ${i + 1} | ${s} | ${s === 'done' ? `run-${i + 1}` : '—'} | ${s === 'done' ? 'abc1234, local merge into main' : '—'} |`).join('\n')}
`;
const testDoc = (item, status) => `${fm({ item, stage: 'test', status, translation: 'test.pt-BR.md' })}\n# Test: ${item} evidence\n\n## Suite and tests\n\n| Run | Unit | E2E | Result |\n|---|---|---|---|\n| run-1 | 120 passed | 3 passed | pass |\n`;

const ITEMS = {
  // the epic's phase 1, its issue in plan.md only; built and passed
  'first-project-onboarding': {
    'intent.md': intent('first-project-onboarding'),
    'spec.md': spec('first-project-onboarding', 'signed off'),
    'plan.md': plan('first-project-onboarding', ['done', 'done', 'done', 'done', 'done', 'done', 'done'], { issue: '"#629 (phase 1 of epic eduardogalbiati/multiagent-orchestrator#628)"' }),
    'test.md': testDoc('first-project-onboarding', 'passed'),
  },
  // its issue in spec.md; built (4 phases) and passed
  'project-mockups': {
    'intent.md': intent('project-mockups'),
    'spec.md': spec('project-mockups', 'signed off', { issue: '"#625"' }),
    'plan.md': plan('project-mockups', ['done', 'done', 'done', 'done']),
    'test.md': testDoc('project-mockups', 'passed'),
  },
  // its issue in spec.md; built, the test still collecting
  'write-doc': {
    'intent.md': intent('write-doc'),
    'spec.md': spec('write-doc', 'signed off', { issue: '"#636"' }),
    'plan.md': plan('write-doc', ['done', 'done', 'done']),
    'test.md': testDoc('write-doc', 'collecting'),
  },
  // an accepted intent only
  'documentation-agent': {
    'intent.md': intent('documentation-agent'),
  },
  // control: a signed-off spec, no plan, no issue
  'offline-mode': {
    'intent.md': intent('offline-mode'),
    'spec.md': spec('offline-mode', 'signed off'),
  },
};

function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-12-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [item, files] of Object.entries(ITEMS)) {
    for (const [name, text] of Object.entries(files)) {
      const f = path.join(dir, 'docs', 'work', item, name);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, text);
    }
  }
  return dir;
}

// docs-list.js in a sandbox with app.js's globals: esc, the real English t, DocModel, DocsPanels.openLabel
function loadDocsList() {
  const i18n = require('@craftorio/shared/i18n');
  i18n.setLanguage?.('en');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const DocModel = require(path.join(ROOT, 'packages', 'shared', 'doc-model.js'));
  const DocsPanels = { openLabel: (doc) => `Open ${doc}` };
  const sandbox = { esc, t: (...a) => i18n.t(...a), DocModel, DocsPanels, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(DOCS_LIST, 'utf8'), sandbox, { filename: DOCS_LIST });
  return sandbox.DocsList;
}

// the Items tab's HTML for the fixture folders
function render(t) {
  const { listItems } = require('@craftorio/engine/fronts/plan/domains/docs');
  return String(loadDocsList().itemsHtml(listItems(repo(t)), 'p1'));
}

// [{ item, html }] in the order drawn: each row from its opening tag (data-testid="docs-item") to the next
function rows(html) {
  const opens = [...html.matchAll(/<[a-z]+\b[^>]*\bdata-testid="docs-item"[^>]*>/g)];
  return opens.map((m, i) => ({
    item: (/\bdata-item="([^"]*)"/.exec(m[0]) || [])[1] || '',
    html: html.slice(m.index, i + 1 < opens.length ? opens[i + 1].index : html.length),
  }));
}
const rowOf = (html, item) => rows(html).find((r) => r.item === item)?.html || '';
const visibleText = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
// "Done" as a word in the row's text (English i18n) or a docs-item-done testid
const showsDone = (row) => /\bDone\b/.test(visibleText(row)) || /data-testid="docs-item-done"/.test(row);
// the stage chain: "Name:done|undone" per stage span
function stageChain(row) {
  const stages = (/data-testid="docs-item-stages"[^>]*>([\s\S]*?)<\/span>\s*<\/div>/.exec(row) || [])[1] || '';
  return [...stages.matchAll(/<span class="docs-stage([^"]*)"[^>]*>([^<]*)<\/span>/g)]
    .map((m) => `${m[2].replace('✓', '').trim()}:${/\bdone\b/.test(m[1]) ? 'done' : 'undone'}`);
}

test('#12 an item whose plan.md has an issue field shows no "Create epic and phase issues" button', (t) => {
  const row = rowOf(render(t), 'first-project-onboarding');
  assert.deepEqual([row !== '', row.includes('data-docs-issues')], [true, false]);
});

test('#12 an item whose plan.md issue names its epic shows the epic issue in its row', (t) => {
  const row = rowOf(render(t), 'first-project-onboarding');
  assert.match(visibleText(row), /eduardogalbiati\/multiagent-orchestrator#628/);
});

test('#12 an item whose spec.md has an issue field shows no "Create epic and phase issues" button', (t) => {
  const row = rowOf(render(t), 'project-mockups');
  assert.deepEqual([row !== '', row.includes('data-docs-issues')], [true, false]);
});

test('#12 an item whose spec.md has an issue field shows that issue in its row', (t) => {
  const row = rowOf(render(t), 'project-mockups');
  assert.match(visibleText(row), /#625\b/);
});

test('#12 a built item still in test with an issue field shows its issue and no create-issues button', (t) => {
  const row = rowOf(render(t), 'write-doc');
  assert.deepEqual([row !== '', row.includes('data-docs-issues'), /#636\b/.test(visibleText(row))], [true, false, true]);
});

test('#12 an item with only an accepted intent shows no create-issues button', (t) => {
  const row = rowOf(render(t), 'documentation-agent');
  assert.deepEqual([row !== '', row.includes('data-docs-issues')], [true, false]);
});

test('#12 control: a signed-off spec with no plan and no issue keeps "Write the plan" and "Create epic and phase issues"', (t) => {
  const row = rowOf(render(t), 'offline-mode');
  assert.deepEqual([row.includes('data-docs-write-plan'), row.includes('data-docs-issues')], [true, true]);
});

test('#12 guard: no "Write the plan" on an item whose plan already exists', (t) => {
  const html = render(t);
  assert.deepEqual(
    ['first-project-onboarding', 'project-mockups', 'write-doc'].map((item) => rowOf(html, item).includes('data-docs-write-plan')),
    [false, false, false],
  );
});

test('#12 a built plan with a passed test.md shows the item as Done', (t) => {
  const html = render(t);
  assert.deepEqual([showsDone(rowOf(html, 'first-project-onboarding')), showsDone(rowOf(html, 'project-mockups'))], [true, true]);
});

test('#12 a Done item shows its stage chain complete up to Test, every stage checked', (t) => {
  const chain = stageChain(rowOf(render(t), 'first-project-onboarding'));
  assert.deepEqual(
    [chain.slice(0, 4).join(','), chain.filter((s) => s.endsWith(':undone')).join(',')],
    ['Plan:done,Design:done,Build:done,Test:done', ''],
  );
});

test('#12 a built plan whose test.md is still collecting is not Done', (t) => {
  assert.equal(showsDone(rowOf(render(t), 'write-doc')), false);
});

test('#12 items in progress (accepted intent, signed-off spec) are not Done', (t) => {
  const html = render(t);
  assert.deepEqual([showsDone(rowOf(html, 'documentation-agent')), showsDone(rowOf(html, 'offline-mode'))], [false, false]);
});

test('#12 Done items are listed after every item in progress', (t) => {
  const order = rows(render(t)).map((r) => r.item);
  const done = ['first-project-onboarding', 'project-mockups'];
  const lastInProgress = Math.max(...order.map((item, i) => (done.includes(item) ? -1 : i)));
  const firstDone = Math.min(...done.map((item) => order.indexOf(item)));
  assert.deepEqual([order.length, firstDone > lastInProgress], [5, true], `order: ${order.join(', ')}`);
});
