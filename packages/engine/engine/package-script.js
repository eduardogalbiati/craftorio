// @ts-check
// The package script a suite command runs, and whether it compiles before testing (#212's single-file
// rounds, packages/engine/engine/suite-step.js filteredCommand).

'use strict';

const fs = require('fs');
const path = require('path');

// A package script whose earlier commands compile or build (`tsc -p . && node --test dist/test`): the
// files appended reach only its last command, which runs the compiled copies. `bddgen && playwright test`
// (#324) generates specs and compiles nothing: it still takes them.
const COMPILE_STEP = /\b(tsc|babel|swc|esbuild|webpack|rollup|vite build|(npm|pnpm|yarn)( run)? build[\w:-]*)\b/;
function compilesFirst(script) {
  const parts = String(script).split(/&&|\|\||;/);
  return parts.length > 1 && parts.slice(0, -1).some((p) => COMPILE_STEP.test(p));
}

// The package script a command runs (`npm test`, `npm run test:unit`, `pnpm test`, `yarn unit`...) as
// written in cwd's package.json, or null (not a package script, no package.json, no such script).
function packageScript(command, cwd) {
  if (!cwd) return null;
  const m = /^(?:npm|pnpm|yarn)(?: run(?:-script)?)? ([\w:.-]+)$/.exec(command);
  if (!m) return null;
  const name = m[1] === 't' ? 'test' : m[1];
  try { return JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8')).scripts?.[name] ?? null; } catch { return null; }
}

module.exports = { compilesFirst, packageScript };
