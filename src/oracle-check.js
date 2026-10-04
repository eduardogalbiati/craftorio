// The Oracle's checker (#184): verify a claim by running it. Runs one test file or test command on a
// scratch checkout of a project's branch (a detached git worktree under <workspace>/oracle/checks/,
// removed afterwards: the project's own checkout is never touched) with MULTIAGENT_SIMULATION_ONLY=1,
// and returns the result with its evidence (exit code, duration, the failing tests, the output's
// tail). No model call. The command is parsed here, never given to a shell as written: one program
// of CHECK_PROGRAMS and plain arguments (no pipes, redirections, chains or inline code). A quick check
// (the Oracle's `delegate` to `checker`) stops at QUICK_MS; a longer one is a `check.run` action card
// the owner confirms (src/oracle-actions.js), with LONG_MS.
// The project's node_modules (when it has one) is linked into the checkout and unlinked before the
// checkout is removed, so the check runs without an install.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile, spawn } = require('child_process');
const { killTree, resolveCommand } = require('./engine/providers');

const QUICK_MS = 2 * 60e3;
const LONG_MS = 20 * 60e3;
const TAIL_CHARS = 4000;
const MAX_OUTPUT = 1e6; // what is kept of a long output to find the failing tests in
const MAX_FAILURES = 20;
// the test runners a check may start
const CHECK_PROGRAMS = [
  'dotnet',
  'go',
  'gradle',
  'jest',
  'mocha',
  'mvn',
  'node',
  'npm',
  'npx',
  'pnpm',
  'pytest',
  'python',
  'python3',
  'vitest',
  'yarn',
];
// plain arguments only: what a shell would read as code is refused
const SAFE_ARG = /^[A-Za-z0-9_@%+=:,./\\-]+$/;
const INLINE_CODE = new Set(['-c', '-e', '-p', '--eval', '--print']);

/** The command's argv, or throws why it is refused. */
function parseCheckCommand(command) {
  const argv = String(command || '').trim().split(/\s+/).filter(Boolean);
  if (!argv.length) throw new Error('Say which test file or command to run (e.g. "node --test test/x.test.js").');
  const bad = argv.find((a) => !SAFE_ARG.test(a));
  if (bad) throw new Error(`The check runs plain arguments only (no quotes, pipes, redirections or chains): "${bad}" is refused.`);
  if (!CHECK_PROGRAMS.includes(argv[0].toLowerCase())) throw new Error(`A check starts a test runner (${CHECK_PROGRAMS.join(', ')}), not ${argv[0]}.`);
  if (argv.some((a) => INLINE_CODE.has(a))) throw new Error('A check runs the project\'s tests, not inline code.');
  return argv;
}

const git = (cwd, args) => new Promise((resolve, reject) => {
  execFile('git', ['-C', cwd, ...args], { timeout: 60e3, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => (err ? reject(new Error(String(stderr || err.message).trim())) : resolve(String(stdout).trim())));
});

// runs argv in cwd → { code, output, timedOut, durationMs }
function runCommand(argv, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const env = { ...process.env, MULTIAGENT_SIMULATION_ONLY: '1', CI: process.env.CI || '1' };
    delete env.NODE_TEST_CONTEXT; // a check started from a node:test process reports like a top-level run
    const resolved = resolveCommand(argv[0]) || { file: argv[0], shell: false };
    const started = Date.now();
    let output = '';
    let timedOut = false;
    let child;
    try {
      child = spawn(resolved.file, argv.slice(1), { cwd, env, shell: !!resolved.shell, windowsHide: true });
    } catch (e) {
      resolve({ code: null, output: e.message, timedOut: false, durationMs: 0 });
      return;
    }
    const take = (d) => { output += d; if (output.length > MAX_OUTPUT) output = output.slice(-MAX_OUTPUT / 2); };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    child.on('error', (e) => { output += `\n${e.message}`; });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, output, timedOut, durationMs: Date.now() - started }); });
  });
}

// the names of the failing tests in a runner's output (node:test TAP/spec, Jest/Vitest, pytest, go)
function failingTests(output) {
  const names = [];
  for (const line of String(output).split(/\r?\n/)) {
    const m = line.match(/^\s*not ok \d+ - (.+?)\s*(#.*)?$/) || line.match(/^\s*✖ (.+?)(?: \(\d[\d.]*m?s\))?$/)
      || line.match(/^\s*(?:FAILED|FAIL:?|--- FAIL:) (.+?)\s*$/) || line.match(/^\s*● (.+?)\s*$/);
    if (m && !names.includes(m[1].trim())) names.push(m[1].trim());
    if (names.length >= MAX_FAILURES) break;
  }
  return names;
}

/**
 * Runs `command` on a scratch checkout of `branch` of the repository in `folder`.
 * → { ok, text, exitCode, durationMs, timedOut, failures, commit }
 */
async function runCheck({ folder, branch, command, checksDir, timeoutMs = QUICK_MS }) {
  const argv = parseCheckCommand(command);
  const ref = String(branch || '').trim();
  if (!ref || ref.startsWith('-') || !SAFE_ARG.test(ref)) throw new Error('Say which branch to check out (e.g. "feature/x").');
  if (!folder || !fs.existsSync(folder)) throw new Error('The project\'s folder is missing.');
  const commit = await git(folder, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => '');
  if (!commit) throw new Error(`The branch ${ref} does not exist in the project's repository.`);
  fs.mkdirSync(checksDir, { recursive: true });
  const dir = path.join(checksDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`);
  await git(folder, ['worktree', 'add', '--detach', dir, commit]);
  const modules = path.join(dir, 'node_modules');
  let linked = false;
  let res;
  try {
    const own = path.join(folder, 'node_modules');
    if (fs.existsSync(own) && !fs.existsSync(modules)) {
      try { fs.symlinkSync(own, modules, 'junction'); linked = true; } catch { /* the check runs without it */ }
    }
    res = await runCommand(argv, dir, timeoutMs);
  } finally {
    // the link first: removing the checkout must never reach the project's own node_modules
    if (linked) { try { fs.unlinkSync(modules); } catch { /* removed with the checkout */ } }
    await git(folder, ['worktree', 'remove', '--force', dir]).catch(() => fs.rmSync(dir, { recursive: true, force: true }));
    await git(folder, ['worktree', 'prune']).catch(() => {});
  }
  const failures = failingTests(res.output);
  const ok = !res.timedOut && res.code === 0;
  const verdict = res.timedOut
    ? `stopped after ${Math.round(timeoutMs / 1000)} s (longer than a quick check: propose a check.run card)`
    : ok ? 'pass' : `fail (exit code ${res.code})`;
  const tail = res.output.length > TAIL_CHARS ? `…${res.output.slice(-TAIL_CHARS)}` : res.output;
  const text = [
    `Check of ${ref} (${commit.slice(0, 12)}): \`${argv.join(' ')}\` with MULTIAGENT_SIMULATION_ONLY=1, on a scratch checkout (removed).`,
    `Result: ${verdict}, ${(res.durationMs / 1000).toFixed(1)} s.`,
    failures.length ? `Failing tests:\n${failures.map((f) => `- ${f}`).join('\n')}` : '',
    `Output (end):\n${tail.trim() || '(none)'}`,
  ].filter(Boolean).join('\n\n');
  return { ok, text, exitCode: res.code, durationMs: res.durationMs, timedOut: res.timedOut, failures, commit };
}

module.exports = {
  CHECK_PROGRAMS,
  failingTests,
  LONG_MS,
  parseCheckCommand,
  QUICK_MS,
  runCheck,
};
