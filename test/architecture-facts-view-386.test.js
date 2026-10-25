// #386 acceptance: the pure functions behind the Architecture tab's Facts view for a human reader
// (packages/shared/architecture-facts-view.js, UMD: module.exports in Node, window.ArchitectureFactsView
// in the browser): a finding's 0-100 danger score from its severity and its target's Danger Zone
// score (and the formula shown in a tooltip), the findings ranked, counted and filtered, the
// languages as GitHub shows them (Linguist colours, one decimal, "Other" under 0.5%), the one-line
// complexity note and the quality gate as one row of three chips. The module is loaded inside each
// test, so this file loads before the module exists and each test fails on its own.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('@multiagent/shared/architecture-facts-view.js');

// the Danger Zone of packages/shared/architecture-model.js: [{ file, score }], score = √(u² + v²) in 0..√2
const DZ = [
  { file: 'src/billing.js', score: 1.4142 },
  { file: 'src/rates.js', score: 1.2 },
  { file: 'src/export.js', score: 0.9 },
  { file: 'src/ui/menu.js', score: 0.5 },
  { file: 'src/ui/tiny.js', score: 0.3 },
];
const finding = (severity, ...paths) => ({ severity, files: paths.map((path) => ({ path })) });

// ---------- the score ----------

test('#386 findingScore is an integer from 0 to 100, the same for the same inputs', () => {
  const { findingScore } = load();
  for (const severity of ['high', 'medium', 'low']) {
    for (const path of ['src/billing.js', 'src/export.js', 'src/not-in-the-zone.js']) {
      const a = findingScore(finding(severity, path), DZ);
      assert.ok(Number.isInteger(a), `${severity} ${path}: ${a} is an integer`);
      assert.ok(a >= 0 && a <= 100, `${severity} ${path}: ${a} is in 0..100`);
      assert.equal(findingScore(finding(severity, path), DZ), a, 'deterministic');
      assert.equal(findingScore(finding(severity, path), [...DZ].reverse()), a, 'the Danger Zone\'s order does not matter');
    }
  }
});

test('#386 findingScore: for the same target, high > medium > low (in and out of the Danger Zone)', () => {
  const { findingScore } = load();
  for (const path of ['src/billing.js', 'src/export.js', 'src/not-in-the-zone.js']) {
    const [high, medium, low] = ['high', 'medium', 'low'].map((s) => findingScore(finding(s, path), DZ));
    assert.ok(high > medium, `${path}: high ${high} > medium ${medium}`);
    assert.ok(medium > low, `${path}: medium ${medium} > low ${low}`);
  }
});

test('#386 findingScore: for the same severity, a hotter Danger Zone target scores higher, one outside it scores lower than any inside', () => {
  const { findingScore } = load();
  for (const severity of ['high', 'medium', 'low']) {
    const scores = ['src/ui/tiny.js', 'src/ui/menu.js', 'src/export.js', 'src/rates.js', 'src/billing.js'].map((p) => findingScore(finding(severity, p), DZ));
    for (let i = 1; i < scores.length; i++) assert.ok(scores[i] >= scores[i - 1], `${severity}: ${JSON.stringify(scores)} never goes down as the Danger Zone score goes up`);
    assert.ok(scores[4] > scores[0], `${severity}: √2 scores above 0.3 (${JSON.stringify(scores)})`);
    const outside = findingScore(finding(severity, 'src/not-in-the-zone.js'), DZ);
    assert.ok(outside < scores[0], `${severity}: outside the zone ${outside} < the coolest file inside it ${scores[0]}`);
  }
});

test('#386 findingScore: the top of the scale (high, Danger Zone √2) stays within 100', () => {
  const { findingScore } = load();
  const top = findingScore(finding('high', 'src/billing.js'), [{ file: 'src/billing.js', score: Math.SQRT2 }]);
  assert.ok(top <= 100 && top > 0, `${top}`);
});

test('#386 findingScore: no files, no Danger Zone or no severity does not throw and gives a number from the severity alone', () => {
  const { findingScore } = load();
  const bare = (f, dz) => {
    const n = findingScore(f, dz);
    assert.ok(Number.isInteger(n) && n >= 0 && n <= 100, `${JSON.stringify(f)} → ${n}`);
    return n;
  };
  const high = bare({ severity: 'high' }, undefined);
  assert.equal(bare({ severity: 'high', files: [] }, []), high, 'no files and an empty zone: the severity alone');
  assert.equal(bare({ severity: 'high', files: [{ path: 'src/billing.js' }] }, null), high, 'no Danger Zone: the severity alone');
  assert.ok(bare({ severity: 'low' }, undefined) < high);
  bare({}, undefined);
});

test('#386 findingScore: a finding with several files is scored by its hottest file', () => {
  const { findingScore } = load();
  const alone = findingScore(finding('medium', 'src/rates.js'), DZ);
  assert.equal(findingScore(finding('medium', 'src/rates.js', 'src/not-in-the-zone.js'), DZ), alone, 'a second file outside the zone does not lower the score');
  assert.equal(findingScore(finding('medium', 'src/not-in-the-zone.js', 'src/rates.js'), DZ), alone, 'nor does its place in the list');
  assert.ok(findingScore(finding('medium', 'src/ui/tiny.js', 'src/billing.js'), DZ) >= findingScore(finding('medium', 'src/ui/tiny.js'), DZ));
});

test('#386 SCORE_FORMULA is the tooltip: a sentence naming the severity and the Danger Zone', () => {
  const { SCORE_FORMULA } = load();
  assert.equal(typeof SCORE_FORMULA, 'string');
  assert.ok(SCORE_FORMULA.trim().length > 0);
  assert.match(SCORE_FORMULA, /severity/i);
  assert.match(SCORE_FORMULA, /Danger Zone/i);
});

// ---------- ranking, counts, filters ----------

const FINDINGS = [
  { title: 'Billing constants have no names', severity: 'low', status: 'kept', files: [{ path: 'src/billing.js' }] },
  { title: 'Report builder duplicates the rate rule', severity: 'high', status: 'new', files: [{ path: 'src/report.js' }] },
  { title: 'Export reaches into billing internals', severity: 'medium', status: 'new', files: [{ path: 'src/export.js' }] },
  { title: 'Rates and discounts live in one unit', severity: 'high', status: 'kept', files: [{ path: 'src/rates.js' }] },
  { title: 'Notes repeat the rate table', severity: 'medium', status: 'new', files: [{ path: 'docs/notes.md' }] },
];

test('#386 rankFindings: copies with their score and their index in the input, highest score first, the input untouched', () => {
  const { rankFindings, findingScore } = load();
  const input = JSON.parse(JSON.stringify(FINDINGS));
  const before = JSON.stringify(input);
  const ranked = rankFindings(input, DZ);
  assert.equal(JSON.stringify(input), before, 'the input is not mutated');
  assert.equal(ranked.length, 5);
  assert.notEqual(ranked, input);
  for (const r of ranked) {
    assert.ok(Number.isInteger(r.index) && r.index >= 0 && r.index < 5, `index ${r.index}`);
    assert.equal(r.title, input[r.index].title, 'index points at the finding in the input');
    assert.equal(r.score, findingScore(input[r.index], DZ), 'score is findingScore');
    assert.ok(!input.includes(r), 'a copy, not the input object');
  }
  assert.deepEqual(ranked.map((r) => r.index).sort(), [0, 1, 2, 3, 4], 'every finding once');
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score, `sorted by score: ${ranked.map((r) => r.score).join(', ')}`);
  // same severity: the one in the Danger Zone (src/rates.js) comes before the one out of it (src/report.js)
  const at = (title) => ranked.findIndex((r) => r.title === title);
  assert.ok(at('Rates and discounts live in one unit') < at('Report builder duplicates the rate rule'));
  assert.deepEqual(rankFindings([], DZ), []);
});

test('#386 findingCounts: per severity and per new / kept, zeros included', () => {
  const { rankFindings, findingCounts } = load();
  const counts = findingCounts(rankFindings(FINDINGS, DZ));
  assert.deepEqual([counts.severity.high, counts.severity.medium, counts.severity.low], [2, 2, 1]);
  assert.deepEqual([counts.status.new, counts.status.kept], [3, 2]);
  const none = findingCounts([]);
  assert.deepEqual([none.severity.high, none.severity.medium, none.severity.low, none.status.new, none.status.kept], [0, 0, 0, 0, 0]);
  const onlyLow = findingCounts(rankFindings([FINDINGS[0]], DZ));
  assert.deepEqual([onlyLow.severity.high, onlyLow.severity.medium, onlyLow.severity.low, onlyLow.status.new, onlyLow.status.kept], [0, 0, 1, 0, 1]);
});

test('#386 filterFindings: by severity, by new / kept, both, or none (all)', () => {
  const { rankFindings, filterFindings } = load();
  const ranked = rankFindings(FINDINGS, DZ);
  const titles = (list) => list.map((f) => f.title).sort();
  assert.deepEqual(titles(filterFindings(ranked, { severity: 'high' })), ['Rates and discounts live in one unit', 'Report builder duplicates the rate rule']);
  assert.deepEqual(titles(filterFindings(ranked, { status: 'kept' })), ['Billing constants have no names', 'Rates and discounts live in one unit']);
  assert.deepEqual(titles(filterFindings(ranked, { severity: 'medium', status: 'new' })), ['Export reaches into billing internals', 'Notes repeat the rate table']);
  assert.deepEqual(titles(filterFindings(ranked, { severity: 'low', status: 'new' })), []);
  for (const all of [{}, { severity: null, status: null }, { severity: undefined }, undefined, null]) {
    assert.equal(filterFindings(ranked, all).length, 5, `${JSON.stringify(all)} keeps them all`);
  }
  const high = filterFindings(ranked, { severity: 'high' });
  for (let i = 1; i < high.length; i++) assert.ok(high[i - 1].score >= high[i].score, 'the rank order is kept');
});

// ---------- languages ----------

const LINGUIST = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Rust: '#dea584', Python: '#3572a5', CSS: '#563d7c', HTML: '#e34c26', Shell: '#89e051',
  Go: '#00add8', Java: '#b07219', 'C#': '#178600', Markdown: '#083fa1', YAML: '#cb171e', JSON: '#292929',
};

test('#386 languageColor: GitHub\'s Linguist colours', () => {
  const { languageColor } = load();
  for (const [name, color] of Object.entries(LINGUIST)) {
    assert.equal(String(languageColor(name)).toLowerCase(), color, name);
  }
});

test('#386 languageColor: every unknown language gets the same neutral colour, unlike any listed one', () => {
  const { languageColor } = load();
  const neutral = String(languageColor('NoSuchLanguage')).toLowerCase();
  assert.match(neutral, /^#[0-9a-f]{3}([0-9a-f]{3})?$/, 'a hex colour');
  assert.equal(String(languageColor('Klingon Script')).toLowerCase(), neutral);
  assert.equal(String(languageColor('')).toLowerCase(), neutral);
  assert.equal(Object.values(LINGUIST).includes(neutral), false, `${neutral} is none of the listed colours`);
});

test('#386 languageShares: one decimal of the counted lines, largest first, with its colour (743 / 257 → 74.3 / 25.7)', () => {
  const { languageShares } = load();
  const input = [{ language: 'CSS', lines: 257 }, { language: 'JavaScript', lines: 743 }];
  const before = JSON.stringify(input);
  const shares = languageShares(input);
  assert.equal(JSON.stringify(input), before, 'the input is not mutated');
  assert.deepEqual(shares.map((s) => [s.language, s.lines, s.percent, String(s.color).toLowerCase()]), [
    ['JavaScript', 743, 74.3, '#f1e05a'],
    ['CSS', 257, 25.7, '#563d7c'],
  ]);
  assert.deepEqual(languageShares([{ language: 'JavaScript', lines: 2 }, { language: 'Rust', lines: 1 }]).map((s) => s.percent), [66.7, 33.3]);
  assert.deepEqual(languageShares([{ language: 'Go', lines: 1990 }, { language: 'JavaScript', lines: 7430 }, { language: 'CSS', lines: 580 }]).map((s) => `${s.language} ${s.percent}`),
    ['JavaScript 74.3', 'Go 19.9', 'CSS 5.8']);
});

test('#386 languageShares: languages under 0.5% are one "Other" entry, last', () => {
  const { languageShares } = load();
  const shares = languageShares([
    { language: 'Brainfuck', lines: 20 }, { language: 'JavaScript', lines: 9900 }, { language: 'Klingon Script', lines: 10 }, { language: 'Rust', lines: 70 },
  ]);
  assert.deepEqual(shares.map((s) => [s.language, s.lines, s.percent]), [
    ['JavaScript', 9900, 99],
    ['Rust', 70, 0.7],
    ['Other', 30, 0.3],
  ]);
  assert.match(String(shares[2].color), /^#[0-9a-fA-F]{3,6}$/, 'Other has a colour too');
  assert.equal(shares.filter((s) => s.language === 'Other').length, 1);
});

test('#386 languageShares: no language or no line gives an empty list, never NaN', () => {
  const { languageShares } = load();
  assert.deepEqual(languageShares([]), []);
  assert.deepEqual(languageShares([{ language: 'JavaScript', lines: 0 }, { language: 'CSS', lines: 0 }]), []);
});

// ---------- the complexity line ----------

const LANGS = [
  { language: 'JavaScript', lines: 5000 }, { language: 'Rust', lines: 3000 }, { language: 'Go', lines: 500 }, { language: 'Python', lines: 300 }, { language: 'Java', lines: 100 },
];

test('#386 complexityLine: "Complexity: measured for JavaScript; not measured for Rust and 3 more", one short line', () => {
  const { complexityLine } = load();
  const line = complexityLine({ status: 'measured', tool: 'code-health', metric: 'cyclomatic', unmeasured: ['Rust', 'Go', 'Python', 'Java'], needed: ['lizard'], install: 'pip install lizard', reason: null }, LANGS);
  assert.equal(typeof line, 'string');
  assert.ok(line.startsWith('Complexity:'), line);
  assert.ok(line.includes('measured for JavaScript'), line);
  assert.ok(line.includes('not measured for Rust and 3 more'), line);
  assert.equal(/\n/.test(line), false, 'one line');
  assert.ok(line.length < 120, `${line.length} characters: ${line}`);
});

test('#386 complexityLine: one language not measured is named, no "more"; none not measured says so neither', () => {
  const { complexityLine } = load();
  const langs = [{ language: 'JavaScript', lines: 5000 }, { language: 'Rust', lines: 3000 }];
  const one = complexityLine({ status: 'measured', tool: 'code-health', metric: 'cyclomatic', unmeasured: ['Rust'], needed: ['lizard'], install: null, reason: null }, langs);
  assert.ok(one.startsWith('Complexity:'), one);
  assert.ok(one.includes('measured for JavaScript'), one);
  assert.ok(one.includes('not measured for Rust'), one);
  assert.equal(/more/.test(one), false, one);
  const all = complexityLine({ status: 'measured', tool: 'code-health', metric: 'cyclomatic', unmeasured: [], needed: [], install: null, reason: null }, [{ language: 'JavaScript', lines: 10 }]);
  assert.ok(all.startsWith('Complexity:') && all.includes('measured for JavaScript'), all);
  assert.equal(all.includes('not measured'), false, all);
});

test('#386 complexityLine: nothing measured (no tool, or its check failed) is still one short "Complexity:" line', () => {
  const { complexityLine } = load();
  for (const status of ['missing', 'not-measured', 'failed']) {
    const line = complexityLine({ status, unmeasured: ['Python', 'Rust'], needed: ['lizard'], reason: 'no complexity tool found on this machine', install: 'pip install lizard' }, LANGS);
    assert.ok(line.startsWith('Complexity:'), `${status}: ${line}`);
    assert.match(line, /not measured/, `${status}: ${line}`);
    assert.equal(/\n/.test(line), false);
    assert.ok(line.length < 120, `${status}: ${line.length} characters`);
  }
});

// src/domains/project/architecture-facts.js: 'missing' also when lizard is there but the checkout is not at the analysed commit
test('#386 complexityLine: not measured because of the checkout says so, never "no tool found"', () => {
  const { complexityLine } = load();
  const line = complexityLine({ status: 'missing', reason: 'the checkout is not at the default branch\'s commit: complexity is measured on the files on disk' }, LANGS);
  assert.ok(line.startsWith('Complexity:') && /not measured/.test(line), line);
  assert.equal(/no tool/i.test(line), false, `lizard is installed: ${line}`);
  assert.match(line, /checkout/i, line);
  assert.equal(/\n/.test(line), false);
  assert.ok(line.length < 120, `${line.length} characters: ${line}`);
});

// ---------- the quality gate row ----------

// as src/domains/project/architecture-facts.js qualityGate builds it: [{ name, state, source, value }]
const GATE = [
  { name: 'complexity', state: 'pending', source: 'node scripts/code-health.js --check', value: null },
  { name: 'coverage', state: 'measured', source: '.github/workflows/ci.yml, package.json', value: '81.2% of lines' },
  { name: 'duplication', state: 'missing', source: null, value: null },
];

test('#386 qualityGateRow: three chips, complexity, coverage, duplication, each with its state', () => {
  const { qualityGateRow } = load();
  const row = qualityGateRow([GATE[2], GATE[0], GATE[1]]);
  assert.deepEqual(row.map((c) => [c.name, c.state]), [['complexity', 'pending'], ['coverage', 'measured'], ['duplication', 'missing']]);
  for (const c of row) {
    assert.equal(typeof c.label, 'string');
    assert.match(c.label, new RegExp(c.name, 'i'), `the chip names its aspect: ${c.label}`);
    assert.equal(typeof c.title, 'string');
  }
});

test('#386 qualityGateRow: a measured chip shows ✓ and its value; the tooltip is the command or file', () => {
  const { qualityGateRow } = load();
  const [complexity, coverage, duplication] = qualityGateRow(GATE);
  assert.ok(coverage.label.includes('✓'), coverage.label);
  assert.ok(coverage.label.includes('81.2% of lines'), coverage.label);
  assert.ok(coverage.title.includes('.github/workflows/ci.yml, package.json'), coverage.title);
  assert.ok(complexity.title.includes('node scripts/code-health.js --check'), complexity.title);
  assert.equal(complexity.label.includes('✓'), false, 'pending is not ✓');
  assert.equal(duplication.label.includes('✓'), false, 'missing is not ✓');
  assert.ok(duplication.title.length > 0, 'a missing aspect still says why');
});

test('#386 qualityGateRow: an aspect absent from the gate is missing; no gate gives three missing chips', () => {
  const { qualityGateRow } = load();
  assert.deepEqual(qualityGateRow([GATE[1]]).map((c) => [c.name, c.state]), [['complexity', 'missing'], ['coverage', 'measured'], ['duplication', 'missing']]);
  for (const gate of [null, undefined, []]) {
    assert.deepEqual(qualityGateRow(gate).map((c) => [c.name, c.state]), [['complexity', 'missing'], ['coverage', 'missing'], ['duplication', 'missing']], String(gate));
  }
});

// ---------- real scale ----------

test('#386 real scale: 1,200 Danger Zone files and 40 findings are ranked at once, every score in 0..100', () => {
  const { rankFindings, findingCounts, languageShares } = load();
  const dz = Array.from({ length: 1200 }, (_, i) => ({ file: `src/m${i}.js`, score: Math.round((Math.SQRT2 * (1200 - i)) / 1200 * 1000) / 1000 }));
  const sev = ['high', 'medium', 'low'];
  const findings = Array.from({ length: 40 }, (_, i) => ({ title: `F${i}`, severity: sev[i % 3], status: i % 2 ? 'kept' : 'new', files: [{ path: `src/m${i * 29}.js` }, { path: `docs/d${i}.md` }] }));
  const started = Date.now();
  const ranked = rankFindings(findings, dz);
  assert.ok(Date.now() - started < 1000, 'well under a second');
  assert.equal(ranked.length, 40);
  assert.ok(ranked.every((r) => Number.isInteger(r.score) && r.score >= 0 && r.score <= 100));
  const counts = findingCounts(ranked);
  assert.equal(counts.severity.high + counts.severity.medium + counts.severity.low, 40);
  assert.equal(counts.status.new + counts.status.kept, 40);
  const shares = languageShares(['JavaScript', 'TypeScript', 'Rust', 'Python', 'CSS', 'HTML', 'Shell', 'YAML'].map((language, i) => ({ language, lines: 1000 * (8 - i) })));
  assert.equal(shares.length, 8, 'every language at 0.5% or more has its own entry');
  assert.ok(Math.abs(shares.reduce((s, x) => s + x.percent, 0) - 100) < 0.5, 'the shares add up to 100%');
});
