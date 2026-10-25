// Grok Build adapter (#348): `grok --output-format streaming-json --prompt-file <file>`. What the
// engine, the service and the screens know about this CLI (see claude.js for the fields); the
// registry (index.js) lists it. Browser: window.ProviderGrok; Node: module.exports.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const { contextTokens } = node ? require('./usage') : {};

  const DEFINITION = {
    type: 'grok-cli',
    command: 'grok',
    args: ['--output-format', 'streaming-json', '-m', '{{ model }}'],
    effort_args: ['--reasoning-effort', '{{ effort }}'],
    resume_args: ['--resume', '{{ session_id }}'],
    prompt_file_arg: ['--prompt-file', '{{ prompt_file }}'],
  };

  // The isolation and capability flags of one turn (capabilities.providerArgs; `lib`: its helpers).
  function isolationArgs({ caps, isolated, mcp }, lib) {
    const args = [];
    const notes = [];
    if (isolated) notes.push('grok has no flags to skip the user\'s MCP servers, skills or memory: only its tools are restricted');
    if (caps && Object.keys(mcp).length) notes.push('workflow MCP servers are not passed to grok');
    if (!caps) return { args, notes };
    if (lib.readOnly(caps)) args.push('--tools', ['read_file', 'list_dir', 'grep', ...(caps.web ? ['web_search', 'web_fetch'] : [])].join(','));
    else notes.push('only read-only tool sets are enforced for grok (edit/write/bash run with --always-approve)');
    if (!caps.web) args.push('--disable-web-search');
    if (!caps.subagents) args.push('--no-subagents');
    // headless: nobody can answer its approval prompts
    args.push('--always-approve');
    return { args, notes };
  }

  // Thinking and text arrive as token deltas, tools as tool_call / tool_call_update, and a final `end`
  // event carries the session id, usage and cost. Deltas are buffered into one item per block.
  function flush(emit, acc) {
    if (acc.buf?.text) emit({ kind: acc.buf.kind, text: acc.buf.text });
    acc.buf = null;
  }

  function parse(ev, emit, acc) {
    const delta = ev.type === 'thought' ? 'thinking' : ev.type === 'text' ? 'text' : null;
    if (delta) {
      if (acc.buf && acc.buf.kind !== delta) flush(emit, acc);
      acc.buf ??= { kind: delta, text: '' };
      acc.buf.text += ev.data ?? '';
      if (delta === 'text') acc.segment = (acc.segment || '') + (ev.data ?? '');
      return;
    }
    flush(emit, acc);
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
      // yet (no recorded multi-turn Grok session); if it proves cumulative, do as claude.js does.
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
  parse.flush = flush;

  // ~/.grok/models_cache.json  models{}: info.id, name, hidden, reasoning_efforts[].value, reasoning_effort
  const cachedModels = (c) => Object.values(c?.models || {}).map((m) => m.info || {}).filter((i) => i.id && !i.hidden)
    .map((i) => ({ id: i.id, name: i.name || i.id, efforts: (i.reasoning_efforts || []).map((e) => e.value).filter(Boolean), defaultEffort: i.reasoning_effort || null }));

  const grok = {
    id: 'grok',
    type: DEFINITION.type,
    cli: DEFINITION.command,
    label: 'Grok Build',
    short: 'Grok',
    robot: 'grok',
    modelPrefixes: [/^grok-/],
    models: ['grok-4.7'],
    definition: DEFINITION,
    resumeArgs: (id) => DEFINITION.resume_args.map((a) => a.replace('{{ session_id }}', id)),
    // attached images: no confirmed way (the prompt lists the paths)
    imageInput: null,
    isolationArgs,
    parse,
    // #262 (xAI API): "…used all available credits or reached its monthly spending limit"
    // #312: "You've reached your free Grok Build usage limit" (no reset time in either message)
    quotaPattern: /used all available credits|spending limit|free grok build usage limit/i,
    usageLimitMessage: 'Your team has either used all available credits or reached its monthly spending limit. To continue making API requests, please purchase more credits or raise your spending limit.',
    quotaReset: () => null,
    // #312: no known variable for its config folder (always ~/.grok): one account only
    configDirEnv: null,
    costReported: true,
    installNote: 'then `grok login`',
    installHint: 'install Grok Build from x.ai (then `grok login`)',
    // its conversations: <config>/sessions/<cwd>/<id>/summary.json
    sessionsDir: 'sessions',
    modelsCache: { file: 'models_cache.json', models: cachedModels },
    trust: { format: 'toml', file: 'trusted_folders.toml', table: 'folders', entry: () => `trusted = true\ndecided_at = ${Math.floor(Date.now() / 1000)}` },
    // the Sessions screen's interactive CLI
    efforts: ['low', 'medium', 'high', 'xhigh'],
    newArgs: ({ model, effort }) => [...(model ? ['-m', model] : []), ...(effort ? ['--reasoning-effort', effort] : [])],
    interactiveResumeArgs: (id) => ['--resume', id],
    readOnlyChatArgs: ({ model, prompt }) => ['-m', model, '--tools', 'read_file,list_dir,grep', prompt],
  };

  if (node) module.exports = grok;
  else root.ProviderGrok = grok;
})(typeof window !== 'undefined' ? window : globalThis);
