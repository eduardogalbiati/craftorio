// src/domains/run/run-artifacts.js (#200): a run's artifact index, cached in memory (scripts, or here, with no
// workspace store open) or in the workspace's index.db (src/domains/workspace/store.js) when one is. Covers: a
// finished run computed once, a live run read incrementally (with a partial trailing line held
// back), a deleted file, a shrunk events.jsonl, later saves winning, INTERNAL/sessions exclusion,
// runsOfArtifact, and the store-backed path. test/service/run-lists.test.js and
// test/service/artifacts.test.js cover the service seam that wraps this module.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { artifactIndex, runsOfArtifact } = require('../../src/domains/run/run-artifacts');
const { openStore } = require('../../src/domains/workspace/store');
const { setupWorkspace } = require('../../src/domains/workspace/workspace');

function tmpRun(id = 'run-1') {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-arts-'));
  const runDir = path.join(base, id);
  fs.mkdirSync(runDir, { recursive: true });
  return { base, runDir };
}
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true });
const savedEvent = (file, step, agent) => ({ type: 'file.saved', path: file, step_id: step || undefined, agent: agent || undefined });
const writeEvents = (runDir, lines) => fs.writeFileSync(path.join(runDir, 'events.jsonl'), lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
const relOf = (idx) => idx.files.map((f) => f.rel).sort();

test('artifactIndex: a finished run (summary.json) is computed once; a later call with the same events.jsonl size and mtime never reads it again', async (t) => {
  const { base, runDir } = tmpRun();
  t.after(() => rm(base));
  writeEvents(runDir, [savedEvent(path.join(runDir, 'out.md'), 'plan', 'planner')]);
  fs.writeFileSync(path.join(runDir, 'out.md'), '# plan');
  fs.writeFileSync(path.join(runDir, 'summary.json'), '{}');

  const first = await artifactIndex(runDir);
  assert.equal(first.finished, true);
  assert.deepEqual(relOf(first), ['out.md']);

  // the content changes, but its size and mtime are forced back to what a finished run already
  // cached: a changed quick key is the only thing that would make it read again.
  const eventsPath = path.join(runDir, 'events.jsonl');
  const before = fs.statSync(eventsPath);
  const replaced = Buffer.alloc(before.size, 0x20);
  const line = Buffer.from(`${JSON.stringify(savedEvent(path.join(runDir, 'other.md'), 'x'))}\n`);
  assert.ok(line.length <= before.size, 'fixture: the replacement line must fit in the original size');
  line.copy(replaced);
  fs.writeFileSync(eventsPath, replaced);
  fs.utimesSync(eventsPath, before.atime, before.mtime);

  const second = await artifactIndex(runDir);
  assert.deepEqual(relOf(second), ['out.md'], 'the cached list is returned: the changed events.jsonl was never read');
});

test('artifactIndex: a changed run folder mtime (summary.json rewritten) recomputes a finished run', async (t) => {
  const { base, runDir } = tmpRun();
  t.after(() => rm(base));
  writeEvents(runDir, [savedEvent(path.join(runDir, 'out.md'), 'plan')]);
  fs.writeFileSync(path.join(runDir, 'out.md'), '# plan');
  fs.writeFileSync(path.join(runDir, 'summary.json'), '{}');
  await artifactIndex(runDir);

  // a new file added to the run folder changes its mtime, even with events.jsonl untouched
  fs.writeFileSync(path.join(runDir, 'late.md'), '# late');
  const after = await artifactIndex(runDir);
  assert.deepEqual(relOf(after), ['late.md', 'out.md']);
});

test('artifactIndex: a live run (no summary.json) reads only the bytes appended to events.jsonl; an incomplete trailing line is read next time', async (t) => {
  const { base, runDir } = tmpRun();
  t.after(() => rm(base));
  writeEvents(runDir, [savedEvent(path.join(runDir, 'a.md'), 'plan')]);
  fs.writeFileSync(path.join(runDir, 'a.md'), '# a');

  const first = await artifactIndex(runDir);
  assert.equal(first.finished, false);
  assert.deepEqual(relOf(first), ['a.md']);
  const offsetAfterFirst = first.offset;

  // a line still being written (no trailing newline yet): its save is not parsed this time, but the
  // file itself already shows up from the folder walk
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), JSON.stringify(savedEvent(path.join(runDir, 'b.md'), 'develop')));
  fs.writeFileSync(path.join(runDir, 'b.md'), '# b');
  const partial = await artifactIndex(runDir);
  assert.deepEqual(relOf(partial), ['a.md', 'b.md']);
  assert.equal(partial.files.find((f) => f.rel === 'b.md').step, null, 'no step yet: its save line has no newline');
  assert.equal(partial.offset, offsetAfterFirst, 'the incomplete line was not consumed: the offset did not move past it');

  // completing the line lets it in, and the offset moves past it
  fs.appendFileSync(path.join(runDir, 'events.jsonl'), '\n');
  const completed = await artifactIndex(runDir);
  assert.equal(completed.files.find((f) => f.rel === 'b.md').step, 'develop');
  assert.ok(completed.offset > offsetAfterFirst);
});

test('artifactIndex: a file deleted from the run folder disappears once the folder\'s mtime changes', async (t) => {
  const { base, runDir } = tmpRun();
  t.after(() => rm(base));
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '');
  fs.writeFileSync(path.join(runDir, 'keep.md'), '# keep');
  fs.writeFileSync(path.join(runDir, 'gone.md'), '# gone');

  const before = await artifactIndex(runDir);
  assert.deepEqual(relOf(before), ['gone.md', 'keep.md']);

  fs.unlinkSync(path.join(runDir, 'gone.md'));
  const after = await artifactIndex(runDir);
  assert.deepEqual(relOf(after), ['keep.md']);
});

test('artifactIndex: events.jsonl shrinking (truncated or replaced) restarts the read from offset 0, dropping saves no longer in it', async (t) => {
  const { base, runDir } = tmpRun();
  t.after(() => rm(base));
  writeEvents(runDir, [savedEvent(path.join(runDir, 'a.md'), 'plan'), savedEvent(path.join(runDir, 'b.md'), 'develop')]);
  fs.writeFileSync(path.join(runDir, 'a.md'), '# a');
  fs.writeFileSync(path.join(runDir, 'b.md'), '# b'); // stays on disk even after its save record is lost below
  const first = await artifactIndex(runDir);
  assert.ok(first.offset > 0);
  assert.equal(first.files.find((f) => f.rel === 'b.md').step, 'develop');

  // replaced by a smaller file (e.g. a rotated log): shorter than the offset already read
  writeEvents(runDir, [savedEvent(path.join(runDir, 'a.md'), 'plan')]);
  const second = await artifactIndex(runDir);
  const files = Object.fromEntries(second.files.map((f) => [f.rel, f]));
  assert.equal(files['a.md'].step, 'plan');
  assert.equal(files['b.md'].step, null, 'b.md is still a file on disk, but its save record was lost when events.jsonl shrank: never a stale step');
  assert.ok(second.offset <= fs.statSync(path.join(runDir, 'events.jsonl')).size);
});

test('artifactIndex: a later save of the same path wins its step and agent', async (t) => {
  const { base, runDir } = tmpRun();
  t.after(() => rm(base));
  writeEvents(runDir, [
    savedEvent(path.join(runDir, 'out.md'), 'draft', 'writer'),
    savedEvent(path.join(runDir, 'out.md'), 'final', 'editor'),
  ]);
  fs.writeFileSync(path.join(runDir, 'out.md'), '# out');

  const idx = await artifactIndex(runDir);
  const entry = idx.files.find((f) => f.rel === 'out.md');
  assert.equal(entry.step, 'final');
  assert.equal(entry.agent, 'editor');
});

test('artifactIndex: events.jsonl, meta.json, summary.json and sessions/ are never listed as artifacts', async (t) => {
  const { base, runDir } = tmpRun();
  t.after(() => rm(base));
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '');
  fs.writeFileSync(path.join(runDir, 'meta.json'), '{}');
  fs.writeFileSync(path.join(runDir, 'summary.json'), '{}');
  fs.mkdirSync(path.join(runDir, 'sessions', 's1'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'sessions', 's1', 'log.jsonl'), '');
  fs.writeFileSync(path.join(runDir, 'report.md'), '# r');

  const idx = await artifactIndex(runDir);
  assert.deepEqual(relOf(idx), ['report.md']);
});

test('artifactIndex: what the run\'s tests leave in its temp folder (tmp/, #414) is never listed as an artifact', async (t) => {
  const { base, runDir } = tmpRun();
  t.after(() => rm(base));
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), '');
  fs.mkdirSync(path.join(runDir, 'tmp', 'service-ws-a1b2'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'tmp', 'service-ws-a1b2', 'settings.json'), '{}');
  fs.writeFileSync(path.join(runDir, 'tmp', 'notes.md'), '# left by a test');
  fs.writeFileSync(path.join(runDir, 'report.md'), '# r');

  const idx = await artifactIndex(runDir);
  assert.deepEqual(relOf(idx), ['report.md']);
});

test('runsOfArtifact: a path under runs/<id>/ gives [id] straight from the path, with nothing to read', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-arts-'));
  t.after(() => rm(base));
  const file = path.join(base, '20260101-000000-abcd1234', 'documents', 'report.md');
  const ids = await runsOfArtifact(base, file);
  assert.deepEqual(ids, ['20260101-000000-abcd1234']);
});

test('runsOfArtifact: an external (project copy) path not indexed yet is found by indexing the runs once, then matching it', async (t) => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'run-arts-ext-'));
  t.after(() => rm(base));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-arts-proj-'));
  t.after(() => rm(projectDir));
  const copy = path.join(projectDir, 'prd.md');
  fs.writeFileSync(copy, '# prd');

  const runId = '20260101-000000-abcd5678';
  const runDir = path.join(base, runId);
  fs.mkdirSync(runDir, { recursive: true });
  writeEvents(runDir, [savedEvent(copy, 'plan')]);

  const other = path.join(base, '20260101-000001-other0001');
  fs.mkdirSync(other, { recursive: true });
  writeEvents(other, []);

  const ids = await runsOfArtifact(base, copy);
  assert.deepEqual(ids, [runId]);
});

test('artifactIndex persists through the workspace\'s store: a finished run computed once is read back after the store is reopened, never recomputed', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-arts-store-'));
  const ws = setupWorkspace(dir, { persist: false });
  let store = openStore(ws);
  // node:test runs t.after hooks in the order they were added: close() (of whichever store this
  // closure sees last) must run before rm(dir), or index.db still open fails to unlink on Windows.
  t.after(() => store.close());
  t.after(() => rm(dir));
  const runId = '20260101-000000-storerun1';
  const runDir = path.join(ws.runs, runId);
  fs.mkdirSync(runDir, { recursive: true });
  writeEvents(runDir, [savedEvent(path.join(runDir, 'out.md'), 'plan')]);
  fs.writeFileSync(path.join(runDir, 'out.md'), '# out');
  fs.writeFileSync(path.join(runDir, 'summary.json'), '{}');

  const first = await artifactIndex(runDir);
  assert.deepEqual(relOf(first), ['out.md']);
  assert.ok(store.runArtifacts(runId), 'the index was written to the store');

  store.close();
  store = openStore(ws);
  const second = await artifactIndex(runDir);
  assert.deepEqual(relOf(second), ['out.md'], 'read back from the reopened store, not recomputed from scratch');
});
