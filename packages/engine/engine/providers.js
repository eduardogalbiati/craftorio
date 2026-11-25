// @ts-check
// Runs one turn on a provider: spawns its CLI (or the simulation) and normalizes the events with the
// adapter's stream parser. What differs per CLI lives in its adapter (packages/shared/providers/, #348).
//
// Each turn = 1 headless process:
//   claude -p --output-format stream-json ...   (prompt via stdin)
//   codex exec --json ... -                     (prompt via stdin)
// Session continuity uses the session_id returned by the provider.
//
// Normalized items emitted via onItem():
//   { kind: 'spawn' | 'session' | 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'usage' | 'stderr' | 'raw', ... }

require('../domains/workspace/legacy-env'); // MULTIAGENT_* → CRAFTORIO_* for scripts and shells written before the rename (T2b)
const {
  execFile,
  execSync,
  spawn,
  spawnSync,
} = require('child_process');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const readline = require('readline');
const { refuseReal } = require('./simulation');
const { AGENT_ENV } = require('./capabilities');
const { childEnv } = require('./child-env');
const { runShim } = require('../domains/machine/shell');
const { setBrewLookup } = require('../domains/machine/install-commands');
const registry = require('@craftorio/shared/providers');
const { emptyUsage } = require('@craftorio/shared/providers/usage');

function sleep(ms, signal) {
  return /** @type {Promise<void>} */ (new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error('Cancelled')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  }));
}

// ---------------------------------------------------------------------------
// Command resolution on Windows: `claude` can be an .exe (native
// installer) or a .cmd (npm). .cmd/.bat must go through cmd.exe.
// ---------------------------------------------------------------------------
// Programs installed after the terminal/app was opened only show up in the
// registry PATH. We re-read HKCU/HKLM and append the missing entries.
let pathRefreshed = false;
const PATH_KEYS = ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'];
const regPath = (out) => { const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(String(out || '')); return m ? m[1].trim() : ''; };
function mergeRegistryPaths(values) {
  const expand = (s) => s.replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? `%${v}%`);
  const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const seen = new Set(current.map((p) => p.toLowerCase().replace(/\\+$/, '')));
  const extra = values
    .join(';').split(';').map((p) => expand(p.trim())).filter(Boolean)
    .filter((p) => { const k = p.toLowerCase().replace(/\\+$/, ''); if (seen.has(k)) return false; seen.add(k); return true; });
  if (extra.length) process.env.PATH = [...current, ...extra].join(path.delimiter);
}
function refreshWindowsPath() {
  if (process.platform !== 'win32' || pathRefreshed) return;
  pathRefreshed = true;
  const read = (key) => {
    try { return regPath(execSync(`reg query "${key}" /v Path`, { encoding: 'utf8', windowsHide: true })); } catch { return ''; }
  };
  mergeRegistryPaths(PATH_KEYS.map(read));
}
// refreshWindowsPath without blocking the process (#389)
let pathRefreshing = null;
function refreshWindowsPathAsync() {
  if (process.platform !== 'win32' || pathRefreshed) return Promise.resolve();
  pathRefreshing ??= Promise.all(PATH_KEYS.map((key) => new Promise((resolve) => {
    execFile('reg', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true }, (err, out) => resolve(err ? '' : regPath(out)));
  }))).then((values) => {
    if (pathRefreshed) return;
    pathRefreshed = true;
    mergeRegistryPaths(values);
  });
  return pathRefreshing;
}

// macOS and Linux (#316): an app opened from Finder or the Dock inherits PATH=/usr/bin:/bin:...,
// without Homebrew, ~/.local/bin, nvm... Once per process, the login shell's PATH goes first and
// the process's own entries follow. A shell that fails, hangs (3 s) or prints no PATH changes
// nothing. Its stdout goes to a file, not a pipe: a child the shell leaves behind would
// keep a pipe open past the timeout. SIGKILL: an interactive bash or zsh ignores SIGTERM.
// fish expands "$PATH" with spaces, so it joins the list with colons itself.
let loginPathMerged = false;
function mergeLoginShellPath() {
  if (process.platform === 'win32' || loginPathMerged) return;
  loginPathMerged = true;
  const shell = process.env.SHELL && fs.existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/sh';
  const mark = '__CRAFTORIO_PATH__';
  let dir;
  let out = '';
  try {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'login-path-'));
    const file = path.join(dir, 'out');
    const fd = fs.openSync(file, 'w');
    try {
      const value = path.basename(shell) === 'fish' ? '(string join : $PATH)' : '"$PATH"';
      spawnSync(shell, ['-ilc', `printf '${mark}%s${mark}' ${value}`], {
        stdio: ['ignore', fd, 'ignore'], timeout: 3000, killSignal: 'SIGKILL', windowsHide: true,
      });
    } finally { fs.closeSync(fd); }
    out = fs.readFileSync(file, 'utf8');
  } catch { /* no shell: PATH stays as it was */ }
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
  // The marked PATH's absolute folders, else a last line made only of absolute folders (a shell
  // that ignores -c); anything else is noise.
  const m = new RegExp(`${mark}(.*?)${mark}`, 's').exec(out);
  const entries = (m ? m[1] : out.trim().split('\n').pop() || '').split(path.delimiter).filter(Boolean);
  const login = m ? entries.filter((p) => path.isAbsolute(p)) : entries.every((p) => path.isAbsolute(p)) ? entries : [];
  if (!login.length) return;
  const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  process.env.PATH = [...new Set([...login, ...current])].join(path.delimiter);
}

// The folders the CLIs install to that are often missing from PATH (macOS and Linux).
function knownPosixDirs() {
  const home = os.homedir();
  const dirs = [path.join(home, '.local', 'bin'), path.join(home, '.grok', 'bin'), path.join(home, '.npm-global', 'bin')];
  try {
    const m = /^\s*prefix\s*=\s*(.+?)\s*$/m.exec(fs.readFileSync(path.join(home, '.npmrc'), 'utf8'));
    if (m) dirs.push(path.join(m[1].replace(/^~(?=$|\/)/, home), 'bin'));
  } catch { /* no ~/.npmrc */ }
  return [...dirs, '/opt/homebrew/bin', '/usr/local/bin'];
}

function isExecutableFile(p) {
  try {
    if (!fs.statSync(p).isFile()) return false;
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch { return false; }
}

function resolvePosixCommand(cmd) {
  if (cmd.includes('/')) return isExecutableFile(cmd) ? { file: path.resolve(cmd), shell: false } : null;
  mergeLoginShellPath();
  const dirs = [...(process.env.PATH || '').split(path.delimiter).filter(Boolean), ...knownPosixDirs()];
  for (const dir of dirs) {
    const p = path.resolve(dir, cmd);
    if (isExecutableFile(p)) return { file: p, shell: false };
  }
  return null;
}

// The program to spawn for `cmd`: { file, shell }, or null when it is not installed (every OS).
function resolveCommand(cmd) {
  if (process.platform !== 'win32') return resolvePosixCommand(cmd);
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return { file: cmd, shell: /\.(cmd|bat)$/i.test(cmd) };

  refreshWindowsPath();
  // 1) <cmd>.exe  2) binary with a platform suffix (e.g. winget installs
  // codex-x86_64-pc-windows-msvc.exe without an alias)  3) .cmd/.bat shims
  const exact = (ext) => (dir) => { const p = path.join(dir, cmd + ext); return fs.existsSync(p) ? p : null; };
  const suffixed = (dir) => {
    try {
      const f = fs.readdirSync(dir).find(suffixedName(cmd));
      return f ? path.join(dir, f) : null;
    } catch { return null; }
  };
  for (const [finder, shell] of /** @type {[(dir: string) => string | null, boolean][]} */ ([[exact('.exe'), false], [suffixed, false], [exact('.cmd'), true], [exact('.bat'), true]])) {
    for (const dir of windowsDirs()) {
      const p = finder(dir);
      if (p) return { file: p, shell };
    }
  }
  return null;
}

// The folders the CLIs install to that are often missing from PATH (Windows).
const windowsExtraDirs = () => [
  path.join(process.env.USERPROFILE || '', '.local', 'bin'),
  path.join(process.env.APPDATA || '', 'npm'),
];
const windowsDirs = () => [...(process.env.PATH || '').split(path.delimiter), ...windowsExtraDirs()].filter(Boolean);

// #397: the folders the lookup searches beyond PATH that exist now, read again on every launch (a
// folder an installer creates after the app started counts).
function cliDirs(platform = process.platform) {
  return (platform === 'win32' ? windowsExtraDirs() : knownPosixDirs()).filter((d) => path.isAbsolute(d) && fs.existsSync(d));
}

// #397: a spawn env whose PATH is its own entries first, in order, then the missing cliDirs(), so a
// terminal, an agent and their children find the CLI detection found. One PATH key whatever its case
// (`Path` on Windows); Windows compares folders case-insensitively, like mergeRegistryPaths.
function withCliPath(env, platform = process.platform) {
  const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') || 'PATH';
  const norm = platform === 'win32' ? (p) => p.toLowerCase().replace(/[\\/]+$/, '') : (p) => p;
  const current = String(env[key] || '').split(path.delimiter).filter(Boolean);
  const seen = new Set(current.map(norm));
  const extra = cliDirs(platform).filter((d) => { const k = norm(d); if (seen.has(k)) return false; seen.add(k); return true; });
  return extra.length ? { ...env, [key]: [...current, ...extra].join(path.delimiter) } : env;
}
const suffixedName = (cmd) => (n) => n.toLowerCase().startsWith(`${cmd}-`) && /-windows-[a-z]+\.exe$/i.test(n);

// Whether Homebrew is installed (#398), for packages/engine/domains/machine/install-commands.js's brew commands: macOS only, so
// no PATH lookup elsewhere. Also install-commands' lookup for a call without `brew` (#401).
const homebrewInstalled = (platform = process.platform) => platform === 'darwin' && !!resolveCommand('brew');
setBrewLookup(() => homebrewInstalled());

// resolveCommand without blocking the process (#389: listing every PATH folder for a CLI that is not
// installed took seconds on Windows), same answer: the folders are read in parallel, async.
async function resolveCommandAsync(cmd) {
  if (process.platform !== 'win32' || path.isAbsolute(cmd)) return resolveCommand(cmd);
  await refreshWindowsPathAsync();
  const dirs = windowsDirs();
  const exists = (p) => fs.promises.access(p).then(() => p, () => null);
  const exact = (ext) => (dir) => exists(path.join(dir, cmd + ext));
  const suffixed = (dir) => fs.promises.readdir(dir).then((names) => {
    const f = names.find(suffixedName(cmd));
    return f ? path.join(dir, f) : null;
  }, () => null);
  for (const [finder, shell] of /** @type {[(dir: string) => Promise<string | null>, boolean][]} */ ([[exact('.exe'), false], [suffixed, false], [exact('.cmd'), true], [exact('.bat'), true]])) {
    const p = (await Promise.all(dirs.map(finder))).find(Boolean);
    if (p) return { file: p, shell };
  }
  return null;
}

// The child and every descendant. macOS and Linux (#318): a child spawned with `detached: true`
// leads its own process group, so the group gets SIGTERM, then SIGKILL after a short grace (a
// grandchild that ignores SIGTERM, an interactive shell). A child that is not a group leader
// falls back to signalling the child alone. OWN_GROUP goes into the spawn options of every process
// killTree may stop (CLI turns, suites, screenshots, installs); on Windows `detached` would open a
// console, and taskkill /T already finds the tree.
const OWN_GROUP = { detached: process.platform !== 'win32' };
const KILL_GRACE_MS = 2000;
function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  const signal = (sig) => {
    try { process.kill(-child.pid, sig); return; } catch { /* not a group leader, or already gone */ }
    try { child.kill(sig); } catch { /* already gone */ }
  };
  signal('SIGTERM');
  setTimeout(() => signal('SIGKILL'), KILL_GRACE_MS).unref();
}

// ---------------------------------------------------------------------------
// Parsers: each CLI adapter's own (packages/shared/providers/<id>.js `parse`), named here for the tests
// and the callers that read one turn's stream.
// ---------------------------------------------------------------------------
const parseClaude = registry.byId('claude').parse;
const parseCodex = registry.byId('codex').parse;
const parseGrok = registry.byId('grok').parse;

// #233: the CLI session total a resumed Claude session continues from (packages/shared/providers/claude.js).
function seedClaudeTotal(sessionId, totalUsd) {
  registry.byId('claude').seedTotal(sessionId, totalUsd);
}

// The parsed turn runCli resolves with (the engine records it in session.message_received). #308:
// `usage` is the whole turn; usage_main (the main conversation), subagents and model_calls only when
// the CLI reports them (Claude), never zeros for the others.
function turnResult(acc) {
  return {
    text: acc.text || acc.lastText,
    usage: acc.usage || emptyUsage(),
    ...(acc.usageMain ? { usage_main: acc.usageMain } : {}),
    ...(acc.subagents ? { subagents: acc.subagents } : {}),
    ...(acc.modelCalls ? { model_calls: acc.modelCalls } : {}),
    costUsd: acc.costUsd,
    ...(acc.cliTotalCostUsd != null ? { cliTotalCostUsd: acc.cliTotalCostUsd } : {}),
    // #369: { model, cliVersion }: the CLI did not know the model, costUsd is its figure at another model's rates
    ...(acc.unrecognized ? { unrecognized: acc.unrecognized } : {}),
    providerSessionId: acc.providerSessionId,
    // #302: the turn ended on its request budget, after `requests` model requests
    ...(acc.cut ? { cut: true, requests: acc.cut.requests } : {}),
  };
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------
// Git settings for the agents' own git commands, through GIT_CONFIG_COUNT/KEY_n/VALUE_n (added after
// any the environment already has), so the repositories' config is never written. rerere: a
// conflict resolution recorded once is replayed when the same conflict comes back (#77).
function gitConfigEnv(env, settings) {
  const start = Number(env.GIT_CONFIG_COUNT) || 0;
  const out = { GIT_CONFIG_COUNT: String(start + Object.keys(settings).length) };
  Object.entries(settings).forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${start + i}`] = key;
    out[`GIT_CONFIG_VALUE_${start + i}`] = value;
  });
  return out;
}

// ---------------------------------------------------------------------------
// Image attachments (#129): image files a turn hands to the CLI next to its prompt. Callers store
// them in the workspace first (a run's attachments/ folder, a conversation's folder); runTurn checks
// them before anything is spawned. How each CLI opens them (its adapter's `imageInput`):
//   read: Claude Code reads them with its Read tool: their folders go with --add-dir, Read is offered
//   flag: attached to the message with --image=<file> (the `=` form: --image takes several values,
//         a separate one would swallow `resume` or the `-` stdin argument). Meant for Codex CLI, off
//         until a real `codex exec --image` call confirms it: then set it in its adapter
//   none: no confirmed way (Codex CLI for now, Grok Build): the prompt still lists the paths; the
//         caller warns (imageInput)
// Every provider gets the "Attached images" block with the absolute paths.
// ---------------------------------------------------------------------------
const IMAGE_TYPES = {
  '.gif': 'gif',
  '.jpeg': 'jpeg',
  '.jpg': 'jpeg',
  '.png': 'png',
  '.webp': 'webp',
};
const ATTACHMENT_LIMITS = { count: 10, bytes: 10 * 1024 * 1024 };

// How a provider type opens attached images: 'read', 'flag', 'record' (mock) or null (it cannot).
const imageInput = (type) => registry.byType(type)?.imageInput || null;

// The image format of a file's first bytes, or null.
function sniffImage(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.length >= 6 && /^GIF8[79]a$/.test(buf.subarray(0, 6).toString('latin1'))) return 'gif';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/**
 * Checks a turn's attachments (paths or { path, name }) against the limits: PNG, JPEG, GIF or WebP
 * (by extension and content), at most ATTACHMENT_LIMITS.count images of ATTACHMENT_LIMITS.bytes each.
 * Returns [{ path (absolute), name }]; throws an error naming the file and the limit.
 */
function checkAttachments(list) {
  const files = (list || []).map((a) => (typeof a === 'string' ? { path: a } : a || {}))
    .map((a) => ({ path: path.resolve(String(a.path || '')), name: String(a.name || path.basename(String(a.path || ''))) }));
  if (files.length > ATTACHMENT_LIMITS.count) throw new Error(`Too many attached images: ${files.length} (at most ${ATTACHMENT_LIMITS.count} per turn).`);
  const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  for (const f of files) {
    const type = IMAGE_TYPES[path.extname(f.path).toLowerCase()];
    if (!type) throw new Error(`Attached file "${f.name}" is not a supported image: only PNG, JPEG, GIF and WebP files can be attached.`);
    let stat;
    try { stat = fs.statSync(f.path); } catch { throw new Error(`Attached image "${f.name}" was not found: ${f.path}`); }
    if (!stat.isFile()) throw new Error(`Attached image "${f.name}" is not a file: ${f.path}`);
    if (stat.size > ATTACHMENT_LIMITS.bytes) throw new Error(`Attached image "${f.name}" is ${mb(stat.size)}: the limit is ${mb(ATTACHMENT_LIMITS.bytes)} per image.`);
    const head = Buffer.alloc(12);
    const fd = fs.openSync(f.path, 'r');
    let read;
    try { read = fs.readSync(fd, head, 0, 12, 0); } finally { fs.closeSync(fd); }
    if (sniffImage(head.subarray(0, read)) !== type) throw new Error(`Attached file "${f.name}" is not a valid ${type.toUpperCase()} image: only PNG, JPEG, GIF and WebP files can be attached.`);
  }
  return files;
}

// Whether a file name is one of the image types a turn may carry (by extension only).
const isImagePath = (file) => !!IMAGE_TYPES[path.extname(String(file || '')).toLowerCase()];

/**
 * Checks images (checkAttachments) and copies them into `dir` (a workspace folder: a run's
 * attachments/, a conversation's folder), each under a safe file name (-2, -3... when taken), so
 * they outlive the originals and survive a resume. Returns [{ name, path }] of the copies.
 */
function storeAttachments(list, dir) {
  const files = checkAttachments(list);
  if (!files.length) return [];
  fs.mkdirSync(dir, { recursive: true });
  return files.map((f) => {
    const ext = path.extname(f.path).toLowerCase();
    const base = path.basename(f.name, path.extname(f.name)).replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^[-.]+|-+$/g, '').slice(-80) || 'image';
    let file = path.join(dir, `${base}${ext}`);
    for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base}-${n}${ext}`);
    fs.copyFileSync(f.path, file);
    return { name: f.name, path: file };
  });
}

// The prompt block listing a turn's images, worded for how the CLI opens them.
function attachmentsBlock(files, type) {
  const how = {
    read: 'Open each one with your Read tool before you start.',
    flag: 'They are attached to this message; the files are:',
  }[imageInput(type)] || 'Open each file if you can read images.';
  return `## Attached images\n${how}\n${files.map((f) => `- ${f.name}: ${f.path}`).join('\n')}`;
}

// Claude Code: Read among the offered tools (a --tools list without it, e.g. a tool-less chat).
function withReadTool(args) {
  const i = args.indexOf('--tools');
  if (i < 0 || i + 1 >= args.length) return args;
  const tools = String(args[i + 1]).split(',').map((t) => t.trim()).filter(Boolean);
  if (tools.includes('Read')) return args;
  return [...args.slice(0, i + 1), [...tools, 'Read'].join(','), ...args.slice(i + 2)];
}

/**
 * The command line and prompt of one CLI turn: { args, prompt, promptFile }. Without attachments
 * both are exactly what the provider's definition and extraArgs give; `attachments` (checked by
 * checkAttachments) add the per-CLI arguments (IMAGE_INPUT) and the "Attached images" block.
 */
function cliInvocation({ provider, model, effort, providerSessionId, prompt, extraArgs, render, attachments = [] }) {
  // `prompt_file_arg`: CLIs that take the prompt from a file (e.g. grok --prompt-file) instead of stdin
  const promptFile = provider.prompt_file_arg ? path.join(os.tmpdir(), `craftorio-prompt-${crypto.randomUUID()}.md`) : null;
  const vars = { model, effort, session_id: providerSessionId, prompt_file: promptFile };
  const input = attachments.length ? imageInput(provider.type) : null;
  const imageArgs = input === 'read' ? [...new Set(attachments.map((f) => path.dirname(f.path)))].flatMap((d) => ['--add-dir', d])
    : input === 'flag' ? attachments.map((f) => `--image=${f.path}`) : [];
  let args = [
    ...(provider.args || []),
    // `effort_args` (e.g. claude --effort {{ effort }}): only when the agent sets an effort
    ...(effort ? provider.effort_args || [] : []),
    ...(extraArgs || []),
    ...imageArgs,
    ...(providerSessionId ? provider.resume_args || [] : []),
    ...(provider.stdin_arg ? [provider.stdin_arg] : []),
    ...(provider.prompt_file_arg || []),
  ].map((a) => render(String(a), vars));
  if (input === 'read') args = withReadTool(args);
  return { args, prompt: attachments.length ? `${prompt}\n\n${attachmentsBlock(attachments, provider.type)}` : prompt, promptFile };
}

function runCli(opts, parser) {
  const { provider, providerSessionId, cwd, timeoutMs, signal, onItem, agentEnv, accountEnv: account, envPlatforms, envPassthrough } = opts;
  const { args, prompt, promptFile } = cliInvocation(opts);

  const resolved = resolveCommand(provider.command);
  if (!resolved) return Promise.reject(new Error(`Command "${provider.command}" not found in PATH.`));
  if (!fs.existsSync(cwd)) return Promise.reject(new Error(`Working directory does not exist: ${cwd}`));
  if (signal?.aborted) return Promise.reject(new Error('Cancelled'));

  // #470 (SEC-5): the allowlisted environment (platform tokens per the agent's bash:gh / bash:glab,
  // the workflow's env.passthrough); #397: the agent and its children (gh, npm shims' node) find what detection found
  const env = withCliPath(childEnv(process.env, { platforms: envPlatforms || [], passthrough: envPassthrough || [] }));
  Object.assign(env, gitConfigEnv(env, { 'rerere.enabled': 'true' }));
  // agents' own checks never start real runs, and need no `VAR=value` prefix (refused by allowlists);
  // agentEnv (capabilities.agentEnv): with the run's scratch workspace when it has one (#120)
  Object.assign(env, agentEnv || AGENT_ENV);
  // #312: the turn's account (its config folder, accountEnv), for this process only
  Object.assign(env, account);

  // the recording names the environment's keys, never their values (#470)
  onItem({ kind: 'spawn', command: resolved.file, args, cwd, env: Object.keys(env).sort() });

  if (promptFile) fs.writeFileSync(promptFile, prompt);

  return new Promise((resolve, reject) => {
    const child = runShim(resolved.file, args, { cwd, env, windowsHide: true, ...OWN_GROUP });
    // the CLI's process (the memory guard watches its tree, #276); shim: a .cmd/.bat wrapper whose
    // child is the CLI itself
    if (child.pid) opts.onSpawn?.({ pid: child.pid, shim: !!resolved.shell });

    // #728: a fresh turn (no session resumed) owes nothing to an earlier total under the same CLI session id
    /** @type {import('../../shared/types').TurnResult} */
    const acc = { text: '', lastText: '', usage: null, costUsd: null, providerSessionId, error: null, ...(providerSessionId ? {} : { turnTotalBefore: 0 }) };
    let stderr = '';
    let done = false;

    const finish = (err, val) => {
      if (done) return;
      done = true;
      // #233: a turn that ends without its result (timeout, cancel, crash) still paid for its model calls
      if (err) err.partial = { usage: acc.usage || acc.streamUsage || null, costUsd: acc.costUsd, modelCalls: acc.modelCalls || 0 };
      clearTimeout(timer);
      if (promptFile) fs.rm(promptFile, { force: true }, () => {});
      signal?.removeEventListener('abort', onAbort);
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => { killTree(child); finish(new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    const onAbort = () => { killTree(child); finish(new Error('Cancelled')); };
    signal?.addEventListener('abort', onAbort, { once: true });

    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      line = line.trim();
      if (!line) return;
      let ev;
      try { ev = JSON.parse(line); } catch { onItem({ kind: 'raw', text: line }); return; }
      try { parser(ev, onItem, acc); } catch (e) { onItem({ kind: 'raw', text: line }); }
    });
    child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; onItem({ kind: 'stderr', text: s }); });
    child.stdin.on('error', () => {});
    child.on('error', (e) => finish(e));
    child.on('close', (code) => {
      parser.flush?.(onItem, acc);
      // #369: what the CLI said on stderr about the turn (Claude: a model it does not know)
      parser.stderr?.(stderr, acc);
      // a --max-turns of the agent's own args (not its max_requests): the attempt fails, as before #302
      if (acc.cut && !opts.hint?.maxRequests) acc.error ||= 'Claude returned an error: error_max_turns (the --max-turns of its args)';
      // #860: the tail of what the CLI printed on stderr says why the turn failed
      const tail = stderr.trim() ? stderr.slice(-800).trim() : '';
      if (acc.error) return finish(new Error(tail ? `${acc.error}\n\nstderr: ${tail}` : acc.error));
      if (code !== 0 && !acc.text && !acc.cut) return finish(new Error(`Process exited with code ${code}. ${stderr.slice(-800)}`));
      finish(null, { ...turnResult(acc), exitCode: code });
    });

    child.stdin.end(promptFile ? '' : prompt);
  });
}

// ---------------------------------------------------------------------------
// Mock: simulates an agent to test the flow without spending tokens
// ---------------------------------------------------------------------------
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));

function mockString(key) {
  return ({
    branch: 'feat/mock-feature',
    pr_url: 'https://github.com/acme/app/pull/42',
    deploy_url: 'https://staging.acme.dev',
    fix_request: 'Reviewer comment: extract the magic constant 60000 into a setting.',
    question: 'A reviewer suggested switching the YAML library. Does that make sense in this PR?',
    failure_log: 'test/engine.test.js:12 AssertionError: expected "approved"',
    failure_report: 'npm test: 1 failure in test/engine.test.js (validateSchema accepts an invalid enum).',
    e2e_note: 'Simulated: the run\'s scenarios written and checked with a dry run; they run at release (E2E release workflow).',
    file: 'src/auth/login.ts',
    summary: 'Simulated implementation of the feature with tests.',
    message: 'Simulated draft: I covered the request and applied the latest notes.',
    document: '# Simulated document\n\n## Summary\n\nThis draft was written by the mock provider.\n\n## Details\n\n- First point\n- Second point\n',
    text: 'Simulated note on the draft.',
    // the release run's review (#290): the sections the Ship gate and release-summary.md show
    release_summary: [
      'Simulated: both suites are green after 2 unit rounds, 1 E2E round and 1 fix, in 12 minutes for US$ 0.84.',
      '',
      '## Timeline',
      '',
      '| # | Step | Result | Time | Cost |',
      '| --- | --- | --- | --- | --- |',
      '| 1 | Unit tests | red: 1 failure in test/engine.test.js | 3 min | |',
      '| 2 | Fix the regression | a6f3c21: the workflow loader | 5 min | US$ 0.84 |',
      '| 3 | Unit tests | green | 3 min | |',
      '| 4 | E2E scenarios | green | 1 min | |',
      '',
      '## The fixes',
      '',
      '- **a6f3c21** (packages/engine/engine/workflow.js, +4 −1): the loader read the examples before they merged. A regression of #8 by #12.',
      '',
      '## Before you ship',
      '',
      '- The diff to read: 1 file, 5 lines. Ship merges the fix, pushes the local main and tags the release.',
      '- The release\'s version does not match package.json: check the tag.',
      '',
      '## Follow-ups',
      '',
      '- Add a unit test for the loader without the examples folder (the fix\'s test_notes).',
      '',
      'Read before shipping: the version against package.json.',
    ].join('\n'),
    explanation: 'The answer did not have the fields this step requires, so the run could not use it. I asked for it again with the expected format.',
    instruction: 'Answer only with the JSON object the step asks for, with every required field.',
    item: 'Simulated part of the goal',
  })[key] || `(simulated) ${key}`;
}

// Per-visit sequences: exercise the fix, /loop and human-decision paths.
const MOCK_SEQUENCES = {
  verdict: ['changes_requested', 'approved'],
  tests_status: ['fail', 'pass'],
  build_status: ['success'],
  ci_status: ['pending', 'failed', 'pending', 'success'],
  state: ['waiting', 'needs_human', 'needs_fix', 'ready_to_merge'],
  // the preview fails once because of the code: developer → ci → pr_babysitter → preview again
  preview_status: ['pending', 'failed', 'success'],
  failure_class: ['code'],
  deploy_status: ['pending', 'success'],
  // writer-reviewer: the draft is approved on the 3rd review (threshold 8)
  score: [5.5, 7, 8.6],
};

// The test writer's E2E scenarios (#143), mixed statuses for the gates: a visit whose tests_status
// fails (the 1st by default) has a failed scenario, the next ones pass it; one is always skipped
// (environment). The UI scenario's screenshot is under the visit's evidence folder (the screenshot
// demo writes it; a plain mock run has no image).
// A schema whose status allows `pending` (a development run's test step, #199; it also allows
// passed / failed for `e2e_tests: write_and_run`, #203, and test-batch): the scenarios are written,
// not run: pending (run at release by e2e-release), one skipped (not writable here).
function mockScenarios(h, statuses = []) {
  const seq = h.sequences?.tests_status || MOCK_SEQUENCES.tests_status;
  const failing = seq[Math.min(h.visit - 1, seq.length - 1)] === 'fail';
  const feature = 'features/143-dashboard-filter.feature';
  if (statuses.includes('pending') || (statuses.length && !statuses.includes('passed'))) {
    return [
      { feature, name: 'Filter the runs by status', status: 'pending', steps: ['Given the dashboard lists 3 runs, one of them failed', 'When I pick "Failed" in the status filter', 'Then only the failed run is listed'], screenshots: [] },
      { feature, name: 'An empty filter result explains itself', status: 'pending', steps: ['Given the dashboard lists 2 runs, none of them failed', 'When I pick "Failed" in the status filter', 'Then I see "No run matches this filter"'], screenshots: [] },
    ];
  }
  return [
    {
      feature, name: 'Filter the runs by status', status: 'passed',
      steps: ['Given the dashboard lists 3 runs, one of them failed', 'When I pick "Failed" in the status filter', 'Then only the failed run is listed'],
      screenshots: [`evidence/test/round-${h.visit}/143-e2e-filter-by-status-1.modified.png`],
    },
    {
      feature, name: 'An empty filter result explains itself', status: failing ? 'failed' : 'passed',
      ...(failing ? { reason: 'Then "No run matches this filter" is shown: the list was empty without a message (simulated)' } : {}),
      steps: ['Given the dashboard lists 2 runs, none of them failed', 'When I pick "Failed" in the status filter', 'Then I see "No run matches this filter"'],
      screenshots: [],
    },
    {
      feature, name: 'The filter is kept after a restart', status: 'skipped',
      reason: 'Environment: the app could not be restarted headless in this run (simulated)',
      steps: ['Given I filtered the dashboard by "Failed"', 'When I restart the app', 'Then the dashboard is still filtered by "Failed"'],
      screenshots: [],
    },
  ];
}

// The lists empty in a simulated answer: preexisting_failures and ui_findings unless their sequence
// asks for one, the ui_reviewer's dismissed deterministic findings (#387) always
const EMPTY_UNLESS_ASKED = ['preexisting_failures', 'ui_findings'];
const mockEmptyList = (key, h) => key === 'dismissed' || (EMPTY_UNLESS_ASKED.includes(key) && !h.sequences?.[key]);

// The simulated agent's question (#567, sequences.needs_human)
const MOCK_QUESTION = {
  question: 'Should the new setting be on by default? (simulated question)',
  options: [{ id: 'off', label: 'Off by default' }, { id: 'on', label: 'On by default' }],
  default: 'off',
};

// h.sequences (WorkflowRun's mockSequences) overrides the defaults per field
function mockValue(s, key, h) {
  if (s.enum) {
    const seq = h.sequences?.[key] || MOCK_SEQUENCES[key];
    // only when the sequence fits this enum (the same key can mean different things in different steps)
    if (seq && seq.every((v) => s.enum.includes(v))) return seq[Math.min(h.visit - 1, seq.length - 1)];
    return s.enum[0];
  }
  if (s.type === 'number' || s.type === 'integer') {
    const seq = h.sequences?.[key] || MOCK_SEQUENCES[key];
    if (seq && seq.every(Number.isFinite)) return seq[Math.min(h.visit - 1, seq.length - 1)];
  }
  if (s.type === 'integer') {
    if (key === 'pr_number') return 42;
    // ai-arena's critique: each critic scores a different "Proposal N"
    if (key === 'proposal') return 1 + (((h.call || 1) - 1) % 2);
    return 0;
  }
  switch (s.type) {
    case 'object': {
      /** @type {Record<string, any>} */
      const o = {};
      for (const [k, ps] of Object.entries(s.properties || {})) {
        // sequences.needs_human: { <step>: n } (#567): an ask_human step asks the owner on its first n visits
        if (k === 'needs_human') {
          if (h.visit <= (+h.sequences?.needs_human?.[String(h.stepId).split(':')[0]] || 0)) o[k] = structuredClone(MOCK_QUESTION);
          continue;
        }
        o[k] = mockValue(ps, k, h);
      }
      if ('state' in o && o.state !== 'needs_fix') delete o.fix_request;
      if ('state' in o && o.state !== 'needs_human') delete o.question;
      return o;
    }
    // sequences.preexisting_failures: true: the test writer reports a test that also fails on the base
    // sequences.left_out: [1, 0]: the developer declares one gap on its 1st visit, none after (default none)
    // sequences.left_out_not_mine: true: the developer also declares the issue's Tests and Measure tasks (#173)
    // sequences.ui_findings: true: the ui_reviewer (code_review, #151) returns a (blocking) UI finding
    case 'array': {
      if (mockEmptyList(key, h)) return [];
      // sequences.files_changed: [[...files of visit 1], ...] (#340: the languages a run changed)
      const files = key === 'files_changed' && h.sequences?.files_changed;
      if (Array.isArray(files) && files.length) return [...files[Math.min(h.visit - 1, files.length - 1)]];
      // the developer's screens to capture (#144): one valid entry of the screenshot command
      if (key === 'screenshots' && s.items?.properties?.args) return [{ name: '144-dashboard-default', caption: 'The dashboard (simulated)', args: ['--view', 'dashboard'] }];
      if (key === 'scenarios' && s.items?.properties?.status) return mockScenarios(h, s.items.properties.status.enum || []);
      if (key === 'left_out') {
        const seq = h.sequences?.left_out;
        const count = Array.isArray(seq) && seq.length ? +seq[Math.min(h.visit - 1, seq.length - 1)] || 0 : 0;
        const gaps = Array.from({ length: count }, () => mockValue(s.items || { type: 'string' }, key, h));
        if (!h.sequences?.left_out_not_mine) return gaps;
        return [...gaps,
          { requirement: '**Tests**: unit tests of the change (simulated)', reason: 'Only the test writer writes tests' },
          { requirement: 'Measure: real before/after runs (simulated)', reason: 'Real runs are refused in this run' }];
      }
      return [mockValue(s.items || { type: 'string' }, key, h)];
    }
    case 'boolean': {
      const seq = h.sequences?.[key];
      return seq && seq.every((v) => typeof v === 'boolean') ? seq[Math.min(h.visit - 1, seq.length - 1)] : true;
    }
    case 'number': return 1.5;
    default: return mockString(key);
  }
}

// The project map's cartographer (#372) without mockSequences.city_plan: one district that takes
// every file, so the plan passes the validation of any repository
const MOCK_CITY_PLAN = {
  version: 1, project: 'simulated', summary: 'A simulated plan: every file in one district.', ignore: [],
  zones: [{ id: 'core', name: 'Core', kind: 'industrial', purpose: 'Every file of the project (simulated).' }],
  districts: [{ id: 'everything', name: 'Everything', zone: 'core', purpose: 'Every file (simulated).', include: ['*'], exclude: [] }],
  landmarks: [], ports: [], evidence: [],
};

// A schema's mock answer; its `city_plan` (#372) is mockSequences.city_plan[visit - 1] (the last
// one repeats), else MOCK_CITY_PLAN
function mockAnswer(h) {
  const out = mockValue(h.schema, '', h);
  if (!out || typeof out !== 'object' || !('city_plan' in out)) return out;
  const plans = Array.isArray(h.sequences?.city_plan) && h.sequences.city_plan.length ? h.sequences.city_plan : [MOCK_CITY_PLAN];
  return { ...out, city_plan: structuredClone(plans[Math.min(h.visit - 1, plans.length - 1)]) };
}

// Simulated context window: grows with each turn of the same conversation (30k more per turn),
// so max_context and handoff sessions can be exercised deterministically.
const mockTurns = new Map();
const MOCK_HANDOFF = '```handoff\n- Goal: simulated goal of this agent\n- State: branch feat/mock-feature, commit abc1234\n- Done: simulated work of this turn\n- Left: nothing blocking\n- Decisions: none\n- Key files: src/auth/login.ts\n- Known problems: none\n```';

// sequences.usage_limits: ['<provider>' | '<provider>:<model>' | '<provider>@<account>', ...] (#262,
// #312): every turn of an agent on a listed provider (hint.provider, the agent's own, not `mock`),
// provider:model or account of the provider (hint.account) answers with that CLI's usage-limit
// message (hint.providerType), as a real CLI out of credits does
function mockUsageLimited(hint, model) {
  const limits = hint?.sequences?.usage_limits;
  if (!Array.isArray(limits) || !hint.provider) return false;
  return [hint.provider, `${hint.provider}:${model}`, hint.account && `${hint.provider}@${hint.account}`].some((k) => k && limits.includes(k));
}

// #31: a simulated turn spends nothing (cost 0, its tokens still reported); sequences.simulated_cost
// (tests of the cost mechanics) brings back the priced amounts
const mockCost = (hint, usd) => (hint?.sequences?.simulated_cost ? usd : 0);

async function runMock({ providerSessionId, model, hint, signal, onItem, attempt = 1, timeoutMs, attachments = [] }) {
  const sid = providerSessionId || `mock-${Math.random().toString(36).slice(2, 10)}`;
  const scale = +(process.env.CRAFTORIO_MOCK_DELAY_SCALE ?? 1);
  const d = (ms) => sleep(ms * scale * (0.6 + Math.random() * 0.8), signal);
  const n = (mockTurns.get(sid) || 0) + 1;
  mockTurns.set(sid, n);
  const start = 20000 + 30000 * (n - 1);

  onItem({ kind: 'session', sessionId: sid, model });
  onItem({ kind: 'context', tokens: start });
  if (mockUsageLimited(hint, model)) {
    await d(200);
    throw new Error(registry.byType(hint.providerType)?.usageLimitMessage || `${hint.provider}: usage limit reached`);
  }
  // the follow-up that asks only for the handoff note
  if (hint?.handoffOnly) {
    await d(300);
    onItem({ kind: 'text', text: MOCK_HANDOFF });
    const usage = { input: 200, output: 150, cache_read: start, cache_write: 0, reasoning: 0 };
    const costUsd = mockCost(hint, 0.001);
    onItem({ kind: 'usage', usage, costUsd });
    return { text: MOCK_HANDOFF, usage, costUsd, providerSessionId: sid, exitCode: 0 };
  }
  await d(600);
  onItem({ kind: 'thinking', text: `Analyzing step "${hint?.stepId ?? 'delegated'}" (visit ${hint?.visit ?? '-'}).\nI will inspect the repository and plan the next steps.` });
  // attached images (#129): recorded, never opened
  if (attachments.length) onItem({ kind: 'thinking', text: `Attached images (simulated: not opened): ${attachments.map((f) => `${f.name} (${f.path})`).join(', ')}` });
  await d(900);
  // sequences.permission_denials: { stepId: n }: in the first n answers of that step every tool
  // call is refused by the allowlist (an agent fighting its cli_args)
  if (hint?.call <= (hint?.sequences?.permission_denials?.[hint.stepId] || 0)) {
    const refused = ['gh pr view', '& "C:\\Program Files\\GitHub CLI\\gh.exe" pr view', 'cmd /c gh pr view',
      '"/c/Program Files/GitHub CLI/gh.exe" pr view', 'C:\\PROGRA~1\\GITHUB~1\\gh.exe pr view', '$env:PATH += ";C:\\Program Files\\GitHub CLI"; gh pr view'];
    for (const [i, command] of refused.entries()) {
      onItem({ kind: 'tool_call', id: `d${i}`, name: i % 2 ? 'Bash' : 'PowerShell', input: { command } });
      onItem({ kind: 'tool_result', id: `d${i}`, output: 'This command requires approval', is_error: true });
    }
  } else {
    // sequences.slow_tools: { stepId: ms }: the tool call of that step's turns waits ms (not scaled),
    // with no output meanwhile (an agent waiting on a command that does not end)
    const slow = hint?.stepId != null && hint?.sequences?.slow_tools?.[hint.stepId];
    onItem({ kind: 'tool_call', id: 't1', name: 'Bash', input: { command: slow ? 'until grep -q "duration_ms" out.log; do sleep 5; done' : 'git status' } });
    await (slow ? sleep(slow, signal) : d(500));
    onItem({ kind: 'tool_result', id: 't1', output: 'On branch feat/mock-feature\nnothing to commit, working tree clean' });
    // sequences.tool_timeouts: { stepId: n }: in the first n answers of that step a test command
    // without a `timeout` is cut at the Bash tool's default (#178)
    if (hint?.call <= (hint?.sequences?.tool_timeouts?.[hint.stepId] || 0)) {
      onItem({ kind: 'tool_call', id: 't2', name: 'Bash', input: { command: 'node --test test/slow.test.js' } });
      onItem({ kind: 'tool_result', id: 't2', output: '▶ slow suite\nCommand timed out after 2m 0.0s', is_error: true });
    }
  }
  // sequences.timeouts: { stepId: n }: the first n attempts of each of that step's turns are killed
  // at their timeout after their tool call (the engine retries with the attempt's summary); the two
  // model calls it made are reported as runCli does (#233: the engine prices them)
  if (hint?.stepId != null && attempt <= (hint?.sequences?.timeouts?.[hint.stepId] || 0)) {
    const usage = { input: 1500, output: 400, cache_read: 2 * start + 10000, cache_write: 0, reasoning: 0 };
    throw Object.assign(new Error(`Timed out after ${Math.round((timeoutMs || 0) / 1000)}s`), { partial: { usage, costUsd: mockCost(hint, null), modelCalls: 2 } });
  }
  await d(800);
  // sequences.request_budget: { stepId: n }: the first n turns of that step (wrap-up requests not
  // counted) end on the agent's request budget (hint.maxRequests) without an answer, as
  // claude -p --max-turns does (#302)
  if (hint?.maxRequests && hint.call <= (hint.sequences?.request_budget?.[hint.stepId] || 0)) {
    onItem({ kind: 'context', tokens: start + 40000 });
    const usage = { input: 1500, output: 400, cache_read: hint.maxRequests * start, cache_write: 0, reasoning: 0 };
    const costUsd = mockCost(hint, 0.05);
    onItem({ kind: 'usage', usage, costUsd });
    return { text: '', cut: true, requests: hint.maxRequests, usage, costUsd, providerSessionId: sid, exitCode: 0 };
  }

  const out = hint?.schema ? mockAnswer(hint) : null;
  // sequences.invalid_answers: { stepId: n }: the first n answers of that step miss the required fields
  const invalid = out && hint.call <= (hint.sequences?.invalid_answers?.[hint.stepId] || 0);
  let text = invalid
    ? 'Here is my answer. (simulated: it forgets the fields the step requires)\n\n```json\n{ "comment": "Looks good to me." }\n```'
    : out
      ? `Finished step **${hint.stepId}**.\n\n\`\`\`json\n${JSON.stringify(out, null, 2)}\n\`\`\``
      // free-text steps (e.g. ai-arena's proposals and final document) get a small Markdown document
      : `# Simulated document\n\nDone. (simulated response by ${hint?.agent || 'the agent'} for step "${hint?.stepId ?? 'delegated'}")\n\n## Summary\n\n- First point\n- Second point\n`;
  // sequences.no_handoff: { stepId: n }: the first n answers of that step forget the handoff note
  const withNote = hint?.handoff && !(hint.call <= (hint.sequences?.no_handoff?.[hint.stepId] || 0));
  if (withNote) text = `${MOCK_HANDOFF}\n\n${text}`;
  onItem({ kind: 'context', tokens: start + 20000 });
  onItem({ kind: 'text', text });

  const usage = { input: rand(2000, 12000), output: rand(300, 2500), cache_read: rand(0, 8000), cache_write: rand(0, 2000), reasoning: rand(100, 1500) };
  const costUsd = mockCost(hint, +(usage.input * 3e-6 + usage.output * 15e-6).toFixed(4));
  onItem({ kind: 'usage', usage, costUsd });
  return { text, usage, costUsd, providerSessionId: sid, exitCode: 0, ...(attachments.length ? { attachments } : {}) };
}

// ---------------------------------------------------------------------------
// opts.attachments: optional image files for this turn (paths or { path, name }), checked against
// the limits before anything runs (checkAttachments); see "Image attachments" above.
async function runTurn(opts) {
  if (opts.provider.type !== 'mock') refuseReal(`the ${opts.provider.type} provider`);
  // #728: a caller without an onItem (the refactor ranking did) must never crash the turn
  opts = { ...opts, attachments: checkAttachments(opts.attachments), onItem: opts.onItem || (() => {}) };
  const adapter = registry.byType(opts.provider.type);
  if (!adapter) throw new Error(`Unknown provider: ${opts.provider.type}`);
  return adapter.cli ? runCli(opts, adapter.parse) : runMock(opts);
}

// A tool call refused by the agent's allowlist (cli_args) rather than a command that ran and
// failed: Claude Code answers "This command requires approval" / "... you haven't granted it
// yet" in headless mode; the other CLIs report sandbox or policy refusals.
function isPermissionDenial(item) {
  if (item?.kind !== 'tool_result' || !item.is_error) return false;
  return /requires approval|haven't granted|permission[^.\n]{0,80}denied|denied by (?:the )?(?:policy|sandbox|user)|rejected by (?:the )?(?:policy|sandbox|user)|not allowed by/i.test(String(item.output || ''));
}

// A command cut by the tool's own timeout (Claude Code's Bash tool: "Command timed out after 2m 0.0s";
// its default is 120 s when the call passes no `timeout`): the command returned no result (#178).
function isToolTimeout(item) {
  if (item?.kind !== 'tool_result') return false;
  return /\bcommand timed out after\b/i.test(String(item.output || '').slice(-400));
}

// Request errors (invalid model, 4xx) are not worth retrying.
function isRetryable(err) {
  return !/"status":\s*4\d\d|invalid_request|not supported|not found|does not exist/i.test(String(err?.message || err));
}

// #262: a provider out of credits or past its usage limit: retrying on it is pointless, the agent
// moves on to the next entry of its fallback chain. The messages every CLI may print, plus the
// CLI's own (`type`: its adapter's quotaPattern, e.g. Claude Code "5-hour limit reached ∙ resets 3pm").
const QUOTA_COMMON = /usage limit|credit balance is too low|insufficient[_ ](?:quota|credits?)|quota exceeded|exceeded your (?:current )?quota|out of credits/i;
function isQuotaError(type, message) {
  const text = String(message?.message ?? message ?? '');
  return QUOTA_COMMON.test(text) || !!registry.byType(type)?.quotaPattern?.test(text);
}

// #799: the same for a message whose CLI is not known (a finished run's error names no provider)
const isAnyQuotaError = (message) => registry.list().some((a) => isQuotaError(a.type, message));

// #312: when a CLI's usage limit resets (epoch ms), read from its message by its adapter, or null.
// now: epoch ms or a Date, when the message was read (a clock time is its next occurrence)
function quotaResetAt(type, message, now = Date.now()) {
  const text = String(message?.message ?? message ?? '');
  return registry.byType(type)?.quotaReset?.(text, +now) ?? null;
}

// #312: the CLI process's variable that selects an account ({ name, dir }): its config folder
// through the adapter's configDirEnv; {} for no account or a CLI without one. Never agentEnv (printed
// in prompts and allow rules)
function accountEnv(type, account) {
  const name = registry.byType(type)?.configDirEnv;
  return account?.dir && name ? { [name]: account.dir } : {};
}

module.exports = {
  accountEnv,
  ATTACHMENT_LIMITS,
  checkAttachments,
  cliDirs,
  cliInvocation,
  emptyUsage,
  gitConfigEnv,
  homebrewInstalled,
  imageInput,
  isAnyQuotaError,
  isImagePath,
  isPermissionDenial,
  isQuotaError,
  isRetryable,
  isToolTimeout,
  killTree,
  MOCK_CITY_PLAN,
  OWN_GROUP,
  parseClaude,
  parseCodex,
  parseGrok,
  quotaResetAt,
  refreshWindowsPath,
  resolveCommand,
  resolveCommandAsync,
  runTurn,
  seedClaudeTotal,
  sleep,
  sniffImage,
  storeAttachments,
  turnResult,
  withCliPath,
};
