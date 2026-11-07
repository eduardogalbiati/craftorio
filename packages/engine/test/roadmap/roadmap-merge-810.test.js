// #810 merge a pull request from the app: a merge that landed counts as merged for the Roadmap, one that did not land
// never does (packages/engine/domains/roadmap/roadmap-status.js mergedPullRequest, exported by roadmap.js).
// Acceptance tests, written before the code, on a run folder's events.jsonl.
//
// The interface these tests assume:
// - A merge tried from the app records the event `pr.merge` { step_id, url, number, admin, merged: boolean,
//   commit? (the merge commit, when merged), error? (the platform's message, when not), by? }.
// - mergedPullRequest(runDir) is true for a `pr.merge` with merged: true, never for merged: false; the existing
//   rule stays (an `action.executed` `gh pr merge` / `glab mr merge` counts only with exit 0, unskipped).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const roadmaps = require('../../domains/roadmap/roadmap');

function runDir(t, events) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-merge-810-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));
  return dir;
}
const URL = 'https://github.com/acme/app/pull/42';

test('#810 mergedPullRequest: a merge from the app that landed (pr.merge merged) counts as merged', (t) => {
  const dir = runDir(t, [{ type: 'pr.merge', step_id: 'pr_monitor', url: URL, number: 42, admin: false, merged: true, commit: 'abc1234' }]);
  assert.equal(roadmaps.mergedPullRequest(dir), true);
});

test('#810 mergedPullRequest: a merge from the app that failed never reads as merged', (t) => {
  const dir = runDir(t, [
    { type: 'pr.merge', step_id: 'pr_monitor', url: URL, number: 42, admin: false, merged: false, error: 'Pull Request is not mergeable' },
    { type: 'action.executed', command: 'gh pr merge 42 --repo github.com/acme/app --merge --admin', exit_code: 1 },
  ]);
  assert.equal(roadmaps.mergedPullRequest(dir), false);
});
