// #481 (SEC-26), src/service/areas/local-preview.js `localPreview:suggest { dir }`: it reads a folder
// on the engine's machine, so only a known project folder (or a run's worktree) is read; any other
// folder is refused (the channel throws, or answers null without reading it). A project's own folder
// still gets its suggestion. The folder here declares `web: node server.js` in a Procfile, which
// suggestConfig turns into { command: 'node server.js' }.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeService } = require('./service/helpers');

function appFolder(t, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `lp-481-${name}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'Procfile'), 'web: node server.js\n');
  return dir;
}

test('#481 localPreview:suggest: a folder that is no project (nor worktree) is refused', async (t) => {
  const { api } = makeService(t);
  const outside = appFolder(t, 'outside');
  let answer;
  try { answer = await api['localPreview:suggest']({ dir: outside }); } catch { answer = 'refused'; }
  assert.ok(answer === null || answer === 'refused', `read a folder outside the projects: ${JSON.stringify(answer)}`);
});

test('#481 localPreview:suggest: a project\'s folder still gets its suggestion', async (t) => {
  const { api } = makeService(t);
  const folder = appFolder(t, 'project');
  await api['projects:create']({ name: 'demo', folder });
  const answer = await api['localPreview:suggest']({ dir: folder });
  assert.equal(answer?.command, 'node server.js');
});
