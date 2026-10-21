// The agent chats' live turn (#180), shared by the Product Owner's drawer (views/backlog/backlog-po.js),
// the Oracle drawer (views/oracle/oracle.js) and the Supervisor chat (views/supervisor/supervisor.js):
// while the agent answers, an activity line with a spinner says what it does ("Reading src/roadmap.js",
// "Searching the code for dispatchRoadmaps", "Listing open issues (gh)", "Thinking…") with a running
// timer and a Stop button; the last steps stay listed under it, collapsible ("6 steps"); the answer's
// prose shows as it is written (Markdown; the trailing ```json block never shows). States: starting,
// working, writing, stopping, then done, failed or stopped; a turn with no item for STALE_MS says
// "Still working: last step 1 min ago". Fed by the service's chat:progress events (src/chat-progress.js:
// { chat, key, turnId, phase, items, status }). The structured answer (cards) comes from the final
// message as before: the view drops the live turn when the ask returns.
// Pure state (create, apply, view, stepLabel, visibleText, duration) and the markup (html, which uses
// app.js's esc and markdownHtml); a view re-renders it on each event and on its own 1 s ticker.
// Browser: window.LiveTurn; Node: module.exports.
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('../shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  const STALE_MS = 60e3;
  // the steps listed under the activity line (the count says how many there were)
  const SHOWN_STEPS = 5;
  const ACTIVE = ['starting', 'working', 'writing', 'stopping'];

  /** A new turn of `agent` ("Product Owner"), started at `now`. */
  function create({ agent = 'agent', now = Date.now() } = {}) {
    return { agent, turnId: null, startedAt: now, lastAt: now, status: 'starting', steps: [], texts: [], thinking: false, stepsOpen: true };
  }

  const cut = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
  // a path's last segments: what the owner recognises (the whole path is the step's tooltip)
  const shortPath = (p) => String(p || '').split(/[\\/]+/).filter(Boolean).slice(-3).join('/');

  // A shell command as an activity: gh/glab and git read as what they do.
  function commandLabel(command) {
    const c = String(command || '').trim();
    const cli = c.match(/^(gh|glab)\s+(issue|pr|mr|api|repo|run)\b(?:\s+(\w+))?(?:\s+#?(\d+))?/);
    if (cli) {
      const [, tool, what, verb, n] = cli;
      if (what === 'api') return t('live_turn.calling_the_platform_api', { tool });
      if (n) return t(`live_turn.reading_one_${what}`, { n, tool });
      if (verb === 'list') return t(`live_turn.listing_${what}`, { tool });
      return t(`live_turn.reading_${what}`, { tool });
    }
    const git = c.match(/^git\s+(log|diff|show|status|blame|grep)\b/);
    if (git) return t(`live_turn.git_${git[1]}`);
    return t('live_turn.running_command', { command: cut(c, 60) });
  }

  /** What a tool call does, as the activity line says it. */
  function stepLabel({ name = '', input = {} } = {}) {
    const i = input || {};
    const mcp = String(name).match(/^mcp__[^_]+(?:_[^_]+)*?__(.+)$/);
    if (mcp) return t('live_turn.reading_the_app_data', { what: mcp[1].replace(/_/g, ' ') });
    switch (name) {
      case 'Read': return t('live_turn.reading_what', { what: shortPath(i.file_path || i.path) || t('live_turn.a_file') });
      case 'Grep': return i.pattern ? t('live_turn.searching_the_code_for', { pattern: cut(i.pattern, 50) }) : t('live_turn.searching_the_code');
      case 'Glob': return i.pattern ? t('live_turn.listing_files_pattern', { pattern: cut(i.pattern, 50) }) : t('live_turn.listing_files');
      case 'LS': return t('live_turn.listing_what', { what: shortPath(i.path) || t('live_turn.a_folder') });
      case 'Bash': case 'shell': return commandLabel(i.command);
      case 'WebFetch': return t('live_turn.reading_what', { what: cut(i.url, 60) || t('live_turn.a_web_page') });
      case 'WebSearch': return i.query ? t('live_turn.searching_the_web_for', { query: cut(i.query, 50) }) : t('live_turn.searching_the_web');
      case 'Task': case 'Agent': return i.description ? t('live_turn.asking_a_sub_agent_about', { what: cut(i.description, 50) }) : t('live_turn.asking_a_sub_agent');
      case 'TodoWrite': return t('live_turn.updating_its_plan');
      default: return t('live_turn.using_tool', { tool: name || t('live_turn.a_tool') });
    }
  }
  // the tooltip: the whole path, pattern or command
  const stepDetail = ({ input = {} } = {}) => String(input?.file_path || input?.path || input?.command || input?.pattern || input?.url || input?.query || '');

  /** The prose written so far, without the trailing ```json block (never shown while streaming). */
  function visibleText(texts = []) {
    return texts.join('\n\n').replace(/```json[\s\S]*$/, '').trim();
  }

  /**
   * Applies one chat:progress payload to the turn (another turn's payload is ignored) → the turn.
   * phase 'start' adopts its turnId; 'items' adds steps, thinking and text; 'end' sets the status.
   */
  function apply(turn, payload, now = Date.now()) {
    if (!turn || !payload) return turn;
    if (payload.phase === 'start') {
      turn.turnId = payload.turnId || null;
      turn.lastAt = now;
      return turn;
    }
    if (turn.turnId && payload.turnId && payload.turnId !== turn.turnId) return turn;
    if (payload.phase === 'end') {
      turn.status = ['done', 'failed', 'stopped'].includes(payload.status) ? payload.status : 'done';
      return turn;
    }
    for (const it of payload.items || []) {
      turn.lastAt = now;
      if (it.kind === 'tool_call') {
        turn.steps.push({ id: it.id || null, label: stepLabel(it), detail: stepDetail(it), state: 'running' });
        turn.thinking = false;
      } else if (it.kind === 'tool_result') {
        const step = [...turn.steps].reverse().find((s) => (it.id ? s.id === it.id : s.state === 'running'));
        if (step) step.state = it.is_error ? 'error' : 'done';
      } else if (it.kind === 'thinking') {
        turn.thinking = true;
      } else if (it.kind === 'text') {
        turn.texts.push(String(it.text || ''));
        turn.thinking = false;
      }
      if (turn.status !== 'stopping') turn.status = visibleText(turn.texts) ? 'writing' : 'working';
    }
    return turn;
  }

  /** "45 s", "1 min 20 s", "12 min". */
  function duration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return `${s} s`;
    const m = Math.floor(s / 60);
    return m >= 10 || s % 60 === 0 ? `${m} min` : `${m} min ${s % 60} s`;
  }

  /**
   * What the view draws at `now`: { status, active, label, elapsed, stale, steps (the last
   * SHOWN_STEPS), stepCount, text }.
   */
  function view(turn, now = Date.now()) {
    const active = ACTIVE.includes(turn.status);
    const last = turn.steps[turn.steps.length - 1];
    const idle = now - turn.lastAt;
    const stale = active && turn.status !== 'stopping' && idle >= STALE_MS;
    let label;
    if (stale) label = t('live_turn.still_working', { minutes: Math.floor(idle / 60e3) });
    else if (turn.status === 'starting') label = t('live_turn.starting_the_agent', { agent: turn.agent });
    else if (turn.status === 'stopping') label = t('live_turn.stopping');
    else if (turn.status === 'writing') label = t('live_turn.writing_the_answer');
    else if (turn.status === 'working') label = last?.state === 'running' && !turn.thinking ? last.label : t('live_turn.thinking');
    else label = { done: t('live_turn.done'), failed: t('live_turn.failed'), stopped: t('live_turn.stopped') }[turn.status] || '';
    return {
      status: turn.status, active, label, elapsed: duration(now - turn.startedAt), stale,
      steps: turn.steps.slice(-SHOWN_STEPS), stepCount: turn.steps.length, text: visibleText(turn.texts),
    };
  }

  // ---- markup (browser: app.js globals esc and markdownHtml) ------------------------------------
  // outside the app (tests): the same escaping as app.js's esc
  const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  /**
   * The live turn's markup. `stop`: the Stop button (a click on [data-live-stop]); the steps' toggle
   * is [data-live-steps] (onClick handles both).
   */
  function html(turn, { now = Date.now(), stop = true } = {}) {
    const v = view(turn, now);
    /* global esc, markdownHtml */
    const e = typeof esc === 'function' ? esc : escape;
    const md = typeof markdownHtml === 'function' ? markdownHtml : (t) => `<p>${escape(t)}</p>`;
    const n = v.stepCount;
    const steps = n ? `<div class="live-turn-steps">
        <button type="button" class="link-btn small" data-live-steps aria-expanded="${turn.stepsOpen}">${t('live_turn.steps_count', { count: n })}</button>
        ${turn.stepsOpen ? `<ol class="live-turn-list">${v.stepCount > v.steps.length ? '<li class="muted">…</li>' : ''}${v.steps.map((s) => `<li class="live-step ${s.state}" title="${e(s.detail || s.label)}"><span class="live-step-mark" aria-hidden="true"></span><span>${e(s.label)}</span></li>`).join('')}</ol>` : ''}
      </div>` : '';
    return `<div class="live-turn${v.stale ? ' stale' : ''}" data-live-status="${e(v.status)}" role="status" aria-live="polite">
      <div class="live-turn-status">${v.active ? '<span class="spinner" aria-hidden="true"></span>' : ''}<span class="live-turn-label">${e(v.label)}</span>
        <span class="live-turn-time muted small" title="${t('live_turn.time_since_the_question_was_sent')}">${e(v.elapsed)}</span>
        ${stop && v.active ? `<button type="button" class="btn sm ghost" data-live-stop${v.status === 'stopping' ? ' disabled' : ''} title="${t('live_turn.end_this_turn_what_was_written')}">${t('live_turn.stop')}</button>` : ''}</div>
      ${steps}
      ${v.text ? `<div class="live-turn-text md md-compact">${md(v.text)}</div>` : ''}
    </div>`;
  }

  /** A click inside the live turn: Stop (`onStop()`) or the steps' toggle → whether it was handled. */
  function onClick(e, turn, { onStop, render } = {}) {
    if (!turn) return false;
    if (e.target.closest('[data-live-stop]')) {
      if (ACTIVE.includes(turn.status) && turn.status !== 'stopping') {
        turn.status = 'stopping';
        render?.();
        onStop?.();
      }
      return true;
    }
    if (e.target.closest('[data-live-steps]')) {
      turn.stepsOpen = !turn.stepsOpen;
      render?.();
      return true;
    }
    return false;
  }

  const api = { STALE_MS, apply, create, duration, html, onClick, stepLabel, view, visibleText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') root.LiveTurn = api;
}(typeof window !== 'undefined' ? window : globalThis));
