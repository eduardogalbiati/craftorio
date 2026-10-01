// The renderer's stylesheets: one checkbox/radio style and one scrollbar style for the whole app,
// defined once from CSS variables. Chromium ignores ::-webkit-scrollbar on an element that sets
// scrollbar-width or scrollbar-color, so a one-off rule would bring back the platform's bar there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'src', 'renderer');
// Top-level stylesheets and each screen's own CSS in views/<view>/<view>.css (#78).
function cssFiles(base, sub = '') {
  return fs.readdirSync(path.join(base, sub), { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return cssFiles(base, path.join(sub, e.name));
    return e.name.endsWith('.css') ? [path.join(sub, e.name)] : [];
  });
}
const sheets = cssFiles(dir).map((f) => ({ file: f, css: fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '') }));
const style = sheets.find((s) => s.file === 'style.css').css;
const root = /:root\s*\{([^}]*)\}/.exec(style)[1];

test('styles: the checkbox and scrollbar variables are defined once, in :root', () => {
  for (const v of ['--check-size', '--check-radius', '--focus-ring', '--scrollbar-size', '--scrollbar-thumb', '--scrollbar-thumb-hover', '--scrollbar-track']) {
    assert.match(root, new RegExp(`${v}\\s*:`), `${v} in :root`);
  }
});

test('styles: checkboxes and radios drop the native look app-wide', () => {
  assert.match(style, /input\[type=checkbox\],\s*input\[type=radio\]\s*\{[^}]*appearance:\s*none/);
  for (const state of [':checked', ':indeterminate', ':disabled', ':focus-visible']) {
    assert.ok(style.includes(`input[type=checkbox]${state}`), `a ${state} state`);
  }
});

test('styles: the scrollbar style is global, with no one-off scrollbar rules', () => {
  assert.match(style, /(^|\n)::-webkit-scrollbar-thumb\s*\{/);
  const oneOff = [];
  for (const { file, css } of sheets) {
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*scrollbar-(?:width|color)[^{}]*)\}/g)) {
      const selector = m[1].trim();
      const global = selector === '*' && file === 'style.css';
      const hidden = /scrollbar-width:\s*none/.test(m[2]);
      if (!global && !hidden) oneOff.push(`${file}: ${selector}`);
    }
  }
  assert.deepEqual(oneOff, []);
});
