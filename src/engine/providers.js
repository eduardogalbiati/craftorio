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

const quoteCmd = (a) => `"${String(a).replace(/"/g, '""')}"`;

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
    case 'result': {
      const u = ev.usage || {};
      acc.text = ev.result ?? acc.lastText ?? '';
      acc.costUsd = ev.total_cost_usd ?? null;
      acc.usage = {
        input: u.input_tokens || 0,
        output: u.output_tokens || 0,
        cache_read: u.cache_read_input_tokens || 0,
        cache_write: u.cache_creation_input_tokens || 0,
        reasoning: 0, // the Anthropic API counts thinking inside output_tokens
      };
      if (ev.session_id) acc.providerSessionId = ev.session_id;
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

function runCli(opts, parser) {
  const { provider, model, effort, providerSessionId, prompt, cwd, extraArgs, timeoutMs, signal, onItem, render } = opts;
  // `prompt_file_arg`: CLIs that take the prompt from a file (e.g. grok --prompt-file) instead of stdin
  const promptFile = provider.prompt_file_arg ? path.join(os.tmpdir(), `multiagent-prompt-${crypto.randomUUID()}.md`) : null;
  const vars = { model, effort, session_id: providerSessionId, prompt_file: promptFile };
  const args = [
    ...(provider.args || []),
    // `effort_args` (e.g. claude --effort {{ effort }}): only when the agent sets an effort
    ...(effort ? provider.effort_args || [] : []),
    ...(extraArgs || []),
    ...(providerSessionId ? provider.resume_args || [] : []),
    ...(provider.stdin_arg ? [provider.stdin_arg] : []),
    ...(provider.prompt_file_arg || []),
  ].map((a) => render(String(a), vars));

  const resolved = resolveCommand(provider.command);
  if (!resolved) return Promise.reject(new Error(`Command "${provider.command}" not found in PATH.`));
  if (!fs.existsSync(cwd)) return Promise.reject(new Error(`Working directory does not exist: ${cwd}`));
  if (signal?.aborted) return Promise.reject(new Error('Cancelled'));

  onItem({ kind: 'spawn', command: resolved.file, args, cwd });

  const env = { ...process.env };
  delete env.CLAUDECODE; // avoids the "nested session" block if the app is launched from inside Claude Code
  Object.assign(env, gitConfigEnv(env, { 'rerere.enabled': 'true' }));

  if (promptFile) fs.writeFileSync(promptFile, prompt);

  return new Promise((resolve, reject) => {
    const child = resolved.shell
      ? spawn(quoteCmd(resolved.file), args.map(quoteCmd), { cwd, env, shell: true, windowsHide: true })
      : spawn(resolved.file, args, { cwd, env, windowsHide: true });

    const acc = { text: '', lastText: '', usage: null, costUsd: null, providerSessionId, error: null };
    let stderr = '';
    let done = false;

    const finish = (err, val) => {
      if (done) return;
      done = true;
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
      finish(null, {
        text: acc.text || acc.lastText,
        usage: acc.usage || emptyUsage(),
        costUsd: acc.costUsd,
        providerSessionId: acc.providerSessionId,
        exitCode: code,
      });
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
    case 'array':
      if (key === 'preexisting_failures' && !h.sequences?.preexisting_failures) return [];
      return [mockValue(s.items || { type: 'string' }, key, h)];
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

async function runMock({ providerSessionId, model, hint, signal, onItem, attempt = 1, timeoutMs }) {
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
  }
  // sequences.timeouts: { stepId: n }: the first n attempts of each of that step's turns are killed
  // at their timeout after their tool call (the engine retries with the attempt's summary)
  if (hint?.stepId != null && attempt <= (hint?.sequences?.timeouts?.[hint.stepId] || 0)) {
    throw new Error(`Timed out after ${Math.round((timeoutMs || 0) / 1000)}s`);
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
  return { text, usage, costUsd, providerSessionId: sid, exitCode: 0 };
}

// ---------------------------------------------------------------------------
async function runTurn(opts) {
  if (opts.provider.type !== 'mock') refuseReal(`the ${opts.provider.type} provider`);
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

// Request errors (invalid model, 4xx) are not worth retrying.
function isRetryable(err) {
  return !/"status":\s*4\d\d|invalid_request|not supported|not found|does not exist/i.test(String(err?.message || err));
}

module.exports = {
  emptyUsage,
  gitConfigEnv,
  isPermissionDenial,
  isRetryable,
  parseGrok,
  refreshWindowsPath,
  resolveCommand,
  runTurn,
  sleep,
};
