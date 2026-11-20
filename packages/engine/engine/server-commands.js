// Commands that never end by themselves: dev servers and watchers (#853).
//
// An agent that runs `pnpm dev` or `next dev` as a foreground tool call waits forever: the call
// returns only when the server ends, and a server never does (a run showed Running for 10+ minutes,
// twice). The engine's server-in-foreground guard (run/turns.js) stops such a command's process tree
// when it has no result after SERVER_FOREGROUND_MS; this module only says whether a command is one.
// Pure: no process is touched. Builds, tests and installs end, so they never match (`next build`,
// `vite build`, `npm test`, `pnpm build`, `npx vitest run`).
//
// A shell line is split on `&&`, `||`, `;`, `|` and newlines: any one segment that is a server makes
// the whole line one (`cd apps/web && pnpm dev`). In a segment, leading `VAR=value` assignments and
// the launchers that only run another program (`npx`, `bunx`, `pnpm exec`, `bundle exec`, `sudo`...)
// are skipped, then the program and its arguments are checked against the rules below.

'use strict';

const SEGMENTS = /&&|\|\||[;|\n]/;
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;
// programs that only run the next word
// (`eval`: the Bash tool's shell line, `bash -c ... && eval 'next dev' ...`, seen in a process list)
const WRAPPERS = new Set(['bunx', 'env', 'eval', 'exec', 'nohup', 'npx', 'sudo', 'time']);
// `<program> <word>` pairs that only run the next word
const WRAPPER_PAIRS = /^(bundle|npm|pnpm|yarn) (dlx|exec)$/;
const PACKAGE_MANAGERS = new Set(['bun', 'npm', 'pnpm', 'yarn']);
// package-manager options that take a value (`pnpm --filter web dev`, `yarn workspace web dev`)
const PM_VALUE_FLAGS = new Set(['--filter', '-F', '--dir', '-C', '--prefix', '--cwd', '--workspace', '-w', 'workspace']);
// scripts that start a server: dev, start, serve (and `dev:web`-like variants)
const SERVER_SCRIPT = /^(dev|start|serve)(:|$)/;
const NEXT_SERVER = new Set(['dev', 'start']);
// vite with no subcommand, an option or a server subcommand; `vite build` ends
const VITE_SERVER = (arg) => arg === undefined || arg.startsWith('-') || ['dev', 'preview', 'serve'].includes(arg);
const ALWAYS_SERVERS = new Set(['nodemon', 'uvicorn']);
// runners whose `--watch` / `-w` keeps them running
const WATCH_RUNNERS = new Set(['babel', 'esbuild', 'jest', 'mocha', 'node', 'rollup', 'sass', 'tailwindcss', 'tsc', 'tsup', 'tsx', 'vitest', 'webpack']);
const WATCH_FLAG = /^(--watch(All)?(=.*)?|-w)$/;
const PM_WATCH_FLAG = /^--watch(All)?(=.*)?$/;
const PYTHON = /^python(\d+(\.\d+)?)?$/;
// python -m <module> [args]: the modules that serve
const PY_SERVER_MODULES = { 'http.server': () => true, flask: (rest) => rest[0] === 'run', uvicorn: () => true };

// the program's bare name: no folder, no Windows extension (`bin/rails` -> rails, `vite.cmd` -> vite)
const programName = (word) => String(word).split(/[\\/]/).pop().replace(/\.(cmd|exe|bat|ps1)$/i, '');

// the words of a segment without its leading assignments and launchers
function commandWords(segment) {
  const words = segment.trim().split(/\s+/).filter(Boolean).map((w) => w.replace(/^["']|["']$/g, ''));
  for (;;) {
    if (!words.length) return words;
    if (ASSIGNMENT.test(words[0])) { words.shift(); continue; }
    const first = programName(words[0]);
    if (WRAPPERS.has(first)) { words.shift(); while (words[0]?.startsWith('-')) words.shift(); continue; }
    if (words.length > 1 && WRAPPER_PAIRS.test(`${first} ${words[1]}`)) { words.splice(0, 2); continue; }
    return words;
  }
}

// the script a package manager runs: its first word that is not an option (or an option's value),
// after `run` / `run-script`
function packageScript(args) {
  const plain = [];
  for (let i = 0; i < args.length; i++) {
    if (PM_VALUE_FLAGS.has(args[i])) { i++; continue; }
    if (!args[i].startsWith('-')) plain.push(args[i]);
  }
  return ['run', 'run-script'].includes(plain[0]) ? plain[1] : plain[0];
}

function isServerSegment(segment) {
  const words = commandWords(segment);
  if (!words.length) return false;
  const program = programName(words[0]);
  const args = words.slice(1);
  if (ALWAYS_SERVERS.has(program)) return true;
  if (program === 'next') return NEXT_SERVER.has(args[0]);
  if (program === 'vite') return VITE_SERVER(args[0]);
  if (PACKAGE_MANAGERS.has(program)) {
    const script = packageScript(args);
    return (!!script && SERVER_SCRIPT.test(script)) || args.some((a) => PM_WATCH_FLAG.test(a));
  }
  if (WATCH_RUNNERS.has(program) && args.some((a) => WATCH_FLAG.test(a))) return true;
  if (program === 'rails') return ['s', 'server'].includes(args[0]);
  if (program === 'flask') return args[0] === 'run';
  if (program === 'php') return args[0] === 'artisan' && args[1] === 'serve';
  if (PYTHON.test(program)) {
    const m = args.indexOf('-m');
    const serves = m >= 0 && PY_SERVER_MODULES[args[m + 1]];
    return !!serves && serves(args.slice(m + 2));
  }
  return false;
}

/** Whether a shell command (a tool call's `command`) starts a dev server or a watcher. */
function isServerCommand(command) {
  if (typeof command !== 'string' || !command.trim()) return false;
  return command.split(SEGMENTS).some(isServerSegment);
}

module.exports = {
  isServerCommand,
};
