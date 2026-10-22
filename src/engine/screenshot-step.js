// The `type: screenshots` step (#144): a step without an agent that runs the project's screenshot
// command (`npm run screenshot -- <args>`, the `screenshot` script of the worktree's package.json)
// once per entry of an earlier step's `screenshots: [{ name, caption, args }]` output: "modified"
// from the worktree, then "original" with `--ref <base>`, into <run_dir>/evidence/<folder>/round-<n>/
// as `<name>.<side>.png` (src/evidence.js; the engine rebuilds the manifest after the step, with the
// captions of the output's `screenshots: [{ path, caption }]`).
// It never fails: no entries, a simulated run, no worktree, no screenshot command, an invalid entry,
// a timeout or a crash end up in the output (`errors`, `reason`, `message`), and the run goes on to
// the next step (the developer_check gate, which says what failed). Nothing is retried by an agent.
// Output: { kind: 'screenshots', folder, round, dir, taken, screens, screenshots, errors, new_elements,
// axe_findings, reason, message }. axe_findings (#387, src/engine/ui-review-checks.js): the axe-core and
// native-control findings of each modified side (the `<name>.<side>.checks.json` the capture writes),
// a baseline when the original side has them too; the ui_reviewer's prompt lists them. new_elements (#185): screens whose original side failed only because a --click /
// context / paste selector matched nothing ("screenshot: nothing matches <selector>") while the
// modified side was taken: an element the change adds, counted apart in the message, not an error.
// Each capture waits for the machine-wide screenshot slot (#199): one Electron screenshot at a time.

const fs = require('fs');
const path = require('path');
const evidence = require('../evidence');
const { killTree, OWN_GROUP, resolveCommand } = require('./providers');
const { runShim } = require('../shell');
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

// The project's screenshot command, from the worktree's package.json: 'npm run screenshot' or null
function screenshotCommand(dir) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return typeof pkg.scripts?.screenshot === 'string' && pkg.scripts.screenshot.trim() ? 'npm run screenshot' : null;
  } catch { return null; }
}

// Runs `npm run screenshot -- <args>` in cwd → { code, output, timedOut }; never rejects.
// onSpawn(pid): the command's process, watched by the memory guard (#276).
// logFile (#465): the command's output is appended to it as it comes (the step's live terminal).
function runShot({ cwd, args, env, timeoutMs, signal, onSpawn, logFile = null }) {
  const npm = resolveCommand('npm');
  if (!npm) return Promise.resolve({ code: null, output: 'npm not found in PATH', timedOut: false });
  const argv = ['run', 'screenshot', '--', ...args];
  // Electron as Electron (the engine may itself run inside Electron as node)
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv.CLAUDECODE;
  return new Promise((resolve) => {
    let child;
    try {
      child = runShim(npm.file, argv, { cwd, env: childEnv, windowsHide: true, ...OWN_GROUP });
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
// (src/engine/machine-slot.js) and gives it to its `npm run screenshot` child (SCREENSHOT_SLOT_ENV),
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

// entries: the developer's list; cwd: the worktree; base: the ref of the "original" side (none: modified
// only); env: the agents' environment (simulation only, scratch workspace); run: runShot (replaceable);
// slot: acquireSlot (replaceable); onSlotWait(holder): a capture waits for another run's screenshot;
// onSpawn(pid): each capture's process (the memory guard, #276)
// logFile (#465): the captures' output, one `$ <command>` line before each; onLog({ path, command }) is
// called once before the first capture runs (path relative to runDir)
async function captureScreenshots({ entries, cwd, runDir, folder, round, base, env, mock, signal, timeoutMs = SHOT_TIMEOUT_MS, run = runShot, log = () => {}, slot = acquireSlot, onSlotWait = () => {}, onSpawn = null, logFile, onLog }) {
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
  const command = cwd && fs.existsSync(cwd) ? screenshotCommand(cwd) : null;
  if (!valid.length) out.reason = 'no valid entry in the developer\'s list';
  else if (mock) out.reason = 'simulated run (the app is not captured)';
  else if (!runDir) out.reason = 'the run has no folder';
  else if (!cwd || !fs.existsSync(cwd)) out.reason = 'the run has no worktree to capture';
  else if (!command) out.reason = 'the project has no screenshot command (a "screenshot" script in package.json)';
  if (out.reason) return finish();

  fs.mkdirSync(dir, { recursive: true });
  const shotLog = openShotLog(logFile, runDir, command, onLog);
  for (const e of valid) {
    let shot = false;
    let modified = false;
    for (const side of base ? ['modified', 'original'] : ['modified']) {
      const args = [...e.args, '--out', dir, '--name', e.name, '--side', side, ...(side === 'original' ? ['--ref', base] : [])];
      const t0 = Date.now();
      log('info', `screenshots: ${command} -- ${args.join(' ')}`);
      shotLog.line(`$ ${command} -- ${args.join(' ')}\n`);
      const r = await withSlot({ signal, onSlotWait, slot }, (token) => run({ cwd, args, env: { ...env, [SCREENSHOT_SLOT_ENV]: token }, timeoutMs, signal, ...(onSpawn ? { onSpawn } : {}), ...shotLog.opts }));
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
  return finish();
}

module.exports = {
  captureScreenshots,
  checkEntry,
  MAX_SCREENS,
  screenshotCommand,
  splitArgs,
};
