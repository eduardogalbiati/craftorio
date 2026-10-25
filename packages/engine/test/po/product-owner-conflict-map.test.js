// The Product Owner and the conflict map (#150, packages/engine/domains/po/product-owner.js): the report's "## Conflict map"
// section (capped), the simulated answer that puts groups touching the same hot file in different
// stages and lists the hot spots to decongest, normalizeAnswer keeping `decongest`, and the skill.
// Conflict maps are plain objects here (no git): the shape packages/engine/domains/project/conflict-map.js builds.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const productOwner = require('../../domains/po/product-owner');

// n run ids, newest first: r<n> … r1
const ids = (n) => Array.from({ length: n }, (_, i) => `r${n - i}`);

// Ten runs: src/index.js changed by 8 (hot), its line 3 by 7 (hot), src/quiet.js by 1 (not hot).
function hotMap() {
  const runIds = ids(10);
  return {
    source: 'runs', runs: 10, runIds,
    files: [
      { file: 'src/index.js', runs: 8, runIds: runIds.slice(0, 8), lastRun: 'r10', conflicts: 2 },
      { file: 'src/quiet.js', runs: 1, runIds: runIds.slice(0, 1), lastRun: 'r10', conflicts: 0 },
    ],
    lines: [{ file: 'src/index.js', line: 3, text: "const { a, b } = require('./x');", runs: 7, runIds: runIds.slice(0, 7) }],
  };
}

// Ten runs, each file changed by one: nothing is hot.
function coolMap() {
  const runIds = ids(10);
  return {
    source: 'runs', runs: 10, runIds,
    files: [{ file: 'src/index.js', runs: 1, runIds: ['r10'], lastRun: 'r10', conflicts: 0 }],
    lines: [],
  };
}

// The section from "## Conflict map" to the next "## " heading (or the end).
function section(report) {
  const at = report.indexOf('## Conflict map');
  if (at < 0) return null;
  const next = report.indexOf('\n## ', at + 1);
  return next < 0 ? report.slice(at) : report.slice(at, next);
}

const LONG = ' It needs a few changes in the module, described here in enough words to be implemented without guessing anything.';

// Two to-do issues of different areas (two groups) that both name src/index.js.
const DATA = {
  projectId: 'demo',
  issues: [
    { number: 1, state: 'open', title: 'Add a route in src/index.js', labels: [{ name: 'area:api' }], body: `Register the new route in src/index.js.${LONG}` },
    { number: 2, state: 'open', title: 'Export a helper', labels: [{ name: 'area:cli' }], body: `Export the helper from src/index.js.${LONG}` },
  ],
};

// Speed: every group of a stage runs at once (no runs-per-stage limit).
const SPEED = 1;

const stageOf = (answer, issue) => answer.groups.find((g) => g.issues.includes(issue)).stage;

// ---- backlogReport ------------------------------------------------------------------------------------

test('backlogReport: a conflict map adds a "## Conflict map" section', () => {
  const report = productOwner.backlogReport({ data: DATA, workflows: [], conflictMap: hotMap() });
  assert.ok(section(report), 'the report has a ## Conflict map section');
});

test('backlogReport: the conflict map section lists a hot file with its run count', () => {
  const text = section(productOwner.backlogReport({ data: DATA, workflows: [], conflictMap: hotMap() })) || '';
  assert.match(text, /src\/index\.js[^\n]*\b8\b/);
});

test('backlogReport: the conflict map section lists a hot line as file:line', () => {
  const text = section(productOwner.backlogReport({ data: DATA, workflows: [], conflictMap: hotMap() })) || '';
  assert.ok(text.includes('src/index.js:3'), text);
});

test('backlogReport: without a conflict map there is no "## Conflict map" section (control)', () => {
  const report = productOwner.backlogReport({ data: DATA, workflows: [] });
  assert.equal(report.includes('## Conflict map'), false);
});

test('backlogReport: a map of 300 files and 100 lines is capped at 4000 characters, keeping the most-changed file and leaving out the least-changed one', () => {
  const runIds = ids(300);
  const name = (i) => `src/f${String(i).padStart(3, '0')}.js`;
  const map = {
    source: 'runs', runs: 300, runIds,
    files: Array.from({ length: 300 }, (_, i) => ({ file: name(i), runs: 300 - i, runIds: runIds.slice(0, 300 - i), lastRun: 'r300', conflicts: 0 })),
    lines: Array.from({ length: 100 }, (_, i) => ({ file: name(i), line: i + 1, text: 'x'.repeat(80), runs: 200 - i, runIds: runIds.slice(0, 200 - i) })),
  };
  const text = section(productOwner.backlogReport({ data: DATA, workflows: [], conflictMap: map }));
  assert.ok(text, 'the report has a ## Conflict map section');
  assert.ok(text.length <= 4000, `the section has ${text.length} characters`);
  assert.ok(text.includes('src/f000.js'), 'the most-changed file is listed');
  assert.equal(text.includes('src/f299.js'), false);
});

// ---- mockAnswer -----------------------------------------------------------------------------------------

test('mockAnswer: two groups naming the same hot file go to different stages', () => {
  const answer = productOwner.mockAnswer({ data: DATA, calibration: SPEED, conflictMap: hotMap() });
  assert.notEqual(stageOf(answer, 1), stageOf(answer, 2));
});

test('mockAnswer: without a conflict map the same two groups share a stage (control)', () => {
  const answer = productOwner.mockAnswer({ data: DATA, calibration: SPEED });
  assert.equal(stageOf(answer, 1), stageOf(answer, 2));
});

test('mockAnswer: the two groups sharing a hot file are listed as a conflict naming that file', () => {
  const answer = productOwner.mockAnswer({ data: DATA, calibration: SPEED, conflictMap: hotMap() });
  const c = answer.conflicts.find((x) => [...x.issues].sort().join(',') === '1,2');
  assert.ok(c, 'a conflict between #1 and #2');
  assert.ok(c.files.includes('src/index.js'));
});

test('mockAnswer: decongest lists the map\'s hot file and hot line with a fix and their counts', () => {
  const answer = productOwner.mockAnswer({ data: DATA, calibration: SPEED, conflictMap: hotMap() });
  const spots = answer.decongest.map((d) => [d.line ? `${d.file}:${d.line}` : d.file, d.runs, d.of]).sort();
  assert.deepEqual(spots, [['src/index.js', 8, 10], ['src/index.js:3', 7, 10]]);
  for (const d of answer.decongest) assert.ok(typeof d.fix === 'string' && d.fix.trim().length > 0);
});

test('mockAnswer: a conflict map with no hot spots gives an empty decongest', () => {
  const answer = productOwner.mockAnswer({ data: DATA, calibration: SPEED, conflictMap: coolMap() });
  assert.deepEqual(answer.decongest, []);
});

// Issues of four areas (four groups); #1, #2 and #3 name the hot src/index.js, #4 does not.
const issueOf = (number, area, file) => ({ number, state: 'open', title: `Change ${area}`, labels: [{ name: `area:${area}` }], body: `Change ${file} for ${area}.${LONG}` });
const FOUR = { projectId: 'demo', issues: [issueOf(1, 'a', 'src/index.js'), issueOf(2, 'b', 'src/index.js'), issueOf(3, 'c', 'src/index.js'), issueOf(4, 'd', 'src/other.js')] };
// Quality-leaning: two runs per stage, so #1 + #2 start in stage 1 and #3 + #4 in stage 2
const QUALITY_LEANING = 4;

test('mockAnswer: three groups of one stage naming the same hot file end in three different stages, each move a conflict naming the file', () => {
  const data = { projectId: 'demo', issues: FOUR.issues.slice(0, 3) };
  const answer = productOwner.mockAnswer({ data, calibration: SPEED, conflictMap: hotMap() });
  assert.equal(new Set([1, 2, 3].map((n) => stageOf(answer, n))).size, 3);
  const named = answer.conflicts.filter((c) => c.files.includes('src/index.js'));
  assert.ok(named.length >= 2, `conflicts naming src/index.js: ${named.length}`);
});

test('mockAnswer: a group moved to a stage where another group names the same hot file moves on again; a group without it keeps its stage', () => {
  const plain = productOwner.mockAnswer({ data: FOUR, calibration: QUALITY_LEANING });
  assert.deepEqual([1, 2, 3, 4].map((n) => stageOf(plain, n)), [1, 1, 2, 2]);
  const answer = productOwner.mockAnswer({ data: FOUR, calibration: QUALITY_LEANING, conflictMap: hotMap() });
  assert.equal(new Set([1, 2, 3].map((n) => stageOf(answer, n))).size, 3);
  assert.equal(stageOf(answer, 4), 2);
});

test('normalizeAnswer of the simulated answer keeps the groups sharing a hot file in different stages', () => {
  const answer = productOwner.mockAnswer({ data: FOUR, calibration: QUALITY_LEANING, conflictMap: hotMap() });
  const out = productOwner.normalizeAnswer(answer, { issues: FOUR.issues, history: [], workflows: [{ file: 'software-development.yaml' }], calibration: QUALITY_LEANING, mock: true });
  const stage = (n) => out.groups.find((g) => g.issues.includes(n)).stage;
  assert.equal(new Set([1, 2, 3].map(stage)).size, 3);
});

// ---- normalizeAnswer --------------------------------------------------------------------------------------

const CTX = { issues: DATA.issues, history: [], workflows: [{ file: 'software-development.yaml' }] };

test('normalizeAnswer: keeps decongest entries with a file, their fix, and the line only when given', () => {
  const raw = {
    summary: '', groups: [],
    decongest: [
      { file: 'src/index.js', fix: 'Split it by area.', runs: 8, of: 10 },
      { file: 'src/index.js', line: 3, fix: 'One import per line, sorted.' },
    ],
  };
  const out = productOwner.normalizeAnswer(raw, CTX);
  assert.deepEqual(out.decongest.map((d) => [d.file, d.fix, d.line]), [
    ['src/index.js', 'Split it by area.', undefined],
    ['src/index.js', 'One import per line, sorted.', 3],
  ]);
  assert.equal('line' in out.decongest[0], false);
});

test('normalizeAnswer: decongest entries without a file are dropped', () => {
  const raw = { summary: '', groups: [], decongest: [{ fix: 'no file' }, { line: 4, fix: 'no file either' }, { file: 'a.js', fix: 'kept' }] };
  const out = productOwner.normalizeAnswer(raw, CTX);
  assert.deepEqual(out.decongest.map((d) => d.file), ['a.js']);
});

test('normalizeAnswer: an answer without decongest gets an empty one', () => {
  const out = productOwner.normalizeAnswer({ summary: '', groups: [] }, CTX);
  assert.deepEqual(out.decongest, []);
});

test('normalizeAnswer: decongest keeps at most 20 fixes', () => {
  const decongest = Array.from({ length: 25 }, (_, n) => ({ file: `src/f${n}.js`, fix: 'Split it.' }));
  const out = productOwner.normalizeAnswer({ summary: '', groups: [], decongest }, CTX);
  assert.equal(out.decongest.length, 20);
  assert.equal(out.decongest[0].file, 'src/f0.js');
  assert.equal(out.decongest[19].file, 'src/f19.js');
});

test('normalizeAnswer: a decongest line, runs or of that is not a positive integer is left out', () => {
  const raw = { summary: '', groups: [], decongest: [
    { file: 'a.js', fix: 'x', line: 2.5, runs: 'many', of: 0 },
    { file: 'b.js', fix: 'y', line: -1, runs: 7, of: 10 },
  ] };
  const out = productOwner.normalizeAnswer(raw, CTX);
  assert.deepEqual(out.decongest.map((d) => [d.file, 'line' in d, 'runs' in d, 'of' in d]), [['a.js', false, false, false], ['b.js', false, true, true]]);
  assert.deepEqual([out.decongest[1].runs, out.decongest[1].of], [7, 10]);
});

// ---- the skill --------------------------------------------------------------------------------------------

test('the backlog-product-owner skill describes the conflict map, hot files in different stages, and decongest', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'skills', 'backlog-product-owner', 'SKILL.md'), 'utf8');
  assert.match(text, /conflict map/i);
  assert.match(text, /different stages?/i);
  assert.match(text, /decongest/);
});
