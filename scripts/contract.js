// The interface contract (T4 of the Craftorio migration): packages/contract/contract.json, the
// channels the engine's full composition declares (names, params, schemas, the desktop flag; never
// their code) and their contract hash (#339, packages/engine/service/contract.js). The app and the
// engine meet only through these channels; the file is what a release of either says it speaks, and
// what Changesets versions as @craftorio/contract. Generated from a service built in simulation on
// no workspace, so it reads nothing of the machine.
//   npm run contract            rewrites contract.json
//   node scripts/contract.js --check   exit 1 when contract.json is not the engine's current contract
require('@craftorio/engine/domains/workspace/legacy-env'); // MULTIAGENT_* → CRAFTORIO_* for scripts and shells written before the rename (T2b)
const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', 'packages', 'contract', 'contract.json');
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

// null when contract.json is current, else what to do
function checkContract(file = FILE) {
  const want = render(currentContract());
  let have = null;
  try { have = fs.readFileSync(file, 'utf8'); } catch { /* missing */ }
  if (have === want) return null;
  const was = have ? (() => { try { return JSON.parse(have).hash; } catch { return 'unreadable'; } })() : 'missing';
  return `packages/contract/contract.json is not the engine's contract (${was} → ${JSON.parse(want).hash}): run npm run contract, and add a changeset for @craftorio/contract`;
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const problem = checkContract();
    if (problem) { console.error(problem); process.exit(1); }
    console.log('contract: current');
  } else {
    const contract = currentContract();
    fs.writeFileSync(FILE, render(contract));
    console.log(`contract: ${contract.entries.length} entries, hash ${contract.hash}`);
  }
  process.exit(0);
}

module.exports = { checkContract, currentContract, FILE };
