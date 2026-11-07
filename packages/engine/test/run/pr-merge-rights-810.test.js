'use strict';

// #810 (developer's own test): the account's real merge / bypass rights, read with `gh api repos/<repo>` /
// `glab api projects/<path>` (run-pr.js readMergeRights, the adapters' parseMergeRights).

const test = require('node:test');
const assert = require('node:assert/strict');
const { readMergeRights, mergeOptions } = require('../../domains/run/run-pr');

const reading = (info, calls = []) => async (cli, args) => { calls.push([cli, ...args]); return info; };

test('GitHub: a repository admin may merge and bypass the protection', async () => {
  const calls = [];
  const r = await readMergeRights({ url: 'https://github.com/o/r/pull/7' }, { reader: reading({ permissions: { push: true, admin: true } }, calls) });
  assert.deepEqual(r, { canMerge: true, canBypass: true });
  assert.equal(calls[0][0], 'gh');
  assert.ok(calls[0].includes('repos/o/r'));
});

test('GitHub: a writer may merge, never bypass; a reader may not merge', async () => {
  const url = 'https://github.com/o/r/pull/7';
  assert.deepEqual(await readMergeRights({ url }, { reader: reading({ permissions: { push: true, admin: false } }) }), { canMerge: true, canBypass: false });
  assert.deepEqual(await readMergeRights({ url }, { reader: reading({ permissions: { push: false, admin: false } }) }), { canMerge: false, canBypass: false });
});

test('a failed read allows the merge (the platform refuses it) and never the bypass', async () => {
  const r = await readMergeRights({ url: 'https://github.com/o/r/pull/7' }, { reader: async () => { throw new Error('gh: not found'); } });
  assert.deepEqual(r, { canMerge: true, canBypass: false });
});

test('GitLab: Developer or more may merge, nobody bypasses; a Reporter may not merge', async () => {
  const url = 'https://gitlab.com/g/sub/p/-/merge_requests/3';
  const calls = [];
  const dev = await readMergeRights({ url }, { reader: reading({ permissions: { project_access: { access_level: 40 } } }, calls) });
  assert.deepEqual(dev, { canMerge: true, canBypass: false });
  assert.equal(calls[0][0], 'glab');
  const reporter = await readMergeRights({ url }, { reader: reading({ permissions: { project_access: { access_level: 20 }, group_access: null } }) });
  assert.deepEqual(reporter, { canMerge: false, canBypass: false });
});

test('the rights read feed the card: no merge button without the merge right', async () => {
  const card = { state: 'ready', pr_state: 'open', ci: { state: 'passed' }, review: {}, conflicts: false };
  const rights = await readMergeRights({ url: 'https://github.com/o/r/pull/7' }, { reader: reading({ permissions: { push: false } }) });
  const o = mergeOptions(card, rights);
  assert.equal(o.merge, false);
  assert.equal(o.bypass, false);
  const writer = await readMergeRights({ url: 'https://github.com/o/r/pull/7' }, { reader: reading({ permissions: { push: true } }) });
  assert.equal(mergeOptions(card, writer).merge, true);
});
