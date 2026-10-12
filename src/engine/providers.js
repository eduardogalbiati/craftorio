// Adapters that open/resume sessions for each provider and normalize the events.
//
// Each turn = 1 headless process:
//   claude -p --output-format stream-json ...   (prompt via stdin)
//   codex exec --json ... -                     (prompt via stdin)
// Session continuity uses the session_id returned by the provider.
//
// Normalized items emitted via onItem():
//   { kind: 'spawn' | 'session' | 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'usage' | 'stderr' | 'raw', ... }

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const path = require('path');
const readline = require('readline');
const { refuseReal } = require('./simulation');
const { AGENT_ENV } = require('./capabilities');
const { runShim } = require('../shell');

const emptyUsage = () => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 });

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelled'));
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error('Cancelled')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Command resolution on Windows: `claude` can be an .exe (native
// installer) or a .cmd (npm). .cmd/.bat must go through cmd.exe.
// ---------------------------------------------------------------------------
// Programs installed after the terminal/app was opened only show up in the
// registry PATH. We re-read HKCU/HKLM and append the missing entries.
let pathRefreshed = false;
function refreshWindowsPath() {
  if (process.platform !== 'win32' || pathRefreshed) return;
  pathRefreshed = true;
  const read = (key) => {
    try {
      const out = execSync(`reg query "${key}" /v Path`, { encoding: 'utf8', windowsHide: true });
      const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(out);
      return m ? m[1].trim() : '';
    } catch { return ''; }
  };
  const expand = (s) => s.replace(/%([^%]+)%/g, (_, v) => process.env[v] ?? `%${v}%`);
  const current = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const seen = new Set(current.map((p) => p.toLowerCase().replace(/\\+$/, '')));
  const extra = [read('HKCU\\Environment'), read('HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment')]
    .join(';').split(';').map((p) => expand(p.trim())).filter(Boolean)
    .filter((p) => { const k = p.toLowerCase().replace(/\\+$/, ''); if (seen.has(k)) return false; seen.add(k); return true; });
  if (extra.length) process.env.PATH = [...current, ...extra].join(path.delimiter);
}

function resolveCommand(cmd) {
  if (process.platform !== 'win32') return { file: cmd, shell: false };
  if (path.isAbsolute(cmd) && fs.existsSync(cmd)) return { file: cmd, shell: /\.(cmd|bat)$/i.test(cmd) };

  refreshWindowsPath();
  const home = process.env.USERPROFILE || '';
  const dirs = [
    ...(process.env.PATH || '').split(path.delimiter),
    path.join(home, '.local', 'bin'),
    path.join(process.env.APPDATA || '', 'npm'),
  ].filter(Boolean);

  // 1) <cmd>.exe  2) binary with a platform suffix (e.g. winget installs
  // codex-x86_64-pc-windows-msvc.exe without an alias)  3) .cmd/.bat shims
  const exact = (ext) => (dir) => { const p = path.join(dir, cmd + ext); return fs.existsSync(p) ? p : null; };
  const suffixed = (dir) => {
    try {
      const f = fs.readdirSync(dir).find((n) => n.toLowerCase().startsWith(`${cmd}-`) && /-windows-[a-z]+\.exe$/i.test(n));
      return f ? path.join(dir, f) : null;
    } catch { return null; }
  };
  for (const [finder, shell] of [[exact('.exe'), false], [suffixed, false], [exact('.cmd'), true], [exact('.bat'), true]]) {
    for (const dir of dirs) {
      const p = finder(dir);
      if (p) return { file: p, shell };
    }
  }
  return null;
}

function killTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    child.kill('SIGTERM');
  }
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------
// Tokens in one request's context window (Anthropic-style usage: new + cached input).
const contextTokens = (u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);

// #233: on a resumed session (`--resume`), the `result` event's `total_cost_usd` is the whole CLI
// session's cost so far (its `usage` is the turn's own): the turn costs the difference with the
// session's previous total, kept here per CLI session id. The engine records the last total in the
// session's snapshot (cli_total_cost_usd) and seeds it back with seedClaudeTotal when a resumed run
// continues the CLI session after the app restarted.
const claudeTotals = new Map();

function seedClaudeTotal(sessionId, totalUsd) {
  if (sessionId && totalUsd > 0 && !(claudeTotals.get(sessionId) >= totalUsd)) claudeTotals.set(sessionId, totalUsd);
}

// The tokens of a turn's distinct model calls (Claude Code repeats a message's usage on each of its
// content blocks): what a turn killed before its `result` still paid for, priced by the engine.
// #308: the sum is also the turn's recorded usage (the `result`'s usage is the main conversation's
// only); a sub-agent's calls (parent_tool_use_id) are summed apart too, as the turn's `subagents`.
// A message repeated with larger figures (its output growing over its blocks) adds the difference.
// The turn's usage is never below the `result`'s figures field by field (a stream that lost
// messages falls back to them): fieldMax.
const fieldMax = (a, b) => Object.fromEntries(Object.keys(a).map((k) => [k, Math.max(a[k] || 0, b[k] || 0)]));
const callFields = (u) => ({ input: u.input_tokens || 0, output: u.output_tokens || 0, cache_read: u.cache_read_input_tokens || 0, cache_write: u.cache_creation_input_tokens || 0 });

function addStreamUsage(acc, id, u, subagent = false) {
  acc.seenCalls ??= new Map();
  const now = callFields(u);
  const before = id ? acc.seenCalls.get(id) : null;
  if (id) acc.seenCalls.set(id, before ? fieldMax(before, now) : now);
  if (!before) acc.modelCalls = (acc.modelCalls || 0) + 1;
  acc.streamUsage ??= emptyUsage();
  if (subagent) {
    acc.subagents ??= { calls: 0, usage: emptyUsage() };
    if (!before) acc.subagents.calls += 1;
  }
  for (const k of Object.keys(now)) {
    const add = Math.max(0, now[k] - (before?.[k] || 0));
    acc.streamUsage[k] += add;
    if (subagent) acc.subagents.usage[k] += add;
  }
}

function parseClaude(ev, emit, acc) {
  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init') {
        acc.providerSessionId = ev.session_id;
        emit({ kind: 'session', sessionId: ev.session_id, model: ev.model });
      }
      break;
    case 'assistant':
      // each model request's context window (the main conversation's, not a sub-agent's)
      if (ev.message?.usage && !ev.parent_tool_use_id) emit({ kind: 'context', tokens: contextTokens(ev.message.usage) });
      // a sub-agent's model calls are paid too
      if (ev.message?.usage) addStreamUsage(acc, ev.message.id, ev.message.usage, !!ev.parent_tool_use_id);
      for (const b of ev.message?.content || []) {
        // Claude Code may omit the thinking content (it only sends the signature)
        if (b.type === 'thinking') { if (b.thinking) emit({ kind: 'thinking', text: b.thinking }); }
        else if (b.type === 'redacted_thinking') emit({ kind: 'thinking', text: '(thinking omitted by the provider)' });
        else if (b.type === 'text') { acc.lastText = b.text; emit({ kind: 'text', text: b.text }); }
        else if (b.type === 'tool_use') emit({ kind: 'tool_call', id: b.id, name: b.name, input: b.input });
      }
      break;
    case 'user':
      for (const b of ev.message?.content || []) {
        if (b.type === 'tool_result') {
          const out = Array.isArray(b.content) ? b.content.map((c) => c.text || '').join('\n') : String(b.content ?? '');
          emit({ kind: 'tool_result', id: b.tool_use_id, output: out.slice(0, 4000), is_error: !!b.is_error });
        }
      }
      break;
    // #277: a turn that used sub-agents ends with 2 to 4 `result` events one ms apart, all carrying
    // the same (or a growing) session total_cost_usd. The turn costs the highest total seen in the
    // turn minus the session's total before the turn, so a later event never lowers it. Their usages
    // overlap (the total does not grow with the later, smaller ones: their tokens were already paid),
    // so the turn's tokens are the largest of each field, not a sum. The raw `result` events of such
    // a turn are kept in the run as `raw` stream items, to check this rule against a real stream.
    // #308: that rule gives the main conversation's figures (usage_main); the turn's usage is the
    // stream's sum of every model call, sub-agents included, floored by them.
    case 'result': {
      const u = ev.usage || {};
      acc.text = ev.result ?? acc.lastText ?? '';
      const usage = {
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cache_read: u.cache_read_input_tokens || 0,
        cache_write: u.cache_creation_input_tokens || 0,
        reasoning: 0, // the Anthropic API counts thinking inside output_tokens
      };
      acc.results = (acc.results || 0) + 1;
      const first = acc.results === 1;
      acc.usageMain = first || !acc.usageMain ? usage : fieldMax(usage, acc.usageMain);
      acc.usage = acc.streamUsage ? fieldMax(acc.usageMain, acc.streamUsage) : { ...acc.usageMain };
      if (ev.session_id) acc.providerSessionId = ev.session_id;
      if (first) acc.firstResult = ev;
      else {
        if (acc.results === 2) emit({ kind: 'raw', event: acc.firstResult });
        emit({ kind: 'raw', event: ev });
      }
      if (first) acc.costUsd = null;
      if (ev.total_cost_usd != null) {
        const sid = acc.providerSessionId;
        if (acc.turnTotalBefore == null) acc.turnTotalBefore = (sid && claudeTotals.get(sid)) || 0;
        const before = acc.turnTotalBefore;
        const total = Math.max(ev.total_cost_usd, acc.cliTotalCostUsd ?? 0);
        // a total below the previous one is a new count (a forked session): taken whole
        acc.costUsd = total >= before ? +(total - before).toFixed(6) : total;
        if (sid) claudeTotals.set(sid, total);
        acc.cliTotalCostUsd = total;
      }
      if (ev.is_error) acc.error = `Claude returned an error: ${ev.subtype} ${ev.result || ''}`;
      emit({ kind: 'usage', usage: acc.usage, costUsd: acc.costUsd });
      break;
    }
    default:
      emit({ kind: 'raw', event: ev });
  }
}

function parseCodex(ev, emit, acc) {
  switch (ev.type) {
    case 'thread.started':
      acc.providerSessionId = ev.thread_id;
      emit({ kind: 'session', sessionId: ev.thread_id });
      break;
    case 'item.completed': {
      const it = ev.item || {};
      switch (it.type) {
        case 'reasoning': if (it.text) emit({ kind: 'thinking', text: it.text }); break;
        case 'agent_message': acc.text = it.text; emit({ kind: 'text', text: it.text }); break;
        case 'command_execution':
          emit({ kind: 'tool_call', id: it.id, name: 'shell', input: { command: it.command } });
          emit({ kind: 'tool_result', id: it.id, output: String(it.aggregated_output ?? '').slice(0, 4000), is_error: it.exit_code ? true : false });
          break;
        case 'file_change': emit({ kind: 'tool_call', id: it.id, name: 'file_change', input: it.changes }); break;
        case 'mcp_tool_call': emit({ kind: 'tool_call', id: it.id, name: `${it.server}.${it.tool}`, input: it.arguments }); break;
        case 'web_search': emit({ kind: 'tool_call', id: it.id, name: 'web_search', input: { query: it.query } }); break;
        case 'error': emit({ kind: 'stderr', text: it.message }); break;
        default: emit({ kind: 'raw', event: ev });
      }
      break;
    }
    // #233: per turn (summed here over the turn's `turn.completed` events); Codex reports no cost,
    // the engine prices its tokens. Not streamed per model call: a killed Codex turn leaves nothing.
    case 'turn.completed': {
      const u = ev.usage || {};
      acc.usage = acc.usage || emptyUsage();
      // OpenAI's input_tokens already includes cached ones; split them to avoid double counting
      acc.usage.input += (u.input_tokens || 0) - (u.cached_input_tokens || 0);
      acc.usage.cache_read += u.cached_input_tokens || 0;
      acc.usage.output += u.output_tokens || 0;
      acc.usage.reasoning += u.reasoning_output_tokens || 0;
      emit({ kind: 'usage', usage: acc.usage, costUsd: null });
      break;
    }
    case 'turn.failed':
      acc.error = ev.error?.message || 'turn.failed';
      break;
    case 'error':
      acc.error = ev.message || 'codex error';
      break;
    case 'turn.started':
    case 'item.started':
    case 'item.updated':
      break;
    default:
      emit({ kind: 'raw', event: ev });
  }
}

// Grok Build (`grok --output-format streaming-json`): thinking and text arrive as
// token deltas, tools as tool_call / tool_call_update, and a final `end` event carries
// the session id, usage and cost. Deltas are buffered into one item per block.
function flushGrok(emit, acc) {
  if (acc.buf?.text) emit({ kind: acc.buf.kind, text: acc.buf.text });
  acc.buf = null;
}

function parseGrok(ev, emit, acc) {
  const delta = ev.type === 'thought' ? 'thinking' : ev.type === 'text' ? 'text' : null;
  if (delta) {
    if (acc.buf && acc.buf.kind !== delta) flushGrok(emit, acc);
    acc.buf ??= { kind: delta, text: '' };
    acc.buf.text += ev.data ?? '';
    if (delta === 'text') acc.segment = (acc.segment || '') + (ev.data ?? '');
    return;
  }
  flushGrok(emit, acc);
  switch (ev.type) {
    case 'tool_call':
      acc.segment = ''; // the final answer is the text after the last tool call
      emit({ kind: 'tool_call', id: ev.toolCallId, name: ev.toolName || ev.title, input: ev.rawInput });
      break;
    case 'tool_call_update':
      if (ev.status === 'completed' || ev.status === 'failed') {
        const out = typeof ev.rawOutput === 'string' ? ev.rawOutput : JSON.stringify(ev.rawOutput ?? ev.content ?? '');
        emit({ kind: 'tool_result', id: ev.toolCallId, output: String(out).slice(0, 4000), is_error: ev.status === 'failed' });
      }
      break;
    // #233: `total_cost_usd` taken as the turn's own: not checked against a resumed real session
    // yet (no recorded multi-turn Grok session); if it proves cumulative, do as parseClaude does.
    case 'end': {
      const u = ev.usage || {};
      acc.text = acc.segment ?? acc.lastText ?? '';
      acc.costUsd = ev.total_cost_usd ?? null;
      acc.usage = {
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cache_read: u.cache_read_input_tokens || 0,
        cache_write: u.cache_creation_input_tokens || 0,
        reasoning: u.reasoning_tokens || 0, // already included in output
      };
      if (ev.sessionId) {
        acc.providerSessionId = ev.sessionId;
        emit({ kind: 'session', sessionId: ev.sessionId });
      }
      emit({ kind: 'usage', usage: acc.usage, costUsd: acc.costUsd });
      break;
    }
    case 'error':
      acc.error = `Grok returned an error: ${ev.message || 'unknown'}`;
      break;
    case 'usage': {           // per-call usage (the context of that request); the totals come in `end`
      const tokens = contextTokens(ev.usage || ev);
      if (tokens) emit({ kind: 'context', tokens });
      break;
    }
    case 'available_commands':
      break;
    default:
      emit({ kind: 'raw', event: ev });
  }
}
parseGrok.flush = flushGrok;

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
    providerSessionId: acc.providerSessionId,
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
// them before anything is spawned. How each CLI opens them (IMAGE_INPUT):
//   read: Claude Code reads them with its Read tool: their folders go with --add-dir, Read is offered
//   flag: attached to the message with --image=<file> (the `=` form: --image takes several values,
//         a separate one would swallow `resume` or the `-` stdin argument). Meant for Codex CLI, off
//         until a real `codex exec --image` call confirms it: then add 'codex-cli': 'flag' below
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
const IMAGE_INPUT = { 'claude-code': 'read', mock: 'record' };

// How a provider type opens attached images: 'read', 'flag', 'record' (mock) or null (it cannot).
const imageInput = (type) => IMAGE_INPUT[type] || null;

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
  const promptFile = provider.prompt_file_arg ? path.join(os.tmpdir(), `multiagent-prompt-${crypto.randomUUID()}.md`) : null;
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
  const { provider, providerSessionId, cwd, timeoutMs, signal, onItem, agentEnv } = opts;
  const { args, prompt, promptFile } = cliInvocation(opts);

  const resolved = resolveCommand(provider.command);
  if (!resolved) return Promise.reject(new Error(`Command "${provider.command}" not found in PATH.`));
  if (!fs.existsSync(cwd)) return Promise.reject(new Error(`Working directory does not exist: ${cwd}`));
  if (signal?.aborted) return Promise.reject(new Error('Cancelled'));

  onItem({ kind: 'spawn', command: resolved.file, args, cwd });

  const env = { ...process.env };
  delete env.CLAUDECODE; // avoids the "nested session" block if the app is launched from inside Claude Code
  Object.assign(env, gitConfigEnv(env, { 'rerere.enabled': 'true' }));
  // agents' own checks never start real runs, and need no `VAR=value` prefix (refused by allowlists);
  // agentEnv (capabilities.agentEnv): with the run's scratch workspace when it has one (#120)
  Object.assign(env, agentEnv || AGENT_ENV);

  if (promptFile) fs.writeFileSync(promptFile, prompt);

  return new Promise((resolve, reject) => {
    const child = runShim(resolved.file, args, { cwd, env, windowsHide: true });
    // the CLI's process (the memory guard watches its tree, #276); shim: a .cmd/.bat wrapper whose
    // child is the CLI itself
    if (child.pid) opts.onSpawn?.({ pid: child.pid, shim: !!resolved.shell });

    const acc = { text: '', lastText: '', usage: null, costUsd: null, providerSessionId, error: null };
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
      if (acc.error) return finish(new Error(acc.error));
      if (code !== 0 && !acc.text) return finish(new Error(`Process exited with code ${code}. ${stderr.slice(-800)}`));
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
      const o = {};
      for (const [k, ps] of Object.entries(s.properties || {})) o[k] = mockValue(ps, k, h);
      if ('state' in o && o.state !== 'needs_fix') delete o.fix_request;
      if ('state' in o && o.state !== 'needs_human') delete o.question;
      return o;
    }
    // sequences.preexisting_failures: true: the test writer reports a test that also fails on the base
    // sequences.left_out: [1, 0]: the developer declares one gap on its 1st visit, none after (default none)
    // sequences.left_out_not_mine: true: the developer also declares the issue's Tests and Measure tasks (#173)
    // sequences.ui_findings: true: the ui_reviewer (code_review, #151) returns a (blocking) UI finding
    case 'array': {
      if (key === 'preexisting_failures' && !h.sequences?.preexisting_failures) return [];
      if (key === 'ui_findings' && !h.sequences?.ui_findings) return [];
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

// Simulated context window: grows with each turn of the same conversation (30k more per turn),
// so max_context and handoff sessions can be exercised deterministically.
const mockTurns = new Map();
const MOCK_HANDOFF = '```handoff\n- Goal: simulated goal of this agent\n- State: branch feat/mock-feature, commit abc1234\n- Done: simulated work of this turn\n- Left: nothing blocking\n- Decisions: none\n- Key files: src/auth/login.ts\n- Known problems: none\n```';

async function runMock({ providerSessionId, model, hint, signal, onItem, attempt = 1, timeoutMs, attachments = [] }) {
  const sid = providerSessionId || `mock-${Math.random().toString(36).slice(2, 10)}`;
  const scale = +(process.env.MULTIAGENT_MOCK_DELAY_SCALE ?? 1);
  const d = (ms) => sleep(ms * scale * (0.6 + Math.random() * 0.8), signal);
  const n = (mockTurns.get(sid) || 0) + 1;
  mockTurns.set(sid, n);
  const start = 20000 + 30000 * (n - 1);

  onItem({ kind: 'session', sessionId: sid, model });
  onItem({ kind: 'context', tokens: start });
  // the follow-up that asks only for the handoff note
  if (hint?.handoffOnly) {
    await d(300);
    onItem({ kind: 'text', text: MOCK_HANDOFF });
    const usage = { input: 200, output: 150, cache_read: start, cache_write: 0, reasoning: 0 };
    onItem({ kind: 'usage', usage, costUsd: 0.001 });
    return { text: MOCK_HANDOFF, usage, costUsd: 0.001, providerSessionId: sid, exitCode: 0 };
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
    throw Object.assign(new Error(`Timed out after ${Math.round((timeoutMs || 0) / 1000)}s`), { partial: { usage, costUsd: null, modelCalls: 2 } });
  }
  await d(800);

  const out = hint?.schema ? mockValue(hint.schema, '', hint) : null;
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
  const costUsd = +(usage.input * 3e-6 + usage.output * 15e-6).toFixed(4);
  onItem({ kind: 'usage', usage, costUsd });
  return { text, usage, costUsd, providerSessionId: sid, exitCode: 0, ...(attachments.length ? { attachments } : {}) };
}

// ---------------------------------------------------------------------------
// opts.attachments: optional image files for this turn (paths or { path, name }), checked against
// the limits before anything runs (checkAttachments); see "Image attachments" above.
async function runTurn(opts) {
  if (opts.provider.type !== 'mock') refuseReal(`the ${opts.provider.type} provider`);
  opts = { ...opts, attachments: checkAttachments(opts.attachments) };
  switch (opts.provider.type) {
    case 'mock': return runMock(opts);
    case 'claude-code': return runCli(opts, parseClaude);
    case 'codex-cli': return runCli(opts, parseCodex);
    case 'grok-cli': return runCli(opts, parseGrok);
    default: throw new Error(`Unknown provider: ${opts.provider.type}`);
  }
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

module.exports = {
  ATTACHMENT_LIMITS,
  checkAttachments,
  cliInvocation,
  emptyUsage,
  gitConfigEnv,
  imageInput,
  isImagePath,
  isPermissionDenial,
  isRetryable,
  isToolTimeout,
  killTree,
  parseClaude,
  parseCodex,
  parseGrok,
  refreshWindowsPath,
  resolveCommand,
  runTurn,
  seedClaudeTotal,
  sleep,
  sniffImage,
  storeAttachments,
  turnResult,
};
