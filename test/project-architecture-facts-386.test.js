// #386 acceptance: the Architecture tab's Facts view for a human reader
// (src/renderer/views/project/project-architecture.js with src/shared/architecture-facts-view.js) in
// a mini DOM, loaded as test/project-architecture-action-381.test.js loads it: a lead row (the
// report's verdict, the top 3 risks with their score, the Danger Zone count, the languages bar),
// findings ranked by a 0-100 score with one line each and "Read more" for the evidence, filters by
// severity and new / kept with their counts, "Send all to Refactor", the languages legend with one
// decimal, the exclusions and the complexity note as one line each, the quality gate as one row of
// chips, and the caveats behind an ⓘ. Real scale: 1,200 files, 32 findings, 8 languages.
// The shared module is loaded when it exists, so this file loads today and each test fails alone.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('./i18n-sandbox');
const { createDom } = require('./mini-dom');

const ROOT = path.join(__dirname, '..');
const RENDERER = path.join(ROOT, 'src', 'renderer');
const FACTS_VIEW = path.join(ROOT, 'src', 'shared', 'architecture-facts-view.js');
const loadView = () => require('../src/shared/architecture-facts-view.js');
const hash = '22'.repeat(20);

// ---------- fixtures: the service's answers (architecture:facts, architecture:report) ----------

const DZ = [
  { file: 'src/billing.js', score: 1.38 }, { file: 'src/rates.js', score: 1.2 }, { file: 'src/export.js', score: 1.0 },
  { file: 'src/engine/run.js', score: 0.9 }, { file: 'src/engine/queue.js', score: 0.8 }, { file: 'src/ui/app.js', score: 0.7 }, { file: 'src/ui/menu.js', score: 0.6 },
];
const LANGUAGES = [
  { language: 'JavaScript', lines: 7430, files: 40 }, { language: 'Rust', lines: 1990, files: 6 }, { language: 'CSS', lines: 550, files: 3 }, { language: 'Brainfuck', lines: 30, files: 1 },
];

function makeModel({ fileCount = 20, dz = DZ, languages = LANGUAGES } = {}) {
  const inZone = new Map(dz.map((d) => [d.file, d.score]));
  const names = [...dz.map((d) => d.file), 'src/report.js', 'docs/notes.md'];
  for (let i = 0; names.length < fileCount; i++) names.push(`src/mod/m${i}.js`);
  const files = names.slice(0, fileCount).map((file, i) => ({
    file, lines: 1000 - (i % 900), language: file.endsWith('.md') ? 'Markdown' : 'JavaScript', commits: 50 - (i % 45), last_change: '2026-10-01T00:00:00Z',
    hotspot: (1000 - (i % 900)) * (50 - (i % 45)), rank: i + 1, co_change: null, complexity: 10 + (i % 7), worst: 3, functions: 4,
    quadrant: inZone.has(file) ? 'Danger Zone' : 'Healthy Closure', score: inZone.get(file) ?? 0.2,
  }));
  return {
    branch: 'main', commits: 120, head: { commit: hash, date: '2026-10-10T12:00:00Z' }, window: { since: null, until: null }, shallow: false,
    include_mass: true, mass_changes: [], pairs: [], frames: [],
    complexity: { status: 'measured', tool: 'code-health', metric: 'cyclomatic', functions: 400, check: null, unmeasured: ['Rust'], needed: ['lizard'], reason: null, install: 'pip install lizard' },
    danger_zone: dz, excluded: { build: 0, generated: 0, lock: 2, project: 0, tests: 688, vendored: 0 }, files, languages,
  };
}

// as src/architecture-facts.js qualityGate builds it
const GATE = [
  { name: 'complexity', state: 'pending', source: 'node scripts/code-health.js --check', value: null },
  { name: 'coverage', state: 'measured', source: 'package.json', value: '81.2% of lines' },
  { name: 'duplication', state: 'missing', source: null, value: null },
];

const SUMMARY = 'The engine is sound but billing concentrates the risk. Two files change together on every release. The rate tables have no tests.';
// index, severity, target, status, sent (the per-finding evidence's second sentence and the refactor are unique)
const FINDINGS = [
  ['low', 'src/billing.js', 'kept', false, 'Billing constants have no names'],
  ['high', 'src/report.js', 'new', false, 'Report builder duplicates the rate rule'],
  ['medium', 'src/export.js', 'new', false, 'Export reaches into billing internals'],
  ['high', 'src/rates.js', 'kept', true, 'Rates and discounts live in one unit'],
  ['medium', 'docs/notes.md', 'new', false, 'Notes repeat the rate table'],
].map(([severity, file, status, sent, title], i) => ({
  kind: 'duplicated-rule', title, severity, status, sent, files: [{ path: file, lines: '10-40' }],
  evidence: `The file changed in most commits of the window. Evidence detail ${i} names the copy in its second block.`,
  refactor: `Refactor plan ${i}: keep the rule in one module.`,
}));
const GONE = [{ kind: 'other', title: 'An old queue lock', severity: 'high', status: 'gone', files: [{ path: 'src/old.js' }], evidence: 'Gone.', refactor: 'None.' }];

function reportView(findings, sentSet) {
  return {
    report: {
      id: 'r1', date: '2026-10-10T13:00:00Z', head: { commit: hash }, simulated: true,
      report: { summary: SUMMARY, areas: [{ area: 'Engine', verdict: 'Stable core with small units.' }, { area: 'Billing', verdict: 'Too much in one file.' }], findings: findings.map(({ status, sent, ...f }) => f) },
    },
    previousId: 'r0', gone: GONE, runsSince: 0,
    findings: findings.map((f, i) => ({ ...f, sent: f.sent || sentSet.has(i) })),
  };
}

// ---------- the harness of test/project-architecture-action-381.test.js ----------

// failSendAt: the call number (0-based) of sendFindingToRefactor that rejects; noReport: never analysed
function loadWindow({ model = makeModel(), findings = FINDINGS, gate = GATE, reports = [], failSendAt = -1, noReport = false } = {}) {
  const calls = { send: [], report: [] };
  const toasts = [];
  const sentSet = new Set();
  const api = {
    architectureFacts: async () => ({ state: 'ok', model: JSON.parse(JSON.stringify(model)), exclude: [], gate: JSON.parse(JSON.stringify(gate)) }),
    architectureReport: async (projectId, opts) => {
      calls.report.push(opts?.reportId ?? null);
      return noReport ? { report: null, findings: [], gone: [], runsSince: 0 } : JSON.parse(JSON.stringify(reportView(findings, sentSet)));
    },
    listArchitectureReports: async () => JSON.parse(JSON.stringify(reports)),
    architectureEstimate: async () => ({ estimate: null }),
    architectureCity: async () => ({ state: 'not-git', model: null, validation: null }),
    chainEstimate: async () => null,
    startRun: async () => ({ runId: 'run-1' }),
    sendFindingToRefactor: async (projectId, reportId, index) => {
      calls.send.push({ projectId, reportId, index });
      if (calls.send.length - 1 === failSendAt) throw new Error('the Refactor store is locked');
      sentSet.add(index);
      return { proposal: { title: findings[index]?.title || 'x' } };
    },
    onEvent: () => () => {},
  };
  const sandbox = {
    console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: () => {} }, sessionStorage: { getItem: () => null, setItem: () => {} },
    api, state: { projects: [{ id: 'p1', name: 'fixture', folder: 'C:/fixture' }], simulationOnly: true },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), fmtNum: (n) => String(n), fmtUsd: (n) => `US$ ${n}`, showToast: (m) => { toasts.push(String(m)); },
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => null;
  withI18n(sandbox);
  vm.createContext(sandbox);
  const shared = ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js'];
  if (fs.existsSync(FACTS_VIEW)) shared.push('architecture-facts-view.js'); // #386's module, once it exists
  for (const f of shared) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'src', 'shared', f), 'utf8'), sandbox, { filename: f });
  }
  vm.runInContext(fs.readFileSync(path.join(RENDERER, 'date-range.js'), 'utf8'), sandbox, { filename: 'date-range.js' });
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js', 'project-architecture.js']) {
    vm.runInContext(fs.readFileSync(path.join(RENDERER, 'views', 'project', f), 'utf8'), sandbox, { filename: f });
  }
  dom.document.addEventListener('click', (e) => sandbox.ProjectArchitecture.onClick(e));
  const box = dom.document.createElement('div');
  dom.document.body.appendChild(box);
  const click = (el) => el.dispatchEvent(new dom.classes.MouseEvent('click', { bubbles: true, cancelable: true }));
  return { PA: sandbox.ProjectArchitecture, box, calls, toasts, click };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };
const q = (root, id) => root.querySelector(`[data-testid="${id}"]`);
const qa = (root, id) => Array.from(root.querySelectorAll(`[data-testid="${id}"]`));
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const text = (el) => norm(el?.textContent);

// hidden: the `hidden` attribute or class, or the body of a closed <details>
const isHidden = (el) => el.hasAttribute('hidden') || String(el.getAttribute('class') || '').split(/\s+/).includes('hidden');
function shown(el, root) {
  if (!el) return false;
  for (let cur = el; cur && cur !== root && cur.nodeType === 1; cur = cur.parentNode) {
    if (isHidden(cur)) return false;
    const parent = cur.parentNode;
    if (parent && parent.nodeType === 1 && parent.localName === 'details' && !parent.hasAttribute('open') && cur.localName !== 'summary') return false;
  }
  return true;
}
// the text a reader sees: no hidden element, no closed <details> beyond its summary
function visibleText(el) {
  const walk = (n) => {
    if (n.nodeType === 3) return n.data;
    if (n.nodeType !== 1) return '';
    if (isHidden(n) || ['script', 'style', 'template'].includes(n.localName)) return '';
    const kids = n.localName === 'details' && !n.hasAttribute('open') ? n.childNodes.filter((c) => c.nodeType === 1 && c.localName === 'summary') : n.childNodes;
    return kids.map(walk).join(' ');
  };
  return el ? norm(walk(el)) : '';
}
const shownFindings = (box) => qa(box, 'architecture-finding').filter((el) => shown(el, box));
const findingOf = (box, file) => qa(box, 'architecture-finding').find((el) => text(el).includes(file));
const scoreOf = (el) => Number((text(q(el, 'architecture-finding-score')).match(/\d+/) || [])[0]);

async function open(opts) {
  const w = loadWindow(opts);
  w.PA.show('p1', w.box);
  await settle();
  return w;
}

// ---------- the lead row ----------

test('#386 the lead row: the verdict in one line, the top 3 risks with their scores highest first, the Danger Zone count, the languages bar', async () => {
  const { findingScore } = loadView();
  const w = await open();
  const overview = q(w.box, 'architecture-overview');
  assert.ok(overview, 'the lead row is there');
  const verdict = text(q(overview, 'architecture-verdict'));
  assert.ok(verdict.length > 0 && verdict.length <= 200, `one line: "${verdict}"`);
  const cards = qa(overview, 'architecture-risk-card');
  assert.equal(cards.length, 3, 'the top 3 risks');
  const shownScores = cards.map((c) => Number((text(q(c, 'architecture-risk-score')).match(/\d+/) || [])[0]));
  const expected = FINDINGS.map((f) => findingScore(f, DZ)).sort((a, b) => b - a).slice(0, 3);
  assert.deepEqual(shownScores, expected, 'the three highest scores, highest first');
  assert.match(text(q(overview, 'architecture-danger-count')), new RegExp(`\\b${DZ.length}\\b`), 'the Danger Zone holds 7 files');
  const bar = q(overview, 'architecture-languages-bar');
  assert.ok(bar, 'the languages bar');
  assert.equal(qa(bar, 'architecture-language-segment').length, 4, 'JavaScript, Rust, CSS and Other');
});

test('#386 the lead row shows fewer risk cards when the report has fewer findings', async () => {
  const w = await open({ findings: FINDINGS.slice(0, 2) });
  assert.equal(qa(w.box, 'architecture-risk-card').length, 2);
});

// ---------- findings ----------

test('#386 each finding is one line: its target, its 0-100 score (formula in the tooltip), one sentence; sorted by score', async () => {
  const { findingScore } = loadView();
  const w = await open();
  const rows = qa(w.box, 'architecture-finding');
  assert.equal(rows.length, 5);
  const order = rows.map((el) => FINDINGS.findIndex((f) => text(el).includes(f.files[0].path)));
  assert.ok(order.every((i) => i >= 0), 'each finding shows its target');
  const scores = rows.map(scoreOf);
  assert.deepEqual(scores, order.map((i) => findingScore(FINDINGS[i], DZ)), 'the score shown is findingScore');
  for (let i = 1; i < scores.length; i++) assert.ok(scores[i - 1] >= scores[i], `sorted by score: ${scores.join(', ')}`);
  for (const el of rows) {
    const s = q(el, 'architecture-finding-score');
    assert.match(String(s.getAttribute('title') || ''), /Danger Zone/i, 'the formula in a tooltip');
    assert.match(String(s.getAttribute('title') || ''), /severity/i);
    const summary = text(q(el, 'architecture-finding-summary'));
    assert.ok(summary.length > 0, 'a summary');
    assert.ok((summary.match(/[.!?](\s|$)/g) || []).length <= 1, `one sentence: "${summary}"`);
  }
  assert.match(visibleText(findingOf(w.box, 'src/report.js')), /\bnew\b/i, 'new stays a badge');
  assert.match(visibleText(findingOf(w.box, 'src/billing.js')), /\bkept\b/i, 'kept stays a badge');
});

test('#386 a finding\'s evidence and refactor are hidden until "Read more"', async () => {
  const w = await open();
  const row = findingOf(w.box, 'src/export.js');
  const before = visibleText(row);
  assert.equal(before.includes('Evidence detail 2'), false, `the evidence is not shown: ${before}`);
  assert.equal(before.includes('Refactor plan 2'), false, 'the refactor is not shown');
  assert.equal(shown(q(row, 'architecture-finding-details'), row), false, 'the details are absent or hidden');
  const more = q(row, 'architecture-finding-more');
  assert.match(text(more), /Read more/i);
  w.click(more);
  await settle();
  const after = findingOf(w.box, 'src/export.js');
  const details = q(after, 'architecture-finding-details');
  assert.ok(shown(details, w.box), 'the details are shown');
  assert.ok(visibleText(details).includes('Evidence detail 2'), 'the evidence');
  assert.ok(visibleText(details).includes('Refactor plan 2'), 'the suggested refactor');
  assert.equal(visibleText(findingOf(w.box, 'src/report.js')).includes('Evidence detail 1'), false, 'only that finding opens');
});

test('#386 filters by severity and by new / kept carry their counts', async () => {
  const w = await open();
  const counts = { high: 2, medium: 2, low: 1, new: 3, kept: 2 };
  for (const [key, n] of Object.entries(counts)) {
    const b = q(w.box, `architecture-filter-${key}`);
    assert.ok(b, `the ${key} filter`);
    assert.match(text(b), new RegExp(`\\b${n}\\b`), `${key}: ${text(b)}`);
  }
});

test('#386 a filter shows only its findings', async () => {
  const targets = (box) => shownFindings(box).map((el) => FINDINGS.find((f) => text(el).includes(f.files[0].path))?.files[0].path).sort();
  let w = await open();
  w.click(q(w.box, 'architecture-filter-high'));
  await settle();
  assert.deepEqual(targets(w.box), ['src/rates.js', 'src/report.js']);
  w = await open();
  w.click(q(w.box, 'architecture-filter-kept'));
  await settle();
  assert.deepEqual(targets(w.box), ['src/billing.js', 'src/rates.js']);
  w = await open();
  w.click(q(w.box, 'architecture-filter-new'));
  await settle();
  assert.deepEqual(targets(w.box), ['docs/notes.md', 'src/export.js', 'src/report.js']);
});

test('#386 the report summary leads, the verdict per area as compact chips, not a list', async () => {
  const w = await open();
  const report = q(w.box, 'architecture-report');
  assert.ok(visibleText(report).includes('Engine') && visibleText(report).includes('Stable core with small units.'));
  const items = Array.from(report.querySelectorAll('li')).map(text);
  assert.equal(items.some((s) => s.includes('Stable core with small units.')), false, `no area verdict in a list item: ${JSON.stringify(items)}`);
});

// ---------- Send all to Refactor ----------

test('#386 "Send all to Refactor" sends the findings not sent yet, says how many, then sends none again', async () => {
  const w = await open();
  const all = q(w.box, 'architecture-send-all');
  assert.match(text(all), /Send all to Refactor/);
  assert.ok(qa(w.box, 'architecture-send-refactor').length >= 4, 'the per-finding control stays');
  w.click(all);
  await settle();
  await settle();
  assert.deepEqual(w.calls.send.map((c) => c.index).sort(), [0, 1, 2, 4], 'the four unsent findings, by their index in the report; not the sent one, not the gone one');
  assert.ok(w.calls.send.every((c) => c.projectId === 'p1' && c.reportId === 'r1'));
  assert.ok(w.toasts.some((t) => /\b4\b/.test(t) && /finding/i.test(t)), `a toast says 4 went: ${JSON.stringify(w.toasts)}`);
  const toastsBefore = w.toasts.length;
  const again = q(w.box, 'architecture-send-all');
  w.click(again);
  await settle();
  await settle();
  assert.equal(w.calls.send.length, 4, 'nothing is sent twice');
  // a disabled button (nothing left to send) says none by itself; an enabled one says it in a toast
  const last = again.disabled ? `${text(again)} ${again.getAttribute('title') || ''}` : w.toasts.slice(toastsBefore).join(' | ');
  if (!again.disabled) assert.match(last, /\b0\b|\bno\b|none|nothing|already/i, `the second click says none went: ${last}`);
});

test('#386 "Send all" with a filter sends the filtered findings only', async () => {
  const w = await open();
  w.click(q(w.box, 'architecture-filter-high'));
  await settle();
  w.click(q(w.box, 'architecture-send-all'));
  await settle();
  await settle();
  assert.deepEqual(w.calls.send.map((c) => c.index), [1], 'the one high finding not sent yet');
  assert.ok(w.toasts.some((t) => /\b1\b/.test(t) && /finding/i.test(t)), JSON.stringify(w.toasts));
});

test('#386 "Send all" stops at the first failed send: the toast counts what went, the error shows, the sent ones keep their mark', async () => {
  const w = await open({ failSendAt: 2 });
  w.click(q(w.box, 'architecture-send-all'));
  await settle();
  await settle();
  assert.equal(w.calls.send.length, 3, 'two sends, then the failed one, then nothing more');
  assert.ok(w.toasts.some((t) => /\b2\b/.test(t) && /finding/i.test(t)), `a toast says 2 went: ${JSON.stringify(w.toasts)}`);
  assert.ok(visibleText(w.box).includes('the Refactor store is locked'), 'the error is shown');
  const marks = qa(w.box, 'architecture-send-refactor').filter((el) => text(el) === 'Sent to Refactor').length;
  assert.equal(marks, 3, 'the one sent before and the two sent now');
  assert.ok(!q(w.box, 'architecture-send-all').disabled, 'two findings are left to send');
});

test('#386 clicking an active filter turns it off, "All" clears both filters', async () => {
  const count = (box) => shownFindings(box).length;
  const w = await open();
  w.click(q(w.box, 'architecture-filter-high'));
  await settle();
  assert.equal(count(w.box), 2);
  w.click(q(w.box, 'architecture-filter-high'));
  await settle();
  assert.equal(count(w.box), 5, 'the high filter is off again');
  w.click(q(w.box, 'architecture-filter-high'));
  await settle();
  w.click(q(w.box, 'architecture-filter-kept'));
  await settle();
  assert.equal(count(w.box), 1, 'high and kept: src/rates.js only');
  assert.ok(text(shownFindings(w.box)[0]).includes('src/rates.js'));
  const all = q(w.box, 'architecture-filter-all');
  assert.ok(all, 'the All button');
  w.click(all);
  await settle();
  assert.equal(count(w.box), 5, 'both filters cleared');
  assert.equal(q(w.box, 'architecture-filter-all').getAttribute('aria-pressed'), 'true');
  assert.equal(q(w.box, 'architecture-filter-high').getAttribute('aria-pressed'), 'false');
  assert.equal(q(w.box, 'architecture-filter-kept').getAttribute('aria-pressed'), 'false');
});

test('#386 another report from the picker closes every open "Read more" and keeps the filter', async () => {
  const reports = [{ id: 'r1', date: '2026-10-10T13:00:00Z', findings: 5, simulated: true }, { id: 'r0', date: '2026-10-01T13:00:00Z', findings: 4, simulated: true }];
  const w = await open({ reports });
  w.click(q(findingOf(w.box, 'src/report.js'), 'architecture-finding-more'));
  await settle();
  w.click(q(w.box, 'architecture-filter-high'));
  await settle();
  assert.ok(shown(q(findingOf(w.box, 'src/report.js'), 'architecture-finding-details'), w.box), 'opened before the switch');
  const picker = q(w.box, 'architecture-report-picker');
  assert.ok(picker, 'the report picker');
  picker.value = 'r0';
  assert.equal(w.PA.onChange({ target: picker }), true);
  await settle();
  assert.equal(w.calls.report.at(-1), 'r0', 'the picked report is read');
  assert.equal(shownFindings(w.box).length, 2, 'the high filter stays');
  const row = findingOf(w.box, 'src/report.js');
  assert.equal(shown(q(row, 'architecture-finding-details'), row), false, 'the details are closed');
});

test('#386 a finding with no files shows its kind as target and scores from its severity alone', async () => {
  const { findingScore } = loadView();
  const findings = [{ kind: 'missing-tests', title: 'Rate tables have no tests', severity: 'high', status: 'new', sent: false, files: [], evidence: 'No test file.', refactor: 'Add tests.' }];
  const w = await open({ findings });
  const rows = qa(w.box, 'architecture-finding');
  assert.equal(rows.length, 1);
  assert.ok(text(rows[0]).includes('missing-tests'), `the kind as target: ${text(rows[0])}`);
  assert.equal(scoreOf(rows[0]), findingScore({ severity: 'high', files: [] }, []), 'the score of its severity alone');
});

test('#386 the lead row before any report and without complexity: no risk card, a verdict placeholder, "—" for the Danger Zone', async () => {
  const model = makeModel();
  model.complexity = { status: 'missing', reason: 'lizard is not installed', install: 'pip install lizard', unmeasured: [], needed: ['lizard'] };
  model.danger_zone = [];
  const w = await open({ model, noReport: true });
  const overview = q(w.box, 'architecture-overview');
  assert.ok(overview, 'the lead row is there');
  assert.ok(text(q(overview, 'architecture-verdict')).length > 0, 'a placeholder verdict');
  assert.equal(qa(overview, 'architecture-risk-card').length, 0);
  assert.ok(text(q(overview, 'architecture-danger-count')).includes('—'), text(q(overview, 'architecture-danger-count')));
  assert.equal(/\b0\b/.test(text(q(overview, 'architecture-danger-count'))), false, 'never 0 when not measured');
  assert.ok(q(overview, 'architecture-languages-bar'), 'the languages come from git, with no report');
});

// ---------- languages, exclusions, complexity ----------

test('#386 the languages legend: one entry per language with its share to one decimal, the exact line count in the tooltip', async () => {
  const w = await open();
  const legend = q(w.box, 'architecture-language-legend');
  assert.ok(legend, 'the legend');
  const entries = qa(legend, 'architecture-language-entry');
  assert.deepEqual(entries.map(text), ['JavaScript 74.3%', 'Rust 19.9%', 'CSS 5.5%', 'Other 0.3%']);
  assert.match(String(entries[0].getAttribute('title') || ''), /7,?430/, 'JavaScript\'s lines in its tooltip');
  assert.match(String(entries[3].getAttribute('title') || ''), /\b30\b/, 'Other\'s lines in its tooltip');
  const seg = qa(w.box, 'architecture-language-segment')[0];
  assert.match(`${seg.getAttribute('style') || ''} ${seg.getAttribute('title') || ''}`, /f1e05a/i, 'JavaScript\'s Linguist colour');
  const badges = Array.from(w.box.querySelectorAll('.badge')).map(text);
  assert.equal(badges.includes('JavaScript 7430'), false, 'no language chip with its line count');
});

test('#386 the exclusions are one muted line, "Excluded: lock files 2 · tests 688", with "Exclude more paths"', async () => {
  const w = await open();
  assert.ok(visibleText(w.box).includes('Excluded: lock files 2 · tests 688'), visibleText(w.box).slice(0, 2000));
  const edit = q(w.box, 'architecture-exclude-edit');
  assert.match(text(edit), /Exclude more paths/);
  const line = edit.parentElement;
  assert.ok(text(line).includes('Excluded: lock files 2 · tests 688'), `the link sits on the line: ${text(line)}`);
  assert.ok(line.closest('.muted'), 'a muted line');
  assert.equal(line.querySelectorAll('.badge').length, 0, 'no chips');
});

test('#386 the complexity note is one short line naming what is measured and what is not', async () => {
  const w = await open();
  const all = visibleText(w.box);
  const at = all.indexOf('Complexity: measured for JavaScript');
  assert.ok(at >= 0, 'the line is there');
  assert.ok(all.slice(at, at + 120).includes('not measured for Rust'), all.slice(at, at + 160));
});

// ---------- the quality gate ----------

test('#386 the quality gate is one row of three chips, ✓ with its value when measured, the command or file in the tooltip', async () => {
  const w = await open();
  const gate = q(w.box, 'architecture-gate');
  assert.ok(gate, 'the gate');
  assert.equal(gate.querySelectorAll('li').length, 0, 'no bullet list');
  const chips = qa(gate, 'architecture-gate-chip');
  assert.equal(chips.length, 3);
  const [complexity, coverage, duplication] = chips;
  assert.match(text(complexity), /complexity/i);
  assert.match(text(coverage), /coverage/i);
  assert.match(text(duplication), /duplication/i);
  assert.ok(text(coverage).includes('✓') && text(coverage).includes('81.2%'), text(coverage));
  assert.equal(text(complexity).includes('✓'), false, 'pending');
  assert.equal(text(duplication).includes('✓'), false, 'missing');
  assert.ok(String(complexity.getAttribute('title') || '').includes('node scripts/code-health.js --check'));
  assert.ok(String(coverage.getAttribute('title') || '').includes('package.json'));
});

// ---------- the caveats ----------

test('#386 the caveats sit behind an ⓘ next to the facts\' title, not on the page until opened', async () => {
  const w = await open();
  assert.equal(visibleText(w.box).includes('Churn says nothing about bugs'), false, 'not printed on the page');
  const button = q(w.box, 'architecture-caveats');
  assert.ok(button, 'the ⓘ');
  assert.ok(`${text(button)} ${button.getAttribute('aria-label') || ''}`.includes('ⓘ'), text(button));
  w.click(button);
  await settle();
  const limits = q(w.box, 'architecture-limits');
  assert.ok(shown(limits, w.box), 'opened');
  assert.ok(visibleText(limits).includes('Churn says nothing about bugs'), visibleText(limits));
});

// ---------- real scale ----------

test('#386 real scale: 1,200 files, 32 findings, 8 languages render with the lead row, 3 risk cards and the hotspot table capped', async () => {
  const dz = Array.from({ length: 300 }, (_, i) => ({ file: `src/mod/m${i * 3}.js`, score: Math.round(Math.SQRT2 * (300 - i) / 300 * 1000) / 1000 }));
  const languages = ['JavaScript', 'TypeScript', 'Rust', 'Python', 'CSS', 'HTML', 'Shell', 'YAML'].map((language, i) => ({ language, lines: 20000 - i * 2400, files: 150 }));
  const sev = ['high', 'medium', 'low'];
  const findings = Array.from({ length: 32 }, (_, i) => ({
    kind: 'oversized-unit', title: `Finding number ${i} is too large`, severity: sev[i % 3], status: i % 4 ? 'kept' : 'new', sent: i % 5 === 0,
    files: [{ path: `src/mod/m${i * 7}.js` }], evidence: `The unit grew. Evidence detail ${i}.`, refactor: `Refactor plan ${i}.`,
  }));
  const started = Date.now();
  const w = await open({ model: makeModel({ fileCount: 1200, dz, languages }), findings });
  assert.ok(Date.now() - started < 5000, 'renders in seconds');
  assert.ok(q(w.box, 'architecture-overview'), 'the lead row');
  assert.equal(qa(w.box, 'architecture-risk-card').length, 3);
  assert.match(text(q(w.box, 'architecture-danger-count')), /\b300\b/);
  const segments = qa(w.box, 'architecture-language-segment').length;
  assert.ok(segments >= 1 && segments <= 8, `${segments} segments`);
  const n = (key) => Number((text(q(w.box, `architecture-filter-${key}`)).match(/\d+/) || [])[0]);
  assert.equal(n('high') + n('medium') + n('low'), 32, 'every finding counted once by severity');
  assert.equal(n('new') + n('kept'), 32, 'and once by new / kept');
  assert.ok(qa(w.box, 'architecture-finding').length >= 1);
  const rows = q(w.box, 'architecture-hotspots').querySelectorAll('tbody tr').length;
  assert.ok(rows > 0 && rows <= 41, `the hotspot table stays capped: ${rows} rows of 1,200 files`);
});
