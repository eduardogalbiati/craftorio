// #489 the release train (src/domains/night/night-watch.js): acceptance tests written before the code.
// Contract for the developer (every new name is reached inside each test):
//   PERMISSIONS gains { id: 'promote-release', label: 'Promote a release', ..., default: false }
//     (OFF by default: not in DEFAULT_PERMISSIONS nor in readPermissions' defaults);
//     permissionOf('release.promote') → 'promote-release'.
//   decideReleaseTrain({ mergesSinceStable, baseCheck: 'green' | 'red', allowed: [permission id], held })
//     → { action: 'none' | 'hold' | 'promote' | 'propose', reason }, at the night's end:
//     no merge since the last stable → 'none'; the candidate on Hold → 'hold' (never promoted by the
//     train, the reason says it is on hold); a red base check → 'hold' (the reason names the base
//     check); green with 'promote-release' allowed → 'promote'; green without it → 'propose' (waits
//     for the owner).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../src/domains/night/night-watch');
const train = (o) => load().decideReleaseTrain({ mergesSinceStable: 2, baseCheck: 'green', allowed: [], held: false, ...o });

test('#489 the night watch has a "Promote a release" permission, OFF by default', (t) => {
  const nw = load();
  const p = nw.PERMISSIONS.find((x) => x.id === 'promote-release');
  assert.ok(p, 'a permission with id promote-release');
  assert.match(p.label, /promote a release/i);
  assert.equal(p.default, false);
  assert.equal(nw.DEFAULT_PERMISSIONS.includes('promote-release'), false);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nw-489-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(nw.readPermissions(dir).allowed.includes('promote-release'), false);
  assert.equal(nw.savePermissions(dir, ['promote-release']).allowed.includes('promote-release'), true);
});

test('#489 a promotion needs the promote-release permission', () => {
  assert.equal(load().permissionOf('release.promote'), 'promote-release');
});

test('#489 train: no merge since the last stable proposes nothing', () => {
  assert.equal(train({ mergesSinceStable: 0, allowed: ['promote-release'] }).action, 'none');
});

test('#489 train: merges, a green base and the night\'s permission promote', () => {
  assert.equal(train({ allowed: ['promote-release'] }).action, 'promote');
});

test('#489 train: without the permission the promotion is proposed and waits for the owner', () => {
  const out = train({ allowed: ['retry', 'refresh'] });
  assert.equal(out.action, 'propose');
  assert.equal(typeof out.reason, 'string');
  assert.ok(out.reason.length > 0);
});

test('#489 train: a red base check holds the promotion and says why', () => {
  const out = train({ baseCheck: 'red', allowed: ['promote-release'] });
  assert.equal(out.action, 'hold');
  assert.match(out.reason, /base check/i);
});

test('#489 train: a candidate on Hold is never promoted by the train', () => {
  const out = train({ held: true, allowed: ['promote-release'] });
  assert.notEqual(out.action, 'promote');
  assert.equal(out.action, 'hold');
  assert.match(out.reason, /hold/i);
});
