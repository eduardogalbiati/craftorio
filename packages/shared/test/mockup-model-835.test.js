'use strict';
// #835 Project mockups, phase 2: the new pure rules of packages/shared/mockup-model.js (no fs, no Electron).
// Written before the code: the module is loaded inside each test so every test fails on its own. The contract:
// - diffMids(beforeHtml, afterHtml) → the sorted data-mid values of the elements that changed (text or
//   attributes changed, added or removed); identical markup → [];
// - normalizeFlow({ name, links }, screens?) → { name, links: [{ from: { screen, mid }, to }] }; throws on an
//   empty or not slug-like name, a link without from.screen, from.mid or to, and (with `screens`) a link
//   from or to a screen not in the list;
// - flowTarget(flow, screen, mid) → the target screen's slug, or null;
// - FRAMES unchanged: desktop-1440, tablet-768, phone-390.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../mockup-model');

// refused: the call throws, and not because the function is missing (then the test must stay red)
const refuses = (fn) => {
  try { fn(); return false; } catch (e) { if (e instanceof TypeError && /is not a function/.test(e.message)) throw e; return true; }
};

const BEFORE = '<body><h1 data-mid="m1">A</h1><p data-mid="m2">x</p><p data-mid="m3">y</p></body>';
const AFTER = '<body><h1 data-mid="m1">B</h1><p data-mid="m2">x</p><button data-mid="m4">go</button></body>';

const FLOW = { name: 'checkout', links: [{ from: { screen: 'cart', mid: 'm1' }, to: 'pay' }] };

// ---- frames ------------------------------------------------------------------------------------

test('#835 FRAMES still lists desktop-1440, tablet-768 and phone-390 with their widths', () => {
  assert.deepEqual(load().FRAMES.map((f) => [f.id, f.width]), [['desktop-1440', 1440], ['tablet-768', 768], ['phone-390', 390]]);
});

// ---- diffMids ----------------------------------------------------------------------------------

test('#835 diffMids lists the changed, removed and added data-mids, sorted', () => {
  assert.deepEqual(load().diffMids(BEFORE, AFTER), ['m1', 'm3', 'm4']);
});

test('#835 diffMids of identical markup is []', () => {
  assert.deepEqual(load().diffMids(BEFORE, BEFORE), []);
});

test('#835 diffMids sees an attribute change on an element whose text is the same', () => {
  const after = BEFORE.replace('<p data-mid="m2">', '<p data-mid="m2" class="lead">');
  assert.deepEqual(load().diffMids(BEFORE, after), ['m2']);
});

// ---- normalizeFlow -----------------------------------------------------------------------------

test('#835 normalizeFlow gives back { name, links: [{ from: { screen, mid }, to }] }', () => {
  assert.deepEqual(load().normalizeFlow(FLOW), { name: 'checkout', links: [{ from: { screen: 'cart', mid: 'm1' }, to: 'pay' }] });
});

test('#835 normalizeFlow refuses an empty name and a name that is not slug-like', () => {
  const { normalizeFlow } = load();
  assert.deepEqual(['', '  ', 'Check Out!', '../x'].map((name) => refuses(() => normalizeFlow({ ...FLOW, name }))), [true, true, true, true]);
});

test('#835 normalizeFlow refuses a link without from.screen, without from.mid or without to', () => {
  const { normalizeFlow } = load();
  const bad = [
    { from: { mid: 'm1' }, to: 'pay' },
    { from: { screen: 'cart' }, to: 'pay' },
    { from: { screen: 'cart', mid: 'm1' } },
  ];
  assert.deepEqual(bad.map((link) => refuses(() => normalizeFlow({ name: 'checkout', links: [link] }))), [true, true, true]);
});

test('#835 normalizeFlow with a screens list refuses a link to a screen not in the list', () => {
  assert.equal(refuses(() => load().normalizeFlow(FLOW, ['cart'])), true);
});

test('#835 normalizeFlow with a screens list refuses a link from a screen not in the list', () => {
  assert.equal(refuses(() => load().normalizeFlow(FLOW, ['pay'])), true);
});

test('#835 normalizeFlow with a screens list holding both screens accepts the flow', () => {
  assert.deepEqual(load().normalizeFlow(FLOW, ['cart', 'pay']).links.map((l) => [l.from.screen, l.from.mid, l.to]), [['cart', 'm1', 'pay']]);
});

// ---- flowTarget --------------------------------------------------------------------------------

test('#835 flowTarget gives the target screen of a linked element', () => {
  assert.equal(load().flowTarget(FLOW, 'cart', 'm1'), 'pay');
});

test('#835 flowTarget of an element without a link is null', () => {
  assert.equal(load().flowTarget(FLOW, 'cart', 'm9'), null);
});

test('#835 flowTarget of the same mid on another screen is null', () => {
  assert.equal(load().flowTarget(FLOW, 'pay', 'm1'), null);
});
