// #383: the app's form controls follow its dark theme instead of the OS's white native menus.
// style.css declares `color-scheme: dark` on :root; date and datetime-local inputs share the text
// inputs' rule (same height, border, radius); a select uses the customizable select
// (`appearance: base-select`) with its ::picker(select) popup styled from the app's tokens and the
// selected option marked; no stylesheet forces an option back to the OS colour
// (`option { color: initial; }` in project-city.css); checkboxes are 18px, the .small variant grows
// with them. The 3D view's light theme keeps its own `color-scheme: light`.
// Stylesheets are read as text with comments stripped (like renderer-styles.test.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'renderer');
function cssFiles(base, sub = '') {
  return fs.readdirSync(path.join(base, sub), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return cssFiles(base, path.join(sub, e.name));
    return e.name.endsWith('.css') ? [path.join(sub, e.name)] : [];
  });
}
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const sheets = cssFiles(dir).map((f) => ({ file: f.replace(/\\/g, '/'), css: strip(fs.readFileSync(path.join(dir, f), 'utf8')) }));
const sheet = (file) => sheets.find((s) => s.file === file).css;
const style = sheet('style.css');

// Innermost rules of a stylesheet: { selectors: [...], body } (an @media block's rules included).
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const selectors = m[1].split(',').map((s) => s.trim().replace(/\s+/g, ' ').replace(/=["']([^"']*)["']\]/g, '=$1]')).filter(Boolean);
    out.push({ selectors, body: m[2] });
  }
  return out;
}
const styleRules = rules(style);
const rootBody = () => styleRules.filter((r) => r.selectors.includes(':root')).map((r) => r.body).join('\n');

test('#383 style.css :root declares color-scheme: dark', () => {
  assert.match(rootBody(), /(^|[;\s])color-scheme:\s*dark\s*(;|$)/);
});

test('#383 date and datetime-local inputs share the rule of select and text inputs', () => {
  const wanted = ['select', 'input[type=text]', 'input[type=date]', 'input[type=datetime-local]'];
  const shared = styleRules.filter((r) => wanted.every((w) => r.selectors.includes(w)));
  assert.equal(shared.length >= 1, true, 'one rule lists select, input[type=text], input[type=date] and input[type=datetime-local]');
  const body = shared.map((r) => r.body).join('\n');
  assert.match(body, /border-radius:/, 'the shared rule sets the radius');
  assert.match(body, /padding:/, 'the shared rule sets the padding (same height as text inputs)');
});

test('#383 a select uses the customizable select (appearance: base-select)', () => {
  const hit = styleRules.filter((r) => r.selectors.includes('select') && /(^|[;\s{])appearance:\s*base-select/.test(r.body));
  assert.equal(hit.length >= 1, true);
});

test('#383 the select popup (::picker(select)) uses the app panel background and border tokens', () => {
  const picker = styleRules.filter((r) => r.selectors.some((s) => s.includes('::picker(select)')));
  assert.equal(picker.length >= 1, true, 'a ::picker(select) rule');
  const body = picker.map((r) => r.body).join('\n');
  assert.match(body, /background(-color)?:[^;]*var\(--panel/, 'background from --panel or --panel-2');
  assert.match(body, /border:[^;]*var\(--border\)/, 'border from --border');
});

test('#383 the selected option is marked (an option:checked rule)', () => {
  const hit = styleRules.filter((r) => r.selectors.some((s) => s.includes('option:checked')));
  assert.equal(hit.length >= 1, true);
});

test('#383 checkboxes are 18px (--check-size in :root)', () => {
  const m = /--check-size:\s*([\d.]+)px/.exec(rootBody());
  assert.equal(m && m[1], '18');
});

test('#383 the .small checkbox variant grows with the base size (between 14px and 18px)', () => {
  const small = styleRules.filter((r) => r.selectors.includes('.small') && /--check-size:/.test(r.body));
  assert.equal(small.length >= 1, true, 'a .small rule sets --check-size');
  for (const r of small) {
    const m = /--check-size:\s*([\d.]+)px/.exec(r.body);
    const px = m ? Number(m[1]) : NaN;
    assert.equal(px > 14 && px < 18, true, `.small --check-size is ${m ? m[1] + 'px' : 'not in px'}`);
  }
});

test('#383 no stylesheet sets color: initial on an option', () => {
  const offenders = [];
  for (const s of sheets) {
    for (const r of rules(s.css)) {
      const optionSelector = r.selectors.some((sel) => /(^|[\s>+~(,])option(?![\w-])/.test(sel));
      if (optionSelector && /(^|[;\s])color:\s*initial/.test(r.body)) offenders.push(`${s.file}: ${r.selectors.join(', ')}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('#383 the 3D view light theme keeps color-scheme: light (run3d.css)', () => {
  const hit = rules(sheet('run3d.css')).filter((r) => r.selectors.some((s) => s.includes('[data-theme=light]')) && /color-scheme:\s*light/.test(r.body));
  assert.equal(hit.length >= 1, true);
});
