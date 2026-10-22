// #465 a live terminal on the deterministic steps: the service side (acceptance tests written before
// the code). A step's log (the `path` of its step.log event, relative to the run folder) opens:
// - embedded: term:open { kind: 'log', runId, path } follows the file in this process (as the live
//   session terminal does), its new lines pushed on term:data;
// - external: terminalSpec(runId, path, 'log') (what session:terminal / openSessionTerminal(path,
//   'log', runId) runs) is the tail with `<runDir> --file <path>`.
// Only a file under runs/<id>/logs/ opens: `..` out of it, another folder of the run (sessions/) or
// an absolute path is refused.
// Seams: the service's api (test/service/helpers.js makeService) and its events; the run folder is
// written by hand (events.jsonl makes it a run, logs/ its step logs).
// Assumptions: the embedded call's option is named `path`; terminalSpec takes the log's path where a
// session id goes (runId, path, 'log').
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./helpers');

function runWithLog(service, runId = '20261022-120000-abcd1234') {
  const runDir = path.join(service.workspace().runs, runId);
  fs.mkdirSync(path.join(runDir, 'logs'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'events.jsonl'), `${JSON.stringify({ type: 'workflow.started', ts: new Date().toISOString(), run_id: runId, workflow: 'fixture-service', mock: true, steps: [] })}\n`);
  fs.writeFileSync(path.join(runDir, 'logs', 'suite-1.log'), '$ npm test\n');
  fs.writeFileSync(path.join(runDir, 'sessions', 'x.jsonl'), '{}\n');
  return { runId, runDir };
}

function termOutput(service) {
  const byId = new Map();
  service.events.on('term:data', ({ id, data }) => byId.set(id, (byId.get(id) || '') + String(data)));
  return (id) => byId.get(id) || '';
}

async function until(fn, what, timeoutMs = 4000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (fn()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(`timed out waiting for ${what}`);
}

test('#465 term:open kind log: follows a step log of the run, its new lines pushed on term:data', async (t) => {
  const { service, api } = makeService(t);
  const { runId, runDir } = runWithLog(service);
  const output = termOutput(service);
  const opened = api['term:open']({ kind: 'log', runId, path: 'logs/suite-1.log', cols: 80, rows: 24 });
  assert.ok(opened && opened.id != null, 'a terminal was opened');
  t.after(() => { try { api['term:kill']({ id: opened.id }); } catch { /* gone */ } });
  await until(() => output(opened.id).includes('$ npm test'), `the log's first line (got ${JSON.stringify(output(opened.id))})`);
  fs.appendFileSync(path.join(runDir, 'logs', 'suite-1.log'), 'ok 7 - grows after open\n');
  await until(() => output(opened.id).includes('ok 7 - grows after open'), 'a line appended after the terminal opened');
});

test('#465 term:open kind log: a path outside the run\'s logs/ folder is refused (while logs/suite-1.log opens)', async (t) => {
  const { service, api } = makeService(t);
  const { runId, runDir } = runWithLog(service);
  fs.writeFileSync(path.join(service.workspace().root, 'secret.txt'), 'secret\n');
  const ok = api['term:open']({ kind: 'log', runId, path: 'logs/suite-1.log', cols: 80, rows: 24 });
  assert.ok(ok && ok.id != null, 'a log of the run opens');
  t.after(() => { try { api['term:kill']({ id: ok.id }); } catch { /* gone */ } });
  for (const bad of ['../../secret.txt', 'logs/../../../secret.txt', 'sessions/x.jsonl', 'events.jsonl', path.join(runDir, 'logs', 'suite-1.log')]) {
    assert.throws(() => api['term:open']({ kind: 'log', runId, path: bad, cols: 80, rows: 24 }), (e) => !/Session not found/.test(e.message), `refused: ${bad}`);
  }
});

test('#465 terminalSpec(runId, path, \'log\'): the tail with <runDir> --file <path> (the external window); an outside path is refused', (t) => {
  const { service } = makeService(t);
  const { runId, runDir } = runWithLog(service);
  const spec = service.terminalSpec(runId, 'logs/suite-1.log', 'log');
  const args = (spec.args || []).map(String);
  const at = args.indexOf('--file');
  assert.ok(at > 0, `--file in the tail's arguments: ${JSON.stringify(args)}`);
  assert.equal(path.resolve(args[at - 1]), path.resolve(runDir), 'the run folder before --file');
  assert.equal(args[at + 1].replace(/\\/g, '/'), 'logs/suite-1.log');
  for (const bad of ['../../secret.txt', 'sessions/x.jsonl']) {
    assert.throws(() => service.terminalSpec(runId, bad, 'log'), (e) => !/Session not found/.test(e.message), `refused: ${bad}`);
  }
});
