// Run chat: any workflow run as a conversation (RunChatModel in run-chat-model.js), live or
// replayed from its events.jsonl. Agents get their robot (robots.js) by provider and model, fan-out
// steps sit side by side, human gates are answered inline (never automatically). Opened from the
// runs lists ("Open chat"), the Backlog and the Run screen's Chat / Details toggle, and by every
// way of opening a run while Chat is the remembered run view (showRun in app.js). A run always
// opens at its latest message; "Jump to latest" shows while scrolled up.
// Write & Review and AI Arena runs keep their own chat screens (openChatFor routes them).
(() => {
  const $c = (sel) => document.querySelector(sel);
  const { RunChatModel, splitAnswer, providerType } = window.RunChatModel;
  const md = (t) => (typeof markdownHtml === 'function' ? markdownHtml(t) : `<pre>${esc(t)}</pre>`);
  const clock = (ts) => new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
  const fmtSecs = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s` : `${Math.round((ms || 0) / 1000)}s`);
  const DOING = { thinking: 'is thinking', reading: 'is using a tool', writing: 'is writing' };

  let chat = { model: new RunChatModel(), runId: null, live: false, follow: false, loading: false, buffer: [] };

  // ---------------------------------------------------------------- avatars
  const isSupervisor = (agent) => /^_?supervisor$/.test(agent || '');
  // Each agent keeps one colour through the chat (the supervisor has its own).
  function hueOf(agent) {
    let h = 0;
    for (const ch of String(agent)) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return Math.round((h % 1000) * 137.508) % 360; // golden angle: close names get distant hues
  }
  const colorStyle = (agent) => (isSupervisor(agent) ? '' : ` style="--rc-agent:hsl(${hueOf(agent)} 70% 64%)"`);
  const nameOf = (agent) => (isSupervisor(agent) ? 'Supervisor' : chat.model.nameOf(agent));
  // Robots face the centre of the screen (as in Write & Review and AI Arena): one on the left
  // looks right (mirrored), one on the right looks left. The supervisor sits on the left.
  function robot(who, st = 'idle', opts = {}) {
    const mirror = isSupervisor(who.agent) || who.side !== 'right';
    if (isSupervisor(who.agent)) return Robots.svg('supervisor', st, { mirror, ...opts });
    const variant = Robots.variantFor(providerType(who.provider, who.model), who.model || '');
    return Robots.svg(variant, st, { plaque: who.model ? Robots.plaqueFor(who.model) : undefined, mirror, ...opts });
  }
  const avatar = (who) => `<span class="duo-robot still" aria-hidden="true">${robot(who, 'idle', { bubble: false })}</span>`;

  // The hover card of an agent: provider, model and effort as recorded in the run, its session mode and turn.
  const PROVIDERS = { 'claude-code': 'Claude', 'codex-cli': 'Codex', 'grok-cli': 'Grok', 'gemini-cli': 'Gemini' };
  const MODES = { persistent: 'persistent session', ephemeral: 'new session every turn', handoff: 'new session with a handoff note' };
  function cardLines(who) {
    const provider = `${PROVIDERS[providerType(who.provider, who.model)] || who.provider || 'Unknown provider'}${who.provider === 'mock' ? ' (simulated)' : ''}`;
    const first = [provider, who.model ? Robots.plaqueFor(who.model) : '', who.effort ? `effort ${who.effort}` : ''].filter(Boolean).join(' · ');
    const second = [MODES[who.mode] || '', who.turn ? `turn ${who.turn}` : ''].filter(Boolean).join(' · ');
    return [first, second].filter(Boolean);
  }
  function agentAvatar(who) {
    const lines = cardLines(who);
    return `<span class="rc-who" tabindex="0" aria-label="${esc(`${nameOf(who.agent)}: ${lines.join(', ')}`)}">${avatar(who)}</span>
      <span class="rc-card" role="tooltip">${lines.map((l) => `<span>${esc(l)}</span>`).join('')}<span class="mono muted">${esc(who.agent)}</span></span>`;
  }
  const stepTag = (stepId, visit, sub) => `<span class="rc-step" title="Step">${esc(stepId)}${sub ? ` · ${esc(sub)}` : ''}${visit > 1 ? ` · visit ${visit}` : ''}</span>`;

  // ---------------------------------------------------------------- items → HTML
  function turnHtml(it) {
    const { prose, json, decisions } = splitAnswer(it.text);
    let body = prose ? md(prose) : '';
    if (!body && json) body = `<pre class="rc-json">${esc(json)}</pre>`;
    if (!body) body = '<p class="muted small">(no text)</p>';
    const extras = [];
    if (json && prose) extras.push(`<details class="rc-more"><summary>Structured answer</summary><pre class="rc-json">${esc(json)}</pre></details>`);
    if (decisions) extras.push(`<details class="rc-more"><summary>Decision log</summary><pre class="rc-json">${esc(decisions)}</pre></details>`);
    if (it.handoff) extras.push(`<details class="rc-more"><summary>Handoff note</summary><div class="rc-body md">${md(it.handoff)}</div></details>`);
    const tools = it.activity.filter((a) => a.kind === 'tool');
    const thinking = it.activity.filter((a) => a.kind === 'thinking');
    if (it.activity.length) {
      const what = [tools.length ? `${tools.length} tool call${tools.length === 1 ? '' : 's'}` : '', thinking.length ? 'thinking' : ''].filter(Boolean).join(' · ');
      extras.push(`<details class="rc-more rc-activity"><summary>${what}</summary><ol>${it.activity.map((a) => (a.kind === 'tool'
        ? `<li class="${a.error ? 'err' : ''}"><b class="mono">${esc(a.name)}</b> <span class="mono muted">${esc(a.input)}</span></li>`
        : `<li class="think"><i>${esc(a.text)}</i></li>`)).join('')}</ol></details>`);
    }
    // context window: at the first request of the turn → its largest request (a fresh session starts small)
    const ctx = it.context?.peak ? ` · context ${it.fresh ? 'fresh ' : ''}${fmtK(it.context.start)} → ${fmtK(it.context.peak)}` : '';
    const foot = it.durationMs ? `${fmtK(it.tokensIn)} in / ${fmtK(it.tokensOut)} out${ctx} · $${it.cost.toFixed(2)} · ${fmtSecs(it.durationMs)}` : '';
    return `<div class="rc-msg rc-${it.side === 'right' ? 'right' : 'left'}" data-item="${it.id}"${colorStyle(it.agent)}>${agentAvatar(it)}<div class="duo-bubble">
      <div class="duo-meta"><b class="rc-name" title="${esc(it.agent)}">${esc(nameOf(it.agent))}</b>${it.model ? `<span class="tag">${esc(it.model)}</span>` : ''}${stepTag(it.stepId, it.visit, it.sub)}<span class="time">${clock(it.ts)}</span></div>
      <div class="rc-body md">${body}</div>${extras.join('')}${foot ? `<div class="duo-foot">${esc(foot)}</div>` : ''}</div></div>`;
  }

  function gateHtml(it) {
    const off = !chat.live || it.resolved || it.closed ? ' disabled' : '';
    const buttons = it.choices.map((c, i) => {
      const chosen = it.resolved && String(c.id) === it.resolved.choice;
      return `<button type="button" class="btn sm ${!it.resolved && i === 0 ? 'primary' : ''}${chosen ? ' chosen' : ''}" data-approval="${esc(it.approvalId)}" data-choice="${esc(c.id)}"${c.feedback_required ? ' data-needs-text="1"' : ''}${off}>${esc(c.label)}</button>`;
    }).join('');
    // Run locally / Open the worktree (app.js), only while the gate waits in the live run
    const tools = chat.live && !it.resolved && !it.closed && typeof gateToolsHtml === 'function' ? gateToolsHtml(it) : '';
    const field = it.feedback && !it.resolved && !it.closed ? `<label class="duo-ask-label">${esc(it.feedback.label || 'Instructions (optional)')}</label>
      <textarea class="duo-ask-text" rows="2" placeholder="${esc(it.feedback.placeholder || '')}"${off}></textarea>` : '';
    const state = it.resolved ? '' : it.closed ? '<p class="muted small">The run ended before an answer.</p>' : chat.live ? '' : '<p class="muted small">Waiting for an answer.</p>';
    return `<div class="rc-gate" data-item="${it.id}"><div class="duo-ask" data-gate="${esc(it.approvalId)}">
      <div class="duo-meta"><b>Human gate</b>${stepTag(it.stepId)}<span class="time">${clock(it.ts)}</span></div>
      <div class="rc-body md">${md(it.message)}</div>${tools}${field}<div class="row">${buttons}</div>${state}</div></div>`;
  }

  function groupHtml(it) {
    const state = !it.done ? '<span class="pill pill-running">running</span>'
      : it.error ? '<span class="pill pill-failed">failed</span>'
        : it.failed?.length ? `<span class="pill pill-warn">${it.failed.length} failed</span>` : '<span class="pill pill-success">done</span>';
    return `<div class="rc-group" data-item="${it.id}"><div class="rc-group-head">
      <span>Parallel · ${stepTag(it.stepId, it.visit)} · ${it.agents.map((a) => `<b${colorStyle(a)} title="${esc(a)}">${esc(nameOf(a))}</b>`).join(', ')}</span>${state}</div>
      <div class="rc-group-body"></div></div>`;
  }

  const SUP_WHAT = { retry: 'Asked for a new attempt.', fix_output: 'Fixed the answer so the run can continue.', ask_human: 'Needs you: see the gate below.', fail: 'Could not recover this step.' };
  function itemHtml(it) {
    switch (it.kind) {
      case 'start': {
        const issue = it.issues.length ? `${it.issues.length > 1 ? 'Issues' : 'Issue'} ${it.issues.map((i) => `<a href="${esc(i.url)}" target="_blank" rel="noopener">#${esc(i.number)}</a> ${esc(i.title || '')}`).join(' · ')}` : '';
        const inputs = Object.entries(it.inputs).filter(([k, v]) => k !== 'task' && v !== '' && v != null);
        return `<div data-item="${it.id}" class="rc-start"><div class="duo-msg user"><div class="duo-bubble">
          <div class="duo-meta"><b>${esc(it.workflow)}</b>${it.version ? `<span class="tag">v${esc(it.version)}</span>` : ''}${it.mock ? '<span class="badge p-mock">simulated</span>' : ''}<span class="time">${clock(it.ts)}</span></div>
          ${it.task ? `<div class="rc-body md">${md(it.task)}</div>` : '<p class="muted small">No task.</p>'}
          ${inputs.length ? `<details class="rc-more"><summary>Inputs</summary><dl class="rc-inputs">${inputs.map(([k, v]) => `<dt class="mono">${esc(k)}</dt><dd class="mono">${esc(typeof v === 'string' ? v : JSON.stringify(v))}</dd>`).join('')}</dl></details>` : ''}
          </div></div>${it.resumedFrom ? `<div class="duo-note plain"><span>Resumed from ${esc(it.resumedFrom.run_id)} at ${esc(it.resumedFrom.step)}</span></div>` : ''}${issue ? `<div class="duo-note plain"><span>${issue}</span></div>` : ''}</div>`;
      }
      case 'turn': return turnHtml(it);
      case 'group': return groupHtml(it);
      case 'gate': return gateHtml(it);
      case 'system': return `<div class="rc-sys ${it.level}" data-item="${it.id}"><span>${esc(it.text)}</span><time>${clock(it.ts)}</time></div>`;
      case 'fail': return `<div class="rc-sys error" data-item="${it.id}"><span>${esc(it.stepId)} failed: ${esc(it.text.slice(0, 400))}</span><time>${clock(it.ts)}</time></div>`;
      case 'reply': return `<div class="duo-msg user reply" data-item="${it.id}"><div class="duo-bubble">
        <div class="duo-meta"><b>${it.by === 'user' ? 'You' : esc(it.by)}</b>${stepTag(it.stepId)}<span class="time">${clock(it.ts)}</span></div>
        <p><b>${esc(it.label)}</b></p>${it.feedback ? `<p class="duo-msg-text">${esc(it.feedback)}</p>` : ''}</div></div>`;
      case 'supervisor': return `<div class="duo-msg supervisor" data-item="${it.id}">${avatar({ agent: 'supervisor' })}<div class="duo-bubble">
        <div class="duo-meta"><b>Supervisor</b>${stepTag(it.stepId)}<span class="tag">${esc(it.action)}${it.goto ? ` → ${esc(it.goto)}` : ''}${it.causeClass ? ` · ${esc(it.causeClass)}` : ''}</span><span class="time">${clock(it.ts)}</span></div>
        <p class="duo-msg-text">${esc(it.explanation)}</p>${it.instruction ? `<p class="duo-msg-text">${esc(it.instruction)}</p>` : ''}
        ${SUP_WHAT[it.action] ? `<p class="muted small">${SUP_WHAT[it.action]}</p>` : ''}</div></div>`;
      case 'end': {
        const ok = it.status === 'success';
        return `<div class="duo-note ${ok ? 'done' : 'failed'}" data-item="${it.id}"><span><b>${ok ? 'Done' : esc(it.status)}</b>${!ok && it.error ? ` · ${esc(it.error.slice(0, 240))}` : ''} · $${(it.cost || 0).toFixed(2)} · ${fmtSecs(it.durationMs)}</span>
          <button type="button" class="link-btn small" data-resume title="Start a new run from a step of this one, keeping the previous outputs (no supervisor call)">Resume from step…</button></div>`;
      }
      default: return '';
    }
  }

  // ---------------------------------------------------------------- rendering
  // Only what an event added or changed is (re)drawn: open <details> and a half-written
  // gate answer survive new messages.
  function draw(ids) {
    const box = $c('#rc-messages');
    const scroller = $c('#rc-scroll');
    const stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 240;
    for (const id of ids) {
      const it = chat.model.byId.get(id);
      const el = box.querySelector(`[data-item="${id}"]`);
      if (el && it.kind === 'group') {
        el.querySelector('.rc-group-head').outerHTML = new DOMParser().parseFromString(groupHtml(it), 'text/html').querySelector('.rc-group-head').outerHTML;
        continue;
      }
      const html = itemHtml(it);
      if (el) { el.outerHTML = html; continue; }
      const parent = it.parent && box.querySelector(`[data-item="${it.parent}"] .rc-group-body`);
      (parent || box).insertAdjacentHTML('beforeend', html);
    }
    drawTyping();
    drawHead();
    if (stick && chat.live) scroller.scrollTop = scroller.scrollHeight;
    drawJump();
  }

  // "Jump to latest" while scrolled up from the last message.
  const scrolledUp = (s) => s.scrollHeight - s.scrollTop - s.clientHeight >= 240;
  const drawJump = () => $c('#rc-jump').classList.toggle('hidden', !scrolledUp($c('#rc-scroll')));
  function toLatest() {
    const scroller = $c('#rc-scroll');
    scroller.scrollTop = scroller.scrollHeight;
    drawJump();
  }

  // Who is working right now, below the last message (several at once in a fan-out).
  function drawTyping() {
    const el = $c('#rc-typing');
    const active = chat.live ? [...chat.model.active.values()] : [];
    const key = active.map((a) => `${a.agent}:${a.state}`).join('|');
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.innerHTML = active.map((a) => `<div class="duo-typing${a.side === 'right' ? ' rc-right' : ''}"${colorStyle(a.agent)} title="${esc([a.agent, ...(isSupervisor(a.agent) ? [] : cardLines(a))].join('\n'))}"><span class="duo-robot" aria-hidden="true">${robot(a, a.state)}</span>
      <span class="duo-dots"><i></i><i></i><i></i></span><span><b>${esc(nameOf(a.agent))}</b> ${DOING[a.state] || DOING.thinking}… <span class="muted">(${esc(a.stepId)})</span></span></div>`).join('');
  }

  function drawHead() {
    const r = chat.model.run;
    $c('#rc-title').innerHTML = r.id ? `<b>${esc(r.workflow)}</b>${r.mock ? ' <span class="badge p-mock">simulated</span>' : ''} <span class="muted small mono">${esc(r.id)}</span>` : `<span class="muted mono">${esc(chat.runId || '')}</span>`;
    const status = chat.loading ? 'loading' : r.status === 'running' && !chat.live ? 'interrupted' : r.status || 'unknown';
    const waiting = chat.live && chat.model.pendingGates().length;
    const pill = $c('#rc-status');
    pill.className = `pill pill-${waiting ? 'warn' : status}`;
    pill.textContent = waiting ? 'waiting for you' : status;
    $c('#rc-cost').textContent = r.cost ? `$${r.cost.toFixed(2)}` : '';
    $c('#rc-stop').classList.toggle('hidden', !chat.live);
  }

  function reset(runId) {
    chat = { model: new RunChatModel(), runId, live: false, follow: chat.follow, loading: true, buffer: [] };
    $c('#rc-messages').innerHTML = '';
    $c('#rc-typing').innerHTML = '';
    delete $c('#rc-typing').dataset.key;
    $c('#rc-jump').classList.add('hidden');
  }

  const isCurrentRun = (runId) => isRunLive(runId);

  // Opens a run's chat: replays what is on disk, then follows it live when it is the run in
  // progress. `follow`: when the run ends, the next run started in this window takes its place.
  async function openRun(runId, { running = false, follow = false } = {}) {
    chat.follow = follow;
    reset(runId);
    // set before showing the view, so a pending gate of this run is asked inline right away
    chat.live = running || isCurrentRun(runId);
    showView('runchat');
    drawHead();
    let events = [];
    try {
      events = await api.runEvents(runId, { activity: true }); // with tool calls and thinking
    } catch (e) {
      chat.loading = false;
      $c('#rc-messages').innerHTML = `<p class="error">Could not load the run: ${esc(errMsg(e))}</p>`;
      drawHead();
      return;
    }
    if (chat.runId !== runId) return; // another run was opened meanwhile
    const ids = [];
    for (const ev of [...events, ...chat.buffer]) ids.push(...chat.model.apply(ev));
    chat.buffer = [];
    chat.loading = false;
    chat.live = chat.live && chat.model.run.status === 'running';
    draw(ids);
    // live or past, a run opens at its latest message (where the outcome is)
    toLatest();
  }

  function onEvent(ev) {
    if (!chat.runId) return;
    if (ev.type === 'workflow.started' && ev.run_id !== chat.runId && chat.follow && !chat.live && visible()) {
      reset(ev.run_id);
      chat.loading = false;
      chat.live = true;
      draw(chat.model.apply(ev));
      return;
    }
    if (ev.run_id !== chat.runId) return;
    if (chat.loading) { chat.buffer.push(ev); return; }
    if (ev.type === 'workflow.started') chat.live = true;
    const ids = chat.model.apply(ev);
    if (ev.type === 'workflow.finished') {
      chat.live = false;
      ids.push(...[...chat.model.gates.values()].map((g) => g.id)); // gates get disabled
    }
    draw(ids);
  }

  const visible = () => !$c('#view-runchat').classList.contains('hidden');

  // Write & Review and AI Arena runs open in their own chat screens.
  function openChatFor({ runId, workflow, running = false, follow = false }) {
    if (workflow === 'writer-reviewer' && window.openDuoRun) return window.openDuoRun(runId, { running });
    if (workflow === 'ai-arena' && window.openArenaRun) return window.openArenaRun(runId, { running });
    return openRun(runId, { running, follow });
  }
  window.openRunChat = openChatFor;
  // true while this screen shows the live run (its gates are answered here, not in a dialog)
  window.runChatShowsRun = (runId) => chat.live && chat.runId === runId && visible();
  // the run this screen shows (live or replayed), for desktop notifications
  window.runChatShownRunId = () => (visible() ? chat.runId : null);

  function init() {
    if (!$c('#view-runchat')) return;
    $c('#rc-messages').addEventListener('click', (e) => {
      if (e.target.closest('[data-resume]')) { window.openResumeDialog?.(chat.runId); return; }
      if (e.target.closest('[data-gate-tool]')) { if (chat.live) onGateTool(e, chat.runId); return; }
      const b = e.target.closest('button[data-approval]');
      if (!b || !chat.live || b.disabled) return;
      const v = b.dataset.choice;
      const text = b.closest('.duo-ask')?.querySelector('textarea')?.value || '';
      if (b.dataset.needsText && !text.trim()) { showToast('Write your request first', `"${b.textContent}" sends the text to the agent.`); b.closest('.duo-ask')?.querySelector('textarea')?.focus(); return; }
      b.closest('.duo-ask').querySelectorAll('button').forEach((x) => { x.disabled = true; });
      api.resolveApproval(b.dataset.approval, v === 'true' ? true : v === 'false' ? false : v, text, chat.runId);
    });
    $c('#rc-stop').onclick = () => api.stopRun(chat.runId);
    $c('#rc-logs').onclick = () => chat.model.run.runDir && api.openPath(chat.model.run.runDir);
    // Chat / Details: the Run screen for the run in progress, the runs list for a past one. The
    // choice is remembered: the next run opened shows the same view (setRunView in app.js).
    $c('#rc-details').onclick = () => {
      setRunView('details');
      if (state.runs.has(chat.runId)) selectRun(chat.runId);
      else showRunInList(chat.runId);
    };
    $c('#run-mode-chat').onclick = () => {
      if (!state.run) return;
      setRunView('chat');
      openChatFor({ runId: state.run.id, workflow: state.run.workflow, running: state.run.status === 'running', follow: true });
    };
    $c('#rc-scroll').addEventListener('scroll', drawJump, { passive: true });
    $c('#rc-jump').onclick = toLatest;
    // the supervisor's look is customizable in Agents
    document.addEventListener('robots:changed', (e) => {
      if (e.detail?.name !== 'supervisor' || chat.loading || !chat.runId) return;
      $c('#rc-messages').innerHTML = '';
      draw(chat.model.items.map((it) => it.id));
    });
    api.onEvent(onEvent);
  }

  init();
})();
