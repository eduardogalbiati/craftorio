// #383: the app's select (packages/ui-kit/select.js). Two seams:
// - Select.markup(attrs, options, value): the markup of a select built from a list (tuples, objects,
//   plain values), the chosen option marked, labels and values escaped;
// - the search list a select with more than 10 options opens instead of the native one: opened by a
//   click, Enter, Space or Alt+Down; arrows, Home / End, Enter, typing and Esc; disabled options and
//   groups; a pick sets the native select's value and dispatches one bubbling change.
// The list is driven through events on a small parsed DOM (test/mini-dom.js). mini-dom has no
// HTMLSelectElement, `size` or `label`: the sandbox adds them as a browser has them. placePopover
// (run-list.js, the app's placement rule) is a recorded stub: there is no layout here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');
const { createDom } = require('./mini-dom');

const RENDERER = path.join(__dirname, '..');

// ---------- Select.markup ----------

test('#383 markup builds a select from [value, label, extra] tuples, marking the chosen and the disabled options', () => {
  const { markup } = require('../select.js');
  assert.equal(
    markup('id="pick" data-testid="pick"', [['a', 'Alpha'], ['b', 'Beta', { disabled: true }]], 'a'),
    '<select id="pick" data-testid="pick"><option value="a" selected>Alpha</option><option value="b" disabled>Beta</option></select>',
  );
});

test('#383 markup takes { value, label, disabled } objects and matches the chosen value as a string', () => {
  const { markup } = require('../select.js');
  assert.equal(
    markup('', [{ value: '1', label: 'One' }, { value: 2, label: 'Two', disabled: true }], 2),
    '<select ><option value="1">One</option><option value="2" selected disabled>Two</option></select>',
  );
});

test('#383 markup takes plain values as both value and label; no value marks no option', () => {
  const { markup } = require('../select.js');
  assert.equal(markup('', ['x', 'y'], 'y'), '<select ><option value="x">x</option><option value="y" selected>y</option></select>');
  assert.doesNotMatch(markup('', ['x', 'y']), /selected/);
  assert.match(markup('', [0, 1], 0), /<option value="0" selected>0<\/option>/);
});

test('#383 markup escapes option values and labels', () => {
  const { markup } = require('../select.js');
  const html = markup('', [['a"b', '<b>Tom & Jerry\'s</b>']]);
  assert.match(html, /value="a&quot;b"/);
  assert.match(html, />&lt;b&gt;Tom &amp; Jerry&#39;s&lt;\/b&gt;</);
  assert.doesNotMatch(html, /<b>/);
});

test('#383 markup keeps option markup given as a string', () => {
  const { markup } = require('../select.js');
  assert.equal(markup('id="s"', '<option value="k">K</option>'), '<select id="s"><option value="k">K</option></select>');
});

// ---------- the search list ----------

// 12 options: two groups, a disabled option, a disabled group; America/New_York is chosen.
const ZONES = `
  <option value="utc">UTC</option>
  <optgroup label="America">
    <option value="sp">America/São_Paulo</option>
    <option value="ny" selected>America/New_York</option>
    <option value="la" disabled>America/Los_Angeles</option>
  </optgroup>
  <optgroup label="Retired" disabled>
    <option value="old1">Etc/Old_One</option>
    <option value="old2">Etc/Old_Two</option>
  </optgroup>
  <optgroup label="Asia">
    <option value="tokyo">Asia/Tokyo</option>
    <option value="seoul">Asia/Seoul</option>
    <option value="kolkata">Asia/Kolkata</option>
  </optgroup>
  <option value="lon">Europe/London</option>
  <option value="par">Europe/Paris</option>
  <option value="ber">Europe/Berlin</option>`;
const TEN = Array.from({ length: 10 }, (_, i) => `<option value="v${i}">Option ${i}</option>`).join('');

function load(options = ZONES, attrs = '') {
  const placed = [];
  const sandbox = {
    console, setTimeout, clearTimeout,
    getComputedStyle: () => ({ getPropertyValue: () => '', colorScheme: '' }),
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  sandbox.HTMLSelectElement = class { static [Symbol.hasInstance](el) { return !!el && el.localName === 'select'; } };
  const proto = dom.classes.Element.prototype;
  Object.defineProperty(proto, 'size', { configurable: true, get() { return Number(this.getAttribute('size')) || 0; } });
  Object.defineProperty(proto, 'label', { configurable: true, get() { return this.getAttribute('label') ?? (this.localName === 'option' ? this.textContent : ''); } });
  sandbox.placePopover = (box, anchor) => placed.push({
    width: box.style.width, maxHeight: box.style.maxHeight,
    anchoredToSelect: anchor === sel, inPage: box.parentNode === dom.document.body,
  });
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['select-search.js', 'select.js']) vm.runInContext(fs.readFileSync(path.join(RENDERER, f), 'utf8'), sandbox, { filename: f });
  dom.document.body.innerHTML = `<button id="outside">elsewhere</button><select data-testid="zone" aria-label="Time zone" ${attrs}>${options}</select>`;
  const doc = dom.document;
  const sel = doc.querySelector('[data-testid="zone"]');
  const changes = [];
  doc.body.addEventListener('change', (e) => changes.push(e.target === sel ? sel.value : 'other'));
  const { MouseEvent, KeyboardEvent, Event } = dom.classes;
  const mousedown = (el) => { const e = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }); el.dispatchEvent(e); return e.defaultPrevented; };
  const key = (el, k, extra = {}) => { const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...extra }); el.dispatchEvent(e); return e.defaultPrevented; };
  const popover = () => doc.querySelector('[data-testid="select-popover"]');
  const search = () => doc.querySelector('[data-testid="select-search"]');
  const opts = () => [...popover().querySelectorAll('[role=option]')];
  const visible = () => opts().filter((o) => !o.hidden).map((o) => o.textContent);
  const optionNamed = (name) => opts().find((o) => o.textContent === name);
  const active = () => popover().querySelector('.active')?.textContent ?? null;
  const type = (q) => { const s = search(); s.value = q; s.dispatchEvent(new Event('input', { bubbles: true })); };
  const click = (el) => { mousedown(el); el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); };
  return { doc, sel, changes, placed, mousedown, key, popover, search, opts, visible, optionNamed, active, type, click, outside: doc.querySelector('#outside') };
}

test('#383 a click on a select with more than 10 options opens the search list instead of the native one', () => {
  const t = load();
  assert.equal(t.mousedown(t.sel), true, 'the native list is prevented');
  assert.equal(t.popover() === null, false, 'the search list is open');
  assert.equal(t.search().type, 'search');
  assert.equal(t.doc.activeElement === t.search(), true, 'the search box has the focus');
  assert.equal(t.popover().querySelector('[role=listbox]') === null, false);
  assert.equal(t.opts().length, 12);
  assert.equal(t.sel.getAttribute('aria-expanded'), 'true');
});

test('#383 a select with 10 options keeps the native list', () => {
  const t = load(TEN);
  assert.equal(t.mousedown(t.sel), false);
  assert.equal(t.popover(), null);
});

test('#383 a disabled select with more than 10 options opens nothing', () => {
  const t = load(ZONES, 'disabled');
  t.mousedown(t.sel);
  assert.equal(t.popover(), null);
});

test('#383 Enter, Space and Alt+Down on the focused select open the search list; a plain Down does not', () => {
  for (const [k, extra] of [['Enter', {}], [' ', {}], ['ArrowDown', { altKey: true }]]) {
    const t = load();
    assert.equal(t.key(t.sel, k, extra), true, `${JSON.stringify(k)} is taken`);
    assert.equal(t.popover() === null, false, `${JSON.stringify(k)} opens the list`);
  }
  const t = load();
  t.key(t.sel, 'ArrowDown');
  assert.equal(t.popover(), null);
});

test('#383 the list marks the chosen option, shows disabled options and groups disabled, and labels the groups', () => {
  const t = load();
  t.mousedown(t.sel);
  assert.deepEqual(t.opts().filter((o) => o.getAttribute('aria-selected') === 'true').map((o) => o.textContent), ['America/New_York']);
  assert.deepEqual(t.opts().filter((o) => o.getAttribute('aria-disabled') === 'true').map((o) => o.textContent),
    ['America/Los_Angeles', 'Etc/Old_One', 'Etc/Old_Two']);
  assert.deepEqual([...t.popover().querySelectorAll('[role=group]')].map((g) => g.getAttribute('aria-label')), ['America', 'Retired', 'Asia']);
  assert.equal(t.active(), 'America/New_York', 'the chosen option is the active one');
});

test('#383 arrows move through the pickable options and skip the disabled ones; Home and End go to the ends', () => {
  const t = load();
  t.mousedown(t.sel);
  t.key(t.search(), 'ArrowDown');
  assert.equal(t.active(), 'Asia/Tokyo', 'Los Angeles and the Retired group are skipped');
  t.key(t.search(), 'ArrowUp');
  t.key(t.search(), 'ArrowUp');
  assert.equal(t.active(), 'America/São_Paulo');
  t.key(t.search(), 'Home');
  assert.equal(t.active(), 'UTC');
  t.key(t.search(), 'ArrowUp');
  assert.equal(t.active(), 'UTC', 'stays on the first');
  t.key(t.search(), 'End');
  assert.equal(t.active(), 'Europe/Berlin');
  t.key(t.search(), 'ArrowDown');
  assert.equal(t.active(), 'Europe/Berlin', 'stays on the last');
});

test('#383 Enter picks the active option: the select takes its value, one change bubbles, the list closes and the select has the focus', () => {
  const t = load();
  t.mousedown(t.sel);
  t.key(t.search(), 'ArrowDown');
  t.key(t.search(), 'Enter');
  assert.equal(t.sel.value, 'tokyo');
  assert.deepEqual(t.changes, ['tokyo']);
  assert.equal(t.popover(), null);
  assert.equal(t.sel.getAttribute('aria-expanded'), 'false');
  assert.equal(t.doc.activeElement === t.sel, true);
});

test('#383 a click on an option picks it', () => {
  const t = load();
  t.mousedown(t.sel);
  t.click(t.optionNamed('Europe/Paris'));
  assert.equal(t.sel.value, 'par');
  assert.deepEqual(t.changes, ['par']);
  assert.equal(t.popover(), null);
});

test('#383 a disabled option and an option of a disabled group cannot be picked', () => {
  const t = load();
  t.mousedown(t.sel);
  t.click(t.optionNamed('America/Los_Angeles'));
  t.click(t.optionNamed('Etc/Old_One'));
  assert.equal(t.sel.value, 'ny');
  assert.deepEqual(t.changes, []);
  assert.equal(t.popover() === null, false, 'the list stays open');
});

test('#383 picking the option already chosen dispatches no change', () => {
  const t = load();
  t.mousedown(t.sel);
  t.key(t.search(), 'Enter');
  assert.equal(t.sel.value, 'ny');
  assert.deepEqual(t.changes, []);
  assert.equal(t.popover(), null);
});

test('#383 typing filters the options, ignoring case and accents, hides the groups left empty and makes the first match active', () => {
  const t = load();
  t.mousedown(t.sel);
  t.type('TOKYO');
  assert.deepEqual(t.visible(), ['Asia/Tokyo']);
  const groups = [...t.popover().querySelectorAll('[role=group]')].map((g) => [g.getAttribute('aria-label'), g.hidden]);
  assert.deepEqual(groups, [['America', true], ['Retired', true], ['Asia', false]]);
  assert.equal(t.active(), 'Asia/Tokyo');
  t.type('sao');
  assert.deepEqual(t.visible(), ['America/São_Paulo']);
  t.key(t.search(), 'Enter');
  assert.equal(t.sel.value, 'sp');
  assert.deepEqual(t.changes, ['sp']);
});

test('#383 a search with no match says so and Enter picks nothing', () => {
  const t = load();
  t.mousedown(t.sel);
  const empty = () => [...t.popover().querySelectorAll('div')].find((d) => /No option matches/.test(d.textContent) && !d.querySelector('div'));
  assert.equal(empty().hidden, true, 'hidden while options match');
  t.type('zzz');
  assert.deepEqual(t.visible(), []);
  assert.equal(empty().hidden, false);
  t.key(t.search(), 'Enter');
  assert.equal(t.sel.value, 'ny');
  assert.deepEqual(t.changes, []);
  t.type('');
  assert.equal(t.visible().length, 12);
  assert.equal(empty().hidden, true);
});

test('#383 a search that matches only disabled options counts as no match', () => {
  const t = load();
  t.mousedown(t.sel);
  t.type('Los_Angeles');
  assert.equal(t.active(), null);
  t.key(t.search(), 'Enter');
  assert.deepEqual(t.changes, []);
});

test('#383 Escape closes the list without a change and gives the focus back to the select', () => {
  const t = load();
  t.mousedown(t.sel);
  t.key(t.search(), 'ArrowDown');
  t.key(t.search(), 'Escape');
  assert.equal(t.popover(), null);
  assert.equal(t.sel.value, 'ny');
  assert.deepEqual(t.changes, []);
  assert.equal(t.doc.activeElement === t.sel, true);
});

test('#383 a click outside the list closes it; a second click on the select closes it too', () => {
  const t = load();
  t.mousedown(t.sel);
  t.mousedown(t.outside);
  assert.equal(t.popover(), null);
  t.mousedown(t.sel);
  assert.equal(t.popover() === null, false);
  t.mousedown(t.sel);
  assert.equal(t.popover(), null);
  assert.deepEqual(t.changes, []);
});

test('#383 the list is sized from the select and the larger free side, then placed by the app\'s popover rule', () => {
  const t = load();
  t.sel.getBoundingClientRect = () => ({ top: 500, bottom: 530, left: 40, right: 340, width: 300, height: 30, x: 40, y: 500 });
  t.doc.documentElement.clientHeight = 700;
  t.mousedown(t.sel);
  // 170 px free below, 500 above: the larger side less a 14 px margin, at most 360
  assert.deepEqual(t.placed, [{ width: '300px', maxHeight: '360px', anchoredToSelect: true, inPage: true }]);
});

test('#383 a narrow select near the top gets a 220 px wide list, as tall as the space below allows', () => {
  const t = load();
  t.sel.getBoundingClientRect = () => ({ top: 20, bottom: 50, left: 0, right: 90, width: 90, height: 30, x: 0, y: 20 });
  t.doc.documentElement.clientHeight = 300;
  t.mousedown(t.sel);
  assert.deepEqual(t.placed.map((p) => [p.width, p.maxHeight]), [['220px', '236px']]);
});
