// Adapters que abrem/retomam sessões de cada provider e normalizam os eventos.
//
// Cada turno = 1 processo headless:
//   claude -p --output-format stream-json ...   (prompt via stdin)
//   codex exec --json ... -                     (prompt via stdin)
// A continuidade da sessão é feita com o session_id devolvido pelo provider.
//
// Itens normalizados emitidos via onItem():
//   { kind: 'spawn' | 'session' | 'thinking' | 'text' | 'tool_call' | 'tool_result' | 'usage' | 'stderr' | 'raw', ... }

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const emptyUsage = () => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 });

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Cancelado'));
    const t = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(t); reject(new Error('Cancelado')); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Resolução de comandos no Windows: `claude` pode ser um .exe (instalador
// nativo) ou um .cmd (npm). .cmd/.bat precisam passar pelo cmd.exe.
// ---------------------------------------------------------------------------
// Programas instalados depois que o terminal/app foi aberto só aparecem no PATH
// do registro. Relemos HKCU/HKLM e acrescentamos as entradas que faltarem.
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

  // 1) <cmd>.exe  2) binário com sufixo de plataforma (ex.: winget instala
  // codex-x86_64-pc-windows-msvc.exe sem alias)  3) shims .cmd/.bat
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
function parseClaude(ev, emit, acc) {
  switch (ev.type) {
    case 'system':
      if (ev.subtype === 'init') {
        acc.providerSessionId = ev.session_id;
        emit({ kind: 'session', sessionId: ev.session_id, model: ev.model });
      }
      break;
    case 'assistant':
      for (const b of ev.message?.content || []) {
        // O Claude Code pode omitir o conteúdo do thinking (só envia a assinatura)
        if (b.type === 'thinking') { if (b.thinking) emit({ kind: 'thinking', text: b.thinking }); }
        else if (b.type === 'redacted_thinking') emit({ kind: 'thinking', text: '(thinking omitido pelo provider)' });
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
        reasoning: 0, // a API da Anthropic conta thinking dentro de output_tokens
      };
      if (ev.session_id) acc.providerSessionId = ev.session_id;
      if (ev.is_error) acc.error = `Claude retornou erro: ${ev.subtype} ${ev.result || ''}`;
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
      // input_tokens da OpenAI já inclui os cacheados; separamos para não contar duas vezes
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
      acc.error = ev.message || 'erro do codex';
      break;
    case 'turn.started':
    case 'item.started':
    case 'item.updated':
      break;
    default:
      emit({ kind: 'raw', event: ev });
  }
}

// ---------------------------------------------------------------------------
// CLI runner
// ---------------------------------------------------------------------------
function runCli(opts, parser) {
  const { provider, model, providerSessionId, prompt, cwd, extraArgs, timeoutMs, signal, onItem, render } = opts;
  const vars = { model, session_id: providerSessionId };
  const args = [
    ...(provider.args || []),
    ...(extraArgs || []),
    ...(providerSessionId ? provider.resume_args || [] : []),
    ...(provider.stdin_arg ? [provider.stdin_arg] : []),
  ].map((a) => render(String(a), vars));

  const resolved = resolveCommand(provider.command);
  if (!resolved) return Promise.reject(new Error(`Comando "${provider.command}" não encontrado no PATH.`));
  if (!fs.existsSync(cwd)) return Promise.reject(new Error(`Diretório de trabalho não existe: ${cwd}`));
  if (signal?.aborted) return Promise.reject(new Error('Cancelado'));

  onItem({ kind: 'spawn', command: resolved.file, args, cwd });

  const env = { ...process.env };
  delete env.CLAUDECODE; // evita o bloqueio de "sessão aninhada" se o app for aberto de dentro do Claude Code

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
      signal?.removeEventListener('abort', onAbort);
      err ? reject(err) : resolve(val);
    };
    const timer = setTimeout(() => { killTree(child); finish(new Error(`Timeout após ${Math.round(timeoutMs / 1000)}s`)); }, timeoutMs);
    const onAbort = () => { killTree(child); finish(new Error('Cancelado')); };
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
      if (acc.error) return finish(new Error(acc.error));
      if (code !== 0 && !acc.text) return finish(new Error(`Processo saiu com código ${code}. ${stderr.slice(-800)}`));
      finish(null, {
        text: acc.text || acc.lastText,
        usage: acc.usage || emptyUsage(),
        costUsd: acc.costUsd,
        providerSessionId: acc.providerSessionId,
        exitCode: code,
      });
    });

    child.stdin.end(prompt);
  });
}

// ---------------------------------------------------------------------------
// Mock: simula um agente para testar o fluxo sem gastar tokens
// ---------------------------------------------------------------------------
const rand = (a, b) => Math.floor(a + Math.random() * (b - a));

function mockString(key) {
  return ({
    branch: 'feat/mock-feature',
    pr_url: 'https://github.com/acme/app/pull/42',
    deploy_url: 'https://staging.acme.dev',
    fix_request: 'O CI falhou em test_login: ajuste o mock de sessão no teste.',
    file: 'src/auth/login.ts',
    summary: 'Implementação simulada da feature com testes.',
  })[key] || `(simulado) ${key}`;
}

function mockValue(s, key, h) {
  if (s.enum) {
    if (key === 'verdict') return h.visit < 2 ? 'changes_requested' : 'approved';
    if (key === 'state') return ['waiting', 'needs_fix', 'waiting', 'ready_to_merge'][Math.min(h.visit - 1, 3)];
    if (key === 'deploy_status') return 'success';
    return s.enum[0];
  }
  switch (s.type) {
    case 'object': {
      const o = {};
      for (const [k, ps] of Object.entries(s.properties || {})) o[k] = mockValue(ps, k, h);
      if ('state' in o && o.state !== 'needs_fix') delete o.fix_request;
      return o;
    }
    case 'array': return [mockValue(s.items || { type: 'string' }, key, h)];
    case 'boolean': return true;
    case 'integer': return 42;
    case 'number': return 1.5;
    default: return mockString(key);
  }
}

async function runMock({ providerSessionId, model, hint, signal, onItem }) {
  const sid = providerSessionId || `mock-${Math.random().toString(36).slice(2, 10)}`;
  const d = (ms) => sleep(ms * (0.6 + Math.random() * 0.8), signal);

  onItem({ kind: 'session', sessionId: sid, model });
  await d(600);
  onItem({ kind: 'thinking', text: `Analisando o step "${hint?.stepId ?? 'delegado'}" (visita ${hint?.visit ?? '-'}).\nVou inspecionar o repositório e planejar os próximos passos.` });
  await d(900);
  onItem({ kind: 'tool_call', id: 't1', name: 'Bash', input: { command: 'git status' } });
  await d(500);
  onItem({ kind: 'tool_result', id: 't1', output: 'On branch feat/mock-feature\nnothing to commit, working tree clean' });
  await d(800);

  const out = hint?.schema ? mockValue(hint.schema, '', hint) : null;
  const text = out
    ? `Concluí o step **${hint.stepId}**.\n\n\`\`\`json\n${JSON.stringify(out, null, 2)}\n\`\`\``
    : 'Feito. (resposta simulada)';
  onItem({ kind: 'text', text });

  const usage = { input: rand(2000, 12000), output: rand(300, 2500), cache_read: rand(0, 8000), cache_write: rand(0, 2000), reasoning: rand(100, 1500) };
  const costUsd = +(usage.input * 3e-6 + usage.output * 15e-6).toFixed(4);
  onItem({ kind: 'usage', usage, costUsd });
  return { text, usage, costUsd, providerSessionId: sid, exitCode: 0 };
}

// ---------------------------------------------------------------------------
async function runTurn(opts) {
  switch (opts.provider.type) {
    case 'mock': return runMock(opts);
    case 'claude-code': return runCli(opts, parseClaude);
    case 'codex-cli': return runCli(opts, parseCodex);
    default: throw new Error(`Provider desconhecido: ${opts.provider.type}`);
  }
}

// Erros de requisição (modelo inválido, 4xx) não adianta repetir.
function isRetryable(err) {
  return !/"status":\s*4\d\d|invalid_request|not supported|não encontrado|não existe/i.test(String(err?.message || err));
}

module.exports = { runTurn, resolveCommand, refreshWindowsPath, isRetryable, sleep, emptyUsage };
