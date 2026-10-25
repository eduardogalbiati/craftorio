// packages/ui-kit/run3d-theme.js: the themes of the run's 3D view. Which palette is picked, how the
// choice is remembered (and that the view goes on without storage), that the dark one is the app's
// own tokens and the light one the proof of concept's, and that both paint every state.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const T = require('../run3d-theme');

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', '..', '..', rel), 'utf8');
// a storage like localStorage, over a plain object
const storage = (data = {}) => ({ data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } });
const broken = { getItem() { throw new Error('storage is disabled'); }, setItem() { throw new Error('quota exceeded'); } };
// the shape of a palette: its keys, nested (not the colours)
const shape = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, v && typeof v === 'object' ? shape(v) : typeof v]));

test('pick: dark is the default, also for a name that is no theme; the toggle goes to the other one', () => {
  assert.equal(T.DEFAULT, 'dark');
  assert.deepEqual(T.NAMES, ['dark', 'light']);
  assert.equal(T.pick().name, 'dark');
  assert.equal(T.pick('light').name, 'light');
  assert.equal(T.pick('solarized'), T.pick('dark'));
  assert.equal(T.pick('light'), T.THEMES.light, 'the same object each time: a hook can compare it');
  assert.equal(T.other('dark'), 'light');
  assert.equal(T.other('light'), 'dark');
  assert.equal(T.other('nothing'), 'light', 'from the default');
});

test('the choice is remembered in localStorage and read back', () => {
  const store = storage();
  assert.equal(T.load(store), 'dark', 'nothing stored yet');
  assert.equal(T.save('light', store), true);
  assert.deepEqual(store.data, { [T.KEY]: 'light' });
  assert.equal(T.KEY, 'multiagent.run3d.theme');
  assert.equal(T.load(store), 'light', 'a later opening, or the app restarted');
  assert.equal(T.save('dark', store), true);
  assert.equal(T.load(store), 'dark');
});

test('storage that is missing, refuses or holds something else is not an error: dark, and nothing saved', () => {
  assert.equal(T.load(broken), 'dark');
  assert.equal(T.save('light', broken), false);
  assert.equal(T.load(null), 'dark', 'a window without localStorage');
  assert.equal(T.save('light', null), false);
  assert.equal(T.load(storage({ [T.KEY]: 'neon' })), 'dark', 'a value that is no theme');
  const store = storage();
  assert.equal(T.save('neon', store), false, 'only a theme is remembered');
  assert.deepEqual(store.data, {});
  // no argument: this process has no localStorage, or one that works; neither throws
  assert.ok(T.NAMES.includes(T.load()));
});

test('dark follows the app\'s own tokens (style.css :root)', () => {
  const root = /:root\s*\{([^}]*)\}/.exec(read('packages/ui-kit/style.css'))[1];
  const token = (name) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(root)?.[1].toLowerCase();
  const dark = T.THEMES.dark;
  for (const [name, value] of Object.entries(dark.app)) assert.equal(value, token(name), `--${name} of style.css`);
  assert.deepEqual(Object.keys(dark.app), ['bg', 'panel', 'panel-2', 'border', 'text', 'muted', 'accent', 'green', 'yellow', 'red']);
  // and the scene is painted with them
  assert.equal(dark.sky, dark.app.bg, 'the background');
  assert.equal(dark.card, dark.app.panel);
  assert.equal(dark.board, dark.app.panel);
  assert.equal(dark.ink, dark.app.text);
  assert.equal(dark.muted, dark.app.muted);
  assert.equal(dark.accent, dark.app.accent);
  assert.equal(dark.laneDone, dark.app.accent);
  assert.deepEqual([dark.status.running, dark.status.done, dark.status.waiting, dark.status.failed], [dark.app.accent, dark.app.green, dark.app.yellow, dark.app.red]);
});

test('light is the palette of the approved proof of concept', () => {
  const light = T.THEMES.light;
  assert.deepEqual(light.status, { pending: '#A7B0C2', running: '#4C6FFF', done: '#1FAE6E', changes: '#E39A12', failed: '#EA4E4B', waiting: '#E39A12' });
  assert.deepEqual([light.sky, light.floor, light.wall, light.pad, light.lane, light.laneDone], ['#E8EDF7', '#EDF0F8', '#DCE3F1', '#FFFFFF', '#DDE3F0', '#4C6FFF']);
  assert.deepEqual([light.wood, light.chair, light.gate, light.supervisor], ['#B58A63', '#394055', '#E0A93B', '#7C5CFF']);
  assert.deepEqual(light.light, { sky: '#FFFFFF', ground: '#CBD5EC', hemi: 1.95, sun: 1.45 });
});

test('both themes paint the same things: one palette shape, every colour a #RRGGBB', () => {
  const { app, ...dark } = T.THEMES.dark;
  assert.ok(app);
  assert.deepEqual(shape(dark), shape(T.THEMES.light));
  const colours = (o) => Object.values(o).flatMap((v) => (v && typeof v === 'object' ? colours(v) : typeof v === 'string' && v.startsWith('#') ? [v] : []));
  for (const name of T.NAMES) for (const c of colours(T.THEMES[name])) assert.match(c, /^#[0-9a-fA-F]{6}$/, `${name}: ${c}`);
});

test('state colours keep their meaning in both themes: grey queued, the accent running, green done, amber waiting and changes, red failed', () => {
  const hue = (hex) => {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max - min < 40) return 'grey';
    const h = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    return h < 0.35 || h > 5.6 ? 'red' : h < 1.2 ? 'amber' : h < 2.8 ? 'green' : 'blue';
  };
  for (const name of T.NAMES) {
    const s = T.THEMES[name].status;
    assert.deepEqual(Object.keys(s), ['pending', 'running', 'done', 'changes', 'failed', 'waiting'], name);
    assert.deepEqual(Object.values(s).map(hue), ['grey', 'blue', 'green', 'amber', 'red', 'amber'], name);
    assert.equal(s.running, T.THEMES[name].accent, `${name}: running is the accent`);
  }
});

test('on the dark theme every state colour reads on the cards and on the floor (contrast of 3 or more)', () => {
  assert.equal(T.contrast('#000000', '#ffffff'), 21);
  assert.equal(T.contrast('#777777', '#777777'), 1);
  const dark = T.THEMES.dark;
  for (const [state, colour] of Object.entries(dark.status)) {
    for (const on of ['card', 'floor', 'pad', 'sky']) assert.ok(T.contrast(colour, dark[on]) >= 3, `${state} ${colour} on the ${on} ${dark[on]}: ${T.contrast(colour, dark[on]).toFixed(2)}`);
  }
  assert.ok(T.contrast(dark.ink, dark.card) >= 7, 'the text on a card');
  assert.ok(T.contrast(dark.muted, dark.card) >= 4.5, 'the muted text on a card');
  assert.ok(T.contrast(dark.onAccent, dark.accent) >= 4.5, 'the text on an accent button');
  assert.ok(T.contrast(dark.laneDone, dark.lane) >= 3, 'the travelled lane on the lane');
  // the floor's pieces are told apart: the pads and the lane from the floor, the floor from the background
  assert.ok(T.contrast(dark.pad, dark.sky) > T.contrast(dark.floor, dark.sky));
  assert.ok(T.contrast(dark.lane, dark.floor) > 1.2);
});

test('the HUD\'s stylesheet: dark by default from the app\'s variables, light under data-theme, the same variables in both', () => {
  const css = read('packages/ui-kit/run3d.css');
  const dark = /\.r3d \{([^}]*)\}/.exec(css)[1], light = /\.r3d\[data-theme="light"\] \{([^}]*)\}/.exec(css)[1];
  for (const [mine, app] of [['bg', 'bg'], ['ink', 'text'], ['muted', 'muted'], ['accent', 'accent'], ['green', 'green'], ['amber', 'yellow'], ['red', 'red'], ['line', 'border']]) {
    assert.match(dark, new RegExp(`--r3d-${mine}: var\\(--${app}, #[0-9a-f]{6}\\)`), `--r3d-${mine} is the app's --${app}`);
  }
  assert.match(light, /--r3d-bg: #E8EDF7;/);
  assert.match(light, /--r3d-accent: #4C6FFF;/);
  const names = (block) => [...block.matchAll(/(--r3d-[a-z0-9-]+):/g)].map((m) => m[1]).sort();
  assert.deepEqual(names(light), names(dark).filter((n) => n !== '--r3d-radius'), 'light sets every colour dark sets');
  assert.match(dark, /color-scheme: dark;/);
  assert.match(light, /color-scheme: light;/);
  // no colour of one theme left in a rule: the rules only use the variables (state colours come in --c)
  const rules = css.slice(css.indexOf('.r3d *,'));
  assert.deepEqual(rules.match(/#[0-9A-Fa-f]{3,6}\b/g) || [], [], 'a literal colour in a rule would not follow the theme');
});

test('the overlay applies the remembered theme before the scene loads, and remembers the toggle\'s choice', () => {
  const src = read('packages/ui-kit/run3d.js');
  assert.match(src, /el\.dataset\.theme = Run3DTheme\.load\(\);/);
  assert.match(src, /onTheme: \(name\) => \{ el\.dataset\.theme = name; Run3DTheme\.save\(name\); \}/);
  const hud = read('packages/ui-kit/run3d/hud.jsx');
  // #330: the name comes from the catalog ("Switch to the dark theme" in English)
  assert.match(hud, /const switchTheme = t\('run3d\.switch_theme', \{ theme: t\(`run3d\.theme_\$\{next\}`\) \}\);/);
  assert.match(hud, /data-testid="run3d-theme"/);
  assert.match(hud, /aria-label=\{switchTheme\}/, 'the toggle has an accessible name');
  assert.match(hud, /title=\{switchTheme\}/, 'and a tooltip');
  const I18n = require('@multiagent/shared/i18n.js');
  assert.equal(I18n.t('run3d.switch_theme', { theme: I18n.t('run3d.theme_dark') }), 'Switch to the dark theme');
});
