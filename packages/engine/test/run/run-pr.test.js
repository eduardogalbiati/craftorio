// packages/engine/domains/run/run-pr.js: a run's PR/MR (#84) — found in its events, its state mapped from gh/glab JSON
// (no LLM, cached), and the owner's display title.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  defaultTitle, fetchPrState, ghPrDisplay, glMrDisplay, prCache, prOfEvents, prOfOutput, readMeta, writeTitle,
} = require('../../domains/run/run-pr');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-pr-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---- prOfOutput / prOfEvents -------------------------------------------------------------------

test('prOfOutput: a step output with pr_url and pr_number', () => {
  assert.deepEqual(prOfOutput({ pr_url: 'https://github.com/acme/app/pull/42', pr_number: 42 }), { number: 42, url: 'https://github.com/acme/app/pull/42' });
});

test('prOfOutput: the number is parsed from the URL when pr_number is missing', () => {
  assert.deepEqual(prOfOutput({ pr_url: 'https://gitlab.com/acme/app/-/merge_requests/7' }), { number: 7, url: 'https://gitlab.com/acme/app/-/merge_requests/7' });
});

test('prOfOutput: a non-http pr_url is ignored (its pr_number can still stand alone); nothing at all is null', () => {
  assert.deepEqual(prOfOutput({ pr_url: 'not-a-url', pr_number: 1 }), { number: 1, url: null });
  assert.equal(prOfOutput({ pr_url: 'not-a-url' }), null);
  assert.equal(prOfOutput({ pr_number: undefined }), null);
  assert.equal(prOfOutput(null), null);
  assert.equal(prOfOutput({}), null);
});

test('prOfEvents: the latest step.finished output with a PR, ignoring earlier and unrelated steps', () => {
  const events = [
    { type: 'step.finished', step_id: 'develop', output: { branch: 'feat/x' } },
    { type: 'step.finished', step_id: 'ci', output: { pr_url: 'https://github.com/acme/app/pull/1', pr_number: 1 } },
    { type: 'session.message_received' },
    { type: 'step.finished', step_id: 'pr_babysitter', output: { pr_url: 'https://github.com/acme/app/pull/1', pr_number: 1, state: 'ready' } },
  ];
  assert.deepEqual(prOfEvents(events), { number: 1, url: 'https://github.com/acme/app/pull/1' });
  assert.equal(prOfEvents([{ type: 'step.finished', step_id: 'develop', output: {} }]), null);
  assert.equal(prOfEvents([]), null);
});

// ---- ghPrDisplay / glMrDisplay ------------------------------------------------------------------

const ghPr = (extra) => ({ state: 'OPEN', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', statusCheckRollup: [], ...extra });
const check = (status, conclusion) => ({ __typename: 'CheckRun', name: 'ci', status, conclusion });

test('ghPrDisplay: merged and closed, regardless of checks or draft', () => {
  assert.equal(ghPrDisplay(ghPr({ state: 'MERGED', isDraft: true })).state, 'merged');
  assert.equal(ghPrDisplay(ghPr({ state: 'CLOSED' })).state, 'closed');
});

test('ghPrDisplay: a draft PR shows as draft even if it would otherwise conflict', () => {
  const r = ghPrDisplay(ghPr({ isDraft: true, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }));
  assert.equal(r.state, 'draft');
});

test('ghPrDisplay: conflict, failing and pending checks, each over the "open" default', () => {
  assert.equal(ghPrDisplay(ghPr({ mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' })).state, 'conflict');
  assert.equal(ghPrDisplay(ghPr({ statusCheckRollup: [check('COMPLETED', 'FAILURE')] })).state, 'failing');
  assert.equal(ghPrDisplay(ghPr({ statusCheckRollup: [check('IN_PROGRESS', '')] })).state, 'pending');
});

test('ghPrDisplay: mergeable and clean with no (or passed) checks is ready to merge', () => {
  assert.equal(ghPrDisplay(ghPr({})).state, 'ready'); // no checks registered yet
  assert.match(ghPrDisplay(ghPr({})).detail, /ready to merge/);
  assert.equal(ghPrDisplay(ghPr({ statusCheckRollup: [check('COMPLETED', 'SUCCESS')] })).state, 'ready');
});

test('ghPrDisplay: open is the fallback, e.g. passed checks blocked by branch protection', () => {
  const r = ghPrDisplay(ghPr({ mergeStateStatus: 'BLOCKED', statusCheckRollup: [check('COMPLETED', 'SUCCESS')] }));
  assert.equal(r.state, 'open');
  assert.match(r.detail, /blocked/);
});

const glMr = (extra) => ({ state: 'opened', draft: false, work_in_progress: false, has_conflicts: false, detailed_merge_status: 'mergeable', head_pipeline: null, ...extra });

test('glMrDisplay: merged and closed', () => {
  assert.equal(glMrDisplay(glMr({ state: 'merged' })).state, 'merged');
  assert.equal(glMrDisplay(glMr({ state: 'closed' })).state, 'closed');
});

test('glMrDisplay: draft (or work_in_progress), conflict, failing and pending pipelines', () => {
  assert.equal(glMrDisplay(glMr({ draft: true })).state, 'draft');
  assert.equal(glMrDisplay(glMr({ work_in_progress: true })).state, 'draft');
  assert.equal(glMrDisplay(glMr({ has_conflicts: true })).state, 'conflict');
  assert.equal(glMrDisplay(glMr({ head_pipeline: { status: 'failed' } })).state, 'failing');
  assert.equal(glMrDisplay(glMr({ head_pipeline: { status: 'running' } })).state, 'pending');
});

test('glMrDisplay: mergeable with no (or passed) pipeline is ready; otherwise open', () => {
  assert.equal(glMrDisplay(glMr({})).state, 'ready'); // no pipeline, detailed_merge_status mergeable
  assert.equal(glMrDisplay(glMr({ head_pipeline: { status: 'success' } })).state, 'ready');
  assert.equal(glMrDisplay(glMr({ detailed_merge_status: 'cannot_be_merged' })).state, 'open');
});

// ---- fetchPrState / prCache --------------------------------------------------------------------

test('fetchPrState: dispatches to gh for a PR URL and glab for an MR URL, with the reader standing in for the CLI', async () => {
  const calls = [];
  const reader = async (cmd, args) => { calls.push([cmd, ...args]); return cmd === 'gh' ? ghPr({}) : glMr({}); };
  const gh = await fetchPrState({ url: 'https://github.com/acme/app/pull/9' }, { reader });
  assert.equal(gh.state, 'ready');
  const gl = await fetchPrState({ url: 'https://gitlab.com/acme/app/-/merge_requests/9' }, { reader });
  assert.equal(gl.state, 'ready');
  assert.equal(calls[0][0], 'gh');
  assert.equal(calls[1][0], 'glab');
});

test('fetchPrState: a URL that is not a pull/merge request gives state unknown without calling the reader', async () => {
  const reader = async () => { throw new Error('should not be called'); };
  const r = await fetchPrState({ url: 'https://github.com/acme/app/issues/1' }, { reader });
  assert.equal(r.state, 'unknown');
});

test('prCache: a reader error gives state unknown, with the error in the detail', async () => {
  const cache = prCache({ reader: async () => { throw new Error('gh: not found'); } });
  const r = await cache.refresh({ number: 1, url: 'https://github.com/acme/app/pull/1' });
  assert.equal(r.state, 'unknown');
  assert.match(r.detail, /gh: not found/);
});

test('prCache: the reader is called once per URL within the TTL', async () => {
  let calls = 0;
  const reader = async () => { calls += 1; return ghPr({}); };
  const cache = prCache({ reader });
  const pr = { number: 2, url: 'https://github.com/acme/app/pull/2' };
  const a = await cache.refresh(pr);
  const b = await cache.refresh(pr);
  assert.equal(calls, 1);
  assert.equal(a.state, 'ready');
  assert.equal(b.state, 'ready');
  assert.ok(b.checkedAt);
});

test('prCache: merged and closed are never read again, even with maxAgeMs 0', async () => {
  let calls = 0;
  const reader = async () => { calls += 1; return ghPr({ state: 'MERGED' }); };
  const cache = prCache({ reader });
  const pr = { number: 3, url: 'https://github.com/acme/app/pull/3' };
  await cache.refresh(pr);
  await cache.refresh(pr, { maxAgeMs: 0 });
  assert.equal(calls, 1);
});

test('prCache: maxAgeMs 0 forces a fresh read of a PR that has not merged or closed', async () => {
  let calls = 0;
  const reader = async () => { calls += 1; return ghPr({}); };
  const cache = prCache({ reader });
  const pr = { number: 4, url: 'https://github.com/acme/app/pull/4' };
  await cache.refresh(pr);
  await cache.refresh(pr, { maxAgeMs: 0 });
  assert.equal(calls, 2);
});

test('prCache: get() reads the cache without triggering a read; null before the first refresh', async () => {
  const cache = prCache({ reader: async () => ghPr({}) });
  assert.equal(cache.get('https://github.com/acme/app/pull/5'), null);
  await cache.refresh({ number: 5, url: 'https://github.com/acme/app/pull/5' });
  assert.equal(cache.get('https://github.com/acme/app/pull/5').state, 'ready');
});

// #797: the commit a merged PR leaves is what its roadmap item keeps
test('ghPrDisplay: a merged PR carries its merge commit; one the platform gives none for carries no field', () => {
  assert.equal(ghPrDisplay(ghPr({ state: 'MERGED', mergeCommit: { oid: 'abc' } })).mergedCommit, 'abc');
  assert.equal('mergedCommit' in ghPrDisplay(ghPr({ state: 'MERGED', mergeCommit: null })), false);
  assert.equal('mergedCommit' in ghPrDisplay(ghPr({ state: 'CLOSED', mergeCommit: { oid: 'abc' } })), false);
});

test('glMrDisplay: a merged MR carries its merge commit first, its squash commit without one, and none with neither', () => {
  assert.equal(glMrDisplay(glMr({ state: 'merged', merge_commit_sha: 'abc', squash_commit_sha: 'def' })).mergedCommit, 'abc');
  assert.equal(glMrDisplay(glMr({ state: 'merged', merge_commit_sha: null, squash_commit_sha: 'def' })).mergedCommit, 'def');
  assert.equal('mergedCommit' in glMrDisplay(glMr({ state: 'merged', merge_commit_sha: null, squash_commit_sha: null })), false);
  assert.equal('mergedCommit' in glMrDisplay(glMr({ state: 'closed', merge_commit_sha: 'abc' })), false);
});

test('prCache: a merged PR keeps its merge commit on the read and on the reads the cache answers', async () => {
  const cache = prCache({ reader: async () => ghPr({ state: 'MERGED', mergeCommit: { oid: 'abc' } }) });
  const pr = { number: 6, url: 'https://github.com/acme/app/pull/6' };
  assert.equal((await cache.refresh(pr)).mergedCommit, 'abc');
  assert.equal((await cache.refresh(pr, { maxAgeMs: 0 })).mergedCommit, 'abc');
  assert.equal(cache.get(pr.url).mergedCommit, 'abc');
});

// ---- the run's title ----------------------------------------------------------------------------

test('writeTitle: trims and collapses whitespace; an empty title clears it back to the default', (t) => {
  const dir = tmp(t);
  writeTitle(dir, '  My   title\nline2 ');
  assert.equal(readMeta(dir).title, 'My title line2');
  writeTitle(dir, '');
  assert.equal(readMeta(dir).title, undefined);
});

test('readMeta: a missing or invalid meta.json reads as {}', (t) => {
  const dir = tmp(t);
  assert.deepEqual(readMeta(dir), {});
  fs.writeFileSync(path.join(dir, 'meta.json'), 'not json');
  assert.deepEqual(readMeta(dir), {});
});

test('defaultTitle: the issue, a group with "(+k)", the task\'s first line, or null', () => {
  assert.equal(defaultTitle({ issues: [{ number: 12, title: 'Fix the bug' }] }), '#12 Fix the bug');
  assert.equal(defaultTitle({ issues: [{ number: 12, title: 'Fix the bug' }, { number: 13 }] }), '#12 Fix the bug (+1)');
  assert.equal(defaultTitle({ issues: [{ number: 12 }] }), '#12');
  assert.equal(defaultTitle({ task: 'Implement the feature\nmore detail' }), 'Implement the feature');
  assert.equal(defaultTitle({}), null);
});
