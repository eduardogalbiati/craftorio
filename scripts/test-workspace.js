// A workspace's `npm test` (T5 of the Craftorio migration): scripts/test.js --workspace <the folder
// npm runs it in>. Under Turborepo (TURBO_HASH set) on Linux and macOS the runner moves to a session
// of its own, with no controlling terminal: Turborepo gives each task a pseudo-terminal, and a test
// that touches the terminal (an embedded terminal, an interactive shell) otherwise stops the whole
// group by job control (SIGTTIN / SIGTTOU), and the task hangs until its timeout. The output still
// goes to the same place; the exit code and a stop signal are passed along. Elsewhere (a shell, the
// orchestrator's suite step, Windows) it runs the runner as it is.
const { spawn } = require('child_process');
const path = require('path');

const runner = path.join(__dirname, 'test.js');
const args = [runner, '--workspace', process.cwd(), ...process.argv.slice(2)];
const ownSession = !!process.env.TURBO_HASH && process.platform !== 'win32';

const child = spawn(process.execPath, args, {
  stdio: ownSession ? ['ignore', 'inherit', 'inherit'] : 'inherit',
  detached: ownSession,
});
const stop = (signal) => {
  try { process.kill(ownSession ? -child.pid : child.pid, signal); } catch { /* already gone */ }
};
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => stop(signal));
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
