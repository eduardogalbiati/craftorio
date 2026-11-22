// #242: the Product Owner drawer's split cards (fronts/build/views/backlog/backlog-po-proposals.js,
// styles in backlog.css) overflowed the drawer and showed raw Markdown in the task lines. The module
// is loaded whole into a vm sandbox (like test/renderer-backlog-po-proposals.test.js) and its HTML is
// read as text: no layout here, so the overflow part is checked on the CSS rules that cause it.
// The inline Markdown of a task (**bold**, `code`, [text](url)) must be rendered or stripped by the
// module itself (no app.js markdownHtml in the sandbox), and each task line's `title` (the hover) is
// the full plain text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
// a page file by its page-relative name, in whichever layer holds it (the UI kit, a front, the page folder)
const pageFileOf = (rel) => require('../../../scripts/source-tree').pageFile(path.join(__dirname, '..', '..', '..'), rel);
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox.js');

const BACKLOG = pageFileOf('views/backlog');
const src = fs.readFileSync(path.join(BACKLOG, 'backlog-po-proposals.js'), 'utf8');
const defaultWorkflowSrc = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'packages', 'shared', 'default-workflow.js'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const unesc = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const textOf = (html) => unesc(String(html).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

function load() {
  const sandbox = {
    esc,
    state: { workflows: [], simulationOnly: false, settings: { defaultWorkflow: null } },
    errMsg: (e) => String(e?.message || e),
    devMode: () => true,
    confirmDialog: async () => true,
    api: {},
  };
  sandbox.window = sandbox;
  sandbox.window.BacklogActions = { data: () => ({ epics: [] }), showData: () => {}, showRoadmap: () => {} };
  vm.createContext(withI18n(sandbox));
  vm.runInContext(defaultWorkflowSrc, sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.BacklogPoProposals;
}

const LONG = 'very long words that keep going '.repeat(10).trim(); // 300+ characters
const TASKS = [
  { n: 1, text: `**Acceptance**: the card wraps inside the drawer, ${LONG}` },
  { n: 2, text: `Rename \`savePermissions\` and read [the storage doc](https://example.com/docs/storage) first, ${LONG}` },
  { n: 3, text: 'Plain task' },
];
const PLAIN = ['Acceptance: the card wraps inside the drawer', 'Rename savePermissions and read the storage doc first'];

function proposal(issue = 7) {
  return {
    issue,
    title: `Parent issue with a very long title, ${LONG}`,
    tasks: TASKS,
    reasons: ['Too big.'],
    children: [
      { stage: 1, complexity: 2, title: `First child with a long title, ${LONG}`, tasks: [1, 3], reason: '' },
      { stage: 2, complexity: 3, title: 'Second child', tasks: [2], reason: '' },
    ],
  };
}
const ctxOf = (messages) => ({ messages, projectId: 'p1', busy: false, issueRef: (n) => `<a class="po-issue">#${n}</a>`, issueOf: () => null, render: () => {}, setMessages: () => {} });

// the <li> of each .po-tasks list: [{ attrs, inner }]
function taskLines(html) {
  const lists = [...html.matchAll(/<ul class="[^"]*\bpo-tasks\b[^"]*"[^>]*>([\s\S]*?)<\/ul>/g)].map((m) => m[1]);
  assert.ok(lists.length, 'no .po-tasks list rendered');
  return lists.flatMap((l) => [...l.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)].map((m) => ({ attrs: m[1], inner: m[2] })));
}
const titleAttr = (attrs) => { const m = /\btitle="([^"]*)"/.exec(attrs); return m ? unesc(m[1]) : null; };

test('#242 split card: task lines show no raw Markdown (no ** nor backticks nor ](url)), and keep their words', () => {
  const P = load();
  const msg = { ts: 't1', answer: { splits: [proposal()] } };
  const lines = taskLines(P.splitsHtml(ctxOf([msg]), msg));
  assert.equal(lines.length, 3);
  for (const l of lines) {
    const text = textOf(l.inner);
    assert.doesNotMatch(text, /\*\*|`|\]\(/, `raw Markdown in a task line: ${text.slice(0, 80)}`);
  }
  assert.ok(textOf(lines[0].inner).includes(PLAIN[0]), textOf(lines[0].inner).slice(0, 80));
  assert.ok(textOf(lines[2].inner).includes(PLAIN[1]), textOf(lines[2].inner).slice(0, 80));
  // bold is shown as bold (or stripped), never as asterisks
  assert.doesNotMatch(lines[0].inner, /\*\*/);
});

test('#242 split card: each task line carries its full plain text in title (the hover)', () => {
  const P = load();
  const msg = { ts: 't2', answer: { splits: [proposal()] } };
  const lines = taskLines(P.splitsHtml(ctxOf([msg]), msg));
  const titles = lines.map((l) => titleAttr(l.attrs));
  assert.ok(titles.every((x) => x), 'a task line has no title');
  assert.ok(titles[0].includes(PLAIN[0]) && titles[0].endsWith(LONG), titles[0].slice(0, 80));
  assert.ok(titles[2].includes(PLAIN[1]) && titles[2].endsWith(LONG), titles[2].slice(0, 80));
  for (const x of titles) assert.doesNotMatch(x, /\*\*|`|\]\(/);
});

test('#242 split card: the issue title and the child titles carry their full text in title', () => {
  const P = load();
  const s = proposal();
  const msg = { ts: 't3', answer: { splits: [s] } };
  const html = P.splitsHtml(ctxOf([msg]), msg);
  const parent = /<[^>]*\bpo-split-title\b[^>]*>/.exec(html)?.[0];
  assert.ok(parent, 'no .po-split-title');
  assert.equal(titleAttr(parent), s.title);
  const child = /<[^>]*\bpo-child-title\b[^>]*>/.exec(html)?.[0];
  assert.ok(child, 'no .po-child-title');
  assert.equal(titleAttr(child), s.children[0].title);
});

test('#242 Edit…: the task selectors show the tasks without raw Markdown', () => {
  const P = load();
  const msg = { ts: 't4', answer: { splits: [proposal(9)] } };
  const ctx = ctxOf([msg]);
  const b = { dataset: { splitAct: 'edit' } };
  b.closest = (sel) => (sel === '[data-msg]' ? { dataset: { msg: '0' } } : sel === '[data-split]' ? { dataset: { split: '9' } } : b);
  assert.equal(P.onClick({ target: { closest: () => b } }, ctx), true);
  const html = P.splitsHtml(ctx, msg);
  const tasks = [...html.matchAll(/<label class="[^"]*\bpo-edit-task\b[^"]*"[^>]*>([\s\S]*?)<\/label>/g)].map((m) => m[1]);
  assert.equal(tasks.length, 3, 'the Edit… form has no task selectors');
  for (const t of tasks) {
    const text = textOf(t.replace(/<select[\s\S]*?<\/select>/g, ''));
    assert.doesNotMatch(text, /\*\*|`|\]\(/, `raw Markdown in an Edit… task: ${text.slice(0, 80)}`);
    for (const m of t.matchAll(/\btitle="([^"]*)"/g)) assert.doesNotMatch(unesc(m[1]), /\*\*|`|\]\(/);
  }
  assert.ok(textOf(tasks[0]).includes(PLAIN[0]));
});

// ---- the CSS: what lets a long card push the drawer wider -----------------------------------------
const css = fs.readFileSync(path.join(BACKLOG, 'backlog.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// the declarations of every rule whose selector list contains `selector` exactly (one of the commas)
function declsOf(selector) {
  const out = [];
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sels = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' '));
    if (sels.includes(selector)) out.push(m[2]);
  }
  return out.join(';');
}
const has = (decls, re) => re.test(decls.replace(/\s+/g, ' '));
const SHRINKS = /grid-template-columns\s*:\s*minmax\(\s*0(px)?\s*,\s*1fr\s*\)/;
const MIN0 = /min-width\s*:\s*0(px)?\s*(;|$|!)/;

test('#242 CSS: the card grids (.po-group, .po-children, .po-tasks) let their items shrink to the drawer', () => {
  const items = { '.po-group': ['.po-group > *'], '.po-children': ['.po-children > *', '.po-child', '.po-children > li'], '.po-tasks': ['.po-tasks > *', '.po-tasks li', '.po-tasks > li'] };
  for (const [grid, children] of Object.entries(items)) {
    const own = declsOf(grid);
    const ok = has(own, SHRINKS) || children.some((c) => has(declsOf(c), MIN0));
    assert.ok(ok, `${grid}: neither grid-template-columns: minmax(0, 1fr) nor min-width: 0 on its items`);
  }
});

test('#242 CSS: a task line wraps (clamped) instead of one nowrap line', () => {
  const li = declsOf('.po-tasks li') + ';' + declsOf('.po-tasks > li');
  const nowrap = has(li, /white-space\s*:\s*nowrap/);
  const clamped = has(li, /-webkit-line-clamp\s*:/);
  assert.ok(!nowrap || clamped, '.po-tasks li still has white-space: nowrap (one line, cut) and no line clamp');
  assert.ok(clamped || has(li, /white-space\s*:\s*(normal|pre-wrap|pre-line)/) || !nowrap, '.po-tasks li does not wrap');
});

test('#242 CSS: a card\'s actions row wraps', () => {
  assert.ok(has(declsOf('.po-group-actions'), /flex-wrap\s*:\s*wrap/), '.po-group-actions has no flex-wrap: wrap');
});
