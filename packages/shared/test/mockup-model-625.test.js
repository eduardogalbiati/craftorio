'use strict';
// #625 Project mockups (Phase 0 + Phase 1 MVP): packages/shared/mockup-model.js, the pure rules of the
// mockups (no fs, no Electron). Written before the code: the module is loaded inside each test so every
// test fails on its own. The contract:
// - FRAMES = [{ id: 'desktop-1440', width: 1440 }, { id: 'tablet-768', width: 768 }, { id: 'phone-390', width: 390 }],
//   DEFAULT_FRAME = 'desktop-1440';
// - slugify(title) → lowercase ASCII kebab-case, accents stripped, punctuation dropped, never empty ('screen');
// - addMids(html) → every element gets data-mid="m<n>" (document order, skipping used numbers), an existing
//   data-mid kept, idempotent, only the elements inside <body> of a full document;
// - buildChatMessage({ mockup, version, frame, selection, area, refs, message }) → that shape, defaults
//   frame DEFAULT_FRAME, selection [], area null, refs []; selection entries keep only
//   mid, selector, kit, text, box, html, crop; throws on an empty message;
// - lintMockup({ html, css, tokens }) → [{ rule, value }]: raw-color, unknown-token, large-script (> 2000 chars);
// - estimateCost(action) → { model, min, max } (USD), unknown action throws;
// - extractTokens(files) → { tokens: [{ name, value, file, line }], fonts }; tokensCss(tokens) → a :root block.
// Assumption beyond the contract: a token's `name` is the custom property name; the tests accept it with or
// without its leading `--` from extractTokens, and give tokensCss names with the `--`.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../mockup-model');

const midOf = (html, tag) => (new RegExp(`<${tag}\\b[^>]*data-mid="([^"]*)"`).exec(html) || [])[1] ?? null;

// ---- frames, slugify ---------------------------------------------------------------------------

test('#625 FRAMES lists desktop, tablet and phone widths and the default frame is desktop-1440', () => {
  const m = load();
  assert.deepEqual(m.FRAMES.map((f) => [f.id, f.width]), [['desktop-1440', 1440], ['tablet-768', 768], ['phone-390', 390]]);
  assert.equal(m.DEFAULT_FRAME, 'desktop-1440');
});

test('#625 slugify makes lowercase ASCII kebab-case (punctuation dropped, accents stripped, blank → "screen")', () => {
  const { slugify } = load();
  assert.deepEqual([slugify('Orders Dashboard!'), slugify('Painel de Ações'), slugify('   ')], ['orders-dashboard', 'painel-de-acoes', 'screen']);
});

// ---- addMids -----------------------------------------------------------------------------------

test('#625 addMids numbers the elements m1, m2 in document order', () => {
  const out = load().addMids('<header><button>Export</button></header>');
  assert.deepEqual([midOf(out, 'header'), midOf(out, 'button')], ['m1', 'm2']);
});

test('#625 addMids keeps an existing data-mid and skips its number', () => {
  const out = load().addMids('<header><button data-mid="m1">X</button></header>');
  assert.deepEqual([midOf(out, 'header'), midOf(out, 'button')], ['m2', 'm1']);
});

test('#625 addMids is idempotent', () => {
  const { addMids } = load();
  const once = addMids('<main><h1>Orders</h1><ul><li>A</li><li>B</li></ul></main>');
  assert.equal(addMids(once), once);
});

test('#625 addMids on a full document marks the body\'s elements and none in the head', () => {
  const out = load().addMids('<!doctype html><html><head><meta charset="utf-8"><title>T</title></head><body><main><p>Hi</p></main></body></html>');
  const head = out.slice(out.indexOf('<head'), out.indexOf('</head>'));
  assert.equal(head.includes('data-mid'), false, head);
  assert.deepEqual([midOf(out, 'main') !== null, midOf(out, 'p') !== null], [true, true]);
});

// ---- buildChatMessage --------------------------------------------------------------------------

test('#625 buildChatMessage fills the defaults: desktop frame, no selection, no area, no refs', () => {
  const msg = load().buildChatMessage({ mockup: 'orders-dashboard', version: 'abc123', message: 'Make it denser' });
  assert.deepEqual(msg, { mockup: 'orders-dashboard', version: 'abc123', frame: 'desktop-1440', selection: [], area: null, refs: [], message: 'Make it denser' });
});

test('#625 buildChatMessage keeps only mid, selector, kit, text, box, html and crop of a selection entry', () => {
  const entry = { mid: 'm2', selector: 'header > button.export', kit: 'button', text: 'Export', box: [1, 2, 3, 4], html: '<button>Export</button>', crop: 'refs/a.png', extra: 'drop me', el: {} };
  const msg = load().buildChatMessage({ mockup: 'x', version: 'v', selection: [entry], message: 'Bigger' });
  assert.deepEqual(Object.keys(msg.selection[0]).sort(), ['box', 'crop', 'html', 'kit', 'mid', 'selector', 'text']);
});

test('#625 buildChatMessage refuses a whitespace-only message', () => {
  const { buildChatMessage } = load(); // outside assert.throws: a missing module must not pass
  assert.throws(() => buildChatMessage({ mockup: 'x', version: 'v', message: '   ' }));
});

// ---- lintMockup --------------------------------------------------------------------------------

const TOKENS = ':root {\n  --primary: #1a73e8;\n  --surface: #ffffff;\n  --gap: 8px;\n}\n';

test('#625 lintMockup reports a hex color in the css and an rgb() in an inline style that are not token values as raw-color', () => {
  const problems = load().lintMockup({ html: '<div class="a" style="background: rgb(1, 2, 3)">x</div>', css: '.a { color: #ff0000; border-color: #1a73e8; }', tokens: TOKENS });
  const raw = problems.filter((p) => p.rule === 'raw-color').map((p) => String(p.value));
  assert.deepEqual([raw.includes('#ff0000'), raw.some((v) => v.startsWith('rgb')), raw.includes('#1a73e8')], [true, true, false], JSON.stringify(problems));
});

test('#625 lintMockup reports var(--name) of an undeclared token as unknown-token', () => {
  const problems = load().lintMockup({ html: '<div class="a">x</div>', css: '.a { color: var(--missing); }', tokens: TOKENS });
  assert.equal(problems.some((p) => p.rule === 'unknown-token' && String(p.value).includes('--missing')), true, JSON.stringify(problems));
});

test('#625 lintMockup reports an inline script longer than 2000 characters as large-script', () => {
  const big = `<div>x</div><script>${'a'.repeat(2001)}</script>`;
  const small = `<div>x</div><script>${'a'.repeat(100)}</script>`;
  const { lintMockup } = load();
  assert.deepEqual([
    lintMockup({ html: big, css: '', tokens: TOKENS }).some((p) => p.rule === 'large-script'),
    lintMockup({ html: small, css: '', tokens: TOKENS }).some((p) => p.rule === 'large-script'),
  ], [true, false]);
});

test('#625 lintMockup finds nothing in markup that only uses declared tokens', () => {
  const problems = load().lintMockup({
    html: '<div class="a" style="padding: var(--gap)">x</div>',
    css: '.a { color: var(--primary); background: var(--surface); }',
    tokens: TOKENS,
  });
  assert.deepEqual(problems, []);
});

// ---- estimateCost ------------------------------------------------------------------------------

test('#625 estimateCost gives the D15 table for each action', () => {
  const { estimateCost } = load();
  assert.deepEqual(['build-kit', 'generate-screen', 'chat-edit', 'review-screen', 'lint'].map((a) => estimateCost(a)), [
    { model: 'opus', min: 1.5, max: 4 },
    { model: 'opus', min: 0.4, max: 1.2 },
    { model: 'sonnet', min: 0.03, max: 0.3 },
    { model: 'sonnet', min: 0.1, max: 0.4 },
    { model: null, min: 0, max: 0 },
  ]);
});

test('#625 estimateCost refuses an unknown action', () => {
  const { estimateCost } = load(); // outside assert.throws: a missing module must not pass
  assert.throws(() => estimateCost('paint-the-moon'));
});

// ---- extractTokens / tokensCss -----------------------------------------------------------------

const FILES = [
  { file: 'src/theme.css', text: ':root {\n  --primary: #1a73e8;\n  --gap:   8px  ;\n}\nbody { font-family: "Inter", sans-serif; }\n' },
  { file: 'src/brand.css', text: '@font-face { font-family: \'Brand Sans\'; src: url(brand.woff2); }\n.card { --radius: 4px; font-family: Inter, Arial; }\n' },
];

test('#625 extractTokens lists every custom property with its trimmed value, file and 1-based line, in file order', () => {
  const { tokens } = load().extractTokens(FILES);
  assert.deepEqual(tokens.map((t) => [String(t.name).replace(/^--/, ''), t.value, t.file, t.line]), [
    ['primary', '#1a73e8', 'src/theme.css', 2],
    ['gap', '8px', 'src/theme.css', 3],
    ['radius', '4px', 'src/brand.css', 2],
  ]);
});

test('#625 extractTokens lists each font family once, quotes removed', () => {
  assert.deepEqual(load().extractTokens(FILES).fonts, ['Inter', 'Brand Sans']);
});

test('#625 tokensCss writes one declaration per token, in order, inside a :root block', () => {
  const css = load().tokensCss([{ name: '--primary', value: '#1a73e8' }, { name: '--gap', value: '8px' }]);
  assert.match(css, /:root\s*\{/);
  assert.deepEqual([css.indexOf('--primary: #1a73e8;') >= 0, css.indexOf('--gap: 8px;') > css.indexOf('--primary: #1a73e8;'), css.includes('----')], [true, true, false]);
});
