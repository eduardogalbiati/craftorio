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

// #181: a human gate card in the run chat spans the conversation's full width, the message stays
// at a readable width, and the right column (Changed files, From the developer, Run files) gets
// the extra room, stacking under it on a narrow window.
test('styles: runchat.css\'s .rc-gate stretches to the full width instead of a centered 720px column', () => {
  const runchat = sheets.find((s) => s.file.replace(/\\/g, '/') === 'views/runchat/runchat.css').css;
  assert.match(runchat, /\.rc-gate\s*\{[^}]*align-self:\s*stretch[^}]*width:\s*100%/);
  assert.doesNotMatch(runchat, /\.rc-gate\s*\{[^}]*align-self:\s*center/);
  assert.doesNotMatch(runchat, /\.rc-gate\s*\{[^}]*width:\s*min\(720px/);
  assert.match(runchat, /\.rc-gate \.run-gate-wide\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*760px\)\s*minmax\(260px,\s*1fr\)/, 'the message column keeps a readable width, the rest goes to Artifacts');
  assert.match(runchat, /@media \(max-width:\s*1100px\)\s*\{\s*\.rc-gate \.run-gate-wide\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/, 'stacks to one column on a narrow window');
});

// #181: a gate's choice buttons (run chat, Run screen, Write & Review) sit side by side in one
// row, wrapping to a second line only when the card is too narrow, instead of stacking.
test('styles: .gate-choices lays the gate\'s choice buttons out in a wrapping row', () => {
  assert.match(style, /\.gate-choices\s*\{[^}]*display:\s*flex[^}]*flex-wrap:\s*wrap/);
  assert.match(style, /\.gate-choices \.btn\s*\{[^}]*white-space:\s*nowrap/, 'a button\'s label never wraps onto a second line by itself');
});

// #207: Backlog labels (Kanban cards, List rows, the filter menu and the active-filter chips) are a
// pastel background in the label's own colour, no border; the other card badges (epic, refreshed,
// triage, roadmap) follow the same filled style so a card never mixes outlined and filled chips.
test('styles (#207): .bl-label has no border and a pastel (color-mix) background, with a neutral fallback (--muted) for an uncoloured label', () => {
  const backlog = sheets.find((s) => s.file.replace(/\\/g, '/') === 'views/backlog/backlog.css').css;
  assert.match(backlog, /\.bl-label\s*\{[^}]*--lc:\s*var\(--muted\);[^}]*border:\s*1px solid transparent;[^}]*background:\s*color-mix\(in srgb, var\(--lc\) 18%, var\(--panel\)\);/);
  assert.doesNotMatch(backlog, /\.bl-label\s*\{[^}]*border:\s*1px solid var\(--lc\)/);
});

test('styles (#207): an active filter label (.bl-label.on) is a stronger mix with a focus-colour ring, not a border in the label\'s colour', () => {
  const backlog = sheets.find((s) => s.file.replace(/\\/g, '/') === 'views/backlog/backlog.css').css;
  assert.match(backlog, /\.bl-label\.on\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--lc\) 34%, var\(--panel\)\);[^}]*box-shadow:\s*0 0 0 1px var\(--accent\);/);
});

test('styles (#207): the epic badge and the other card badges (refreshed, triage, roadmap) are filled too, not outlined, so a card never mixes the two styles', () => {
  const backlog = sheets.find((s) => s.file.replace(/\\/g, '/') === 'views/backlog/backlog.css').css;
  assert.match(backlog, /\.bl-epic\s*\{[^}]*border:\s*1px solid transparent;[^}]*background:\s*color-mix\(in srgb, #8B5CF6 18%, var\(--panel\)\);/);
  assert.match(backlog, /\.bl-epic\.on\s*\{[^}]*background:\s*color-mix\(in srgb, #8B5CF6 34%, var\(--panel\)\);[^}]*box-shadow:\s*0 0 0 1px var\(--accent\);/);
  assert.match(backlog, /\.bl-labels \.badge\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*color-mix\(in srgb, currentColor 16%, var\(--panel\)\);/);
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
