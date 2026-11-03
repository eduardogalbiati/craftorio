// #431: the Product Owner drawer's workflow options (#po-wf-row, fronts/build/views/backlog/
// backlog-po.js, drawn with WorkflowInputs.formHtml) can be minimized to a one-line summary, and show
// the main options first (Mode, Unit tests, E2E tests, Screenshots) with the rest behind "Show more
// options". Acceptance tests written before the code.
//
// Harness: the whole page in packages/ui-kit/test/agent-chat-page-harness.js (index.html parsed into
// mini-dom, every page script run, a fake window.api recording each call), the drawer opened with
// BacklogPO.open() on project "demo", the workflow list = workflows/feature.yaml's real inputs (the
// default development workflow). "Per viewer" = the page's localStorage: a new page whose storage
// starts with the old page's entries is the same viewer coming back (no key name is assumed).
//
// Contract the developer provides (chosen here):
// - [data-testid="po-wf-toggle"]: a <button> on the "Plan with" row (#po-wf-row), aria-expanded
//   "true" (options shown) / "false" (minimized), a non-empty title (tooltip) in both states; a click
//   toggles;
// - minimized: the options box [data-testid="po-workflow-options"] is hidden, the row and the
//   workflow select stay, and [data-testid="po-wf-summary"] (in the row) is shown with the chosen
//   values by their labels (e.g. "Automatic · Unit: Write and run · E2E: Write and run · Screenshots: All");
// - expanded: only the main options' fields are shown; the others sit in [data-testid="wf-more"]
//   behind [data-testid="wf-more-toggle"] ("Show more options", aria-expanded="false"; open: "Show
//   fewer options", aria-expanded="true"); a click toggles;
// - both choices (minimized, more open) are remembered per viewer (localStorage);
// - neither changes a value; a question (api.askProductOwner's 11th argument, `inputs`) carries
//   every option's value, the hidden ones included.
// Hidden = the element, or an ancestor below #po-drawer, has the `hidden` attribute, the `hidden`
// class or style display none (show_if fields, hidden by their own attribute, count as hidden).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { textOf } = require('@multiagent/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@multiagent/ui-kit/test/agent-chat-page-harness');

const FEATURE = (() => {
  const doc = yaml.load(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'workflows', 'feature.yaml'), 'utf8'));
  return { file: 'feature.yaml', name: doc.metadata.name, description: doc.metadata.description, inputs: doc.inputs };
})();
// the owner's "Mode" is `mode` and/or `validation` (#630); the other main options are fixed
const MODE_KEYS = ['mode', 'validation'];
const TEST_MAIN = ['unit_tests', 'e2e_tests', 'screenshots'];
const EXTRA = ['developer_model', 'developer_effort', 'test_command', 'check_command', 'suite_red_outside_change'];

async function openPo({ storage = null, workflows = [FEATURE] } = {}) {
  const page = await loadPage({
    api: {
      listWorkflows: async () => workflows,
      listProjects: async () => [{ id: 'demo', name: 'Demo project' }],
      askProductOwner: () => new Promise(() => {}),
    },
  });
  if (storage) for (const [k, v] of storage) page.sandbox.localStorage.setItem(k, v);
  const actions = page.sandbox.BacklogActions;
  actions.projectId = () => 'demo';
  actions.project = () => ({ id: 'demo', name: 'Demo project' });
  await page.sandbox.BacklogPO.open();
  await settle();
  return page;
}
// the same viewer in a new app session: a new page whose storage starts with this one's entries
const reopenAsSameViewer = (page) => openPo({ storage: [...page.sandbox.localStorage.store.entries()] });

const drawer = (page) => page.$('#po-drawer');
const isHidden = (page, el) => {
  const stop = drawer(page);
  for (let n = el; n && n !== stop; n = n.parentNode) {
    if (n.hasAttribute?.('hidden') || n.classList?.contains('hidden') || n.style?.display === 'none') return true;
  }
  return false;
};
const box = (page) => page.$('#po-drawer [data-testid="po-workflow-options"]');
const toggle = (page) => page.$('#po-wf-row [data-testid="po-wf-toggle"]');
const summary = (page) => page.$('#po-wf-row [data-testid="po-wf-summary"]');
const moreLink = (page) => box(page)?.querySelector('[data-testid="wf-more-toggle"]') ?? null;
const field = (page, key) => box(page)?.querySelector(`.wi-field[data-wi-key="${key}"]`) ?? null;
const shownKeys = (page) => (box(page)?.querySelectorAll('.wi-field[data-wi-key]') || []).filter((f) => !isHidden(page, f)).map((f) => f.getAttribute('data-wi-key'));
const values = (page) => JSON.stringify(page.sandbox.WorkflowInputs.read(box(page), { all: true }));

function needToggle(page) {
  const b = toggle(page);
  assert.equal(b === null, false, 'the "Plan with" row has a [data-testid="po-wf-toggle"] chevron');
  return b;
}
function needMoreLink(page) {
  const l = moreLink(page);
  assert.equal(l === null, false, 'the options have a [data-testid="wf-more-toggle"] link');
  return l;
}

test('#431 the "Plan with" row has a chevron <button> (po-wf-toggle) on its right, expanded by default: aria-expanded="true" and a tooltip', async () => {
  const page = await openPo();
  const b = needToggle(page);
  assert.equal(b.tagName, 'BUTTON', 'a <button>, so Enter and Space work from the keyboard');
  assert.equal(b.getAttribute('aria-expanded'), 'true');
  assert.equal(String(b.getAttribute('title') || '').trim().length > 0, true, 'a tooltip (title)');
  assert.equal(isHidden(page, box(page)), false, 'the options are shown');
});

test('#431 the chevron minimizes the options to a one-line summary of the chosen values (row and select stay) and expands them again', async () => {
  const page = await openPo();
  needToggle(page).click();
  await settle();
  const b = toggle(page);
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  assert.equal(String(b.getAttribute('title') || '').trim().length > 0, true, 'a tooltip when minimized too');
  assert.equal(isHidden(page, box(page)), true, 'the options box is hidden');
  assert.equal(isHidden(page, page.$('#po-wf-row')), false, 'the row stays');
  assert.equal(isHidden(page, page.$('#po-workflow')), false, 'the workflow select stays');
  const s = summary(page);
  assert.equal(s === null, false, 'a [data-testid="po-wf-summary"] in the row');
  assert.equal(isHidden(page, s), false, 'the summary is shown when minimized');
  const text = textOf(s);
  assert.equal(text.includes('Write and run'), true, `Unit and E2E tests by their labels: "${text}"`);
  assert.equal(text.includes('Screenshots'), true, `"${text}"`);
  assert.equal(/\bAll\b/.test(text), true, `Screenshots: All: "${text}"`);
  assert.equal(/Automatic|Local/.test(text), true, `the mode by its label: "${text}"`);
  assert.equal(/write_and_run|_/.test(text), false, `labels, not raw values: "${text}"`);

  toggle(page).click();
  await settle();
  assert.equal(toggle(page).getAttribute('aria-expanded'), 'true');
  assert.equal(isHidden(page, box(page)), false, 'the options are shown again');
});

test('#431 the minimized summary reads the owner\'s line: "Automatic · Unit: Write and run · E2E: Write and run · Screenshots: All"', async () => {
  const page = await openPo();
  needToggle(page).click();
  await settle();
  const s = summary(page);
  assert.equal(s === null, false, 'a [data-testid="po-wf-summary"]');
  assert.equal(textOf(s).replace(/\s+/g, ' ').trim(), 'Automatic · Unit: Write and run · E2E: Write and run · Screenshots: All');
});

test('#431 in Portuguese the summary names the tests short in the viewer\'s language (Unitários:, E2E:)', async () => {
  const page = await openPo();
  page.sandbox.I18n.setLanguage('pt-BR');
  needToggle(page).click();
  await settle();
  const text = textOf(summary(page));
  assert.equal(text.includes('Unitários: '), true, `"${text}"`);
  assert.equal(text.includes('E2E: '), true, `"${text}"`);
  assert.equal(text.includes('Unit: '), false, `no English prefix: "${text}"`);
});

test('#431 switching the workflow while minimized keeps it minimized and the summary follows the new workflow\'s values', async () => {
  const quickInputs = JSON.parse(JSON.stringify(FEATURE.inputs));
  quickInputs.unit_tests.default = 'off';
  const QUICK = { file: 'quick.yaml', name: 'Quick development', description: 'A copy with unit tests off', inputs: quickInputs };
  const page = await openPo({ workflows: [FEATURE, QUICK] });
  const select = page.$('#po-workflow');
  assert.equal(select.value, 'feature.yaml', 'the default development workflow is chosen first');
  needToggle(page).click();
  await settle();
  assert.equal(textOf(summary(page)).includes('Unit: Write and run'), true, `"${textOf(summary(page))}"`);
  select.value = 'quick.yaml';
  select.onchange({ target: select });
  await settle();
  assert.equal(toggle(page).getAttribute('aria-expanded'), 'false', 'still minimized');
  assert.equal(isHidden(page, box(page)), true, 'the options box stays hidden');
  const text = textOf(summary(page));
  assert.equal(isHidden(page, summary(page)), false, 'the summary is shown');
  assert.equal(text.includes('Unit: Off'), true, `the new workflow's value: "${text}"`);
});

test('#431 the summary follows the values set: Unit tests set to Off reads Off once minimized', async () => {
  const page = await openPo();
  needToggle(page);
  page.sandbox.WorkflowInputs.set(box(page), 'unit_tests', 'off');
  toggle(page).click();
  await settle();
  const s = summary(page);
  assert.equal(s === null, false, 'a [data-testid="po-wf-summary"]');
  assert.equal(/\bOff\b/.test(textOf(s)), true, `"${textOf(s)}"`);
});

test('#431 minimizing and expanding never changes a value', async () => {
  const page = await openPo();
  needToggle(page);
  page.sandbox.WorkflowInputs.set(box(page), 'unit_tests', 'run_existing');
  page.sandbox.WorkflowInputs.set(box(page), 'developer_effort', 'high');
  const before = values(page);
  toggle(page).click();
  await settle();
  assert.equal(values(page), before, 'minimized');
  toggle(page).click();
  await settle();
  assert.equal(values(page), before, 'expanded again');
});

test('#431 the minimized choice is remembered per viewer: reopening the drawer and a new session start minimized', async () => {
  const page = await openPo();
  needToggle(page).click();
  await settle();
  page.$('#btn-po-close')?.click();
  await settle();
  await page.sandbox.BacklogPO.open();
  await settle();
  assert.equal(toggle(page).getAttribute('aria-expanded'), 'false', 'reopened: still minimized');
  const again = await reopenAsSameViewer(page);
  const b = toggle(again);
  assert.equal(b === null, false, 'the chevron');
  assert.equal(b.getAttribute('aria-expanded'), 'false', 'a new session: still minimized');
  assert.equal(isHidden(again, box(again)), true, 'the options box is hidden');
});

test('#431 expanded, only Mode, Unit tests, E2E tests and Screenshots are shown; the rest waits behind "Show more options"', async () => {
  const page = await openPo();
  const shown = shownKeys(page);
  for (const k of TEST_MAIN) assert.equal(shown.includes(k), true, `${k} is shown (shown: ${JSON.stringify(shown)})`);
  assert.equal(shown.some((k) => MODE_KEYS.includes(k)), true, `Mode is shown (shown: ${JSON.stringify(shown)})`);
  assert.deepEqual(shown.filter((k) => !TEST_MAIN.includes(k) && !MODE_KEYS.includes(k)), [], 'nothing else is shown');
  const link = needMoreLink(page);
  assert.equal(isHidden(page, link), false, 'the link is shown');
  assert.equal(textOf(link), 'Show more options');
  assert.equal(link.getAttribute('aria-expanded'), 'false');
});

test('#431 the options are drawn under group labels (wf-group-label), Unit tests, E2E tests and Screenshots under the same one', async () => {
  const page = await openPo();
  const labels = (box(page)?.querySelectorAll('[data-testid="wf-group-label"]') || []).filter((l) => !isHidden(page, l));
  assert.equal(labels.length > 0, true, 'group labels are shown');
  assert.equal(labels.every((l) => textOf(l).length > 0), true, 'each label has a text');
  // the last group label before an element, in document order inside the options box
  const groupBefore = (el) => {
    let last = null;
    const walk = (n) => {
      if (n === el) return true;
      if (n.getAttribute?.('data-testid') === 'wf-group-label') last = textOf(n);
      for (const c of n.childNodes || []) if (walk(c)) return true;
      return false;
    };
    walk(box(page));
    return last;
  };
  const groups = TEST_MAIN.map((k) => groupBefore(field(page, k)));
  assert.equal(groups[0] === null, false, 'Unit tests is under a group label');
  assert.deepEqual(groups, [groups[0], groups[0], groups[0]], `the same group: ${JSON.stringify(groups)}`);
});

test('#431 "Show more options" opens the rest and then reads "Show fewer options"; clicked again it closes them', async () => {
  const page = await openPo();
  needMoreLink(page).click();
  await settle();
  for (const k of EXTRA) assert.equal(isHidden(page, field(page, k)), false, `${k} is shown`);
  assert.equal(textOf(moreLink(page)), 'Show fewer options');
  assert.equal(moreLink(page).getAttribute('aria-expanded'), 'true');
  moreLink(page).click();
  await settle();
  for (const k of EXTRA) assert.equal(isHidden(page, field(page, k)), true, `${k} is hidden again`);
  assert.equal(textOf(moreLink(page)), 'Show more options');
});

test('#431 "Show more options" left open is remembered per viewer', async () => {
  const page = await openPo();
  needMoreLink(page).click();
  await settle();
  const again = await reopenAsSameViewer(page);
  const link = moreLink(again);
  assert.equal(link === null, false, 'the link');
  assert.equal(textOf(link), 'Show fewer options');
  for (const k of EXTRA) assert.equal(isHidden(again, field(again, k)), false, `${k} is shown`);
});

test('#431 a question sent while minimized, with the extra options closed, carries every option\'s value', async () => {
  const page = await openPo();
  needToggle(page);
  page.sandbox.WorkflowInputs.set(box(page), 'unit_tests', 'run_existing');
  page.sandbox.WorkflowInputs.set(box(page), 'developer_effort', 'high');
  page.sandbox.WorkflowInputs.set(box(page), 'check_command', 'npm run lint');
  needMoreLink(page);
  assert.equal(isHidden(page, field(page, 'developer_effort')), true, 'developer_effort sits behind "Show more options"');
  toggle(page).click();
  await settle();
  assert.equal(toggle(page).getAttribute('aria-expanded'), 'false');
  const input = page.$('#po-drawer [data-testid="agent-chat-input"]');
  page.dom.type(input, 'Plan the login issues');
  page.$('#po-drawer [data-testid="agent-chat-send"]').click();
  await settle();
  const asks = page.callsTo('askProductOwner');
  assert.equal(asks.length, 1, 'the question was sent');
  assert.equal(asks[0][9], 'feature.yaml');
  const sent = asks[0][10] || {};
  const pick = (keys) => Object.fromEntries(keys.map((k) => [k, sent[k]]));
  assert.deepEqual(pick(['mode', 'validation', 'unit_tests', 'e2e_tests', 'screenshots', 'developer_model', 'developer_effort', 'check_command', 'suite_red_outside_change', 'validate_every_round']), {
    mode: 'local', validation: 'auto', unit_tests: 'run_existing', e2e_tests: 'write_and_run', screenshots: 'all',
    developer_model: 'claude-opus-5-5', developer_effort: 'high', check_command: 'npm run lint', suite_red_outside_change: 'ask', validate_every_round: false,
  });
});
