// Affected tests (#212): prints the test files a change can break, from the import graph and the
// files changed since a base (packages/engine/engine/affected-tests.js, no model). Each file comes with why it
// was chosen ("imports packages/engine/domains/roadmap/roadmap.js", "reads fronts/plan/views/docs/docs.js"
// for a path the test reads from disk, #695); a shared root (package.json, ...) or a project without a JS
// graph prints "the whole suite". --json prints the whole selection; --files only the paths (one per
// line, for `npm test -- <files>`).
//   node scripts/affected-tests.js [--base main] [--root <dir>] [--json | --files]

const path = require('path');
const { affectedTests, selectionLines } = require('@multiagent/engine/engine/affected-tests');

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const root = path.resolve(opt('--root', process.cwd()));
const sel = affectedTests({ root, base: opt('--base', 'main') });

if (args.includes('--json')) console.log(JSON.stringify(sel, null, 2));
else if (args.includes('--files')) { if (sel.mode === 'affected') console.log(sel.files.join('\n')); else console.log('(all)'); }
else console.log(selectionLines(sel).join('\n'));
