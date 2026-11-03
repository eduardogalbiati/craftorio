// #431: the shared workflow form (packages/ui-kit/workflow-inputs.js) draws a workflow's options under
// small group labels, its main options first and the rest behind a "Show more options" link, when the
// host asks for it (the Product Owner drawer). Acceptance tests written before the code.
//
// The markup is parsed into packages/ui-kit/test/mini-dom.js (a small real DOM), so the tests read
// elements, not strings.
//
// Contract the developer provides (chosen here):
// - two optional fields on a workflow input: `group` (a short label, e.g. "Tests") and `main: true`;
// - formHtml(defs, { groups: true }) opts in. Without `groups` (the Start drawer, the roadmap item's
//   Edit, the chain picker) the form stays exactly as today, whatever group/main the inputs carry;
// - with `groups: true` and at least one `main` input:
//   - each group's label is an element [data-testid="wf-group-label"] whose text is the group, drawn
//     before that group's fields; groups come in the order of their first input in `defs`, fields
//     keep their `defs` order inside a group;
//   - the main inputs' fields are outside the container [data-testid="wf-more"]; every other field is
//     inside it (with its own group labels);
//   - closed (the default): [data-testid="wf-more"] has the `hidden` attribute and the link
//     [data-testid="wf-more-toggle"] (a <button> or <a>) reads "Show more options",
//     aria-expanded="false"; formHtml(defs, { groups: true, moreOpen: true }): no `hidden` on it, the
//     link reads "Show fewer options", aria-expanded="true";
// - with `groups: true` but no `main` input: the groups are drawn, nothing is hidden (no wf-more
//   container, or one that is not hidden, and no link); with neither group nor main: exactly the
//   markup of formHtml(defs) (no label, no link, every field);
// - read(root) still returns every value, the hidden fields' included;
// - "Show more options" / "Show fewer options" are catalog strings (packages/shared/i18n/en.json, with
//   the same keys in pt-BR.json).
// A field is "hidden" when it, or an element between it and the form's root, has the `hidden`
// attribute (the rule show_if already follows).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createDom, textOf } = require('./mini-dom');
const WorkflowInputs = require('../workflow-inputs');

const I18N = path.join(__dirname, '..', '..', 'shared', 'i18n');

// groups chosen so "first appearance" gives the same order overall and among the non-main inputs
const DEFS = {
  mode: { type: 'string', enum: ['auto', 'validated'], default: 'auto', label: 'Mode', options: { auto: 'Automatic', validated: 'Validated' }, group: 'How it runs', main: true },
  unit_tests: { type: 'string', enum: ['write_and_run', 'run_existing', 'off'], default: 'write_and_run', label: 'Unit tests', options: { write_and_run: 'Write and run', run_existing: 'Run existing', off: 'Off' }, group: 'Tests', main: true },
  validate_every_round: { type: 'boolean', default: false, label: 'Validate every round', group: 'How it runs' },
  e2e_tests: { type: 'string', enum: ['off', 'write', 'write_and_run'], default: 'write_and_run', label: 'E2E tests', options: { off: 'Off', write: 'Write', write_and_run: 'Write and run' }, group: 'Tests', main: true },
  test_command: { type: 'string', default: 'npm test', label: 'Test command', group: 'Tests' },
  screenshots: { type: 'string', enum: ['off', 'changed', 'all'], default: 'all', label: 'Screenshots', options: { off: 'Off', changed: 'Changed screens', all: 'All' }, group: 'Tests', main: true },
  developer_model: { type: 'string', enum: ['claude-opus-5-5', 'claude-fable-5-1'], default: 'claude-opus-5-5', label: 'Developer model', group: 'Developer' },
  check_command: { type: 'string', default: 'npm run check', label: 'Check command', group: 'Checks' },
};
const MAIN = ['mode', 'unit_tests', 'e2e_tests', 'screenshots'];
const EXTRA = ['validate_every_round', 'test_command', 'developer_model', 'check_command'];
const strip = (defs) => Object.fromEntries(Object.entries(defs).map(([k, d]) => { const { group, main, ...rest } = d; return [k, rest]; }));

function mount(html) {
  const { document } = createDom({ window: {} });
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}
const fieldOf = (root, key) => root.querySelector(`.wi-field[data-wi-key="${key}"]`);
const insideMore = (root, el) => { for (let n = el?.parentNode; n && n !== root; n = n.parentNode) if (n.getAttribute?.('data-testid') === 'wf-more') return true; return false; };
const isHidden = (root, el) => { for (let n = el; n && n !== root; n = n.parentNode) if (n.hasAttribute?.('hidden')) return true; return false; };
const labelsIn = (scope) => scope.querySelectorAll('[data-testid="wf-group-label"]').map((l) => textOf(l));
// the text of the last group label before `el` in document order, under `root`
function groupBefore(root, el) {
  let last = null;
  const walk = (n) => {
    if (n === el) return true;
    if (n.getAttribute?.('data-testid') === 'wf-group-label') last = textOf(n);
    for (const c of n.childNodes || []) if (walk(c)) return true;
    return false;
  };
  walk(root);
  return last;
}

test('#431 formHtml with groups: true draws group labels (wf-group-label) in the order of first appearance, each field under its group\'s label', () => {
  const root = mount(WorkflowInputs.formHtml(DEFS, { groups: true }));
  const more = root.querySelector('[data-testid="wf-more"]');
  assert.equal(more === null, false, 'a [data-testid="wf-more"] container holds the non-main options');
  const main = root.querySelectorAll('[data-testid="wf-group-label"]').filter((l) => !insideMore(root, l)).map((l) => textOf(l));
  assert.deepEqual(main, ['How it runs', 'Tests'], 'the main options\' groups, outside wf-more');
  assert.deepEqual(labelsIn(more), ['How it runs', 'Tests', 'Developer', 'Checks'], 'the other options\' groups, inside wf-more');
  for (const key of Object.keys(DEFS)) {
    const f = fieldOf(root, key);
    assert.equal(f === null, false, `the ${key} field is drawn`);
    assert.equal(groupBefore(root, f), DEFS[key].group, `${key} is drawn under "${DEFS[key].group}"`);
  }
});

test('#431 formHtml with groups: true puts the main options outside wf-more and the others inside it, hidden, behind "Show more options" (aria-expanded="false")', () => {
  const root = mount(WorkflowInputs.formHtml(DEFS, { groups: true }));
  const more = root.querySelector('[data-testid="wf-more"]');
  assert.equal(more === null, false, 'a [data-testid="wf-more"] container');
  assert.equal(more.hasAttribute('hidden'), true, 'closed by default: wf-more has the hidden attribute');
  for (const key of MAIN) {
    assert.equal(insideMore(root, fieldOf(root, key)), false, `${key} (main) is outside wf-more`);
    assert.equal(isHidden(root, fieldOf(root, key)), false, `${key} (main) is shown`);
  }
  for (const key of EXTRA) {
    assert.equal(insideMore(root, fieldOf(root, key)), true, `${key} is inside wf-more`);
    assert.equal(isHidden(root, fieldOf(root, key)), true, `${key} is hidden`);
  }
  const link = root.querySelector('[data-testid="wf-more-toggle"]');
  assert.equal(link === null, false, 'a [data-testid="wf-more-toggle"] link');
  assert.equal(['BUTTON', 'A'].includes(link.tagName), true, `a button or a link, got ${link.tagName}`);
  assert.equal(insideMore(root, link), false, 'the link itself stays visible, outside wf-more');
  assert.equal(textOf(link), 'Show more options');
  assert.equal(link.getAttribute('aria-expanded'), 'false');
});

test('#431 formHtml with groups: true, moreOpen: true shows the other options and the link reads "Show fewer options" (aria-expanded="true")', () => {
  const root = mount(WorkflowInputs.formHtml(DEFS, { groups: true, moreOpen: true }));
  const more = root.querySelector('[data-testid="wf-more"]');
  assert.equal(more === null, false, 'a [data-testid="wf-more"] container');
  assert.equal(more.hasAttribute('hidden'), false, 'open: no hidden attribute');
  for (const key of EXTRA) assert.equal(isHidden(root, fieldOf(root, key)), false, `${key} is shown`);
  const link = root.querySelector('[data-testid="wf-more-toggle"]');
  assert.equal(link === null, false, 'a [data-testid="wf-more-toggle"] link');
  assert.equal(textOf(link), 'Show fewer options');
  assert.equal(link.getAttribute('aria-expanded'), 'true');
});

test('#431 read() still returns the values of the options hidden behind "Show more options"', () => {
  const values = { mode: 'validated', unit_tests: 'run_existing', test_command: 'make test', developer_model: 'claude-fable-5-1', check_command: 'make lint' };
  const root = mount(WorkflowInputs.formHtml(DEFS, { groups: true, values }));
  for (const key of ['test_command', 'developer_model', 'check_command']) assert.equal(isHidden(root, fieldOf(root, key)), true, `${key} is hidden (closed wf-more)`);
  assert.deepEqual(WorkflowInputs.read(root, { all: true }), {
    mode: 'validated', unit_tests: 'run_existing', validate_every_round: false, e2e_tests: 'write_and_run',
    test_command: 'make test', screenshots: 'all', developer_model: 'claude-fable-5-1', check_command: 'make lint',
  });
});

test('#431 formHtml with groups: true and groups but no main input draws the groups and hides nothing (no "Show more options")', () => {
  const defs = Object.fromEntries(Object.entries(DEFS).map(([k, d]) => { const { main, ...rest } = d; return [k, rest]; }));
  const root = mount(WorkflowInputs.formHtml(defs, { groups: true }));
  assert.equal(labelsIn(root).length > 0, true, 'the group labels are drawn');
  assert.equal(root.querySelector('[data-testid="wf-more-toggle"]'), null, 'no "Show more options" link');
  for (const key of Object.keys(defs)) {
    assert.equal(fieldOf(root, key) === null, false, `${key} is drawn`);
    assert.equal(isHidden(root, fieldOf(root, key)), false, `${key} is not hidden`);
  }
});

// guard (green before and after the change): a workflow with neither group nor main renders as today
test('#431 formHtml with groups: true on inputs without group or main renders exactly as formHtml without it', () => {
  const plain = strip(DEFS);
  assert.equal(WorkflowInputs.formHtml(plain, { groups: true }), WorkflowInputs.formHtml(plain));
});

// guard (green before and after the change): the Start drawer, the roadmap item's Edit and the chain
// picker call formHtml without `groups`, so their forms stay flat even on inputs that carry group/main
test('#431 formHtml without groups ignores group and main: no group label, no "Show more options", every field shown', () => {
  const root = mount(WorkflowInputs.formHtml(DEFS));
  assert.equal(root.querySelector('[data-testid="wf-group-label"]'), null);
  assert.equal(root.querySelector('[data-testid="wf-more"]'), null);
  assert.equal(root.querySelector('[data-testid="wf-more-toggle"]'), null);
  for (const key of Object.keys(DEFS)) assert.equal(isHidden(root, fieldOf(root, key)), false, `${key} is shown`);
});

// ---- the catalog strings ----------------------------------------------------------------------------

const flat = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, `${prefix}${k}.`) : [[`${prefix}${k}`, v]]));
const catalog = (file) => Object.fromEntries(flat(JSON.parse(fs.readFileSync(path.join(I18N, file), 'utf8'))));

test('#431 "Show more options" and "Show fewer options" are in en.json, with the same keys translated in pt-BR.json', () => {
  const en = catalog('en.json');
  const pt = catalog('pt-BR.json');
  for (const s of ['Show more options', 'Show fewer options']) {
    const keys = Object.keys(en).filter((k) => en[k] === s);
    assert.equal(keys.length > 0, true, `en.json has a key whose value is "${s}"`);
    for (const k of keys) {
      assert.equal(typeof pt[k], 'string', `pt-BR.json has ${k}`);
      assert.equal(pt[k].trim().length > 0, true, `pt-BR.json's ${k} is not empty`);
    }
  }
});
