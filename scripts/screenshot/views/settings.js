// Screenshot seed of Settings (--view settings): its tabs, and two entries of the dependency cache
// (demoDepsCache, #198: a size and Clear enabled; the E2E suite seeds them too).

const fs = require('fs');
const path = require('path');

// Settings › General › Dependency cache (#198): two complete entries of the demo project (sizes
// recorded in entry.json, as after an install), so the row shows a size and Clear is enabled.
function demoDepsCache(ws, projectId) {
  if (!ws.cache) return; // an app before the cache
  const day = 864e5;
  [['3f9a1c2e7b4d5a6c8e0f1a2b', 412 * 1024 ** 2, 1], ['8c2d4e6f0a1b3c5d7e9f1a2b', 1.3 * 1024 ** 3, 6]].forEach(([key, bytes, daysAgo]) => {
    const entry = path.join(ws.cache, 'deps', projectId, key);
    fs.mkdirSync(path.join(entry, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(entry, 'node_modules', '.package-lock.json'), '{}');
    const at = new Date(Date.now() - daysAgo * day).toISOString();
    fs.writeFileSync(path.join(entry, 'entry.json'), JSON.stringify({ key, lockfile: 'package-lock.json', manager: 'npm', sentinel: '.package-lock.json', bytes, created_at: at, last_used: at }));
  });
}

function seed({ ws, project }) {
  demoDepsCache(ws, project.id);
}

async function afterOpen({ args, click }) {
  if (args.tab) await click(`.settings-tab[data-stab="${args.tab}"]`);
}

module.exports = {
  afterOpen,
  demoDepsCache,
  seed,
  tabs: ['general', 'projects', 'agents', 'execution', 'phone', 'about'],
};
