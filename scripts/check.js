// The repository's fast, deterministic rule checks in one command (issue #404), run by the developer
// before its final answer and by the check step of ai-development-local-hero after develop. Each
// rule calls the same code its test asserts with: lint:lists, layers, the file-size ratchet, code
// health, the decisions log, docs --check, the typecheck (ratchet and checker) and the Oracle's
// capabilities list. One line per finding (`<rule>: <what broke and how to fix it>`), then
// `checks: pass` or `checks: N finding(s)` and exit 1. The suite still runs the rule tests.
//
//   npm run check                       every rule on this checkout
//   node scripts/check.js --root <dir>  every rule on another checkout

const path = require('path');
const { checkComplexity, checkDuplication } = require('./code-health');
const { checkDecisions, checkOracleCapabilities } = require('./doc-rules');
const { checkDocs } = require('./docs');
const { checkFileSizes } = require('./file-size-ratchet');
const { checkLayers } = require('./layers');
const { lintFiles } = require('./lint-lists');
const { checkRatchet, typecheck } = require('./typecheck');

const ROOT = path.join(__dirname, '..');
const rel = (root, file) => (path.isAbsolute(file) ? path.relative(root, file) : file).replace(/\\/g, '/');

// [name, async (root) => [message]] in the order they run
const RULES = [
  ['lint:lists', (root) => lintFiles(root).map((p) => p.message)],
  ['layers', (root) => checkLayers({ root }).map((p) => p.message)],
  ['file-size', (root) => checkFileSizes({ root }).map((p) => p.message)],
  ['code-health', (root) => [...checkComplexity({ root }), ...checkDuplication({ root })].map((p) => p.message)],
  ['decisions', (root) => checkDecisions(root).map((p) => p.message)],
  ['docs', (root) => checkDocs(root)],
  ['oracle-capabilities', (root) => checkOracleCapabilities(root).map((p) => p.message)],
  ['typecheck', async (root) => [
    ...checkRatchet({ root }).map((p) => p.message),
    ...(await typecheck({ root })).map((e) => `${rel(root, e.file)}:${e.line} ${e.message}`),
  ]],
];

// [`<rule>: <message>`]; a rule that throws is a finding too (named, with its error)
async function runChecks(root = ROOT, rules = RULES) {
  const lines = [];
  for (const [name, check] of rules) {
    try {
      for (const message of await check(root)) lines.push(`${name}: ${message}`);
    } catch (err) {
      lines.push(`${name}: the check failed to run: ${err && err.message}`);
    }
  }
  return lines;
}

async function main(argv = process.argv.slice(2)) {
  const at = argv.indexOf('--root');
  const root = at >= 0 ? path.resolve(argv[at + 1]) : ROOT;
  const lines = await runChecks(root);
  for (const line of lines) console.log(line);
  console.log(lines.length ? `checks: ${lines.length} finding(s)` : 'checks: pass');
  return lines.length ? 1 : 0;
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = {
  main,
  RULES,
  runChecks,
};
