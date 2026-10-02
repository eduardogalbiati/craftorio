// The run list shared by Projects › Project (views/project/) and Workflows › Runs
// (views/workflows/): filter chips, one row per run (status, title, PR, duration, tokens, cost,
// progress strip) and, expanded, its actions and agent sessions (tokens and cost per session, a
// total row). Also the progress strip of a row (runProgressStrip: the groups a run visited, with
// their agents' robots) and renderRunListsSoon (run events). Uses app.js globals ($, esc, state,
// fmtDur, fmtNum, dateOf, runTitleHtml, prBadge…), fmtTok / fmtUsd (usage-widget.js), termAction
// (term-dock.js), canResume (resume-dialog.js), WATCH_TITLE (supervisor-drawer.js), openArtifactsAt.

const RUN_FILTERS = [
  ['all', 'All', () => true],
  ['running', 'Running', (r) => r.status === 'running'],
  ['success', 'Success', (r) => r.status === 'success'],
  ['failed', 'Failed', (r) => ['failed', 'cancelled', 'interrupted'].includes(r.status)],
];

// Run list shared by Projects > Project and Workflows > Runs. `rl` is the list state
// ({ runs, error, filter, showSim, expanded, msgs, id? }), `id` being the project when the
// list belongs to one; otherwise each run shows its own project.
function renderRunList(rl, { prefix, box: boxSel, empty, start, rerender }) {
  $(`#${prefix}-show-sim`).checked = rl.showSim;
  $(`#${prefix}-runs-error`).textContent = rl.error ? `Could not load runs: ${rl.error}` : '';

  const all = rl.runs || [];
  const visible = all.filter((r) => rl.showSim || !r.mock);
  const filters = $(`#${prefix}-run-filters`);
  filters.innerHTML = RUN_FILTERS.map(([id, label, fn]) =>
    `<button type="button" class="chip ${rl.filter === id ? 'active' : ''}" data-filter="${id}" ${id === 'failed' ? 'title="Failed, cancelled or interrupted"' : ''}>${label} <span class="muted">${visible.filter(fn).length}</span></button>`).join('');
  filters.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { rl.filter = b.dataset.filter; rerender(); }));

  const box = $(boxSel);
  // a run's title being edited stays until it is saved or cancelled (which renders again)
  if (box.contains(document.activeElement) && document.activeElement.classList.contains('run-title-input')) return;
  if (rl.runs == null) {
    box.innerHTML = rl.error ? '' : '<p class="muted">Loading…</p>';
    return;
  }
  const hiddenSim = all.length - visible.length;
  const simNote = hiddenSim ? `<p class="muted small">${hiddenSim} simulated run${hiddenSim > 1 ? 's' : ''} hidden.</p>` : '';
  if (!all.length || !visible.length) {
    box.innerHTML = `<div class="empty-state"><b>${esc(empty)}</b>${simNote}<button class="btn primary" data-empty-start>Start workflow</button></div>`;
    box.querySelector('[data-empty-start]').onclick = start;
    return;
  }
  const fn = RUN_FILTERS.find(([id]) => id === rl.filter)?.[2] || (() => true);
  const runs = visible.filter(fn);
  box.innerHTML = (runs.map((r) => runListRow(r, rl)).join('') || '<p class="muted pr-none">No runs match this filter.</p>') + simNote;
  askPrStates(runs);

  box.querySelectorAll('.pr-row').forEach((row) => (row.onclick = () => {
    const id = row.closest('.pr-run').dataset.run;
    rl.expanded.has(id) ? rl.expanded.delete(id) : rl.expanded.add(id);
    rerender();
  }));
  box.querySelectorAll('[data-run-act]').forEach((b) => (b.onclick = () => {
    const r = rl.runs.find((x) => x.runId === b.closest('.pr-run').dataset.run);
    if (b.dataset.runAct === 'logs') api.openPath(r.runDir);
    // the Run screen shows the selected run: select this one, not whichever run was on screen
    if (b.dataset.runAct === 'view') showRun(r.runId, { workflow: r.workflow });
    // "Open chat" switches to the chat explicitly, and the chat becomes the remembered view
    if (b.dataset.runAct === 'chat') { setRunView('chat'); window.openRunChat?.({ runId: r.runId, workflow: r.workflow, running: r.current && r.status === 'running' }); }
    if (b.dataset.runAct === 'sup' || b.dataset.runAct === 'watch') {
      openSupervisor({ runId: r.runId, workflow: r.workflow, status: r.status, error: r.error, mock: r.mock, issues: issuesOfRun(r) }, { watch: b.dataset.runAct === 'watch' });
    }
    if (b.dataset.runAct === 'resume') openResumeDialog(r.runId);
  }));
  box.querySelectorAll('[data-art]').forEach((b) => (b.onclick = () => {
    const r = rl.runs.find((x) => x.runId === b.closest('.pr-run').dataset.run);
    openArtifactsAt({ projectId: rl.id || r.project?.id, runId: r.runId, path: b.dataset.art, mock: r.mock });
  }));
  box.querySelectorAll('[data-term]').forEach((b) => (b.onclick = async () => {
    const runId = b.closest('.pr-run').dataset.run;
    const row = b.closest('[data-session]');
    const sid = row.dataset.session;
    const key = `${runId}:${sid}`;
    rl.msgs.set(key, await termAction(b, { sessionId: sid, runId, label: row.dataset.agent }));
    const msg = b.closest('[data-session]').querySelector('[data-term-msg]');
    if (msg) { msg.textContent = rl.msgs.get(key).text; msg.classList.toggle('error', rl.msgs.get(key).error); }
  }));
}

// A run that started while its issues could not be read from the platform (#168): the cache or the
// planned copy was used, named here and in the run's log.
function issueFallbackBadge(r) {
  const used = issuesOfRun(r).filter((i) => i.fallback);
  if (!used.length) return '';
  const what = used.map((i) => `#${i.number}: ${i.fallback === 'cache' ? `the cache of ${i.cachedAt ? dateOf(i.cachedAt) : 'the last sync'}` : 'the copy saved with the planned item'}`).join('; ');
  return ` <span class="badge warn" title="${esc(`The platform could not be read when this run started, so it used ${what}. See the run's log.`)}">issue from cache</span>`;
}

function runListRow(r, pv) {
  const open = pv.expanded.has(r.runId);
  const task = String(r.task || '').trim();
  const firstLine = task.split('\n')[0];
  const dur = r.status === 'running' && r.startedAt ? Date.now() - Date.parse(r.startedAt) : r.durationMs;
  return `
    <div class="pr-run ${open ? 'open' : ''}" data-run="${esc(r.runId)}">
      <div class="pr-row" title="${open ? 'Hide' : 'Show'} sessions">
        <span class="pill pill-${esc(r.status)}">${esc(r.status)}</span>
        <div class="pr-main">
          <div><b>${runTitleHtml(r)}</b> ${prBadge(r)} <span class="muted small" title="workflow">${esc(r.workflow || r.file || 'workflow')}${r.version ? ` v${esc(r.version)}` : ''}</span>${r.mock ? ' <span class="badge p-mock">simulated</span>' : ''}${r.current ? ' <span class="badge live">this window</span>' : ''}${r.runningElsewhere ? ' <span class="badge" title="Another app process on this workspace runs it: stop or resume it there">another window</span>' : ''}${r.retryOf ? ` <span class="badge" title="Started by a retry of the same roadmap item: the two runs do the same work">retry of ${esc(String(r.retryOf).slice(9))}</span>` : ''}${issueFallbackBadge(r)}${r.chain && window.ChainModel ? ` ${ChainModel.chainBadgesHtml(r.chain)}` : ''}${!pv.id && r.project ? ` <span class="badge" title="project">${esc(r.project.name)}</span>` : ''}</div>
          <div class="muted small pr-task" title="${esc(task)}">${esc(firstLine || 'No task')}</div>
        </div>
        <span class="pr-meta"><label>started</label>${r.startedAt ? esc(dateOf(r.startedAt)) : '—'}</span>
        <span class="pr-meta"><label>duration</label>${fmtDur(dur)}</span>
        <span class="pr-meta"><label>tokens</label>${fmtTok(r.tokens?.total)}</span>
        <span class="pr-meta"><label>cost</label>${fmtUsd(r.costUsd)}</span>
        <span class="pr-chev" aria-hidden="true">${open ? '▾' : '▸'}</span>
        ${runProgressStrip(r)}
      </div>
      ${open ? projectRunBody(r, pv) : ''}
    </div>`;
}

const CHAT_TITLES = {
  'writer-reviewer': 'See the writer, reviewer and supervisor conversation',
  'ai-arena': 'See the contenders, the synthesis and the supervisor as a chat',
  'issue-tracker': 'See the analysis and the draft as a chat, and answer the review there',
};

function projectRunBody(r, pv) {
  const sessions = r.sessions || [];
  return `<div class="pr-body">
    <div class="row">
      <button class="btn sm ghost" data-run-act="logs">Open logs</button>
      <button class="btn sm ghost sup-btn" data-run-act="sup"><span class="sup-mark">◆</span> Ask the supervisor</button>
      ${r.current && r.status === 'running' ? `<button class="btn sm ghost sup-btn" data-run-act="watch" title="${WATCH_TITLE}"><span class="sup-mark">◆</span> Watch with the supervisor</button>` : ''}
      ${canResume(r) ? '<button class="btn sm ghost" data-run-act="resume" title="Start a new run from a step of this one, keeping the previous outputs (no supervisor call)">Resume from step…</button>' : ''}
      <button class="btn sm" data-run-act="chat" title="${esc(CHAT_TITLES[r.workflow] || 'See the agents, the orchestrator and the human gates as a chat')}">Open chat</button>
      <button class="btn sm" data-run-act="view" title="${r.current || state.runs.has(r.runId) ? 'Open its Run screen' : 'Open its Run screen, rebuilt from its recorded events (read-only)'}">View run</button>
      <span class="spacer"></span>
      <span class="muted small mono">${esc(r.runId)}</span>
    </div>
    ${r.error ? `<pre class="pr-error">${esc(r.error)}</pre>` : ''}
    ${runTaskBlock(r)}
    ${r.artifacts?.length ? `<div class="pr-arts">
      <div class="pr-arts-head">Artifacts <span class="muted">${r.artifacts.length}</span></div>
      <div class="pr-arts-list">${r.artifacts.map((a) => `
        <button class="pr-art ${a.exists ? '' : 'missing'}" data-art="${esc(a.path)}" title="${esc(a.path)}">
          ${artKindIcon(a.kind)}<span class="pr-art-name">${esc(a.name)}</span>
          ${a.location === 'external' ? '<span class="badge">project copy</span>' : ''}${a.exists ? '' : '<span class="muted small">deleted</span>'}
          <span class="muted small">${esc(fmtSize(a.size))}</span>
        </button>`).join('')}</div>
    </div>` : ''}
    ${sessions.length ? `<table class="u-table pr-sessions">
      <thead><tr><th>Agent</th><th>Provider · model</th><th>Status</th><th class="num">Turns</th><th class="num">Tokens</th><th class="num">Cost</th><th></th></tr></thead>
      <tbody>${[...sessions].sort((a, b) => isOrchSession(b) - isOrchSession(a)).map((s) => {
        const m = pv.msgs.get(`${r.runId}:${s.id}`);
        return `<tr data-session="${esc(s.id)}" data-agent="${esc(s.agent)}">
          <td><b title="${esc(s.agent)}">${esc(agentLabel(s.agent, r.agentNames))}</b> <span class="muted small mono">${esc(s.id)}</span></td>
          <td><span class="badge p-${esc(s.provider)}">${esc(s.provider)}</span> <span class="mono small">${esc(s.model || '')}</span></td>
          <td><span class="status st-${esc(s.status)}"><span class="status-dot"></span>${esc(s.status)}</span></td>
          <td class="num mono">${fmtNum(s.turns)}</td>
          ${tokensCell(s.tokens)}
          ${sessionCostCell(s)}
          <td class="pr-term">
            <span class="small ${m?.error ? 'error' : 'muted'}" data-term-msg>${esc(m?.text || '')}</span>
            ${termButtons('live', isOrchSession(s) ? 'Follow the orchestrator log in a terminal' : '')}
            ${termButtons('cli', '', s.cliAvailable ? '' : s.cliReason || 'Not available')}
          </td>
        </tr>`;
      }).join('')}</tbody>
      ${sessionsTotalRow(sessions)}
    </table>` : '<p class="muted small">No agent sessions in this run.</p>'}
  </div>`;
}

// A session's tokens (sessionView: input + output + cache read + cache write, as on the Usage
// screen): the compact total, the exact breakdown on hover; — when the session has none (the engine).
const TOKEN_PARTS = [['input', 'Input'], ['output', 'Output'], ['cache_read', 'Cache read'], ['cache_write', 'Cache write'], ['reasoning', 'Reasoning (counted in output)']];
function tokensCell(t) {
  if (!t?.total) return '<td class="num mono muted">—</td>';
  const tip = TOKEN_PARTS.map(([k, label]) => `${label}: ${fmtNum(t[k])}`).join('\n');
  return `<td class="num mono" title="${esc(tip)}">${fmtTok(t.total)}</td>`;
}
// Tokens with no cost: a model with no price (Codex, unpriced models), not a free session.
function sessionCostCell(s) {
  if (!s.costUsd && s.tokens?.total && s.provider !== 'mock') return '<td class="num mono muted" title="No price for this model: see Usage › Prices">—</td>';
  return `<td class="num mono">${fmtUsd(s.costUsd)}</td>`;
}
function sessionsTotalRow(sessions) {
  const sum = (f) => sessions.reduce((a, s) => a + (f(s) || 0), 0);
  const tokens = Object.fromEntries([...TOKEN_PARTS.map(([k]) => [k, sum((s) => s.tokens?.[k])]), ['total', sum((s) => s.tokens?.total)]]);
  return `<tfoot><tr class="pr-total"><td colspan="3">Total</td><td class="num mono">${fmtNum(sum((s) => s.turns))}</td>
    ${tokensCell(tokens)}<td class="num mono">${fmtUsd(sum((s) => s.costUsd))}</td><td></td></tr></tfoot>`;
}

function runTaskBlock(r) {
  const t = String(r.task || '').trim();
  return t.includes('\n') || t.length > 120 ? `<details class="pr-fulltask"><summary class="muted small">Full task</summary><pre>${esc(t)}</pre></details>` : '';
}

// Run progress in the runs lists: the groups a run visited, with their agents' avatars
let runListsFrame = 0;
function renderRunListsSoon() {
  if (runListsFrame) return;
  runListsFrame = requestAnimationFrame(() => {
    runListsFrame = 0;
    if (workflowRunsVisible() && state.wr.runs) renderWorkflowRuns();
    if (state.view === 'project' && state.pv?.runs) renderProjectView();
  });
}

// Robot SVGs are large: one per provider/model/state, reused. A workflow agent with a look saved
// in Agents (`workflow` + `agent`) gets its own entry, dropped when a look changes.
const avatarCache = new Map();
document.addEventListener('robots:changed', (e) => { if (e.detail?.name === 'workflow-agents') avatarCache.clear(); });
function robotAvatar(provider, model, st, workflow, agent) {
  const look = window.AgentLooks?.forWorkflow(workflow, agent);
  const key = look ? `look|${workflow}/${agent}|${st}` : `${provider}|${model}|${st}`;
  if (!avatarCache.has(key)) {
    const variant = look || (window.Robots ? Robots.variantFor(window.RunChatModel?.providerType(provider, model) || provider, model || '') : null);
    avatarCache.set(key, variant ? Robots.svg(variant, st, { bubble: false, plaque: '' }) : '');
  }
  return avatarCache.get(key);
}
const PERSON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8.5" r="4" fill="currentColor"/><path d="M4.5 21c0-4.2 3.4-7 7.5-7s7.5 2.8 7.5 7z" fill="currentColor"/></svg>';
const ENGINE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
const CHIP_ROBOT_STATE = { running: 'thinking', waiting: 'waiting', failed: 'error', stopped: 'sleeping', done: 'idle' };
const MAX_CHIPS = 8;

function progressAvatar(a, chip, names, workflow) {
  const tip = a.human
    ? `${a.steps.join(', ')} · You (human gate)${a.durationMs ? ` · ${fmtDur(a.durationMs)}` : ''}`
    : `${a.steps.join(', ')} · ${agentLabel(a.agent, names)} (${a.agent})${a.provider ? ` · ${a.provider}${a.model ? `/${a.model}` : ''}` : ''}${a.durationMs ? ` · ${fmtDur(a.durationMs)}` : ''} · ${fmtUsd(a.cost)}`;
  // the last chip's working agents show the run's state; the others rest
  const st = chip.status === 'done' ? 'idle' : CHIP_ROBOT_STATE[chip.status];
  const art = a.human ? PERSON_SVG : a.provider ? robotAvatar(a.provider, a.model, st, workflow, a.agent) : ENGINE_SVG;
  return `<span class="rp-av${a.human ? ' human' : a.provider ? '' : ' engine'}" title="${esc(tip)}">${art}</span>`;
}

function progressChip(c, names, workflow) {
  const label = {
    done: '✓',
    running: `${c.current}…`,
    waiting: 'waiting for you',
    failed: `✕ ${c.current}`,
    stopped: `stopped at ${c.current}`,
  }[c.status];
  const agents = c.agents.length ? c.agents : [{ agent: 'orchestrator', steps: c.steps.map((e) => e.step), cost: 0, durationMs: 0 }];
  const avs = agents.slice(0, 4).map((a) => progressAvatar(a, c, names, workflow)).join('') + (agents.length > 4 ? `<span class="rp-av rp-more" title="${esc(agents.slice(4).map((a) => agentLabel(a.agent, names)).join(', '))}">+${agents.length - 4}</span>` : '');
  return `<div class="rp-chip st-${c.status}${c.status === 'done' ? ' still' : ''}">
    <div class="rp-avs">${avs}</div>
    <div class="rp-name${c.grouped ? '' : ' mono'}">${esc(c.name)}${c.round > 1 ? ` <span class="rp-round">×${c.round}</span>` : ''}</div>
    <div class="rp-state" title="${esc(c.steps.map((e) => e.step).join(' › '))}">${esc(label)}</div>
  </div>`;
}

// The progress strip of a run's row: the live trail for a run this window follows from its start.
function runProgressStrip(r) {
  const live = r.current ? state.runs.get(r.runId) : null;
  const steps = live?.trail ? live.trail.steps : r.progress;
  if (!steps?.length) return '';
  const status = live?.trail ? live.run?.status || r.status : r.status;
  const chips = RunProgress.progressGroups(steps, r.groups || live?.groups, status);
  const skipped = chips.length - MAX_CHIPS;
  return `<div class="rp-strip">${skipped > 0 ? `<span class="rp-skip" title="${esc(chips.slice(0, skipped).map((c) => c.name).join(' › '))}">+${skipped}</span><span class="rp-sep">›</span>` : ''}${chips.slice(Math.max(0, skipped)).map((c) => progressChip(c, r.agentNames || live?.run?.agentNames, r.workflow || live?.run?.workflow)).join('<span class="rp-sep">›</span>')}</div>`;
}
