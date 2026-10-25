// #357: the Refactor proposals' storage (packages/engine/domains/refactor/refactor-proposals.js) beyond #356: dismissing a
// proposal with a reason (kept and listed), a proposal written by the owner (source 'owner') and the
// Product Owner's ranking saved on the proposals (saveRanking / readRanking). Tests first: the module
// is loaded inside each test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/refactor/refactor-proposals');
const NOW = new Date('2026-10-15T12:00:00.000Z');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'refactor357-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const finding = (key) => ({ source: 'architecture', key, title: `Split ${key}`, files: [`src/${key}.js`] });

test('#357 dismissProposal marks it dismissed with the trimmed reason and keeps it listed', (t) => {
  const { addProposal, dismissProposal, listProposals } = load();
  const dir = tmp(t);
  const p = addProposal(dir, 'proj', finding('a'), NOW);
  const out = dismissProposal(dir, 'proj', p.id, '  Not worth it now  ', NOW);
  assert.equal(out.status, 'dismissed');
  assert.equal(out.dismissReason, 'Not worth it now');
  assert.equal(out.dismissedAt, '2026-10-15T12:00:00.000Z');
  const listed = listProposals(dir, 'proj');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].status, 'dismissed');
  assert.equal(listed[0].dismissReason, 'Not worth it now');
});

test('#357 dismissProposal refuses a blank reason', (t) => {
  const { addProposal, dismissProposal, listProposals } = load();
  const dir = tmp(t);
  const p = addProposal(dir, 'proj', finding('a'), NOW);
  assert.throws(() => dismissProposal(dir, 'proj', p.id, '   ', NOW), /reason/i);
  assert.equal(listProposals(dir, 'proj')[0].status, 'proposed');
});

test('#357 dismissProposal refuses an unknown id', (t) => {
  const { addProposal, dismissProposal } = load();
  const dir = tmp(t);
  addProposal(dir, 'proj', finding('a'), NOW);
  assert.equal(typeof dismissProposal, 'function', 'dismissProposal is exported');
  assert.throws(() => dismissProposal(dir, 'proj', 'nope', 'A reason', NOW));
});

test('#357 an owner proposal keeps its target, improvement and evidence', (t) => {
  const { addProposal, listProposals } = load();
  const dir = tmp(t);
  addProposal(dir, 'proj', { source: 'owner', key: 'k1', target: 'packages/engine/engine', improvement: 'Split the run loop', evidence: 'Every fix touches it' }, NOW);
  const [p] = listProposals(dir, 'proj');
  assert.equal(p.source, 'owner');
  assert.equal(p.target, 'packages/engine/engine');
  assert.equal(p.improvement, 'Split the run loop');
  assert.equal(p.evidence, 'Every fix touches it');
  assert.equal(p.status, 'proposed');
});

test('#357 saveRanking puts rank, rankReason and complexity on the proposals; readRanking keeps at and costUsd', (t) => {
  const { addProposal, listProposals, saveRanking, readRanking } = load();
  const dir = tmp(t);
  const a = addProposal(dir, 'proj', finding('a'), NOW);
  const b = addProposal(dir, 'proj', finding('b'), NOW);
  const answer = { ranking: [{ id: b.id, rank: 1, reason: 'Hottest file', complexity: 2 }, { id: a.id, rank: 2, reason: 'Less churn', complexity: 4 }] };
  saveRanking(dir, 'proj', answer, { at: '2026-10-15T12:00:00.000Z', costUsd: 0.12 });
  const byId = new Map(listProposals(dir, 'proj').map((p) => [p.id, p]));
  assert.deepEqual([byId.get(b.id).rank, byId.get(b.id).rankReason, byId.get(b.id).complexity], [1, 'Hottest file', 2]);
  assert.deepEqual([byId.get(a.id).rank, byId.get(a.id).rankReason, byId.get(a.id).complexity], [2, 'Less churn', 4]);
  const saved = readRanking(dir, 'proj');
  assert.equal(saved.at, '2026-10-15T12:00:00.000Z');
  assert.equal(saved.costUsd, 0.12);
  assert.equal(saved.ranking.length, 2);
});

test('#357 readRanking is null before any ranking', (t) => {
  const { readRanking } = load();
  assert.equal(readRanking(tmp(t), 'proj'), null);
});
