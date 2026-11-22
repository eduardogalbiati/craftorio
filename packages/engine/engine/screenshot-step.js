// The `type: screenshots` step (#144): a step without an agent that runs the project's screenshot
// command (`npm run screenshot -- <args>`, the `screenshot` script of the worktree's package.json)
// once per entry of an earlier step's `screenshots: [{ name, caption, args }]` output: "modified"
// from the worktree, then "original" with `--ref <base>`, into <run_dir>/evidence/<folder>/round-<n>/
// as `<name>.<side>.png` (packages/engine/domains/evidence/evidence.js; the engine rebuilds the manifest after the step, with the
// captions of the output's `screenshots: [{ path, caption }]`).
// It never fails: no entries, a simulated run, no worktree, no screenshot command, an invalid entry,
// a timeout or a crash end up in the output (`errors`, `reason`, `message`), and the run goes on to
// the next step (the developer_check gate, which says what failed). Nothing is retried by an agent.
// Output: { kind: 'screenshots', folder, round, dir, taken, screens, screenshots, errors, new_elements,
// axe_findings, reason, message }. axe_findings (#387, packages/engine/engine/ui-review-checks.js): the axe-core and
// native-control findings of each modified side (the `<name>.<side>.checks.json` the capture writes),
// a baseline when the original side has them too; the ui_reviewer's prompt lists them. new_elements (#185): screens whose original side failed only because a --click /
// context / paste selector matched nothing ("screenshot: nothing matches <selector>") while the
// modified side was taken: an element the change adds, counted apart in the message, not an error.
// Each capture waits for the machine-wide screenshot slot (#199): one Electron screenshot at a time.
// #649 (write-doc in another project): the source of the captures, in this order (captureSource):
//   1. the project's own command: `npm run screenshot` (package.json), else the `command:` of the
//      repository's .craftorio/screenshot.yaml, run as `<command> -- <args>` with the same options;
//   2. Run App: the local preview of .craftorio/local-preview.yaml, captured by `capturePreview`
//      ({ entry, side, ref, out, name, cwd, config, env, signal, timeoutMs }; the machine gives
//      packages/engine/engine/preview-capture.js; ref is the base on the original side, null on the modified);
//   3. a manual attachment: nothing is taken and the reason asks the owner to attach the screenshots.
// out.source says which one ran ('command' | 'run-app' | 'manual').

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const yaml = require('js-yaml');
const evidence = require('../domains/evidence/evidence');
const { readRepoConfig } = require('../domains/local/local-preview');
const { killTree, OWN_GROUP, resolveCommand } = require('./providers');
const {
  quoteArg,
  runShim,
  shQuote,
} = require('../domains/machine/shell');
const { readChecks, screenChecks } = require('./ui-review-checks');
const {
  acquireSlot,
  SCREENSHOT_SLOT,
  SCREENSHOT_SLOT_ENV,
} = require('./machine-slot');

const MAX_SCREENS = 8;
const SHOT_TIMEOUT_MS = 180000;
// set by the step itself: the round folder, the file name, the side and the base
const RESERVED = ['--caption', '--name', '--out', '--ref', '--side'];
const NAME = /^[\w.-]+$/;
// scripts/screenshot.js's last line when a selector matches nothing
const NOTHING_MATCHES = /^screenshot: nothing matches (.+)$/;
const NPM_COMMAND = 'npm run screenshot';
// #649: the screenshot command of a project without a package.json script, committed by its owner
const { projectFiles } = require('@craftorio/shared/project-dir');
// T2c: .craftorio/ first, then .multiagent/ (a repository set up before the rename to Craftorio)
const SCREENSHOT_FILES = [...projectFiles('screenshot.yaml'), ...projectFiles('screenshot.yml')];

// "--view run --click \"[data-x] .y\"" → ['--view', 'run', '--click', '[data-x] .y'] (a list stays a list)
function splitArgs(v) {
  if (Array.isArray(v)) return v.every((a) => typeof a === 'string' || typeof a === 'number') ? v.map(String) : null;
  if (typeof v !== 'string') return v == null ? [] : null;
  const out = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(v));) out.push(m[1] != null ? m[1].replace(/\\(.)/g, '$1') : m[2] ?? m[3]);
  return out;
}

// One entry of the list → { name, caption, args } or { name, error }
function checkEntry(e, i) {
  const name = typeof e?.name === 'string' ? e.name.trim().replace(/\.(original|modified)?\.?png$/i, '') : '';
  const label = name || `entry ${i + 1}`;
  if (!e || typeof e !== 'object') return { name: label, error: 'not an object { name, caption, args }' };
  if (!NAME.test(name)) return { name: label, error: 'name must be a plain file name such as 144-gate-panel-default' };
  const args = splitArgs(e.args);
  if (!args) return { name, error: 'args must be a list of the screenshot command\'s options (or one string)' };
  const reserved = args.find((a) => RESERVED.includes(a));
  if (reserved) return { name, error: `${reserved} is set by the step` };
  return { name, caption: String(e.caption || '').trim() || name, args };
}

// #649: the `command:` of the repository's .craftorio/screenshot.yaml, trimmed; null when there is
// none, it is not valid YAML or it has no command
function yamlCommand(dir) {
  for (const rel of SCREENSHOT_FILES) {
    let doc;
    try { doc = yaml.load(fs.readFileSync(path.join(dir, rel), 'utf8')); } catch { continue; }
    const command = typeof doc?.command === 'string' ? doc.command.trim() : '';
    return command || null;
  }
  return null;
}

// The project's screenshot command: 'npm run screenshot' (a `screenshot` script in the worktree's
// package.json), else the command of .craftorio/screenshot.yaml (#649), else null
function screenshotCommand(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (typeof pkg.scripts?.screenshot === 'string' && pkg.scripts.screenshot.trim()) return 'npm run screenshot';
  } catch { /* no package.json: another project */ }
  return yamlCommand(dir);
}

// #649: how the evidence of the worktree is taken → { kind: 'command', command } | { kind: 'run-app',
// ...the .craftorio/local-preview.yaml config } | { kind: 'manual' } (an invalid preview file too)
function captureSource(dir) {
  const command = dir ? screenshotCommand(dir) : null;
  if (command) return { kind: 'command', command };
  const preview = readRepoConfig(dir);
  return preview && !preview.error ? { kind: 'run-app', ...preview } : { kind: 'manual' };
}

// `<command> -- <args>` for the shell, each argument quoted (cmd.exe on Windows, parsed once, its
// metacharacters ^-escaped: shell.js; /bin/sh elsewhere)
function shellLine(command, args) {
  const quote = process.platform === 'win32' ? (a) => quoteArg(a, { once: true }) : shQuote;
  return `${command} -- ${args.map(quote).join(' ')}`;
}

// The capture's child: `npm run screenshot -- <args>` (through the npm shim), any other command
// (#649) through the shell → ChildProcess, or { error } when npm is missing
function spawnShot(command, args, opts) {
  if (command !== NPM_COMMAND) return spawn(shellLine(command, args), { ...opts, shell: true });
  const npm = resolveCommand('npm');
  if (!npm) return { error: 'npm not found in PATH' };
  return runShim(npm.file, ['run', 'screenshot', '--', ...args], opts);
}

// Runs `<command> -- <args>` in cwd (default `npm run screenshot`) → { code, output, timedOut }; never rejects.
// onSpawn(pid): the command's process, watched by the memory guard (#276).
// logFile (#465): the command's output is appended to it as it comes (the step's live terminal).
function runShot({ cwd, args, env, timeoutMs, signal, onSpawn, logFile = null, command = NPM_COMMAND }) {
  // Electron as Electron (the engine may itself run inside Electron as node)
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.CLAUDECODE;
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnShot(command, args, { cwd, env: childEnv, windowsHide: true, ...OWN_GROUP });
      if (child.error) { resolve({ code: null, output: child.error, timedOut: false }); return; }
    } catch (e) {
      resolve({ code: null, output: e.message, timedOut: false });
      return;
    }
    if (child.pid) onSpawn?.(child.pid);
    let output = '';
    let timedOut = false;
    const file = logFile ? fs.createWriteStream(logFile, { flags: 'a' }) : null;
    file?.on('error', () => {});
    const keep = (d) => { output = (output + d).slice(-4000); file?.write(d); };
    child.stdout?.on('data', keep);
    child.stderr?.on('data', keep);
    const stop = () => killTree(child);
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    signal?.addEventListener('abort', stop, { once: true });
    const done = (code, err) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      const result = { code, output: err ? `${output}${err.message}` : output, timedOut };
      // resolved once the log is flushed: the next capture's `$ <command>` line comes after this output
      if (file && !file.writableEnded && !file.destroyed) file.end(() => resolve(result));
      else resolve(result);
    };
    child.on('error', (e) => done(null, e));
    child.on('close', (code) => done(code));
  });
}

// The last meaningful line of a failed command (the script prints its error last)
const lastLine = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop() || '';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// One Electron screenshot at a time on the machine (#199): each capture takes the machine-wide slot
// (packages/engine/engine/machine-slot.js) and gives it to its `npm run screenshot` child (SCREENSHOT_SLOT_ENV),
// which then does not wait for it. onSlotWait(holder) is called when a capture has to wait.
async function withSlot({ signal, onSlotWait, slot }, fn) {
  let held;
  try {
    held = await slot(SCREENSHOT_SLOT, { signal, holder: 'screenshots step', onWait: onSlotWait });
  } catch (e) {
    return { code: null, output: `waiting for the screenshot slot: ${e.message}`, timedOut: false };
  }
  try { return await fn(held.token); } finally { held.release(); }
}

// #387: the deterministic checks of a screen's modified side (none when it was not taken), baselines
// from its original side
function screenAxeFindings(dir, name, modified) {
  const checked = modified ? readChecks(path.join(dir, `${name}.modified.png`)) : null;
  if (!checked) return [];
  return screenChecks({ modified: checked, original: readChecks(path.join(dir, `${name}.original.png`)), screen: `${name}.modified.png` });
}

// #465: the captures' log, emptied and announced through onLog({ path, command }) (path relative to
// runDir) → { line(text), opts } (the run options that append each capture's output); none: no-ops
function openShotLog(logFile, runDir, command, onLog) {
  if (!logFile) return { line: () => {}, opts: {} };
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, '');
  onLog?.({ path: path.relative(runDir, logFile).split(path.sep).join('/'), command });
  return { line: (text) => fs.appendFileSync(logFile, text), opts: { logFile } };
}

const MANUAL_REASON = 'the project has no screenshot command (package.json or .craftorio/screenshot.yaml) and no local preview (.craftorio/local-preview.yaml): attach the screenshots by hand';

// Why nothing is captured, in the order the owner fixes it; null: capture
function skipReason({ valid, mock, runDir, cwd, source }) {
  if (!valid.length) return 'no valid entry in the developer\'s list';
  if (mock) return 'simulated run (the app is not captured)';
  if (!runDir) return 'the run has no folder';
  if (!cwd || !fs.existsSync(cwd)) return 'the run has no worktree to capture';
  return source.kind === 'manual' ? MANUAL_REASON : null;
}

// #649: one Run App capture as a command's result { code, output, timedOut }; a throw is its output
async function previewShot(capturePreview, opts) {
  try {
    await capturePreview(opts);
    return { code: 0, output: '', timedOut: false };
  } catch (e) {
    return { code: null, output: e?.message || String(e), timedOut: false };
  }
}

// Each side of each valid entry through take(entry, side, args) → { code, output, timedOut }; the
// images, errors, new elements and axe findings go into `out`
async function shootEntries(valid, { dir, base, runDir, label, take, timeoutMs, signal, log, shotLog, out }) {
  for (const e of valid) {
    let shot = false;
    let modified = false;
    for (const side of base ? ['modified', 'original'] : ['modified']) {
      const args = [...e.args, '--out', dir, '--name', e.name, '--side', side, ...(side === 'original' ? ['--ref', base] : [])];
      const t0 = Date.now();
      log('info', `screenshots: ${label} -- ${args.join(' ')}`);
      shotLog.line(`$ ${label} -- ${args.join(' ')}\n`);
      const r = await take(e, side, args);
      const file = path.join(dir, `${e.name}.${side}.png`);
      if (r.code === 0 && fs.existsSync(file)) {
        out.taken++;
        shot = true;
        if (side === 'modified') modified = true;
        out.screenshots.push({ path: path.relative(runDir, file).split(path.sep).join('/'), caption: e.caption, side, duration_ms: Date.now() - t0 });
        continue;
      }
      const error = r.timedOut ? `timed out after ${Math.round(timeoutMs / 1000)} s`
        : r.code === 0 ? 'the command wrote no image'
          : `exit ${r.code ?? '?'}: ${lastLine(r.output) || 'no output'}`;
      // #185: the base has no element the change adds; its modified side was taken, so not an error
      const missing = side === 'original' && modified && !r.timedOut && r.code !== 0 ? NOTHING_MATCHES.exec(lastLine(r.output)) : null;
      if (missing) { out.new_elements.push({ name: e.name, side, selector: missing[1].trim(), error }); continue; }
      out.errors.push({ name: e.name, side, error });
      // an invalid option (exit 2) fails the same way on the other side; a cancelled run stops here
      if (r.code === 2 || signal?.aborted) break;
    }
    if (shot) out.screens++;
    out.axe_findings.push(...screenAxeFindings(dir, e.name, modified));
    if (signal?.aborted) break;
  }
}

// entries: the developer's list; cwd: the worktree; base: the ref of the "original" side (none: modified
// only); env: the agents' environment (simulation only, scratch workspace); run: runShot (replaceable);
// slot: acquireSlot (replaceable); onSlotWait(holder): a capture waits for another run's screenshot;
// onSpawn(pid): each capture's process (the memory guard, #276)
// logFile (#465): the captures' output, one `$ <command>` line before each; onLog({ path, command }) is
// called once before the first capture runs (path relative to runDir)
// capturePreview (#649): the Run App capture of a project without a screenshot command; none: such a
// project asks for a manual attachment
async function captureScreenshots({ entries, cwd, runDir, folder, round, base, env, mock, signal, timeoutMs = SHOT_TIMEOUT_MS, run = runShot, log = () => {}, slot = acquireSlot, onSlotWait = () => {}, onSpawn = null, logFile, onLog, capturePreview = null }) {
  const dir = runDir ? evidence.roundDir(runDir, folder, round) : null;
  const out = {
    kind: 'screenshots', folder, round, dir: dir ? path.relative(runDir, dir).split(path.sep).join('/') : null,
    taken: 0, screens: 0, screenshots: [], errors: [], new_elements: [], axe_findings: [], reason: null, message: '',
  };
  const finish = () => {
    if (!out.taken && !out.reason) out.reason = `every capture failed (${out.errors[0]?.name}: ${out.errors[0]?.error})`;
    const fresh = out.new_elements.length ? `; ${plural(out.new_elements.length, 'new element')} (no original)` : '';
    const failed = out.errors.length ? `; ${plural(out.errors.length, 'error')}: ${out.errors.map((e) => `${e.name}${e.side ? ` (${e.side})` : ''}: ${e.error}`).join('; ')}` : '';
    out.message = out.taken
      ? `${plural(out.taken, 'screenshot')} of ${plural(out.screens, 'screen')} taken in round ${round}${fresh}${failed}`
      : `No screenshots: ${out.reason}${failed}`;
    return out;
  };
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) { out.reason = 'the developer listed no screens (a change without UI)'; return finish(); }
  const valid = [];
  list.forEach((e, i) => {
    const c = i < MAX_SCREENS ? checkEntry(e, i) : { name: e?.name || `entry ${i + 1}`, error: `over the limit of ${MAX_SCREENS} screens` };
    if (c.error) out.errors.push(c);
    else if (valid.some((v) => v.name === c.name)) out.errors.push({ name: c.name, error: 'the same name twice' });
    else valid.push(c);
  });
  const found = cwd && fs.existsSync(cwd) ? captureSource(cwd) : { kind: 'manual' };
  // #649: Run App needs a capture; without one the owner attaches the screenshots
  const source = found.kind === 'run-app' && !capturePreview ? { kind: 'manual' } : found;
  out.source = source.kind;
  out.reason = skipReason({ valid, mock, runDir, cwd, source });
  if (out.reason) return finish();

  fs.mkdirSync(dir, { recursive: true });
  const label = source.kind === 'command' ? source.command : `Run App ${source.url || source.command}`;
  const shotLog = openShotLog(logFile, runDir, label, onLog);
  // Run App: one session for every capture (the base worktree and its install made once)
  const session = {};
  const take = source.kind === 'command'
    ? (e, side, args) => withSlot({ signal, onSlotWait, slot }, (token) => run({ cwd, args, command: source.command, env: { ...env, [SCREENSHOT_SLOT_ENV]: token }, timeoutMs, signal, ...(onSpawn ? { onSpawn } : {}), ...shotLog.opts }))
    : (e, side) => withSlot({ signal, onSlotWait, slot }, () => previewShot(capturePreview, {
      entry: e, side, ref: side === 'original' ? base : null, out: path.join(dir, `${e.name}.${side}.png`), name: e.name,
      cwd, config: source, env, signal, timeoutMs, session,
    }));
  try {
    await shootEntries(valid, { dir, base, runDir, label, take, timeoutMs, signal, log, shotLog, out });
  } finally { await session.release?.(); }
  return finish();
}

module.exports = {
  captureScreenshots,
  captureSource,
  checkEntry,
  MAX_SCREENS,
  screenshotCommand,
  splitArgs,
};
