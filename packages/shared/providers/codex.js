// Codex CLI adapter (#348): `codex exec --json ... -`, the prompt on stdin. What the engine, the
// service and the screens know about this CLI (see claude.js for the fields); the registry
// (index.js) lists it. Browser: window.ProviderCodex; Node: module.exports.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const { emptyUsage } = node ? require('./usage') : {};
  const { nextClockTime, nextDay } = node ? require('./quota-reset') : {};

  const DEFINITION = {
    type: 'codex-cli',
    command: 'codex',
    args: ['exec', '--json', '--skip-git-repo-check', '-m', '{{ model }}'],
    effort_args: ['-c', 'model_reasoning_effort={{ effort }}'],
    resume_args: ['resume', '{{ session_id }}'],
    stdin_arg: '-',
  };

  // Codex features that reach outside the repository (desktop apps, browsers, plugins, memory).
  // `codex features list` keeps removed names as "removed", so these stay valid flags.
  const FEATURES_OFF = ['plugins', 'apps', 'browser_use', 'computer_use', 'in_app_browser', 'image_generation', 'memories'];

  // The isolation and capability flags of one turn (capabilities.providerArgs; `lib`: its helpers).
  // #116: writableRoots, the folders a writing turn may write besides its working folder (a linked
  // worktree's git dir and the repository's common git dir, so `git switch -c` and `git commit` work),
  // still in workspace-write; a read-only turn gets none.
  function isolationArgs({ caps, isolated, mcp, writableRoots = [] }, lib) {
    const args = [];
    const notes = [];
    // one -c for every server: the workflow's declared ones replace the user's config.toml table
    if (isolated || Object.keys(mcp).length) args.push('-c', `mcp_servers=${lib.toml(mcp)}`);
    if (isolated) for (const f of FEATURES_OFF) args.push('--disable', f);
    if (!caps) return { args, notes };
    args.push('-s', lib.writes(caps) ? 'workspace-write' : 'read-only');
    if (lib.writes(caps) && writableRoots.length) args.push('-c', `sandbox_workspace_write.writable_roots=${lib.toml(writableRoots)}`);
    if (!caps.web) args.push('-c', 'web_search="disabled"');
    if (lib.bashRules(caps).some((t) => t !== 'bash')) notes.push('command allowlist (bash:<command>) not enforceable: the sandbox limits writes, not which commands run');
    if (lib.writes(caps) && lib.bashRules(caps).length) notes.push('workspace-write sandbox: no network access for commands');
    return { args, notes };
  }

  function parse(ev, emit, acc) {
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

  // ~/.codex/models_cache.json  models[]: slug, display_name, visibility ('list' = shown), priority,
  // supported_reasoning_levels[].effort, default_reasoning_level
  const cachedModels = (c) => (c?.models || []).filter((m) => m.slug && m.visibility !== 'hide')
    .sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99))
    .map((m) => ({ id: m.slug, name: m.display_name || m.slug, efforts: (m.supported_reasoning_levels || []).map((l) => l.effort).filter(Boolean), defaultEffort: m.default_reasoning_level || null }));

  const codex = {
    id: 'codex',
    type: DEFINITION.type,
    cli: DEFINITION.command,
    label: 'Codex CLI',
    short: 'Codex',
    robot: 'gpt',
    modelPrefixes: [/^gpt-/, /^o\d/, /^codex/],
    models: ['gpt-6-luna'],
    definition: DEFINITION,
    resumeArgs: (id) => DEFINITION.resume_args.map((a) => a.replace('{{ session_id }}', id)),
    // attached images: no confirmed way yet (the prompt lists the paths). `codex exec --image=<file>`
    // ('flag') is meant for it, once a real call confirms it
    imageInput: null,
    isolationArgs,
    featuresOff: FEATURES_OFF,
    subagentsNote: 'subagents: not offered by Codex',
    parse,
    // #262: "You've hit your usage limit. Upgrade to Plus…", "Quota exceeded", insufficient_quota
    quotaPattern: /usage_limit_reached|rate_limit_exceeded.*quota/i,
    usageLimitMessage: "You've hit your usage limit. Upgrade to Plus to continue using Codex (https://openai.com/chatgpt/pricing), or try again later.",
    // #312: when the limit resets (epoch ms, local time), or null: "try again at Oct 26th." (that
    // day, this year or the next; its end when that day is today), "try again at 3:15 PM." (the next 15:15)
    quotaReset: (message, now = Date.now()) => {
      const text = String(message || '');
      const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
      const day = /try again at\s+([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/i.exec(text);
      const month = day ? MONTHS.indexOf(day[1].toLowerCase()) : -1;
      if (month >= 0) return nextDay(month, day[2], now);
      const clock = /try again at\s+(\d{1,2}):(\d{2})\s*(am|pm)?\b/i.exec(text);
      return clock ? nextClockTime(clock[1], clock[2], clock[3], now) : null;
    },
    // #312: the variable that gives the CLI its config folder (one account per folder)
    configDirEnv: 'CODEX_HOME',
    costReported: false,
    installNote: 'then `codex login`',
    // its conversations: <config>/sessions/YYYY/MM/DD/rollout-*.jsonl
    sessionsDir: 'sessions',
    modelsCache: { file: 'models_cache.json', models: cachedModels },
    trust: { format: 'toml', file: 'config.toml', table: 'projects', entry: () => 'trust_level = "trusted"' },
    // the Sessions screen's interactive CLI. --no-daemon: the terminal owns its Codex process. Through
    // the shared background server the conversation would outlive the terminal (and the server can
    // refuse a WinGet install: "the CLI package does not match this platform or executable").
    efforts: ['low', 'medium', 'high', 'xhigh'],
    newArgs: ({ model, effort }) => ['--no-daemon', ...(model ? ['-m', model] : []), ...(effort ? ['-c', `model_reasoning_effort=${effort}`] : [])],
    interactiveResumeArgs: (id) => ['resume', '--no-daemon', id],
    readOnlyChatArgs: ({ model, prompt }) => ['-m', model, '-s', 'read-only', prompt],
  };

  if (node) module.exports = codex;
  else root.ProviderCodex = codex;
})(typeof window !== 'undefined' ? window : globalThis);
