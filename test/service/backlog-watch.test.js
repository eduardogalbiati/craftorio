// src/service/areas/backlog-watch.js (#204): the Backlog screen follows its workspace files live,
// also when nothing is running. parseBacklogFile and watchBacklogDir are pure enough to test with a
// fake fsWatch (no real filesystem watcher, no timing flakiness); the service-level test below
// proves the wiring (setWorkspace starts it, a real outside write reaches `backlog:changed`).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseBacklogFile, watchBacklogDir } = require('../../src/service/areas/backlog-watch');
const { makeService, roadmapProject, until } = require('./helpers');

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'backlog-watch-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// ---------------------------------------------------------------------------
// parseBacklogFile
// ---------------------------------------------------------------------------

test('parseBacklogFile: <id>.roadmap.json / .queue.json / .local.json / .refresh.json name their kind; <id>.json is issues', () => {
  assert.deepEqual(parseBacklogFile('proj.roadmap.json'), { projectId: 'proj', file: 'roadmap' });
  assert.deepEqual(parseBacklogFile('proj.queue.json'), { projectId: 'proj', file: 'queue' });
  assert.deepEqual(parseBacklogFile('proj.local.json'), { projectId: 'proj', file: 'local' });
  assert.deepEqual(parseBacklogFile('proj.refresh.json'), { projectId: 'proj', file: 'refresh' });
  assert.deepEqual(parseBacklogFile('proj.json'), { projectId: 'proj', file: 'issues' });
});

test('parseBacklogFile: not a backlog data file -> null (manifest, .bak/.tmp state-file siblings, folders)', () => {
  assert.equal(parseBacklogFile('proj.roadmap.json.bak'), null);
  assert.equal(parseBacklogFile('proj.json.tmp'), null);
  assert.equal(parseBacklogFile('.seeded'), null); // no .json extension at all
  assert.equal(parseBacklogFile(''), null);
  assert.equal(parseBacklogFile(undefined), null);
});

// ---------------------------------------------------------------------------
// watchBacklogDir, with a fake fsWatch (no real watcher: deterministic, no timing flakiness)
// ---------------------------------------------------------------------------

function fakeWatch() {
  let cb = null;
  const listeners = {};
  const watcher = { on: (ev, fn) => { listeners[ev] = fn; }, close: () => {} };
  const fsWatch = (dir, opts, callback) => { cb = callback; return watcher; };
  return { fsWatch, trigger: (name) => cb('change', name), fail: (e) => listeners.error?.(e) };
}

test('watchBacklogDir: a changed file fires onChange once, debounced (several notifications collapse into one)', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'p1.roadmap.json'), 'a');
  const { fsWatch, trigger } = fakeWatch();
  const events = [];
  const h = watchBacklogDir(dir, { onChange: (e) => events.push(e), fsWatch, debounceMs: 10 });
  t.after(h.close);
  assert.equal(h.watching, true);

  fs.writeFileSync(path.join(dir, 'p1.roadmap.json'), 'ab'); // content (and so mtime/size) actually changes
  trigger('p1.roadmap.json');
  trigger('p1.roadmap.json'); // debounced: a 2nd notification before the timer fires does not add a 2nd event
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(events, [{ projectId: 'p1', file: 'roadmap' }]);
});

test('watchBacklogDir: a write that leaves the file exactly as it was (same mtime and size) pushes nothing', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'p1.queue.json'), 'same'); // present before the watcher starts: its stamp is recorded
  const { fsWatch, trigger } = fakeWatch();
  const events = [];
  const h = watchBacklogDir(dir, { onChange: (e) => events.push(e), fsWatch, debounceMs: 5 });
  t.after(h.close);

  trigger('p1.queue.json'); // notified, but nothing on disk actually changed
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(events, []);
});

test('watchBacklogDir: a file outside the backlog naming (.bak, no .json) is ignored even if the watcher reports it', async (t) => {
  const dir = tmp(t);
  const { fsWatch, trigger } = fakeWatch();
  const events = [];
  const h = watchBacklogDir(dir, { onChange: (e) => events.push(e), fsWatch, debounceMs: 5 });
  t.after(h.close);
  trigger('p1.roadmap.json.bak');
  trigger('notes.txt');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(events, []);
});

test('watchBacklogDir: the watcher\'s own "error" event closes it and calls onError once', async (t) => {
  const dir = tmp(t);
  const { fsWatch, fail } = fakeWatch();
  const errors = [];
  const h = watchBacklogDir(dir, { onError: (e) => errors.push(e), fsWatch });
  t.after(h.close);
  assert.equal(h.watching, true);
  fail(new Error('EPERM'));
  assert.equal(h.watching, false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'EPERM');
});

test('watchBacklogDir: fsWatch throwing synchronously (folder deleted, a network drive) also reports onError, never throws', (t) => {
  const dir = tmp(t);
  const errors = [];
  const fsWatch = () => { throw new Error('ENOENT'); };
  const h = watchBacklogDir(dir, { onError: (e) => errors.push(e), fsWatch });
  assert.equal(h.watching, false);
  assert.equal(errors.length, 1);
});

test('watchBacklogDir: close() stops further notifications', async (t) => {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'p1.roadmap.json'), 'a');
  const { fsWatch, trigger } = fakeWatch();
  const events = [];
  const h = watchBacklogDir(dir, { onChange: (e) => events.push(e), fsWatch, debounceMs: 5 });
  h.close();
  assert.equal(h.watching, false);
  fs.writeFileSync(path.join(dir, 'p1.roadmap.json'), 'ab');
  trigger('p1.roadmap.json');
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(events, []);
});

// ---------------------------------------------------------------------------
// Service wiring: setWorkspace starts a real watcher; an outside write (temp file + rename, like
// another app window or a script) reaches `backlog:changed`, debounced to one event.
// ---------------------------------------------------------------------------

test('service: a project\'s roadmap file written from outside the app emits one debounced backlog:changed', async (t) => {
  const { service, api } = makeService(t);
  const ws = service.workspace();
  const p = await roadmapProject(api, ws, t, [1], 'bw');
  assert.equal(api['backlog:watching'](), true);
  await new Promise((r) => setTimeout(r, 400)); // let roadmapProject's own issues-file write settle first

  const events = [];
  service.events.on('backlog:changed', (e) => events.push(e));
  const file = path.join(ws.backlog, `${p.id}.roadmap.json`);
  const tmpFile = `${file}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify({ stages: [] }));
  fs.renameSync(tmpFile, file); // outside write: temp file + rename, like another window or a script
  await until(() => events.length > 0);
  await new Promise((r) => setTimeout(r, 50)); // give a 2nd, unwanted notification a chance to arrive
  assert.deepEqual(events, [{ projectId: p.id, file: 'roadmap', watching: true }]);
});
