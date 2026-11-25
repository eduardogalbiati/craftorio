// The interface contract (T4 of the Craftorio migration): packages/contract/contract.json, the
// channels the engine's full composition declares (names, params, schemas, the desktop flag; never
// their code) and their contract hash (#339, packages/engine/service/contract.js). The app and the
// engine meet only through these channels; the file is what a release of either says it speaks, and
// what Changesets versions as @craftorio/contract. Generated from a service built in simulation on
// no workspace, so it reads nothing of the machine. The hash is also pinned in
// packages/engine/test/service/one-front-composition-590.test.js (MAIN_CONTRACT): `npm run contract`
// rewrites both, and `npm run check` (its `generated` rule, scripts/generated-files.js) says when
// either is behind, before the suite.
//   npm run contract            rewrites contract.json and the pin
//   node scripts/contract.js --check   exit 1 when contract.json or the pin is not the engine's current contract
require('@craftorio/engine/domains/workspace/legacy-env'); // MULTIAGENT_* → CRAFTORIO_* for scripts and shells written before the rename (T2b)
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'packages', 'contract', 'contract.json');
const PIN_FILE = path.join(__dirname, '..', 'packages', 'engine', 'test', 'service', 'one-front-composition-590.test.js');
const PIN = /^const MAIN_CONTRACT = '([0-9a-f]+)';$/m;
const NAME = (e) => e.channel || e.send || e.event || '';

// The contract of the engine's full composition: { hash, entries } in name order
function currentContract() {
  process.env.CRAFTORIO_SIMULATION_ONLY = '1';
  const { createService } = require('@craftorio/engine/service');
  const { contractHash } = require('@craftorio/engine/service/contract');
  const service = createService({ host: { appVersion: '0.0.0', isPackaged: false } });
  try {
    const entries = service.manifest
      .map((e) => ({ channel: e.channel, send: e.send, event: e.event, method: e.method, params: e.params, schema: e.schema, desktop: e.desktop }))
      .map((e) => Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined)))
      .sort((a, b) => (NAME(a) < NAME(b) ? -1 : NAME(a) > NAME(b) ? 1 : 0));
    return { hash: contractHash(service.manifest), entries };
  } finally {
    service.shutdown();
  }
}

const render = (contract) => `${JSON.stringify(contract, null, 1)}\n`;

// null when contract.json is current, else what to do (`contract`: the current one, when already built)
function checkContract(file = FILE, contract = currentContract()) {
  const want = render(contract);
  let have = null;
  try { have = fs.readFileSync(file, 'utf8'); } catch { /* missing */ }
  if (have === want) return null;
  const was = have ? (() => { try { return JSON.parse(have).hash; } catch { return 'unreadable'; } })() : 'missing';
  return `packages/contract/contract.json is not the engine's contract (${was} → ${contract.hash}): run npm run contract, and add a changeset for @craftorio/contract`;
}

// The hash the #590 test pins, or null when the file or its pin line is missing
function pinnedHash(file = PIN_FILE) {
  try { return PIN.exec(fs.readFileSync(file, 'utf8'))?.[1] ?? null; } catch { return null; }
}

// null when the #590 test pins `hash` (or has no pin to check), else what to do
function checkPin(hash, file = PIN_FILE) {
  const pinned = pinnedHash(file);
  if (pinned === null || pinned === hash) return null;
  return `${path.relative(path.join(__dirname, '..'), file).split(path.sep).join('/')} pins the contract hash ${pinned}, the engine's is ${hash}: run npm run contract (it rewrites the pin), and add a changeset for @craftorio/contract`;
}

// Rewrites the #590 test's pin to `hash`; false when the file has no pin line
function writePin(hash, file = PIN_FILE) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return false; }
  if (!PIN.test(text)) return false;
  const next = text.replace(PIN, `const MAIN_CONTRACT = '${hash}';`);
  if (next !== text) fs.writeFileSync(file, next);
  return true;
}

if (require.main === module) {
  const contract = currentContract();
  if (process.argv.includes('--check')) {
    const problems = [checkContract(FILE, contract), checkPin(contract.hash)].filter(Boolean);
    for (const p of problems) console.error(p);
    if (problems.length) process.exit(1);
    console.log('contract: current');
  } else {
    fs.writeFileSync(FILE, render(contract));
    const pinned = writePin(contract.hash);
    console.log(`contract: ${contract.entries.length} entries, hash ${contract.hash}${pinned ? '' : ' (no pin found in the #590 test)'}`);
  }
  process.exit(0);
}

module.exports = {
  checkContract,
  checkPin,
  currentContract,
  FILE,
  PIN_FILE,
  pinnedHash,
  writePin,
};
