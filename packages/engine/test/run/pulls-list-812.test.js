// #812 the PRs / MRs screen's engine side (packages/engine/domains/run/run-pr.js, packages/engine/service/channels/pulls.js):
// every open pull request of a project, the ones a run opened and the ones no run did, grouped by what they need,
// stacks (#807) kept together in merge order. Acceptance tests, written before the code; the CLIs are replaced by
// `reader(cmd, args)` (JSON reads, as fetchPrMonitor's tests) answering fake gh / glab output, and `hasCli(cli)`.
//
// The interface these tests assume (new exports of run-pr.js, the developer implements them as named):
//   An entry ("pull"): the adapters' parsePulls shape (packages/shared/test/platforms-pr-list-812.test.js)
//     { number, title, url, author, draft, head, base, state, ci: { status }, review: { status }, conflicts: { status } }
//     plus runId (string | null: the run whose PR it is), and after grouping stack ({ position (1 = the bottom,
//     merged first), size } | null) and mergeOptions (pullOptions' answer).
//   groupPullRequests(pulls) → { needYou: [pull], waiting: [pull], others: [pull] }
//     others:  a PR with no run, and a Dependabot PR (author matching /dependabot/i), whatever its state;
//     needYou: state ready or conflict, or review.status changes_requested;
//     waiting: the rest (CI running: state pending; someone else's review: review.status required).
//     A stack (a PR whose base is another listed PR's head) stays together, bottom first, in the group of its
//     bottom PR (the next to merge); each member gets stack { position, size }, a lone PR stack: null.
//   pullOptions(pull, { canMerge = true, canBypass = false } = {}) → mergeOptions(pull, rights) (#810) plus askFix:
//     merge / bypass only on a stack's bottom PR (position 1 or no stack); askFix false for a PR with no run.
//   listPulls(projects, { reader, runs = [], hasCli = (cli) => installed }) → Promise<[{
//     projectId, platform: 'github' | 'gitlab' | null, error: string | null,
//     reason: null | 'no_remote' (no repository URL) | 'no_cli' (gh / glab missing),
//     groups: { needYou, waiting, others }   // empty lists with an error or a reason
//   }]>, one per project in the given order, never rejects: a project whose read fails has its error and the others
//   their lists. projects: [{ id, repo }]; runs: [{ id, pr: { url } }] (a PR's run is the run with its URL).
//   GitHub reads `gh pr list ...` (pullListCommand), GitLab `glab mr list ...`.
//   channels/pulls.js: (ctx) => [{ channel: 'pulls:list', method: 'listPullRequests', params: ['projectId'], fn }]
//     fn(opts) → ctx.listPullRequests(opts) → { projects: [listPulls' entries] } (the window.api name: listPullRequests).
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/run/run-pr');
const channels = () => require('../../service/channels/pulls');

let seq = 0;
const pull = (extra = {}) => {
  const number = extra.number ?? ++seq + 100;
  return {
    number, title: `PR ${number}`, url: `https://github.com/acme/shop/pull/${number}`, author: 'eduardo', draft: false,
    head: `feat-${number}`, base: 'main', state: 'open', runId: `r${number}`,
    ci: { status: 'passed', failed: [] }, review: { status: 'approved', by: [] }, conflicts: { status: 'none' }, ...extra,
  };
};
const READY = { state: 'ready', result: { ready: true, blockers: [] } };
const numbers = (g) => ({ needYou: (g.needYou || []).map((p) => p.number), waiting: (g.waiting || []).map((p) => p.number), others: (g.others || []).map((p) => p.number) });
const sorted = (g) => Object.fromEntries(Object.entries(numbers(g)).map(([k, v]) => [k, [...v].sort((a, b) => a - b)]));

// ---- groupPullRequests -------------------------------------------------------------------------

test('#812 grouping: ready, changes requested and a conflict need you; CI running and a review by someone else wait', () => {
  const g = load().groupPullRequests([
    pull({ number: 1, ...READY }),
    pull({ number: 2, state: 'open', review: { status: 'changes_requested', by: ['ana'] } }),
    pull({ number: 3, state: 'conflict', conflicts: { status: 'base' } }),
    pull({ number: 4, state: 'pending', ci: { status: 'running', failed: [] } }),
    pull({ number: 5, state: 'open', review: { status: 'required', by: [] } }),
  ]);
  assert.deepEqual(sorted(g), { needYou: [1, 2, 3], waiting: [4, 5], others: [] });
});

test('#812 grouping: a Dependabot PR and a PR with no run go to Others, even when ready to merge', () => {
  const g = load().groupPullRequests([
    pull({ number: 6, ...READY, author: 'app/dependabot', runId: null }),
    pull({ number: 7, ...READY, runId: null }),
    pull({ number: 8, state: 'conflict', conflicts: { status: 'base' }, runId: null }),
    pull({ number: 9, ...READY }),
  ]);
  assert.deepEqual(sorted(g), { needYou: [9], waiting: [], others: [6, 7, 8] });
});

test('#812 stacks: stacked PRs stay together in merge order (bottom first), in the group of the bottom PR', () => {
  const g = load().groupPullRequests([
    pull({ number: 23, head: 'stage-3', base: 'stage-2', state: 'pending', ci: { status: 'running', failed: [] } }),
    pull({ number: 21, head: 'stage-1', base: 'main', ...READY }),
    pull({ number: 22, head: 'stage-2', base: 'stage-1', state: 'open', review: { status: 'required', by: [] } }),
  ]);
  const stacks = (g.needYou || []).map((p) => [p.number, p.stack?.position, p.stack?.size]);
  assert.deepEqual([numbers(g), stacks], [{ needYou: [21, 22, 23], waiting: [], others: [] }, [[21, 1, 3], [22, 2, 3], [23, 3, 3]]]);
});

test('#812 stacks: a PR on its own has no stack', () => {
  const g = load().groupPullRequests([pull({ number: 30, ...READY })]);
  assert.equal(g.needYou[0].stack, null);
});

// ---- pullOptions -------------------------------------------------------------------------------

test('#812 stacks: only the bottom PR of a stack offers Merge; the ones above it still offer Close', () => {
  const { pullOptions } = load();
  const bottom = pullOptions(pull({ number: 21, ...READY, stack: { position: 1, size: 2 } }));
  const above = pullOptions(pull({ number: 22, ...READY, stack: { position: 2, size: 2 } }));
  assert.deepEqual([bottom.merge, bottom.close, above.merge, above.bypass, above.close], [true, true, false, false, true]);
});

test('#812 a PR with no run has Merge, Merge ignoring protection and Close as in a run, never Ask for a fix', () => {
  const { pullOptions } = load();
  const ready = pullOptions(pull({ number: 40, ...READY, runId: null, stack: null }));
  const approvals = pullOptions(pull({ number: 41, state: 'open', review: { status: 'required', by: [] }, runId: null, stack: null }), { canMerge: true, canBypass: true });
  const changes = pullOptions(pull({ number: 42, state: 'open', review: { status: 'changes_requested', by: ['ana'] }, runId: null, stack: null }));
  assert.deepEqual(
    [ready.merge, ready.close, ready.askFix, approvals.bypass, approvals.askFix, changes.askFix],
    [true, true, false, true, false, false],
  );
});

// ---- listPulls -----------------------------------------------------------------------------------

const GH_PR = (n, extra = {}) => ({
  number: n, title: `PR ${n}`, url: `https://github.com/acme/shop/pull/${n}`, author: { login: 'eduardo' }, isDraft: false,
  headRefName: `feat-${n}`, baseRefName: 'main', mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', reviewDecision: 'APPROVED',
  statusCheckRollup: [{ __typename: 'CheckRun', name: 'test', status: 'COMPLETED', conclusion: 'SUCCESS' }], ...extra,
});
const GL_MR = (iid) => ({
  iid, title: `MR ${iid}`, web_url: `https://gitlab.com/grp/site/-/merge_requests/${iid}`, author: { username: 'ana' }, draft: false,
  source_branch: `feat-${iid}`, target_branch: 'main', has_conflicts: false, detailed_merge_status: 'mergeable',
});

// a fake gh / glab: the list commands answer per repository, the broken one fails, any other read answers {}
function fakeReader(lists) {
  const calls = [];
  const reader = async (cli, args) => {
    calls.push([cli, ...args].join(' '));
    const line = args.join(' ');
    if (line.includes('acme/broken')) throw new Error(`${cli}: HTTP 404: Could not resolve to a Repository`);
    const listing = (cli === 'gh' && args[0] === 'pr' && args[1] === 'list') || (cli === 'glab' && args[0] === 'mr' && args[1] === 'list');
    if (!listing) return {};
    const repo = Object.keys(lists).find((r) => line.includes(r));
    return repo ? lists[repo] : [];
  };
  return { reader, calls };
}
const SHOP = { id: 'shop', repo: 'https://github.com/acme/shop' };
const BROKEN = { id: 'broken', repo: 'https://github.com/acme/broken' };
const SITE = { id: 'site', repo: 'https://gitlab.com/grp/site' };

test('#812 a failed read: the project says why and the others are still listed', async () => {
  const { reader } = fakeReader({ 'acme/shop': [GH_PR(1), GH_PR(2)] });
  const out = await load().listPulls([BROKEN, SHOP], { reader, runs: [{ id: 'r1', pr: { url: 'https://github.com/acme/shop/pull/1' } }], hasCli: () => true });
  const [broken, shop] = out;
  assert.deepEqual(
    [out.length, broken.projectId, typeof broken.error, /404|Could not resolve/.test(broken.error), sorted(broken.groups), shop.projectId, shop.error, sorted(shop.groups)],
    [2, 'broken', 'string', true, { needYou: [], waiting: [], others: [] }, 'shop', null, { needYou: [1], waiting: [], others: [2] }],
  );
});

test('#812 the PR of a run carries its run id; a PR no run opened carries none', async () => {
  const { reader } = fakeReader({ 'acme/shop': [GH_PR(1), GH_PR(2)] });
  const [shop] = await load().listPulls([SHOP], { reader, runs: [{ id: 'r1', pr: { url: 'https://github.com/acme/shop/pull/1' } }], hasCli: () => true });
  const all = [...shop.groups.needYou, ...shop.groups.waiting, ...shop.groups.others].map((p) => [p.number, p.runId]).sort((a, b) => a[0] - b[0]);
  assert.deepEqual(all, [[1, 'r1'], [2, null]]);
});

test('#812 GitHub projects are read with gh pr list, GitLab projects with glab mr list', async () => {
  const { reader, calls } = fakeReader({ 'acme/shop': [GH_PR(1)], 'grp/site': [GL_MR(7)] });
  const out = await load().listPulls([SHOP, SITE], { reader, runs: [], hasCli: () => true });
  assert.deepEqual(
    [out.map((p) => p.platform), calls.some((c) => c.startsWith('gh pr list')), calls.some((c) => c.startsWith('glab mr list')), out[1].groups.others.map((p) => p.number)],
    [['github', 'gitlab'], true, true, [7]],
  );
});

test('#812 empty states: no remote and no gh / glab are told apart and read nothing; no open PR is three empty groups', async () => {
  const { reader, calls } = fakeReader({ 'acme/shop': [] });
  const out = await load().listPulls(
    [{ id: 'local', repo: '' }, SITE, SHOP],
    { reader, runs: [], hasCli: (cli) => cli === 'gh' },
  );
  assert.deepEqual(
    [out.map((p) => [p.projectId, p.reason, p.error]), sorted(out[2].groups), calls.filter((c) => c.startsWith('glab')).length],
    [[['local', 'no_remote', null], ['site', 'no_cli', null], ['shop', null, null]], { needYou: [], waiting: [], others: [] }, 0],
  );
});

// ---- the channel -------------------------------------------------------------------------------

test('#812 channel pulls:list (window.api.listPullRequests) hands the project to the service', async () => {
  const seen = [];
  const ctx = { listPullRequests: async (opts) => { seen.push(opts?.projectId); return { projects: [] }; } };
  const entry = channels()(ctx).find((c) => c.channel === 'pulls:list');
  const answer = await entry.fn({ projectId: 'shop' });
  assert.deepEqual([entry.method, entry.params, seen, answer], ['listPullRequests', ['projectId'], ['shop'], { projects: [] }]);
});
