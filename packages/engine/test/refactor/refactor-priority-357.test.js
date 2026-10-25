// #357: the Product Owner's prioritization of the Refactor proposals (packages/engine/domains/refactor/refactor-priority.js): the
// answer's schema (PRIORITY_SCHEMA, checked with packages/engine/domains/workspace/json-schema.js validateSchema), validatePriority
// and the simulated answer mockPriority (open proposals ranked 1..n, the ones touching an unfinished
// roadmap item's files last, a higher Danger Zone score first). Tests first: loaded inside each test.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/refactor/refactor-priority');
const { validateSchema } = require('../../domains/workspace/json-schema');

const entry = (extra = {}) => ({ id: 'p1', rank: 1, reason: 'Hot file in the Danger Zone', complexity: 3, ...extra });
const valid = () => ({ ranking: [entry(), entry({ id: 'p2', rank: 2, complexity: 1 })] });

test('#357 PRIORITY_SCHEMA accepts a valid ranking', () => {
  const { PRIORITY_SCHEMA } = load();
  assert.deepEqual(validateSchema(valid(), PRIORITY_SCHEMA), []);
});

test('#357 PRIORITY_SCHEMA refuses a complexity of 6', () => {
  const { PRIORITY_SCHEMA } = load();
  assert.ok(validateSchema({ ranking: [entry({ complexity: 6 })] }, PRIORITY_SCHEMA).length > 0);
});

test('#357 PRIORITY_SCHEMA refuses a complexity of 0', () => {
  const { PRIORITY_SCHEMA } = load();
  assert.ok(validateSchema({ ranking: [entry({ complexity: 0 })] }, PRIORITY_SCHEMA).length > 0);
});

test('#357 PRIORITY_SCHEMA refuses an entry without a reason', () => {
  const { PRIORITY_SCHEMA } = load();
  const { reason, ...noReason } = entry();
  assert.equal(typeof reason, 'string');
  assert.ok(validateSchema({ ranking: [noReason] }, PRIORITY_SCHEMA).length > 0);
});

test('#357 PRIORITY_SCHEMA refuses an empty reason', () => {
  const { PRIORITY_SCHEMA } = load();
  assert.ok(validateSchema({ ranking: [entry({ reason: '' })] }, PRIORITY_SCHEMA).length > 0);
});

test('#357 PRIORITY_SCHEMA refuses a rank of 0', () => {
  const { PRIORITY_SCHEMA } = load();
  assert.ok(validateSchema({ ranking: [entry({ rank: 0 })] }, PRIORITY_SCHEMA).length > 0);
});

test('#357 PRIORITY_SCHEMA refuses an answer without a ranking', () => {
  const { PRIORITY_SCHEMA } = load();
  assert.ok(validateSchema({}, PRIORITY_SCHEMA).length > 0);
});

test('#357 validatePriority agrees with the schema', () => {
  const { validatePriority } = load();
  assert.deepEqual(validatePriority(valid()), []);
  assert.ok(validatePriority({ ranking: [entry({ complexity: 6 })] }).length > 0);
  assert.ok(validatePriority({}).length > 0);
});

// ---------- mockPriority ----------

const proposal = (id, files, extra = {}) => ({ id, status: 'proposed', files, ...extra });

test('#357 mockPriority ranks every open proposal 1..n and omits the dismissed ones', () => {
  const { mockPriority } = load();
  const proposals = [proposal('a', ['src/a.js']), proposal('b', ['src/b.js'], { status: 'dismissed' }), proposal('c', ['src/c.js'])];
  const answer = mockPriority({ proposals });
  assert.deepEqual(answer.ranking.map((r) => r.id).sort(), ['a', 'c']);
  assert.deepEqual(answer.ranking.map((r) => r.rank).sort(), [1, 2]);
});

test('#357 mockPriority answer validates against PRIORITY_SCHEMA with non-empty reasons', () => {
  const { mockPriority, PRIORITY_SCHEMA } = load();
  const answer = mockPriority({ proposals: [proposal('a', ['src/a.js']), proposal('b', ['src/b.js'])] });
  assert.deepEqual(validateSchema(answer, PRIORITY_SCHEMA), []);
  assert.equal(answer.ranking.every((r) => typeof r.reason === 'string' && r.reason.trim().length > 0), true);
});

test('#357 mockPriority ranks a proposal on an unfinished roadmap item\'s files after the others', () => {
  const { mockPriority } = load();
  const proposals = [proposal('busy', ['src/busy.js']), proposal('free1', ['src/free1.js']), proposal('free2', ['src/free2.js'])];
  const answer = mockPriority({ proposals, unfinished: [{ issue: 7, files: ['src/busy.js'] }], dangerScores: { 'src/busy.js': 99 } });
  const rankOf = (id) => answer.ranking.find((r) => r.id === id).rank;
  assert.equal(rankOf('busy'), 3);
});

test('#357 mockPriority ranks the higher Danger Zone score first among the others', () => {
  const { mockPriority } = load();
  const proposals = [proposal('low', ['src/low.js']), proposal('high', ['src/x.js', 'src/high.js'])];
  const answer = mockPriority({ proposals, dangerScores: { 'src/low.js': 10, 'src/high.js': 80, 'src/x.js': 1 } });
  const rankOf = (id) => answer.ranking.find((r) => r.id === id).rank;
  assert.equal(rankOf('high'), 1);
  assert.equal(rankOf('low'), 2);
});
