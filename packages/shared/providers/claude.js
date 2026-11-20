// Claude Code adapter (#348): `claude -p --output-format stream-json`, the prompt on stdin. What the
// engine, the service and the screens know about this CLI: names, models, the workflow provider
// definition, the isolation flags per capability set, the stream parser, the usage-limit messages,
// where its local sessions are and how a folder is trusted. The registry (index.js) lists it.
// Browser: window.ProviderClaude (the parser runs in the engine only); Node: module.exports.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const { cacheTier } = node ? require('../session-cache') : {};
  const { contextTokens, emptyUsage } = node ? require('./usage') : {};
  const { nextClockTime } = node ? require('./quota-reset') : {};

  const DEFINITION = {
    type: 'claude-code',
    command: 'claude',
    args: ['-p', '--output-format', 'stream-json', '--verbose', '--model', '{{ model }}'],
    effort_args: ['--effort', '{{ effort }}'],
    resume_args: ['--resume', '{{ session_id }}'],
    skill_args: ['--add-dir', '{{ skill_dir }}'],
  };

  // Claude Code's sub-agent tool: named `Agent` by current versions, `Task` by older ones. --tools
  // keeps only the names it knows, so offering just `Task` could leave a newer CLI with no sub-agents.
  const SUBAGENT_TOOLS = ['Agent', 'Task'];

  // The isolation and capability flags of one turn (capabilities.providerArgs; `lib`: its helpers).
  function isolationArgs({ caps, isolated, mcp, denyEdits, denyCommands, runDir, env }, lib) {
    const args = [];
    if (isolated) {
      // no settings source at all: neither the user's (plugins, hooks, permission rules) nor the
      // checkout's .claude/settings*.json, whose hooks and permissions.allow the repository controls
      // (#468, SEC-3); no MCP servers but the declared ones, no Chrome integration, no skill listing
      // (the engine injects the workflow's skills), no auto-memory
      args.push('--strict-mcp-config', '--no-chrome', '--setting-sources', '', '--disable-slash-commands',
        '--settings', JSON.stringify({ autoMemoryEnabled: false }));
    }
    if (caps && Object.keys(mcp).length) args.push('--mcp-config', JSON.stringify({ mcpServers: mcp }));
    if (!caps) return { args, notes: [] };
    // --tools: the only built-in tools offered (fewer definitions in context);
    // --allowedTools: the ones that run without asking (nobody can answer in headless mode)
    const offered = ['Read', 'Glob', 'Grep'];
    const allowed = ['Read', 'Glob', 'Grep'];
    if (lib.has(caps, 'edit')) { offered.push('Edit', 'NotebookEdit'); allowed.push('Edit', 'NotebookEdit'); }
    if (lib.has(caps, 'write')) { offered.push('Write'); allowed.push('Write'); }
    const bash = lib.claudeBashRules(caps, env);
    if (bash.length) { offered.push('Bash'); allowed.push(...bash); }
    if (caps.web) { offered.push('WebSearch', 'WebFetch'); allowed.push('WebSearch', 'WebFetch'); }
    if (caps.subagents) { offered.push(...SUBAGENT_TOOLS); allowed.push(...SUBAGENT_TOOLS); }
    allowed.push(...Object.keys(mcp).map((n) => `mcp__${n}`));
    args.push('--tools', offered.join(','), '--allowedTools', allowed.join(' '));
    // deny rules win over allow rules; Edit(...) covers every built-in tool that edits files
    const denied = [
      ...(lib.writes(caps) ? denyEdits.map((p) => `Edit(${lib.claudePath(p)})`) : []),
      ...(bash.length ? denyCommands.map((c) => `Bash(${c}:*)`) : []),
    ];
    if (denied.length) args.push('--disallowedTools', denied.join(' '));
    // file edits (and mkdir/redirects) are refused headless without acceptEdits
    if (lib.writes(caps)) args.push('--permission-mode', 'acceptEdits');
    for (const dir of lib.runDirs(caps, runDir)) args.push('--add-dir', dir);
    return { args, notes: [] };
  }

  // #233: on a resumed session (`--resume`), the `result` event's `total_cost_usd` is the whole CLI
  // session's cost so far (its `usage` is the turn's own): the turn costs the difference with the
  // session's previous total, kept here per CLI session id. The engine records the last total in the
  // session's snapshot (cli_total_cost_usd) and seeds it back with seedTotal when a resumed run
  // continues the CLI session after the app restarted.
  const totals = new Map();

  function seedTotal(sessionId, totalUsd) {
    if (sessionId && totalUsd > 0 && !(totals.get(sessionId) >= totalUsd)) totals.set(sessionId, totalUsd);
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

  function parse(ev, emit, acc) {
    switch (ev.type) {
      case 'system':
        if (ev.subtype === 'init') {
          acc.providerSessionId = ev.session_id;
          acc.cliVersion = ev.claude_code_version; // #369: named in the unknown-model warning
          emit({ kind: 'session', sessionId: ev.session_id, model: ev.model });
        }
        break;
      case 'assistant':
        // each model request's context window (the main conversation's, not a sub-agent's)
        if (ev.message?.usage && !ev.parent_tool_use_id) {
          // #320: the cache tier when the usage reports it (cache_creation.ephemeral_1h / _5m)
          emit({ kind: 'context', tokens: contextTokens(ev.message.usage), ...(cacheTier(ev.message.usage) ? { tier: cacheTier(ev.message.usage) } : {}) });
          (acc.mainCalls ??= new Set()).add(ev.message.id);
        }
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
          if (acc.turnTotalBefore == null) acc.turnTotalBefore = (sid && totals.get(sid)) || 0;
          const before = acc.turnTotalBefore;
          const total = Math.max(ev.total_cost_usd, acc.cliTotalCostUsd ?? 0);
          // a total below the previous one is a new count (a forked session): taken whole
          acc.costUsd = total >= before ? +(total - before).toFixed(6) : total;
          if (sid) totals.set(sid, total);
          acc.cliTotalCostUsd = total;
        }
        // #302: --max-turns reached (the agent's max_requests): not an error, the engine wraps the turn up
        if (ev.subtype === 'error_max_turns') acc.cut = { requests: ev.num_turns ?? acc.mainCalls?.size ?? 0 };
        else if (ev.is_error) {
          // #860: the result's own error details (error_during_execution has no result text) say why
          const details = (Array.isArray(ev.errors) ? ev.errors : [])
            .map((e) => (typeof e === 'string' ? e : (e?.message ?? JSON.stringify(e))))
            .filter((e) => e && String(e).trim());
          acc.error = [`Claude returned an error: ${ev.subtype}`, ev.result, details.join('; ')].filter(Boolean).join(' ');
        }
        emit({ kind: 'usage', usage: acc.usage, costUsd: acc.costUsd });
        break;
      }
      default:
        emit({ kind: 'raw', event: ev });
    }
  }

  // #369: a model the installed Claude Code does not know: it still runs it, writes
  // `[claude-code:unrecognized_model] {"model":"claude-haiku-5-5",...}` to stderr and prices the turn
  // at another model's rates. The engine then prices the turn from its tokens (acc.unrecognized).
  const UNRECOGNIZED = /\[claude-code:unrecognized_model\]\s*(\{[^\r\n]*\})?/;
  parse.stderr = (text, acc) => {
    const m = UNRECOGNIZED.exec(text || '');
    if (!m) return;
    let model = null;
    try { model = JSON.parse(m[1] || '{}').model || null; } catch { /* the marker alone */ }
    acc.unrecognized = { model, cliVersion: acc.cliVersion || null };
  };

  // US$ per million tokens of the models whose price the app needs (#369: a turn the CLI priced at
  // another model's rates); settings.prices overrides an entry. cache_write unset: 1.25× input for
  // a 5-minute cache, 2× for an hour (packages/shared/session-cache.js cacheWriteUsd).
  const PRICES = {
    'claude-haiku-5-5': { input: 0.10, output: 0.50, cache_read: 0.01 },
  };

  const claude = {
    id: 'claude',
    type: DEFINITION.type,
    cli: DEFINITION.command,
    label: 'Claude Code',
    short: 'Claude',
    robot: 'claude',
    modelPrefixes: [/^claude-/],
    models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-5-5', 'claude-haiku-4-5'],
    prices: PRICES,
    definition: DEFINITION,
    resumeArgs: (id) => DEFINITION.resume_args.map((a) => a.replace('{{ session_id }}', id)),
    // attached images: read with its Read tool, their folders given with --add-dir
    imageInput: 'read',
    isolationArgs,
    // deny rules (test paths, `npm ci` on the shared cache) are refused by the CLI itself
    enforcesDenyRules: true,
    // --max-turns: the agent's max_requests is enforced per turn (#302)
    requestLimit: true,
    subagentTools: SUBAGENT_TOOLS,
    subagentsNote: `subagents: ${SUBAGENT_TOOLS.join('/')} tool offered`,
    parse,
    seedTotal,
    // #262: "Claude AI usage limit reached|<epoch>", "5-hour limit reached ∙ resets 3pm", "You've hit your limit";
    // #799: "You've hit your weekly limit"
    quotaPattern: /\blimit reached\b|you['’]ve hit your (?:\w+ )?limit/i,
    usageLimitMessage: 'Claude AI usage limit reached|1760227200',
    // #312: when the limit resets (epoch ms), read from its message, or null: "…|<epoch s>", or
    // "resets 3pm" (the next 15:00, local)
    quotaReset: (message, now = Date.now()) => {
      const text = String(message || '');
      const epoch = /limit reached\|(\d{9,})/i.exec(text);
      if (epoch) return +epoch[1] * 1000;
      const clock = /\bresets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(text);
      return clock ? nextClockTime(clock[1], clock[2], clock[3], now) : null;
    },
    // #312: the variable that gives the CLI its config folder (one account per folder)
    configDirEnv: 'CLAUDE_CONFIG_DIR',
    costReported: true,
    installNote: 'then run `claude` once to log in',
    // its conversations: <config>/projects/<project>/<id>.jsonl (packages/engine/domains/cli/cli-sessions.js, packages/engine/domains/local/local-usage.js)
    sessionsDir: 'projects',
    trust: { format: 'claude-json' },
    // the Sessions screen's interactive CLI
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    newArgs: ({ model, effort }) => [...(model ? ['--model', model] : []), ...(effort ? ['--effort', effort] : [])],
    interactiveResumeArgs: (id) => ['--resume', id],
    // the supervisor's read-only chat about a run (Sessions terminal)
    readOnlyChatArgs: ({ model, skillDir, prompt }) => ['--model', model, '--permission-mode', 'plan', '--add-dir', skillDir, prompt],
  };

  if (node) module.exports = claude;
  else root.ProviderClaude = claude;
})(typeof window !== 'undefined' ? window : globalThis);
