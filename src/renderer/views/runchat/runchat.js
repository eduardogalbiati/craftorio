// Run chat: any workflow run as a conversation (RunChatModel in run-chat-model.js), live or
// replayed from its events.jsonl. Agents get their robot (robots.js) by provider and model, fan-out
// steps sit side by side, human gates are answered inline (never automatically). Opened from the
// runs lists ("Open chat"), the Backlog and the Run screen's Chat tab, and by every way of opening a
// run while Chat is the remembered run view (showRun in app.js). Its header is the same tab row as
// the Run screen's (#410: Chat | Details | 3D first, in the same place), then the title, status,
// cost, Run folder and Stop. A run always
// opens at its latest message; "Jump to latest" shows while scrolled up.
// Write & Review and AI Arena runs keep their own chat screens (openChatFor routes them).
// Registers itself with registerView; its mount also wires the Run screen's Chat button.
// load: after views/runchat/run-chat-model.js views/run/run.js (RunChatModel as it loads, #run-mode-chat in its mount)
(() => {
  const $c = (sel) => document.querySelector(sel);
  const { RunChatModel, splitAnswer, providerType } = window.RunChatModel;
  const md = (t) => (typeof markdownHtml === 'function' ? markdownHtml(t) : `<pre>${esc(t)}</pre>`);
  const clock = (ts) => new Date(ts || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: TimeZone.current() });
  const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
  const fmtSecs = (ms) => (ms >= 60000 ? `${Math.floor(ms / 60000)}m ${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s` : `${Math.round((ms || 0) / 1000)}s`);
  const DOING = { thinking: 'is thinking', reading: 'is using a tool', writing: 'is writing' };

  let chat = { model: new RunChatModel(), runId: null, live: false, follow: false, loading: false, buffer: [] };

  // ---------------------------------------------------------------- avatars
  const isSupervisor = (agent) => /^_?supervisor$/.test(agent || '');
  // Each agent keeps one colour through the chat (the supervisor has its own): its role's fixed
  // colour, or the workflow's `color` (#224, agent-colors.js); the name hash only for other agents.
  const agentDef = (agent) => AgentColors.defIn(state.workflows, chat.model.run?.workflow, agent);
  const agentColor = (agent) => AgentColors.colorFor(agent, agentDef(agent));
  const colorStyle = (agent) => (isSupervisor(agent) ? '' : ` style="--rc-agent:${agentColor(agent)}"`);
  // the colour its robot is painted in (#227), as #RRGGBB
  const paintOf = (agent) => AgentColors.hexFor(agent, agentDef(agent));
  const nameOf = (agent) => (isSupervisor(agent) ? 'Supervisor' : chat.model.nameOf(agent));
  // Robots face the centre of the screen (as in Write & Review and AI Arena): one on the left
  // looks right (mirrored), one on the right looks left. The supervisor sits on the left.
  function robot(who, st = 'idle', opts = {}) {
    const mirror = isSupervisor(who.agent) || who.side !== 'right';
    if (isSupervisor(who.agent)) return Robots.svg('supervisor', st, { mirror, ...opts });
    // a look saved for this workflow's agent in Agents, else the provider's robot painted in the
    // agent's colour (#227): the emblem and the plaque keep the provider
    const saved = window.AgentLooks?.forWorkflow(chat.model.run?.workflow, who.agent);
    const variant = saved || Robots.variantFor(providerType(who.provider, who.model), who.model || '');
    const color = !saved && window.AgentColors ? paintOf(who.agent) : undefined;
    return Robots.svg(variant, st, { plaque: who.model ? Robots.plaqueFor(who.model) : undefined, mirror, ...(color ? { color } : {}), ...opts });
  }
  const avatar = (who) => `<span class="duo-robot still" aria-hidden="true">${robot(who, 'idle', { bubble: false })}</span>`;

  // The hover card of an agent: provider, model and effort as recorded in the run, its session mode and turn.
  // the CLI's short name ("Claude"), from the provider registry through run-chat-model.js
  const PROVIDERS = { shortName: providerType.short };
  const MODES = { persistent: 'persistent session', ephemeral: 'new session every turn', handoff: 'new session with a handoff note' };
  function cardLines(who) {
    const provider = `${PROVIDERS.shortName(who.provider, who.model) || who.provider || 'Unknown provider'}${who.provider === 'mock' ? ' (simulated)' : ''}`;
    const first = [provider, who.model ? Robots.plaqueFor(who.model) : '', who.effort ? `effort ${who.effort}` : ''].filter(Boolean).join(' · ');
    const second = [MODES[who.mode] || '', who.turn ? `turn ${who.turn}` : ''].filter(Boolean).join(' · ');
    return [first, second].filter(Boolean);
  }
  function agentAvatar(who) {
    const lines = cardLines(who);
    return `<span class="rc-who" tabindex="0" aria-label="${esc(`${nameOf(who.agent)}: ${lines.join(', ')}`)}">${avatar(who)}</span>
      <span class="rc-card" role="tooltip">${lines.map((l) => `<span>${esc(l)}</span>`).join('')}<span class="mono muted">${esc(who.agent)}</span></span>`;
  }
  // #245: a step by its readable name, its id in the tooltip
  // (a run recorded without them: its workflow's own `display` names, as the Run screen's progress)
  const workflowStepNames = () => {
    const wf = (state.workflows || []).find((w) => w && (w.file === chat.model.run?.workflow || w.name === chat.model.run?.workflow));
    return wf ? Object.fromEntries((wf.steps || []).filter((s) => s.display).map((s) => [s.id, s.display])) : null;
  };
  const stepName = (stepId) => (!stepId ? '' : chat.model.run?.stepNames ? chat.model.stepName(stepId) : displayName(stepId, workflowStepNames()));
  const stepTag = (stepId, visit, sub) => `<span class="rc-step" data-testid="run-chat-step" title="${esc(`Step ${stepId || ''}`.trim())}">${esc(stepName(stepId))}${sub ? ` · ${esc(sub)}` : ''}${visit > 1 ? t('runchat.visit_visit', { visit }) : ''}</span>`;

  // ---------------------------------------------------------------- items → HTML
  function turnHtml(it) {
    const { prose, json, decisions } = splitAnswer(it.text);
    let body = prose ? md(prose) : '';
    if (!body && json) body = `<pre class="rc-json">${esc(json)}</pre>`;
    if (!body) body = `<p class="muted small">${t('runchat.no_text')}</p>`;
    const extras = [];
    if (json && prose) extras.push(`<details class="rc-more"><summary>${t('runchat.structured_answer')}</summary><pre class="rc-json">${esc(json)}</pre></details>`);
    if (decisions) extras.push(`<details class="rc-more"><summary>${t('runchat.decision_log')}</summary><pre class="rc-json">${esc(decisions)}</pre></details>`);
    if (it.handoff) extras.push(`<details class="rc-more"><summary>${t('runchat.handoff_note')}</summary><div class="rc-body md">${md(it.handoff)}</div></details>`);
    const tools = it.activity.filter((a) => a.kind === 'tool');
    const thinking = it.activity.filter((a) => a.kind === 'thinking');
    if (it.activity.length) {
      const subagents = tools.filter((a) => a.subagent).length;
      const what = [tools.length ? `${tools.length} tool call${tools.length === 1 ? '' : 's'}` : '', subagents ? `${subagents} sub-agent${subagents === 1 ? '' : 's'}` : '', thinking.length ? 'thinking' : ''].filter(Boolean).join(' · ');
      // a sub-agent call shows its type and description, not its whole prompt
      const toolHtml = (a) => (a.subagent
        ? `<li class="rc-subagent${a.error ? ' err' : ''}"><b class="mono">${esc(a.name)}</b> <span class="tag">${esc(a.subagent.type)}</span> ${esc(a.subagent.description)}</li>`
        : `<li class="${a.error ? 'err' : ''}"><b class="mono">${esc(a.name)}</b> <span class="mono muted">${esc(a.input)}</span></li>`);
      extras.push(`<details class="rc-more rc-activity"><summary>${what}</summary><ol>${it.activity.map((a) => (a.kind === 'tool'
        ? toolHtml(a)
        : `<li class="think"><i>${esc(a.text)}</i></li>`)).join('')}</ol></details>`);
    }
    // context window: at the first request of the turn → its largest request (a fresh session starts small)
    const ctx = it.context?.peak ? ` · context ${it.fresh ? 'fresh ' : ''}${fmtK(it.context.start)} → ${fmtK(it.context.peak)}` : '';
    const foot = it.durationMs ? `${fmtK(it.tokensIn)} in / ${fmtK(it.tokensOut)} out${ctx} · $${it.cost.toFixed(2)} · ${fmtSecs(it.durationMs)}` : '';
    return `<div class="rc-msg rc-${it.side === 'right' ? 'right' : 'left'}" data-item="${it.id}"${colorStyle(it.agent)}>${agentAvatar(it)}<div class="duo-bubble">
      <div class="duo-meta"><b class="rc-name" title="${esc(it.agent)}">${esc(nameOf(it.agent))}</b>${isSupervisor(it.agent) ? '' : AgentColors.roleChip(it.agent, agentDef(it.agent))}${it.model ? turnModelTag(it) : ''}${stepTag(it.stepId, it.visit, it.sub)}<span class="time">${clock(it.ts)}</span></div>
      <div class="rc-body md">${body}</div>${extras.join('')}${foot ? `<div class="duo-foot">${esc(foot)}</div>` : ''}</div></div>`;
  }
  // #262: the provider and the model that answered the turn (a simulated one: its workflow provider)
  function turnModelTag(it) {
    const provider = it.simulates || (it.provider === 'mock' ? '' : it.provider);
    return `<span class="tag" data-testid="run-chat-turn-model" data-step="${esc(it.stepId || '')}"${it.simulates ? ` title="${t('runchat.simulated_no_model_was_called')}"` : ''}>${esc([provider, it.model].filter(Boolean).join(' · '))}</span>`;
  }
  // #262: an agent's provider out of credits (or past its usage limit): the turn moved on to the next one
  const fallbackEntry = (entry) => String(entry || '').replace(':', ' · ');
  function fallbackHtml(it) {
    return `<div class="rc-sys warn" data-item="${it.id}" data-testid="run-chat-fallback" title="${esc(it.reason)}"><span><b>${esc(nameOf(it.agent))}</b> ${t('runchat.fell_back_in_stepid', { stepId: stepTag(it.stepId, it.visit, it.sub) })} <span class="mono">${esc(fallbackEntry(it.from))}</span> → <span class="mono">${esc(fallbackEntry(it.to))}</span> · ${esc(it.reason.slice(0, 160))}</span><time>${clock(it.ts)}</time></div>`;
  }

  // #288: a run whose events never ended (no workflow.finished) and that no app runs any more: the
  // app closed while it ran or waited at a gate. Nothing waits for an answer; Resume goes on.
  // A run another app window runs (runningElsewhere, #112) is neither: its gates are answered there.
  const interrupted = () => !chat.live && !chat.loading && !chat.elsewhere && chat.model.run.status === 'running';
  const elsewhereHtml = () => `<div class="duo-note plain rc-interrupted" data-testid="runchat-elsewhere-note"><span><b data-status="running">${t('runchat.running_in_another_app_window')}</b> ${t('runchat.value_follow_it_and_answer_its', { value: esc(chat.elsewhere.host || 'this computer') })}</span></div>`;
  // where it stopped: the gate left waiting, else the step it was at
  const stoppedStep = () => chat.model.pendingGates().at(-1)?.stepId || chat.model.run.stepId || null;
  const resumeButton = () => `<button type="button" class="btn sm primary" data-testid="runchat-resume" data-resume-at="${esc(stoppedStep() || '')}" title="${t('runchat.resume_the_run_where_it_stopped')}">${t('runchat.resume')}</button>`;
  // the chat's last message while the run is interrupted (drawn by draw, after the items)
  function interruptedHtml() {
    const r = chat.model.run;
    const at = stoppedStep();
    const spent = r.lastTs && r.startedAt ? Date.parse(r.lastTs) - Date.parse(r.startedAt) : 0;
    return `<div class="duo-note failed rc-interrupted" data-testid="runchat-interrupted-note"><span><b data-status="interrupted">${t('runchat.interrupted_at')} <span title="${esc(at || '')}">${esc(at ? stepName(at) : t('runchat.its_first_step'))}</span></b> ${t('runchat.the_app_closed_value', { value: (r.cost || 0).toFixed(2) })} ${fmtSecs(spent)}</span>
      ${resumeButton()}<button type="button" class="link-btn small" data-resume title="${t('runchat.start_a_new_run_from_another')}">${t('runchat.resume_from_step')}</button></div>`;
  }

  function gateHtml(it) {
    const off = !chat.live || it.resolved || it.closed ? ' disabled' : '';
    // #288: a gate an interrupted run left waiting: nobody can take the answer, resuming brings it back
    const waits = !chat.live && !it.resolved && !it.closed;
    const stale = waits && !chat.elsewhere;
    const away = waits && !!chat.elsewhere;
    const why = away ? 'The run waits in another app window: answer this gate there' : 'The run was interrupted: resume it to answer this gate';
    // with "Accept and save to issue #n" when the run is about an issue (gateChoices in app.js, #125)
    const choices = typeof gateChoices === 'function' ? gateChoices({ choices: it.choices, save_to_issue: it.saveToIssue }) : it.choices;
    const buttons = choices.map((c, i) => {
      const chosen = it.resolved && String(c.id) === it.resolved.choice && (c.intent || null) === (it.resolved.intent || null);
      const title = waits ? why : c.intent ? c.title : '';
      return `<button type="button" class="btn sm ${!it.resolved && i === 0 ? 'primary' : ''}${chosen ? ' chosen' : ''}" data-approval="${esc(it.approvalId)}" data-choice="${esc(c.id)}"${c.intent ? ` data-intent="${esc(c.intent)}"` : ''}${title ? ` title="${esc(title)}"` : ''}${c.feedback_required ? ' data-needs-text="1"' : ''}${off}>${esc(c.label)}</button>`;
    }).join('')
      + (stale ? resumeButton() : '')
      // #183: "Interact with Oracle" at the end of the row
      + (window.GateOracle?.gateOracleButtonHtml({ approval_id: it.approvalId, run_id: chat.runId, step_id: it.stepId }) || '');
    // Run App / Open the worktree (app.js), only while the gate waits in the live run
    const open = chat.live && !it.resolved && !it.closed;
    const tools = open && typeof gateToolsHtml === 'function' ? gateToolsHtml(it, { runId: chat.runId }) : '';
    const field = it.feedback && !it.resolved && !it.closed ? `<label class="duo-ask-label">${esc(it.feedback.label || t('runchat.instructions_optional'))}</label>
      <textarea class="duo-ask-text" rows="2" placeholder="${esc(it.feedback.placeholder || '')}"${off}></textarea>` : '';
    const state = it.resolved ? '' : it.closed ? `<p class="muted small">${t('runchat.the_run_ended_before_an_answer')}</p>`
      : stale ? `<p class="muted small" data-testid="runchat-gate-interrupted">${t('runchat.this_gate_was_waiting_when_the')}</p>`
        : away ? `<p class="muted small" data-testid="runchat-gate-elsewhere">${t('runchat.this_gate_waits_in_another_app')}</p>` : '';
    // every gate's summary card (#213), the long message in its Details; a gate that tries the change
    // (#108) also gets the run's Artifacts panel on the right while it waits
    // a report (#290: the release summary) leads the message, rendered on its own
    const parts = window.gateReportParts?.(it) || { reportHtml: '', message: it.message };
    const full = `${parts.reportHtml}<div class="rc-body md">${md(parts.message)}</div>`;
    const card = it.brief?.headline ? window.gateCardHtml?.(chat.runId, open ? it : { ...it, runApp: false, localPreview: null }, full)
      : open ? window.gateBriefHtml?.(chat.runId, it, full) : '';
    const help = !it.resolved && !it.closed && !waits ?window.gateButtonsHelpHtml?.(it) || '' : '';
    const side = open && typeof gateSideHtml === 'function' ? gateSideHtml(it, chat.runId) : '';
    const main = `<div class="duo-meta"><b>${t('runchat.human_gate')}</b>${stepTag(it.stepId)}<span class="time">${clock(it.ts)}</span></div>
      ${card || full}${tools}${field}<div class="row gate-choices">${buttons}</div>${help}${state}`;
    return `<div class="rc-gate" data-item="${it.id}"><div class="duo-ask${side ? ' run-gate-wide' : ''}" data-gate="${esc(it.approvalId)}">
      ${side ? `<div class="run-gate-main">${main}</div>${side}` : main}</div></div>`;
  }

  function groupHtml(it) {
    const state = !it.done ? StatusPill.statusPill('running')
      : it.error ? StatusPill.statusPill('failed')
        : it.failed?.length ? `<span class="pill pill-warn">${it.failed.length} ${t('runchat.failed')}</span>` : StatusPill.statusPill('done');
    return `<div class="rc-group" data-item="${it.id}"><div class="rc-group-head">
      <span>${t('runchat.parallel_stepid', { stepId: stepTag(it.stepId, it.visit) })} ${it.agents.map((a) => `<b${colorStyle(a)} title="${esc(a)}">${esc(nameOf(a))}</b>`).join(', ')}</span>${state}</div>
      <div class="rc-group-body"></div></div>`;
  }

  // #396: the end's pill of a run that went on without a green suite (the event's summary, else its row's `tested`)
  const testedPill = (it) => ((it.tested || chat.tested) === 'not green'
    ? ` <span class="pill pill-warn" data-testid="runchat-tested" title="${t('runchat.the_run_reached_the_build_without')}">${t('runchat.not_tested_green')}</span>` : '');

  const SUP_WHAT = { retry:'Asked for a new attempt.', fix_output: 'Fixed the answer so the run can continue.', ask_human: 'Needs you: see the gate below.', fail: 'Could not recover this step.' };
  function itemHtml(it) {
    switch (it.kind) {
      case 'start': {
        const issue = it.issues.length ? `${it.issues.length > 1 ? 'Issues' : 'Issue'} ${it.issues.map((i) => `<a href="${esc(i.url)}" target="_blank" rel="noopener">#${esc(i.number)}</a> ${esc(i.title || '')}`).join(' · ')}` : '';
        const inputs = Object.entries(it.inputs).filter(([k, v]) => k !== 'task' && v !== '' && v != null);
        return `<div data-item="${it.id}" class="rc-start"><div class="duo-msg user"><div class="duo-bubble">
          <div class="duo-meta"><b>${esc(it.workflow)}</b>${it.version ? `<span class="tag">v${esc(it.version)}</span>` : ''}${it.mock ? `<span class="badge p-mock">${t('runchat.simulated')}</span>` : ''}<span class="time">${clock(it.ts)}</span></div>
          ${it.task ? `<div class="rc-body md">${md(it.task)}</div>` : `<p class="muted small">${t('runchat.no_task')}</p>`}
          ${inputs.length ? `<details class="rc-more"><summary>${t('runchat.inputs')}</summary><dl class="rc-inputs">${inputs.map(([k, v]) => `<dt class="mono">${esc(k)}</dt><dd class="mono">${esc(typeof v === 'string' ? v : JSON.stringify(v))}</dd>`).join('')}</dl></details>` : ''}
          </div></div>${it.resumedFrom ? `<div class="duo-note plain"><span>${t('runchat.resumed_from_run_id_at', { run_id: esc(it.resumedFrom.run_id) })} <span title="${esc(it.resumedFrom.step)}">${esc(stepName(it.resumedFrom.step))}</span></span></div>` : ''}${issue ? `<div class="duo-note plain"><span>${issue}</span></div>` : ''}</div>`;
      }
      case 'turn': return turnHtml(it);
      case 'fallback': return fallbackHtml(it);
      case 'group': return groupHtml(it);
      case 'gate': return gateHtml(it);
      case 'system': return `<div class="rc-sys ${it.level}" data-item="${it.id}"><span>${esc(it.text)}</span><time>${clock(it.ts)}</time></div>`;
      case 'fail': return `<div class="rc-sys error" data-testid="run-chat-fail" data-item="${it.id}"><span title="${esc(it.stepId)}">${esc(stepName(it.stepId))} ${t('runchat.failed_2')} ${esc(it.text.slice(0, 400))}</span><time>${clock(it.ts)}</time></div>`;
      case 'reply': return `<div class="duo-msg user reply" data-item="${it.id}"><div class="duo-bubble">
        <div class="duo-meta"><b>${it.by === 'user' ? t('runchat.you') : esc(it.by)}</b>${stepTag(it.stepId)}<span class="time">${clock(it.ts)}</span></div>
        <p><b>${esc(it.label)}</b></p>${it.feedback ? `<p class="duo-msg-text">${esc(it.feedback)}</p>` : ''}</div></div>`;
      case 'supervisor': return `<div class="duo-msg supervisor" data-item="${it.id}">${avatar({ agent: 'supervisor' })}<div class="duo-bubble">
        <div class="duo-meta"><b>${t('runchat.supervisor')}</b>${stepTag(it.stepId)}<span class="tag">${esc(it.action)}${it.goto ? ` → ${esc(it.goto)}` : ''}${it.causeClass ? ` · ${esc(it.causeClass)}` : ''}</span><span class="time">${clock(it.ts)}</span></div>
        <p class="duo-msg-text">${esc(it.explanation)}</p>${it.instruction ? `<p class="duo-msg-text">${esc(it.instruction)}</p>` : ''}
        ${SUP_WHAT[it.action] ? `<p class="muted small">${SUP_WHAT[it.action]}</p>` : ''}</div></div>`;
      case 'end': {
        const ok = it.status === 'success';
        const tested = testedPill(it);
        // #384: the run that resumed this one (its row's resumedBy, read when a past run opens)
        return `<div class="duo-note ${ok ? 'done' : 'failed'}" data-item="${it.id}" data-testid="run-chat-finished"><span><b data-status="${esc(it.status)}">${ok ? t('runchat.done') : esc(StatusPill.statusLabel(it.status))}</b>${tested}${!ok && it.error ? ` · ${esc(it.error.slice(0, 240))}` : ''} · $${(it.cost || 0).toFixed(2)} · ${fmtSecs(it.durationMs)}${StatusPill.resumedLink(chat.resumedBy)}</span>
          <button type="button" class="link-btn small" data-resume title="${t('runchat.start_a_new_run_from_a')}">${t('runchat.resume_from_step')}</button></div>`;
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
    // an interrupted run's note stays the last message (#288)
    box.querySelector('[data-testid="runchat-interrupted-note"]')?.remove();
    box.querySelector('[data-testid="runchat-elsewhere-note"]')?.remove();
    if (interrupted()) box.insertAdjacentHTML('beforeend', interruptedHtml());
    else if (chat.elsewhere && !chat.live && chat.model.run.status === 'running') box.insertAdjacentHTML('beforeend', elsewhereHtml());
    // a gate's Artifacts panel and Run App state (app.js)
    window.mountGateSides?.(box);
    window.paintGateApps?.();
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
      <span class="duo-dots"><i></i><i></i><i></i></span><span><b>${esc(nameOf(a.agent))}</b> ${DOING[a.state] || DOING.thinking}… <span class="muted" title="${esc(a.stepId)}">(${esc(stepName(a.stepId))})</span></span></div>`).join('');
  }

  function drawHead() {
    const r = chat.model.run;
    // the run's title (editable) and PR (#84, app.js), its workflow next to them
    const run = { ...r, id: r.id };
    if (!$c('#rc-title .run-title-input')) $c('#rc-title').innerHTML = r.id
      ? `<b>${window.runTitleHtml ? runTitleHtml(run) : esc(r.workflow)}</b> ${window.runPrBadge ? runPrBadge(run) : ''} <span class="muted small">${esc(r.workflow)}</span>${r.mock ? ` <span class="badge p-mock">${t('runchat.simulated')}</span>` : ''}${r.chain && window.ChainModel ? ` ${ChainModel.chainBadgesHtml(r.chain)}` : ''} <span class="muted small mono" data-testid="run-screen-id">${esc(r.id)}</span>`
      : `<span class="muted mono" data-testid="run-screen-id">${esc(chat.runId || '')}</span>`;
    const status = chat.loading ? 'loading' : r.status === 'running' && !chat.live && !chat.elsewhere ? 'interrupted' : r.status || 'unknown';
    const waiting = chat.live && chat.model.pendingGates().length;
    const pill = $c('#rc-status');
    pill.className = `pill pill-${waiting ? 'warn' : status}`;
    pill.dataset.status = waiting ? 'waiting' : status;
    pill.textContent = StatusPill.statusLabel(status, { waiting: !!waiting });
    $c('#rc-cost').textContent = r.cost ? `$${r.cost.toFixed(2)}` : '';
    $c('#rc-stop').classList.toggle('hidden', !chat.live);
  }

  function reset(runId) {
    chat = { model: new RunChatModel(), runId, live: false, elsewhere: null, follow: chat.follow, loading: true, buffer: [] };
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
      $c('#rc-messages').innerHTML = `<p class="error">${t('runchat.could_not_load_the_run')} ${esc(errMsg(e))}</p>`;
      drawHead();
      return;
    }
    if (chat.runId !== runId) return; // another run was opened meanwhile
    const ids = [];
    for (const ev of [...events, ...chat.buffer]) ids.push(...chat.model.apply(ev));
    chat.buffer = [];
    chat.loading = false;
    chat.live = chat.live && chat.model.run.status === 'running';
    // a past run's row: a run without an end that this window does not run is interrupted, or alive in
    // another app window (its row's runningElsewhere, #112; unreadable, it reads as interrupted); an
    // ended run may have been resumed by a later run (#384)
    if (!chat.live) {
      try {
        const [row] = (await api.listRuns?.({ ids: [runId] }))?.runs || [];
        if (chat.runId !== runId) return;
        if (chat.model.run.status === 'running') chat.elsewhere = row?.status === 'running' && row.runningElsewhere || null;
        chat.resumedBy = row?.resumedBy || null;
        chat.tested = row?.tested || null;
      } catch { /* the run list could not be read */ }
    }
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
  // its title or PR state changed (app.js onRunMeta); not while the title is being edited
  window.runChatRefreshHead = () => { if (chat.runId && !$c('#rc-title .run-title-input')) drawHead(); };

  function init() {
    if (!$c('#view-runchat')) return;
    $c('#rc-messages').addEventListener('click', (e) => {
      const resumed = e.target.closest('[data-testid="run-resumed-link"]');
      if (resumed) { e.preventDefault(); window.showRun?.(resumed.dataset.run); return; }
      const at = e.target.closest('[data-resume-at]');
      if (at) { window.openResumeDialog?.(chat.runId, at.dataset.resumeAt ? { step: at.dataset.resumeAt } : {}); return; }
      if (e.target.closest('[data-resume]')) { window.openResumeDialog?.(chat.runId); return; }
      if (e.target.closest('[data-gate-tool]')) { if (chat.live) onGateTool(e, chat.runId); return; }
      const b = e.target.closest('button[data-approval]');
      if (!b || !chat.live || b.disabled) return;
      const v = b.dataset.choice;
      const text = b.closest('.duo-ask')?.querySelector('textarea')?.value || '';
      if (b.dataset.needsText && !text.trim()) { showToast(t('runchat.write_your_request_first'), t('runchat.textcontent_sends_the_text_to_the', { textContent: b.textContent })); b.closest('.duo-ask')?.querySelector('textarea')?.focus({ preventScroll: true }); return; }
      const buttons = b.closest('.duo-ask').querySelectorAll('button');
      buttons.forEach((x) => { x.disabled = true; });
      // the answer opposite to the gate's recommendation asks once (#213); images pasted into the feedback (#130) go with it
      const answer = v === 'true' ? true : v === 'false' ? false : v;
      const send = () => PasteImage.collect(b.closest('.duo-ask').querySelector('textarea')).then((images) => api.resolveApproval(b.dataset.approval, answer, text, chat.runId, b.dataset.intent || null, ...(images.length ? [images] : [])));
      const gate = chat.model.gates.get(b.dataset.approval);
      if (!window.gateAgainstRecommendation?.(gate, answer)) { send(); return; }
      window.confirmGateAnswer(gate, answer).then((ok) => (ok ? send() : buttons.forEach((x) => { x.disabled = false; })));
    });
    $c('#rc-stop').onclick = () => api.stopRun(chat.runId);
    $c('#rc-logs').onclick = () => chat.model.run.runDir && api.openPath(chat.model.run.runDir);
    // Chat / Details: the Run screen, for a past run rebuilt from its events (openPastRun). The
    // choice is remembered: the next run opened shows the same view (setRunView in app.js).
    $c('#rc-details').onclick = () => {
      setRunView('details');
      if (state.runs.has(chat.runId)) selectRun(chat.runId);
      else openPastRun(chat.runId);
    };
    $c('#run-mode-chat').onclick = () => {
      if (!state.run) return;
      setRunView('chat');
      openChatFor({ runId: state.run.id, workflow: state.run.workflow, running: state.run.status === 'running', follow: true });
    };
    $c('#rc-scroll').addEventListener('scroll', drawJump, { passive: true });
    $c('#rc-jump').onclick = toLatest;
    // the supervisor's look and the workflow agents' looks are customizable in Agents
    document.addEventListener('robots:changed', (e) => {
      if (!['supervisor', 'workflow-agents'].includes(e.detail?.name) || chat.loading || !chat.runId) return;
      $c('#rc-messages').innerHTML = '';
      draw(chat.model.items.map((it) => it.id));
    });
    api.onEvent(onEvent);
  }

  registerView({
    id: 'runchat',
    markup: `
      <section id="view-runchat" class="view hidden">
        <header class="duo-chat-head run-tab-row" data-testid="run-tab-row">
          <div class="tabs" role="tablist" aria-label="${t('runchat.run_view')}">
            <button class="tab active" type="button" role="tab" aria-selected="true">${t('runchat.chat')}</button>
            <button id="rc-details" class="tab" type="button" role="tab" aria-selected="false" title="${t('runchat.sessions_prompts_and_events_of_this')}">${t('runchat.details')}</button>
            <button id="rc-3d" class="tab" type="button" role="tab" aria-selected="false" data-run3d="chat" data-testid="run-3d" title="${t('runchat.show_this_run_in_3d')}">3D</button>
          </div>
          <div id="rc-title" class="rc-title"></div>
          <span id="rc-status" class="pill" data-testid="run-screen-status"></span>
          <div class="spacer"></div>
          <span id="rc-cost" class="mono small muted" title="${t('runchat.cost_so_far')}"></span>
          <button id="rc-logs" class="btn ghost sm" type="button" title="${t('runchat.open_the_run_folder_events_sessions')}">${t('runchat.run_folder')}</button>
          <button id="rc-stop" class="btn danger sm hidden" type="button">${t('runchat.stop')}</button>
        </header>
        <div id="rc-scroll" class="rc-scroll">
          <div id="rc-messages" class="duo-messages rc-messages"></div>
          <div id="rc-typing" class="rc-typing"></div>
        </div>
        <button id="rc-jump" class="btn sm rc-jump hidden" type="button" title="${t('runchat.scroll_to_the_latest_message')}">${t('runchat.jump_to_latest')}</button>
      </section>`,
    mount: init,
  });
})();
