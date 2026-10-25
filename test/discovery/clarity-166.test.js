// #166 Clarity score: a deterministic 0-100 score of how clear a discovery card is, with an 85% bar
// to enter the Ready column, and the night forecast of the Ready column.
//
// The contract these tests assume, src/domains/discovery/clarity.js (required inside each test, so this file loads
// before the module exists):
//   DEFAULT_BAR === 85
//   scoreClarity({ type, document, acceptance }) → { score (integer 0..100), gaps: [strings] }
//     (the same fields card.json already has: clarity { score, gaps })
//     Kinds: idea, prd, rfc, task, bug, hotfix. Reads markdown headings (case-insensitive).
//     Common: Problem, Goal, Scope, Non-goals, Decisions, Open questions, Dependencies, Evidence;
//     acceptance criteria from `acceptance` (non-empty) or an "Acceptance criteria" heading.
//     bug: Steps to reproduce, Observed, Expected; rfc: Alternatives considered; prd: Users, Success metrics.
//   clarityBar(settings, kind) → number (settings { bar, byKind }, both optional; default 85)
//   readyForecast(items, { bar, byKind, night: { start, end } }) → { count, hours, nights, nightHours }
//     items: { type, clarity: { score }, estimate: { minutes } } (card.json's estimate { usd, minutes })
// The bundled skill skills/clarity-score/SKILL.md documents the criteria per kind and the 85 bar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const load = () => require('../../src/domains/discovery/clarity');

// a markdown document with one real sentence under each heading
const doc = (headings) => headings.map((h) => `## ${h}\n\nThis section states the ${h.toLowerCase()} in a full sentence for the team.\n`).join('\n');

const COMMON = ['Problem', 'Goal', 'Scope', 'Non-goals', 'Decisions', 'Open questions', 'Dependencies', 'Evidence'];
const PRD = [...COMMON, 'Users', 'Success metrics'];
const BUG = [...COMMON, 'Steps to reproduce', 'Observed', 'Expected'];
const RFC = [...COMMON, 'Alternatives considered'];
const ACCEPTANCE = '- The report opens from the Dashboard\n- Each project has one row with its weekly cost';

// ---- scoreClarity -------------------------------------------------------------------------------

test('DEFAULT_BAR is 85', () => {
  assert.equal(load().DEFAULT_BAR, 85);
});

test('a complete PRD with acceptance criteria scores at least 85, as an integer from 0 to 100, with no missing acceptance', () => {
  const { scoreClarity } = load();
  const r = scoreClarity({ type: 'prd', document: doc(PRD), acceptance: ACCEPTANCE });
  assert.ok(Number.isInteger(r.score), `score ${r.score} is not an integer`);
  assert.ok(r.score >= 85 && r.score <= 100, `score ${r.score}`);
  assert.ok(Array.isArray(r.gaps));
  assert.ok(!r.gaps.some((m) => /acceptance/i.test(m)), `gaps: ${r.gaps.join('; ')}`);
});

test('the same PRD without acceptance criteria scores lower and lists the acceptance criteria as missing', () => {
  const { scoreClarity } = load();
  const full = scoreClarity({ type: 'prd', document: doc(PRD), acceptance: ACCEPTANCE });
  const none = scoreClarity({ type: 'prd', document: doc(PRD), acceptance: '' });
  assert.ok(none.score < full.score, `${none.score} is not below ${full.score}`);
  assert.ok(none.gaps.some((m) => /acceptance/i.test(m)), `gaps: ${none.gaps.join('; ')}`);
});

test('an "Acceptance criteria" heading in the document counts as acceptance criteria', () => {
  const { scoreClarity } = load();
  const inDoc = scoreClarity({ type: 'prd', document: doc([...PRD, 'Acceptance criteria']), acceptance: '' });
  assert.ok(!inDoc.gaps.some((m) => /acceptance/i.test(m)), `gaps: ${inDoc.gaps.join('; ')}`);
});

test('headings are read case-insensitively', () => {
  const { scoreClarity } = load();
  const lower = doc(PRD).replace(/^## (.+)$/gm, (_, h) => `## ${h.toLowerCase()}`);
  const a = scoreClarity({ type: 'prd', document: doc(PRD), acceptance: ACCEPTANCE });
  const b = scoreClarity({ type: 'prd', document: lower, acceptance: ACCEPTANCE });
  assert.equal(b.score, a.score);
});

test('a bug without "Steps to reproduce" scores lower than the same bug with them and lists the reproduction steps as missing', () => {
  const { scoreClarity } = load();
  const withSteps = scoreClarity({ type: 'bug', document: doc(BUG), acceptance: ACCEPTANCE });
  const without = scoreClarity({ type: 'bug', document: doc(BUG.filter((h) => h !== 'Steps to reproduce')), acceptance: ACCEPTANCE });
  assert.ok(without.score < withSteps.score, `${without.score} is not below ${withSteps.score}`);
  assert.ok(without.gaps.some((m) => /reproduc/i.test(m)), `gaps: ${without.gaps.join('; ')}`);
});

test('an empty document scores below 85 and lists what is missing', () => {
  const { scoreClarity } = load();
  for (const type of ['idea', 'prd', 'rfc', 'task', 'bug', 'hotfix']) {
    const r = scoreClarity({ type, document: '', acceptance: '' });
    assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score < 85, `${type}: score ${r.score}`);
    assert.ok(r.gaps.length > 0, `${type}: no gaps`);
  }
});

test('an RFC complete except "Alternatives considered" lists the alternatives as missing', () => {
  const { scoreClarity } = load();
  const r = scoreClarity({ type: 'rfc', document: doc(RFC.filter((h) => h !== 'Alternatives considered')), acceptance: ACCEPTANCE });
  assert.ok(r.gaps.some((m) => /alternative/i.test(m)), `gaps: ${r.gaps.join('; ')}`);
});

test('the score is deterministic: the same card scores the same twice', () => {
  const { scoreClarity } = load();
  const input = { type: 'rfc', document: doc(RFC.slice(0, 5)), acceptance: '' };
  assert.deepEqual(scoreClarity(input), scoreClarity(input));
});

// ---- clarityBar ---------------------------------------------------------------------------------

test('clarityBar is 85 by default, the project\'s bar when set, and a kind\'s own bar when byKind has it', () => {
  const { clarityBar } = load();
  assert.equal(clarityBar(undefined, 'prd'), 85);
  assert.equal(clarityBar({}, 'prd'), 85);
  assert.equal(clarityBar({ bar: 90 }, 'prd'), 90);
  assert.equal(clarityBar({ bar: 85, byKind: { hotfix: 60 } }, 'hotfix'), 60);
  assert.equal(clarityBar({ bar: 85, byKind: { hotfix: 60 } }, 'bug'), 85);
});

// ---- readyForecast ------------------------------------------------------------------------------

test('readyForecast counts only the items at or above their bar, sums their hours and fits them into 8-hour nights (22:00 to 06:00)', () => {
  const { readyForecast } = load();
  const items = [
    { type: 'prd', clarity: { score: 90 }, estimate: { minutes: 480 } },
    { type: 'prd', clarity: { score: 85 }, estimate: { minutes: 480 } }, // exactly at the bar: counts
    { type: 'rfc', clarity: { score: 100 }, estimate: { minutes: 240 } },
    { type: 'prd', clarity: { score: 84 }, estimate: { minutes: 6000 } }, // below the bar
    { type: 'idea', estimate: { minutes: 3000 } }, // never scored
  ];
  const r = readyForecast(items, { night: { start: '22:00', end: '06:00' } });
  assert.deepEqual({ count: r.count, hours: r.hours, nights: r.nights, nightHours: r.nightHours }, { count: 3, hours: 20, nights: 2, nightHours: 8 });
});

test('readyForecast measures a night window that crosses midnight (23:00 to 08:00 is 9 hours)', () => {
  const { readyForecast } = load();
  const r = readyForecast([], { night: { start: '23:00', end: '08:00' } });
  assert.equal(r.nightHours, 9);
  assert.equal(r.count, 0);
});

test('readyForecast uses a kind\'s own bar: a hotfix scored 70 counts with byKind.hotfix 60, not with the default bar', () => {
  const { readyForecast } = load();
  const items = [{ type: 'hotfix', clarity: { score: 70 }, estimate: { minutes: 120 } }];
  const night = { start: '22:00', end: '06:00' };
  assert.equal(readyForecast(items, { bar: 85, byKind: { hotfix: 60 }, night }).count, 1);
  assert.equal(readyForecast(items, { night }).count, 0);
});

// ---- the skill ----------------------------------------------------------------------------------

test('the bundled clarity-score skill documents every kind (idea, PRD, RFC, task, bug, hotfix) and the 85 bar', () => {
  const file = path.join(__dirname, '..', '..', 'skills', 'clarity-score', 'SKILL.md');
  assert.ok(fs.existsSync(file), 'skills/clarity-score/SKILL.md is missing');
  const text = fs.readFileSync(file, 'utf8');
  for (const kind of ['idea', 'prd', 'rfc', 'task', 'bug', 'hotfix']) {
    assert.match(text, new RegExp(`\\b${kind}\\b`, 'i'), `the skill does not mention ${kind}`);
  }
  assert.match(text, /\b85\b/);
});
