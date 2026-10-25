// #383: a guard against new bare native controls in the renderer. A bare `<select`, `type="date"` or
// `type="datetime-local"` opens the OS's own menu; the files that have them when the guard lands are
// listed with their counts and may only shrink: a file not in the baseline with one fails, a listed
// file whose count grows past its baseline fails (like the file size ratchet, #334).
// Seam: scripts/bare-controls.js { BASELINE, countBareControls, checkBareControls }.
// The module is created by the change: it is loaded inside each test (tests first).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..', '..', '..');
const load = () => require('../../../scripts/bare-controls.js');

// A scratch tree: { 'apps/desktop/renderer/a.js': 'content', ... }.
function tree(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bare-controls-383-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }
  return dir;
}

// The files a check reports, sorted.
const files = (problems) => problems.map((p) => p.file).sort();
const counts = (c) => ({ select: c.select, date: c.date, datetime: c.datetime });

test('#383 countBareControls counts select tags, date and datetime-local inputs', () => {
  const { countBareControls } = load();
  const src = '<select id="a"></select>\n<select>\n<input type="date">\n<input type="datetime-local">';
  assert.deepEqual(counts(countBareControls(src)), { select: 2, date: 1, datetime: 1 });
});

test('#383 countBareControls of an empty source is all zero', () => {
  const { countBareControls } = load();
  assert.deepEqual(counts(countBareControls('')), { select: 0, date: 0, datetime: 0 });
});

test('#383 countBareControls takes single and double quotes for the input type', () => {
  const { countBareControls } = load();
  const src = "<input type='date'> <input type=\"date\"> <input type='datetime-local'> <input type=\"datetime-local\">";
  assert.deepEqual(counts(countBareControls(src)), { select: 0, date: 2, datetime: 2 });
});

test('#383 countBareControls does not count <selection> or <selectmenu as a select', () => {
  const { countBareControls } = load();
  assert.deepEqual(counts(countBareControls('<selection></selection> <selectmenu></selectmenu>')), { select: 0, date: 0, datetime: 0 });
  assert.deepEqual(counts(countBareControls('<select\n  id="x"> <select/> <select\tclass="y">')), { select: 3, date: 0, datetime: 0 });
});

test('#383 a datetime-local input is not also counted as a date input', () => {
  const { countBareControls } = load();
  assert.deepEqual(counts(countBareControls('<input type="datetime-local">')), { select: 0, date: 0, datetime: 1 });
});

test('#383 BASELINE lists renderer files with whole counts, totals no higher than the issue inventory', () => {
  const { BASELINE } = load();
  const keys = Object.keys(BASELINE);
  assert.equal(keys.length > 0, true);
  // the page's layers (phase 3 of the reorganisation study): the UI kit, a front, the app's page folder
  assert.deepEqual(keys.filter((k) => !/^(packages\/ui-kit|fronts\/[^/]+|apps\/[^/]+\/renderer)\//.test(k) || k.includes('\\')), [], 'repo-relative forward-slash paths under a page layer');
  const total = { select: 0, date: 0, datetime: 0 };
  for (const k of keys) {
    for (const kind of Object.keys(total)) {
      const n = BASELINE[k][kind] || 0;
      assert.equal(Number.isInteger(n) && n >= 0, true, `${k} ${kind}: a whole count`);
      total[kind] += n;
    }
  }
  // 74 of the issue inventory, plus the 4 of the browser app's page (apps/web/renderer/index.html, the desktop page's frame again)
  assert.equal(total.select <= 78, true, `select total ${total.select} <= 78`);
  assert.equal(total.date <= 6, true, `date total ${total.date} <= 6`);
  assert.equal(total.datetime <= 2, true, `datetime total ${total.datetime} <= 2`);
});

test('#383 a renderer file not in the baseline with a bare select is a problem', (t) => {
  const { checkBareControls } = load();
  const dir = tree(t, { 'apps/desktop/renderer/views/new/new.js': 'const html = `<select id="x"></select>`;\n' });
  const problems = checkBareControls({ root: dir, baseline: {} });
  assert.deepEqual(files(problems), ['apps/desktop/renderer/views/new/new.js']);
  assert.equal(problems[0].message.includes('apps/desktop/renderer/views/new/new.js'), true, 'the message names the file');
  assert.equal(typeof problems[0].kind, 'string');
});

test('#383 a baselined file whose count grew past its baseline is a problem', (t) => {
  const { checkBareControls } = load();
  const dir = tree(t, { 'apps/desktop/renderer/a.js': '<select> <select> <input type="date">' });
  const baseline = { 'apps/desktop/renderer/a.js': { select: 1, date: 1, datetime: 0 } };
  const problems = checkBareControls({ root: dir, baseline });
  assert.deepEqual(files(problems), ['apps/desktop/renderer/a.js']);
  assert.equal(problems[0].message.includes('apps/desktop/renderer/a.js'), true, 'the message names the file');
});

test('#383 a baselined file at or below its counts is not a problem', (t) => {
  const { checkBareControls } = load();
  const dir = tree(t, {
    'apps/desktop/renderer/at.js': '<select> <input type="date">',
    'apps/desktop/renderer/below.html': '<select>',
  });
  const baseline = {
    'apps/desktop/renderer/at.js': { select: 1, date: 1, datetime: 0 },
    'apps/desktop/renderer/below.html': { select: 3, date: 0, datetime: 1 },
  };
  assert.deepEqual(files(checkBareControls({ root: dir, baseline })), []);
});

test('#383 a file with no bare controls is not a problem', (t) => {
  const { checkBareControls } = load();
  const dir = tree(t, { 'apps/desktop/renderer/plain.js': 'const x = 1; // <selection> only\n', 'apps/desktop/renderer/page.html': '<div></div>' });
  assert.deepEqual(files(checkBareControls({ root: dir, baseline: {} })), []);
});

test('#383 an html file under apps/desktop/renderer is scanned too', (t) => {
  const { checkBareControls } = load();
  const dir = tree(t, { 'apps/desktop/renderer/index.html': '<input type="datetime-local">' });
  assert.deepEqual(files(checkBareControls({ root: dir, baseline: {} })), ['apps/desktop/renderer/index.html']);
});

test('#383 a file outside apps/desktop/renderer is not scanned', (t) => {
  const { checkBareControls } = load();
  const dir = tree(t, { 'src/x.js': '<select></select>', 'scripts/y.js': '<input type="date">' });
  assert.deepEqual(files(checkBareControls({ root: dir, baseline: {} })), []);
});

test('#383 this repository has no bare control beyond the baseline', () => {
  const { checkBareControls } = load();
  assert.deepEqual(checkBareControls({ root }).map((p) => p.message), []);
});
