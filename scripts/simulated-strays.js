// Lists the simulated runs in a workspace that belong to no project (`mock: true`, `project_id: null`):
// before #120, agents' checks (`npm run run -- --mock`, `npm run screenshot`, engine scripts in
// `node -e`) wrote them into the owner's workspace. Read-only by default; the owner reviews the list
// and removes the ones they confirm with `--delete <id> [<id>…]` (only ids of the list, never in
// simulation only, so an agent can't run it). The index (index.db) drops removed runs by itself.
//
//   node scripts/simulated-strays.js [--workspace <dir>] [--delete <id> …]

const fs = require('fs');
const path = require('path');
const { resolveWorkspace, layout } = require('@craftorio/engine/domains/workspace/workspace');
const { simulationOnly } = require('@craftorio/engine/engine/simulation');

function parseArgs(argv) {
  const out = { workspace: null, delete: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace') out.workspace = argv[++i];
    else if (argv[i] === '--delete') while (argv[i + 1] && !argv[i + 1].startsWith('--')) out.delete.push(argv[++i]);
  }
  return out;
}

// summary.json of a finished run, else the workflow.started event (a run that never finished)
function runInfo(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch { /* not finished */ }
  try {
    const first = fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .find((e) => e?.type === 'workflow.started');
    return first && { ...first, status: 'unfinished' };
  } catch { return null; }
}

function strays(runsDir) {
  let ids = [];
  try { ids = fs.readdirSync(runsDir).sort(); } catch { return []; }
  return ids.map((id) => ({ id, info: runInfo(path.join(runsDir, id)) }))
    .filter(({ info }) => info && info.mock === true && !info.project_id);
}

const args = parseArgs(process.argv.slice(2));
const root = args.workspace || resolveWorkspace().dir;
if (!root) { console.error('No workspace found: pass --workspace <dir>.'); process.exit(1); }
const runsDir = layout(path.resolve(root)).runs;
const list = strays(runsDir);
console.log(`${list.length} simulated run(s) without a project in ${runsDir}:`);
for (const { id, info } of list) {
  const inputs = Object.entries(info.inputs || {}).map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' ');
  console.log(`  ${id}  ${info.workflow || '?'}  ${info.status || ''}  ${inputs}`);
}

if (args.delete.length) {
  if (simulationOnly()) { console.error('Refused: --delete is the owner\'s action (MULTIAGENT_SIMULATION_ONLY is set).'); process.exit(1); }
  const known = new Set(list.map((s) => s.id));
  for (const id of args.delete) {
    if (!known.has(id)) { console.error(`  skipped ${id}: not a simulated run without a project`); continue; }
    fs.rmSync(path.join(runsDir, id), { recursive: true, force: true, maxRetries: 3 });
    console.log(`  removed ${id}`);
  }
}
