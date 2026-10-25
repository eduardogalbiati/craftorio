// The E2E suite's entry (#222; phase 3 of docs/reorganisation-study-2026-10.md): generates the
// Playwright tests from the feature files (`bddgen`) and runs them (`playwright test`), for the whole
// repository or for one front's features.
//   npm run test:e2e                              every feature: features/, packages/ui-kit/features/,
//                                                 fronts/*/features/ (playwright.config.js)
//   npm run test:e2e -- --grep @smoke             the critical journeys
//   npm run test:e2e -w fronts/analyser           one front's features (`node scripts/e2e.js --front analyser`)
//   node scripts/e2e.js --front build -- --grep @smoke
// --front <id> names a front of scripts/source-tree.js (an unknown id is an error) and is passed to
// playwright.config.js as MULTIAGENT_E2E_FRONT, which then reads only `fronts/<id>/features/`; every
// steps folder stays loaded (the fronts share the shell's steps). What follows `--` (or any other
// argument) goes to `playwright test` as is. The binaries are node_modules/.bin's, run through
// runShim (packages/engine/domains/machine/shell.js: a .cmd shim on Windows needs cmd.exe, #218).

'use strict';

const path = require('path');
const { runShim } = require('@multiagent/engine/domains/machine/shell');
const { fronts } = require('./source-tree');

const ROOT = path.join(__dirname, '..');
const BIN = path.join(ROOT, 'node_modules', '.bin');
const bin = (name) => path.join(BIN, process.platform === 'win32' ? `${name}.cmd` : name);

/** { front, args }: the front id of `--front <id>` (null for all) and what goes to playwright test. */
function parseArgs(argv) {
  const args = [];
  let front = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--') continue;
    if (argv[i] === '--front') { front = argv[++i] || null; continue; }
    args.push(argv[i]);
  }
  return { front, args };
}

// the exit status of one of the binaries (1 when it is killed by a signal)
const run = (name, args, env) => new Promise((resolve) => {
  runShim(bin(name), args, { cwd: ROOT, stdio: 'inherit', env }).on('exit', (code) => resolve(code ?? 1)).on('error', (e) => { console.error(`e2e: ${e.message}`); resolve(1); });
});

async function main(argv = process.argv.slice(2)) {
  const { front, args } = parseArgs(argv);
  const env = { ...process.env };
  if (front) {
    const known = fronts(ROOT).map((f) => f.id);
    if (!known.includes(front)) {
      console.error(`e2e: unknown front "${front}" (fronts: ${known.join(', ') || 'none installed'})`);
      return 2;
    }
    env.MULTIAGENT_E2E_FRONT = front;
  } else delete env.MULTIAGENT_E2E_FRONT;
  const gen = await run('bddgen', [], env);
  if (gen !== 0) return gen;
  return run('playwright', ['test', ...args], env);
}

if (require.main === module) main().then((code) => process.exit(code));

module.exports = { parseArgs };
