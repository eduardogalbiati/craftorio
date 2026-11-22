// #185 Before/after screenshots: a click (or context / paste) selector that matches nothing on the
// original side, while the modified side succeeded, is an element the change adds: recorded as
// "not on the original (new element)", not an error; the modified screenshot is kept.
//
// Seam: packages/engine/engine/screenshot-step.js captureScreenshots (existing export) with an injected
// `run` (the screenshot command, writes <out>/<name>.<side>.png or fails like scripts/screenshot.js
// does: exit 1, last line "screenshot: nothing matches <selector>") and a fake `slot`.
// New output field (#185):
//   new_elements: [{ name, side: 'original', selector?, error? }] — one per screen whose original
//     failed only because its selector matched nothing while its modified side was taken;
//     always an array ([] when none). Those screens are not in `errors`.
//   message: "<n> screenshots of <m> screens taken in round <r>; <k> new element(s) (no original)"
//     (then "; <e> errors: …" for real errors).
// A selector missing on both sides, a crash of the original side or a failure on the modified side
// stays an error.
// Artifacts panel (packages/ui-kit/artifacts-panel.js, extras.capture = that output): such a screen
// shows its modified image alone, labelled "new element", with no error line and no original slot.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { captureScreenshots } = require('@craftorio/engine/engine/screenshot-step');
const { fakeRoot, loadPanel, waitTick } = require('@craftorio/ui-kit/test/artifacts-panel-helpers');

function tmpDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const slot = async () => ({ token: 'tok', release: () => {} });

// outcomes: { '<name>.<side>': 'ok' | '<last output line>' }; anything not listed is 'ok'
function fakeRun(outcomes) {
  return async ({ args }) => {
    const out = args[args.indexOf('--out') + 1];
    const name = args[args.indexOf('--name') + 1];
    const side = args[args.indexOf('--side') + 1];
    const r = outcomes[`${name}.${side}`] || 'ok';
    if (r === 'ok') {
      fs.writeFileSync(path.join(out, `${name}.${side}.png`), 'PNG');
      return { code: 0, output: '', timedOut: false };
    }
    return { code: 1, output: `capturing...\n${r}\n`, timedOut: false };
  };
}

function opts(t, entries, outcomes) {
  const cwd = tmpDir(t, 'wt-');
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { screenshot: 'node scripts/screenshot.js' } }));
  return { entries, cwd, runDir: tmpDir(t, 'run-'), folder: 'developer', round: 1, base: 'main', env: {}, mock: false, slot, run: fakeRun(outcomes) };
}

const REFRESH = { name: '161-backlog-refresh-now', caption: 'Refresh now', args: ['--view', 'backlog', '--click', '[data-refresh-now]'] };
const MISSING_REFRESH = 'screenshot: nothing matches [data-refresh-now]';

test('a click selector that exists only on the modified side is a new element: no error, the modified image kept', async (t) => {
  const out = await captureScreenshots(opts(t, [REFRESH], { '161-backlog-refresh-now.original': MISSING_REFRESH }));
  assert.deepEqual(out.errors, []);
  assert.equal(out.new_elements.length, 1);
  assert.equal(out.new_elements[0].name, '161-backlog-refresh-now');
  assert.equal(out.new_elements[0].side, 'original');
  assert.deepEqual(out.screenshots.map((s) => s.side), ['modified']);
  assert.equal(out.taken, 1);
  assert.equal(out.screens, 1);
});

test('the step message counts new elements apart from errors: "4 screenshots of 3 screens … 2 new elements (no original)"', async (t) => {
  const entries = [
    { name: '161-backlog-default', caption: 'Backlog', args: ['--view', 'backlog'] },
    REFRESH,
    { name: '161-backlog-paste', caption: 'Paste', args: ['--view', 'backlog', '--paste', '[data-paste-box]'] },
  ];
  const out = await captureScreenshots(opts(t, entries, {
    '161-backlog-refresh-now.original': MISSING_REFRESH,
    '161-backlog-paste.original': 'screenshot: nothing matches [data-paste-box]',
  }));
  assert.match(out.message, /^4 screenshots of 3 screens taken in round 1/);
  assert.match(out.message, /2 new elements \(no original\)/);
  assert.doesNotMatch(out.message, /error/i);
  assert.doesNotMatch(out.message, /nothing matches/);
  assert.deepEqual(out.errors, []);
});

test('a selector that matches nothing on both sides is still an error, not a new element', async (t) => {
  const out = await captureScreenshots(opts(t, [REFRESH], {
    '161-backlog-refresh-now.modified': MISSING_REFRESH,
    '161-backlog-refresh-now.original': MISSING_REFRESH,
  }));
  assert.deepEqual(out.new_elements, []);
  assert.ok(out.errors.some((e) => e.side === 'modified' && /nothing matches \[data-refresh-now\]/.test(e.error)));
  assert.equal(out.taken, 0);
});

test('a crash of the modified side is still an error, even when the original side matched nothing', async (t) => {
  const out = await captureScreenshots(opts(t, [REFRESH], {
    '161-backlog-refresh-now.modified': 'TypeError: Cannot read properties of undefined (reading \'click\')',
    '161-backlog-refresh-now.original': MISSING_REFRESH,
  }));
  assert.deepEqual(out.new_elements, []);
  assert.ok(out.errors.some((e) => e.side === 'modified' && /TypeError/.test(e.error)));
});

test('an original side that crashes for another reason is still an error, with the modified image kept', async (t) => {
  const out = await captureScreenshots(opts(t, [REFRESH], { '161-backlog-refresh-now.original': 'Error: the window never loaded' }));
  assert.deepEqual(out.new_elements, []);
  assert.equal(out.errors.length, 1);
  assert.equal(out.errors[0].side, 'original');
  assert.match(out.message, /1 error/);
});

test('the gate\'s Artifacts panel shows a new element\'s modified image alone, labelled new element, with no error line', async () => {
  const file = '/r/evidence/developer/round-1/161-backlog-refresh-now.modified.png';
  const ev = {
    version: 1, base: 'main', branch: 'feat/161', final: { step: 'developer', round: 1 },
    rounds: [{ step: 'developer', round: 1, captured_at: '2026-10-03T00:00:00Z', final: true }],
    images: [{ path: 'evidence/developer/round-1/161-backlog-refresh-now.modified.png', file, pair: null, side: 'modified', key: '161-backlog-refresh-now', issue: '161', caption: 'Refresh now', commit: 'abc1234', step: 'developer', round: 1, final: true }],
  };
  const capture = {
    kind: 'screenshots', folder: 'developer', round: 1, taken: 1, screens: 1, errors: [], reason: null,
    new_elements: [{ name: '161-backlog-refresh-now', side: 'original', error: 'exit 1: screenshot: nothing matches [data-refresh-now]' }],
    message: '1 screenshot of 1 screen taken in round 1; 1 new element (no original)',
  };
  const files = [{ path: file, name: '161-backlog-refresh-now.modified.png', rel: ev.images[0].path, kind: 'image', category: 'screenshots', size: 1, mtime: '2026-10-03T00:00:00Z' }];
  const { ArtifactsPanel } = loadPanel({ listArtifacts: async () => [{ artifacts: files }], runEvidence: async () => ev });
  const { root } = fakeRoot();
  ArtifactsPanel.mount(root, { runId: 'r1', flat: true, extras: { capture } });
  await waitTick();
  assert.equal((root.innerHTML.match(/<figure>/g) || []).length, 1, 'the modified image alone, no original slot');
  assert.match(root.innerHTML, /new element/i);
  assert.doesNotMatch(root.innerHTML, /class="error[^"]*"[^>]*>[^<]*nothing matches/);
});
