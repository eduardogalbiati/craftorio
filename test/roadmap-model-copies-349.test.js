// #349 acceptance: the roadmap's rules live in src/shared/roadmap-model.js only, src/roadmap.js is
// the only writer of the roadmap's state, and the views ask the model. Source scans over src/
// (tests and fixtures live outside src/ and are not scanned).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.join(__dirname, '..', 'src');
const MODEL = path.join(SRC, 'shared', 'roadmap-model.js');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const sourceFiles = () => fs.readdirSync(SRC, { recursive: true })
  .map((rel) => path.join(SRC, rel))
  .filter((file) => file.endsWith('.js') && fs.statSync(file).isFile());
const scan = (re, allowed = new Set()) => {
  const hits = [];
  for (const file of sourceFiles()) {
    if (allowed.has(file)) continue;
    fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, n) => {
      if (re(line)) hits.push(`${path.relative(SRC, file).replace(/\\/g, '/')}:${n + 1}: ${line.trim()}`);
    });
  }
  return hits;
};

test('no module outside the model lists \'done\' and \'skipped\' together', () => {
  const hits = scan((line) => /['"`]done['"`]/.test(line) && /['"`]skipped['"`]/.test(line), new Set([MODEL]));
  assert.deepEqual(hits, []);
});

test('no module outside the model defines FINISHED', () => {
  const hits = scan((line) => /\bFINISHED\s*=(?!=)/.test(line), new Set([MODEL]));
  assert.deepEqual(hits, []);
});

test('the model exists where the views and the engine can load it', () => {
  assert.equal(fs.existsSync(MODEL), true);
});

test('only src/roadmap.js writes the roadmap\'s state, pausedBy and scope', () => {
  const writes = /\b(pausedBy|scope)\s*:|\bstate\s*:\s*['"`](planned|running|paused|done)['"`]/;
  const hits = [];
  for (const rel of ['live-roadmap.js', 'domains/night/night-watch.js', 'roadmap-undo.js', 'service/areas/roadmap.js']) {
    read(rel).split(/\r?\n/).forEach((line, n) => { if (writes.test(line)) hits.push(`${rel}:${n + 1}: ${line.trim()}`); });
  }
  assert.deepEqual(hits, []);
});

test('the Roadmap view draws its buttons from the model\'s allowedActions', () => {
  const view = read('renderer/views/backlog/backlog-roadmap.js');
  assert.equal(/RoadmapModel/.test(view), true, 'backlog-roadmap.js does not use RoadmapModel');
  assert.equal(/allowedActions\s*\(/.test(view), true, 'backlog-roadmap.js does not call allowedActions');
});

test('the Dashboard asks the model for the roadmap\'s current stage', () => {
  assert.equal(/RoadmapModel/.test(read('renderer/views/dashboard/dashboard.js')), true, 'dashboard.js does not use RoadmapModel');
});
