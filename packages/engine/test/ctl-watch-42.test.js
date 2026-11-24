// #42 internals of `watch` (scripts/ctl.js): the reason a roadmap gives, on the cases native/craftorio-ctl/src/watch.rs
// passes too; the exits of a wrong use, of another contract version and of an app that never answers, for both clients
// (craftorio-ctl is built as ctl-342.test.js does: skipped without cargo, never in CI); the default maximum duration.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { execFile, spawnSync } = require('child_process');
const { CONTROL_VERSION } = require('../control');
const ctl = require('../../../scripts/ctl.js');
const cases = require('./fixtures/ctl-watch-cases.json');

const ROOT = path.join(__dirname, '..', '..', '..');
const CTL_JS = path.join(ROOT, 'scripts', 'ctl.js');
const BINARY = path.join(process.env.CARGO_TARGET_DIR || path.join(ROOT, 'native', 'target'), 'release', process.platform === 'win32' ? 'craftorio-ctl.exe' : 'craftorio-ctl');
const hasCargo = () => spawnSync('cargo', ['--version'], { stdio: 'ignore' }).status === 0;
const SKIP_RUST = !process.env.CI && !hasCargo() ? 'cargo is not installed: craftorio-ctl\'s cases are skipped (CI runs them)' : false;

let built = null;
function rustBinary() {
  built ||= spawnSync('cargo', ['build', '--release', '--manifest-path', path.join(ROOT, 'native', 'Cargo.toml'), '-p', 'craftorio-ctl'], { encoding: 'utf8', timeout: 9 * 60 * 1000 });
  if (built.status !== 0) throw new Error(`cargo build of craftorio-ctl failed: ${(built.stderr || built.error?.message || '').slice(-1500)}`);
  return BINARY;
}

const CLIENTS = [
  { name: 'scripts/ctl.js', skip: false, command: () => [process.execPath, CTL_JS] },
  { name: 'craftorio-ctl', skip: SKIP_RUST, command: () => [rustBinary()] },
];

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

const run = ([file, ...first], args) => new Promise((resolve) => {
  execFile(file, [...first, ...args], { timeout: 30000, encoding: 'utf8', windowsHide: true }, (error, stdout, stderr) => {
    resolve({ code: error ? error.code : 0, stdout, stderr });
  });
});

for (const client of CLIENTS) {
  const it = (name, fn) => test(`#42 ${client.name} watch: ${name}`, { skip: client.skip }, (t) => fn(t, client.command()));

  it('another contract version exits 3, an older app too', async (t, command) => {
    const other = await app(t, (req, res) => res.end(JSON.stringify({ version: '99' })));
    const out = await run(command, ['watch', 'p', '--workspace', other]);
    assert.equal(out.code, 3, out.stderr);
    assert.match(out.stderr, /version 99/);
    const older = await app(t, (req, res) => { res.statusCode = 404; res.end('{"error":"Not found"}'); });
    assert.equal((await run(command, ['watch', 'p', '--workspace', older])).code, 3);
  });

  it('an app that never answers ends at the maximum duration', async (t, command) => {
    const root = await app(t, () => {});
    const out = await run(command, ['watch', 'p', '--max', '1', '--workspace', root]);
    assert.equal(out.code, 4, out.stderr);
    assert.equal(out.stdout, 'timeout: nothing to report after 1 s\n');
  });

  it('an app that stops answering while it watches ends at the maximum duration', async (t, command) => {
    const root = await app(t, (req, res) => {
      if (req.url === '/api/version') res.end(JSON.stringify({ version: CONTROL_VERSION }));
      else if (req.url === `/api/${encodeURIComponent('projects:list')}`) res.end('{"result":[{"id":"p"}]}');
    });
    const out = await run(command, ['watch', 'p', '--max', '2', '--workspace', root]);
    assert.equal(out.code, 4, out.stderr);
    assert.equal(out.stdout, 'timeout: nothing to report after 2 s\n');
  });

  it('no project, or a time that is not whole seconds, exits 1', async (t, command) => {
    const root = await app(t, () => {});
    for (const args of [['watch'], ['watch', 'p', '--max', '1.5'], ['watch', 'p', '--stall', '0'], ['watch', 'p', '--max']]) {
      const out = await run(command, ['--workspace', root, ...args]);
      assert.equal(out.code, 1, args.join(' '));
      assert.match(out.stderr, /watch <projectId>|whole number of seconds/);
    }
  });
}

// the client's clock runs a thousand times faster: its hour passes in seconds
test('#42 scripts/ctl.js watch: without --max it ends after an hour', async (t) => {
  const root = await app(t, () => {});
  const preload = path.join(root, 'fast-clock.js');
  fs.writeFileSync(preload, 'const real = globalThis.setTimeout;\nglobalThis.setTimeout = (fn, ms, ...rest) => real(fn, ms / 1000, ...rest);\n');
  const out = await run([process.execPath, '--require', preload, CTL_JS], ['watch', 'p', '--workspace', root]);
  assert.equal(out.code, 4, out.stderr);
  assert.equal(out.stdout, 'timeout: nothing to report after 3600 s\n');
});

test('#42 craftorio-ctl watch has the same default times as scripts/ctl.js', () => {
  const rust = fs.readFileSync(path.join(ROOT, 'native', 'craftorio-ctl', 'src', 'watch.rs'), 'utf8');
  const js = fs.readFileSync(CTL_JS, 'utf8');
  for (const [name, value] of [['DEFAULT_STALL', '900'], ['DEFAULT_MAX', '3600']]) {
    assert.equal(rust.includes(`const ${name}: &str = "${value}";`), true, `watch.rs ${name}`);
    assert.equal(js.includes(`const ${name} = '${value}';`), true, `ctl.js ${name}`);
  }
});
