// A stub at the process boundary for the conflict map's git calls (#526): wraps child_process.execFile
// (callback and util.promisify forms) so a test can count the git processes started in one folder and
// hold them behind a gate (a git that hangs) until it opens. Install it before the module under test is
// required: the modules destructure execFile when they load. A helper, it never calls test().
const childProcess = require('child_process');
const path = require('path');
const util = require('util');

const realExecFile = childProcess.execFile;
const same = (a, b) => !!a && !!b && path.resolve(String(a)).toLowerCase() === path.resolve(String(b)).toLowerCase();

const state = { watched: new Set(), calls: [], held: [], gated: false };

function wrapped(file, args, options, callback) {
  if (typeof args === 'function') { callback = args; args = []; options = {}; }
  if (typeof options === 'function') { callback = options; options = {}; }
  const list = Array.isArray(args) ? args : [];
  const cwd = options && options.cwd;
  const watched = /(^|[\\/])git(\.exe)?$/i.test(String(file)) && [...state.watched].some((dir) => same(dir, cwd));
  if (!watched) return realExecFile.call(childProcess, file, args, options, callback);
  state.calls.push({ cwd, args: list.slice() });
  const go = () => realExecFile.call(childProcess, file, args, options, callback);
  if (!state.gated) return go();
  state.held.push(go);
  // a minimal ChildProcess stand-in while the call is held
  const fake = new (require('events'))();
  fake.kill = () => true;
  fake.pid = 0;
  return fake;
}
wrapped[util.promisify.custom] = (file, args, options) => new Promise((resolve, reject) => {
  wrapped(file, args, options || {}, (err, stdout, stderr) => (err ? reject(Object.assign(err, { stdout, stderr })) : resolve({ stdout, stderr })));
});
childProcess.execFile = wrapped;

module.exports = {
  /** Count (and gate) the git processes started with this folder as cwd. */
  watch(dir) { state.watched.add(dir); },
  /** Git calls started in the watched folders so far: [{ cwd, args }]. */
  calls(dir) { return state.calls.filter((c) => !dir || same(c.cwd, dir)); },
  /** From now on, git calls in the watched folders wait until open(). */
  close() { state.gated = true; },
  /** Lets the held calls (and every later one) run. */
  open() { state.gated = false; const held = state.held.splice(0); for (const go of held) go(); },
  held() { return state.held.length; },
  reset() { state.watched.clear(); state.calls.length = 0; this.open(); },
};
