// The generated files and limits a change must keep, checked before the suite (`npm run check`'s
// `generated` rule, which a run's rule_check step runs after every developer commit): each finding names
// the command that fixes it, instead of a test failing late in the suite.
// - packages/contract/contract.json is the engine's current contract (scripts/contract.js; the
//   suite's packages/contract/test/contract.test.js): `npm run contract`;
// - the contract hash pinned in packages/engine/test/service/one-front-composition-590.test.js
//   (MAIN_CONTRACT) is the engine's: `npm run contract` rewrites it too (it failed 22 of 127 runs
//   between 2026-11-01 and 2026-11-25, always in the suite);
// - no doc of docs/agents/ grows over the size limit (200 lines; test/docs-topic-indexes-573.test.js) but
//   the ones not split yet (DOCS_NOT_SPLIT_YET, the same list as that test's): split it into
//   docs/agents/<topic>/ files and run `npm run docs`.
// The contract is checked only on this checkout (the engine that builds it is this one's), and each part
// only where its files exist, so a scratch root (the rules' own tests) has no finding.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// docs/agents files over the limit that are not split yet (test/docs-topic-indexes-573.test.js lists the same)
const DOCS_NOT_SPLIT_YET = [
  'docs/agents/capabilities.md',
  'docs/agents/decisions.md',
  'docs/agents/engine/gates-and-run-end.md',
];

// root → [finding]
function checkGenerated(root = ROOT) {
  const problems = [];
  const contractFile = path.join(root, 'packages', 'contract', 'contract.json');
  if (path.resolve(root) === path.resolve(ROOT) && fs.existsSync(contractFile)) {
    const { checkContract, checkPin, currentContract } = require('./contract');
    const contract = currentContract();
    problems.push(...[checkContract(contractFile, contract), checkPin(contract.hash)].filter(Boolean));
  }
  if (fs.existsSync(path.join(root, 'docs', 'agents'))) {
    const { oversizedDocs } = require('./docs');
    for (const d of oversizedDocs(root)) {
      if (DOCS_NOT_SPLIT_YET.includes(d.file)) continue;
      problems.push(`${d.file} has ${d.lines} lines, over the docs' limit of 200: split it into subtopic files under docs/agents/<topic>/ (each with its heading and summary line), then run npm run docs`);
    }
  }
  return problems;
}

module.exports = { checkGenerated, DOCS_NOT_SPLIT_YET };
