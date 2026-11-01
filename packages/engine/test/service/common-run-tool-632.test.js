// #632: runTool(file, args, env, { cwd, timeout }) runs the tool in the given folder (glab repo create needs the
// project's folder); without cwd it keeps the process's own. Real node as the tool.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { runTool } = require('../../service/common');

const CWD = ['-e', 'process.stdout.write(process.cwd())'];
const same = (a, b) => fs.realpathSync.native(a).toLowerCase() === fs.realpathSync.native(b).toLowerCase();

test('#632 runTool with cwd runs the tool in that folder', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-tool-632-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const out = await runTool(process.execPath, CWD, {}, { cwd: dir, timeout: 30000 });
  assert.equal(out.ok, true, out.out);
  assert.equal(same(out.out, dir), true, `${out.out} is ${dir}`);
});

test('#632 runTool without options runs the tool in the process folder', async () => {
  const out = await runTool(process.execPath, CWD);
  assert.equal(out.ok, true, out.out);
  assert.equal(same(out.out, process.cwd()), true, `${out.out} is ${process.cwd()}`);
});

test('#632 runTool reports a failing tool as ok: false with its output', async () => {
  const out = await runTool(process.execPath, ['-e', 'process.stderr.write("boom"); process.exit(3)'], {}, { timeout: 30000 });
  assert.equal(out.ok, false);
  assert.match(out.out, /boom/);
});
