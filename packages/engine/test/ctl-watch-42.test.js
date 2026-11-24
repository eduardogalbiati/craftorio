// #42 internals of `watch` (scripts/ctl.js): the reason a roadmap gives, on the cases native/craftorio-ctl/src/watch.rs
// passes too; the exits of a wrong use, of another contract version and of an app that never answers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { CONTROL_VERSION } = require('../control');
const ctl = require('../../../scripts/ctl.js');
const cases = require('./fixtures/ctl-watch-cases.json');

const CTL_JS = path.join(__dirname, '..', '..', '..', 'scripts', 'ctl.js');

for (const c of cases) {
  test(`#42 watch, the reason: ${c.name}`, () => {
    const first = ctl.currentStage(c.before || c.roadmap);
    const reason = ctl.reasonOf(c.roadmap, { first, active: c.active });
    assert.equal(reason && reason.join(': '), c.expected);
    assert.deepEqual(ctl.runningRuns(c.roadmap).map((r) => [r.runId, r.label]), c.runs);
  });
}

test('#42 scripts/ctl.js speaks the app\'s contract version', () => {
  assert.equal(ctl.CONTROL_VERSION, CONTROL_VERSION);
});

// a workspace whose endpoint is an app that answers as `handler`
async function app(t, handler) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ctl-watch-42-'));
  const server = http.createServer(handler);
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  t.after(() => {
    server.close();
    server.closeAllConnections();
    fs.rmSync(root, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(root, 'control'));
  fs.writeFileSync(path.join(root, 'control', 'endpoint.json'), JSON.stringify({ url: `http://127.0.0.1:${server.address().port}`, token: 'x' }));
  return root;
}

const run = (args) => new Promise((resolve) => {
  execFile(process.execPath, [CTL_JS, ...args], { timeout: 30000, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
    resolve({ code: error ? error.code : 0, stdout, stderr });
  });
});

test('#42 scripts/ctl.js watch: another contract version exits 3, an older app too', async (t) => {
  const other = await app(t, (req, res) => res.end(JSON.stringify({ version: '99' })));
  const out = await run(['watch', 'p', '--workspace', other]);
  assert.equal(out.code, 3, out.stderr);
  assert.match(out.stderr, /version 99/);
  const older = await app(t, (req, res) => { res.statusCode = 404; res.end('{"error":"Not found"}'); });
  assert.equal((await run(['watch', 'p', '--workspace', older])).code, 3);
});

test('#42 scripts/ctl.js watch: an app that never answers ends at the maximum duration', async (t) => {
  const root = await app(t, () => {});
  const out = await run(['watch', 'p', '--max', '1', '--workspace', root]);
  assert.equal(out.code, 4, out.stderr);
  assert.equal(out.stdout, 'timeout: nothing to report after 1 s\n');
});

test('#42 scripts/ctl.js watch: no project, or a time that is not whole seconds, exits 1', async (t) => {
  const root = await app(t, () => {});
  for (const args of [['watch'], ['watch', 'p', '--max', '1.5'], ['watch', 'p', '--stall', '0'], ['watch', 'p', '--max']]) {
    const out = await run(['--workspace', root, ...args]);
    assert.equal(out.code, 1, args.join(' '));
    assert.match(out.stderr, /watch <projectId>|whole number of seconds/);
  }
});
