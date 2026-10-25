// #388: the run's 3D view draws a frame only when something changes. The run's <Canvas>
// (packages/ui-kit/run3d/main.jsx) renders on demand and the scene asks for frames (invalidate) on a
// change or while an animation that matters moves; the replay's clock loop spins only while a replay
// plays; and a hidden or minimised window stops the scene (the overlay packages/ui-kit/run3d.js unmounts
// it or stops its loop), then brings it back when the window shows again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const sceneSources = () => fs.readdirSync(path.join(ROOT, 'packages/ui-kit/run3d'))
  .filter((f) => /\.(js|jsx)$/.test(f))
  .map((f) => read(`packages/ui-kit/run3d/${f}`));

test('#388 the run\'s Canvas renders on demand (frameloop="demand"), as the project city does', () => {
  const src = read('packages/ui-kit/run3d/main.jsx');
  const canvas = /<Canvas\b[^>]*>/.exec(src);
  assert.ok(canvas, 'main.jsx draws a <Canvas>');
  assert.match(canvas[0], /\bframeloop=(?:"demand"|'demand'|\{\s*['"]demand['"]\s*\}|\{)/, 'the <Canvas> tag declares its frameloop');
  // a computed frameloop (e.g. 'never' while hidden) is fine, as long as 'demand' is what it shows
  assert.match(src, /['"]demand['"]/, 'the frameloop is "demand"');
});

test('#388 the run\'s scene asks for frames itself: invalidate() from @react-three/fiber on changes and moving animations', () => {
  const all = sceneSources().join('\n');
  assert.equal(/\binvalidate\s*\(\s*\)/.test(all), true, 'some source of packages/ui-kit/run3d/ calls invalidate()');
  assert.equal(/\binvalidate\b[^\n]*=\s*useThree\(|useThree\(\s*\(?\s*\w*\s*\)?\s*=>\s*\w+\.invalidate|\{[^}]*\binvalidate\b[^}]*\}\s*=\s*useThree\(|import\s*\{[^}]*\binvalidate\b[^}]*\}\s*from\s*'@react-three\/fiber'/.test(all), true,
    'invalidate comes from React Three Fiber (useThree() or its import)');
});

test('#388 the replay\'s clock loop (requestAnimationFrame) spins only while a replay plays, not while the view is idle', () => {
  const src = read('packages/ui-kit/run3d/main.jsx');
  const start = src.indexOf('function useReplay(');
  assert.ok(start >= 0, 'main.jsx has the replay hook useReplay()');
  const next = src.indexOf('\nfunction ', start + 1);
  const body = src.slice(start, next < 0 ? undefined : next);
  if (!/requestAnimationFrame\(/.test(body)) return; // the clock moved elsewhere: nothing spins here
  // the loop depends on the player's state: it reads playing/moving, or wakes on the player's notices
  assert.match(body, /\.(?:playing|moving)\b|\.subscribe\(/, 'the requestAnimationFrame loop is started and stopped with the replay, not run forever');
});

// --- the overlay, in a sandbox: a fake DOM just large enough for open() / close() -----------------
function fakeElement(tag = 'div') {
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(), dataset: {}, attrs: {}, innerHTML: '', className: '', removed: false, child: null,
    setAttribute(k, v) { this.attrs[k] = String(v); },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter((f) => f !== fn); },
    querySelector(sel) { if (sel === '.r3d-root') { this.child ||= fakeElement(); return this.child; } return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    append() {}, remove() { this.removed = true; }, focus() {},
    getContext() { return null; },
  };
  return el;
}

function overlaySandbox() {
  const docListeners = {};
  const winListeners = {};
  const intervals = new Map();
  let nextTimer = 1;
  const mounts = [];
  const calls = []; // every call made on a scene handle: "<mount#>:<method>"
  const document = {
    hidden: false, visibilityState: 'visible',
    body: fakeElement('body'), head: fakeElement('head'),
    createElement: (tag) => fakeElement(tag),
    querySelectorAll: () => [],
    addEventListener(type, fn) { (docListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { docListeners[type] = (docListeners[type] || []).filter((f) => f !== fn); },
    get activeElement() { return null; },
  };
  const player = { add() {}, interrupt() {}, notify() {}, setMainGates() {}, playing: false, moving: false };
  const sandbox = {
    console, Promise, Error, String, Object, Array, Set, Map, Math, Date, JSON,
    document,
    setTimeout: () => 0, clearTimeout: () => {},
    setInterval: (fn, ms) => { const id = nextTimer++; intervals.set(id, ms); return id; },
    clearInterval: (id) => { intervals.delete(id); },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {},
    addEventListener(type, fn) { (winListeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) { winListeners[type] = (winListeners[type] || []).filter((f) => f !== fn); },
    Run3DTheme: { load: () => 'dark', save: () => true },
    Run3DReplay: { Run3DPlayer: function Run3DPlayer() { return player; } },
    api: {
      onEvent: () => () => {},
      runEvents: async () => [{ seq: 1, run_id: 'run-1', type: 'workflow.started', ts: '2026-10-15T10:00:00.000Z' }],
      listWorkflows: async () => [],
    },
    state: { workflows: [{ name: 'wf', file: 'wf.yaml', steps: [] }] },
    isRunLive: () => true,
    esc: (s) => String(s), errMsg: (e) => String(e?.message || e),
    Run3DScene: {
      webgl: () => '',
      mount(element, opts) {
        const n = mounts.length + 1;
        mounts.push({ opts });
        return new Proxy({}, {
          get(_, key) {
            if (typeof key !== 'string' || key === 'then') return undefined;
            return (...args) => { calls.push(`${n}:${key}`); return undefined; };
          },
        });
      },
    },
  };
  sandbox.window = sandbox;
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(read('packages/ui-kit/run3d.js'), sandbox, { filename: 'run3d.js' });
  const fire = (type) => {
    for (const fn of [...(docListeners[type] || [])]) fn({ type, target: document });
    for (const fn of [...(winListeners[type] || [])]) fn({ type, target: sandbox });
  };
  const setHidden = (hidden) => {
    document.hidden = hidden;
    document.visibilityState = hidden ? 'hidden' : 'visible';
    fire('visibilitychange');
  };
  return { sandbox, mounts, calls, setHidden, intervals };
}
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };

test('#388 a hidden or minimised window stops the 3D scene (unmounted, or its loop stopped), and it comes back when shown', async () => {
  const box = overlaySandbox();
  await box.sandbox.Run3D.open('run-1');
  await flush();
  assert.equal(box.mounts.length, 1, 'the scene is mounted when the overlay opens');
  assert.equal(box.sandbox.Run3D.isOpen(), true);

  const before = box.calls.length;
  box.setHidden(true);
  await flush();
  const onHide = box.calls.slice(before);
  const overlayStopped = onHide.length > 0; // unmount(), or a call that stops the loop (pause/sleep/…)
  // the scene may watch the page's visibility itself instead: its loop switched off ('never') while hidden
  const scene = sceneSources().join('\n');
  const sceneStops = /visibilitychange/.test(scene) && /frameloop=\{[^}]*['"]never['"]/.test(scene);
  assert.equal(overlayStopped || sceneStops, true,
    `hiding the window stops the scene: calls on its handle ${JSON.stringify(onHide)}, or the scene's own frameloop 'never' while hidden`);

  if (!overlayStopped) return; // the scene handles it: nothing more the overlay must do
  const unmounted = onHide.includes('1:unmount');
  const atHide = box.calls.length;
  box.setHidden(false);
  await flush();
  const resumed = box.mounts.length === 2 || box.calls.slice(atHide).some((c) => !c.endsWith(':unmount'));
  assert.equal(resumed, true, unmounted ? 'shown again: the scene is mounted again' : 'shown again: the scene\'s loop runs again');
  assert.equal(box.sandbox.Run3D.isOpen(), true, 'the overlay stays open across hiding');
  box.sandbox.Run3D.close();
});
