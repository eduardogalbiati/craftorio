// The run list shared by Projects › Project (views/project/) and Workflows › Runs
// (views/workflows/): filter chips, one row per run (status, title, PR, duration, tokens, cost,
// progress strip) and, expanded, its actions and agent sessions (tokens and cost per session, a
// total row). Also the progress strip of a row (runProgressStrip: the groups a run visited, with
// their agents' robots) and renderRunListsSoon (run events). Uses app.js globals ($, esc, state,
// fmtDur, fmtNum, dateOf, runTitleHtml, prBadge…), fmtTok / fmtUsd (usage-widget.js), termAction
// (term-dock.js), canResume (resume-dialog.js), WATCH_TITLE (supervisor-drawer.js), openArtifactsAt.
//
// The lists come in pages from the service (#200: runs:list / projects:runs with { offset, limit,
// filter, showSim, q, upTo }): the filter chips, "Show simulated" and the search ask the service
// again, the next page loads when the "Loading more…" row scrolls into view (loadRunListPage), and a
// row's artifacts load when it opens (artifacts:list { runId }), grouped by step, ART_PAGE at a time.
// A run event updates its own row (refreshRunRow: runs:list { ids }).

// The filter chips; the service filters and counts (src/service/areas/run-lists.js RUN_FILTERS).
const RUN_FILTERS = [
  ['all', 'All'],
  ['running', 'Running'],
  ['success', 'Success'],
  ['failed', 'Failed'],
];
const RUN_PAGE = 30;
const ART_PAGE = 50;

// Loads the list's runs: mode 'reset' (the first page: opening the list, a filter or the search
// changed), 'more' (the next page) or 'refresh' (the pages already loaded, again: live updates keep
// the scroll and the open rows). fetchPage(opts) is the service call; returns its answer, null when it
// failed or a newer load replaced it.
async function loadRunListPage(rl, fetchPage, mode = 'reset') {
  const seq = (rl.seq = (rl.seq || 0) + 1);
  const opts = { filter: rl.filter || 'all', showSim: !!rl.showSim, q: rl.q || '', offset: 0, limit: RUN_PAGE };
  if (mode === 'more') opts.offset = rl.nextOffset || 0;
  if (mode === 'refresh') opts.limit = Math.max(RUN_PAGE, rl.nextOffset || 0);
  if (mode === 'reset' && rl.upTo) opts.upTo = rl.upTo;
  if (mode === 'more') rl.moreError = null;
  try {
    const res = await fetchPage(opts);
    if (seq !== rl.seq) return null;
    const got = res.runs || [];
    if (mode === 'more') {
      const have = new Set((rl.runs || []).map((r) => r.runId));
      rl.runs = [...(rl.runs || []), ...got.filter((r) => !have.has(r.runId))];
    } else rl.runs = got;
    rl.counts = res.counts || null;
    rl.hiddenSim = res.hiddenSim || 0;
    rl.hasMore = !!res.hasMore;
    rl.nextOffset = res.nextOffset || 0;
    rl.error = null;
    return res;
  } catch (e) {
    if (seq !== rl.seq) return null;
    if (mode === 'more') rl.moreError = errMsg(e);
    else rl.error = errMsg(e);
    return null;
  }
}

// Run list shared by Projects > Project and Workflows > Runs. `rl` is the list state
// ({ runs, error, filter, showSim, q, expanded, msgs, counts, hiddenSim, hasMore, arts, id? }), `id`
// being the project when the list belongs to one; otherwise each run shows its own project.
// reload(): the first page again (filters changed); loadMore(): the next page.
function renderRunList(rl, { prefix, box: boxSel, empty, start, rerender, reload, loadMore }) {
  $(`#${prefix}-show-sim`).checked = rl.showSim;
  const search = $(`#${prefix}-run-search`);
  if (search && document.activeElement !== search) search.value = rl.q || '';
  $(`#${prefix}-runs-error`).textContent = rl.error ? `Could not load runs: ${rl.error}` : '';

  const filters = $(`#${prefix}-run-filters`);
  filters.innerHTML = RUN_FILTERS.map(([id, label]) =>
    `<button type="button" class="chip ${rl.filter === id ? 'active' : ''}" data-filter="${id}" ${id === 'failed' ? 'title="Failed, cancelled or interrupted"' : ''}>${label} <span class="muted">${rl.counts ? rl.counts[id] ?? 0 : ''}</span></button>`).join('');
  filters.querySelectorAll('[data-filter]').forEach((b) => (b.onclick = () => { rl.filter = b.dataset.filter; rerender(); reload(); }));

  const box = $(boxSel);
  // a run's title being edited stays until it is saved or cancelled (which renders again)
  if (box.contains(document.activeElement) && document.activeElement.classList.contains('run-title-input')) return;
  rl.observer?.disconnect();
  if (rl.runs == null) {
    box.innerHTML = rl.error ? '' : '<p class="muted">Loading…</p>';
    return;
  }
  const hiddenSim = rl.hiddenSim || 0;
  const simNote = hiddenSim ? `<p class="muted small">${hiddenSim} simulated run${hiddenSim > 1 ? 's' : ''} hidden.</p>` : '';
  if (!rl.runs.length && !rl.counts?.all && !rl.q) {
    box.innerHTML = `<div class="empty-state"><b>${esc(empty)}</b>${simNote}<button class="btn primary" data-empty-start>Start workflow</button></div>`;
    box.querySelector('[data-empty-start]').onclick = start;
    return;
  }
  const runs = rl.runs;
  // the open rows' artifacts load (again when their count changed) before the rows are drawn
  for (const r of runs) if (rl.expanded.has(r.runId)) ensureRunArtifacts(rl, r, rerender);
  const more = !rl.hasMore ? '' : rl.moreError
    ? `<div class="pr-more" data-more><span class="error small">Could not load more runs: ${esc(rl.moreError)}</span> <button type="button" class="btn sm ghost" data-more-retry>Retry</button></div>`
    : '<div class="pr-more muted small" data-more>Loading more…</div>';
  box.innerHTML = (nestChildRuns(runs).map((r) => runListRow(r, rl)).join('') || `<p class="muted pr-none">${rl.q ? 'No runs match this search.' : 'No runs match this filter.'}</p>`) + more + simNote;
  askPrStates(runs);

  // infinite scroll: the next page when the "Loading more…" row comes near the screen
  const sentinel = box.querySelector('[data-more]');
  if (sentinel && !rl.moreError && typeof IntersectionObserver === 'function') {
    rl.observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) loadMore(); }, { rootMargin: '300px' });
    rl.observer.observe(sentinel);
  }
  box.querySelector('[data-more-retry]')?.addEventListener('click', () => { rl.moreError = null; rerender(); loadMore(); });

  box.querySelectorAll('.pr-row').forEach((row) => (row.onclick = () => {
    const id = row.closest('.pr-run').dataset.run;
    rl.expanded.has(id) ? rl.expanded.delete(id) : rl.expanded.add(id);
    rerender();
  }));
  box.querySelectorAll('[data-art-more]').forEach((b) => (b.onclick = () => {
    const e = rl.arts?.get(b.closest('.pr-run').dataset.run);
    if (e) e.shown += ART_PAGE;
    rerender();
  }));
  box.querySelectorAll('[data-art-retry]').forEach((b) => (b.onclick = () => {
    rl.arts?.delete(b.closest('.pr-run').dataset.run);
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
    if (b.dataset.runAct === 'analytics') window.openAnalytics?.({ tab: 'run', runId: r.runId });
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

// Child runs of a `type: workflow` step (#174) right under their parent (by item, then start), marked
// `nested`; a child whose parent is not in the list stays where it is.
function nestChildRuns(list) {
  const ids = new Set(list.map((r) => r.runId));
  const under = new Map();
  for (const r of list) {
    const p = r.parentRun?.run_id;
    if (p && p !== r.runId && ids.has(p)) (under.get(p) || under.set(p, []).get(p)).push(r);
  }
  const order = (a, b) => (a.parentRun.index ?? 0) - (b.parentRun.index ?? 0) || String(a.startedAt).localeCompare(String(b.startedAt));
  const out = [];
  const add = (r, depth) => {
    out.push(depth ? { ...r, nested: depth } : r);
    if (depth < 3) (under.get(r.runId) || []).sort(order).forEach((c) => add(c, depth + 1));
  };
  list.filter((r) => !(r.parentRun?.run_id && ids.has(r.parentRun.run_id) && r.parentRun.run_id !== r.runId)).forEach((r) => add(r, 0));
  return out;
}

// The badges of a run linked by a `type: workflow` step (#174): its parent, or how many runs it started.
function childRunBadges(r) {
  const p = r.parentRun;
  const kids = r.childRuns || [];
  const parent = p?.run_id ? ` <span class="badge" title="${esc(`Started by run ${p.run_id}${p.workflow ? ` (${p.workflow})` : ''}, step ${p.step_id || '?'}`)}">child${Number.isInteger(p.index) ? ` · item ${p.index + 1}` : ''}</span>` : '';
  const waiting = kids.filter((c) => c.status === 'running').length;
  const children = kids.length ? ` <span class="badge" title="${esc(kids.map((c) => `${c.run_id}: ${c.status}`).join('\n'))}">${kids.length} child run${kids.length === 1 ? '' : 's'}${waiting ? ` · ${waiting} running` : ''}</span>` : '';
  return parent + children;
}

function runListRow(r, pv) {
  const open = pv.expanded.has(r.runId);
  const task = String(r.task || '').trim();
  const firstLine = task.split('\n')[0];
  const dur = r.status === 'running' && r.startedAt ? Date.now() - Date.parse(r.startedAt) : r.durationMs;
  return `
    <div class="pr-run ${open ? 'open' : ''}${r.nested ? ' pr-child' : ''}" data-run="${esc(r.runId)}"${r.nested ? ` style="--nest:${r.nested}"` : ''}>
      <div class="pr-row" title="${open ? 'Hide' : 'Show'} sessions">
        <span class="pill pill-${esc(r.status)}">${esc(r.status)}</span>
        <div class="pr-main">
          <div><b>${runTitleHtml(r)}</b> ${prBadge(r)} <span class="muted small" title="workflow">${esc(r.workflow || r.file || 'workflow')}${r.version ? ` v${esc(r.version)}` : ''}</span>${r.mock ? ' <span class="badge p-mock">simulated</span>' : ''}${r.current ? ' <span class="badge live">this window</span>' : ''}${r.runningElsewhere ? ' <span class="badge" title="Another app process on this workspace runs it: stop or resume it there">another window</span>' : ''}${r.retryOf ? ` <span class="badge" title="Started by a retry of the same roadmap item: the two runs do the same work">retry of ${esc(String(r.retryOf).slice(9))}</span>` : ''}${issueFallbackBadge(r)}${r.chain && window.ChainModel ? ` ${ChainModel.chainBadgesHtml(r.chain)}` : ''}${childRunBadges(r)}${!pv.id && r.project ? ` <span class="badge" title="project">${esc(r.project.name)}</span>` : ''}</div>
          <div class="muted small pr-task" title="${esc(task)}">${esc(firstLine || 'No task')}</div>
        </div>
        <span class="pr-meta"><label>started</label>${r.startedAt ? esc(dateOf(r.startedAt)) : '—'}</span>
        <span class="pr-meta"><label>duration</label>${fmtDur(dur)}</span>
        <span class="pr-meta"><label>tokens</label>${fmtTok(r.tokens?.total)}</span>
        <span class="pr-meta"><label>cost</label>${fmtUsd(r.costUsd)}${r.childrenCostUsd ? ` <span class="muted small" title="What its child runs cost (their own children included), not in its cost">+ ${fmtUsd(r.childrenCostUsd)} child runs</span>` : ''}</span>
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
      <button class="btn sm ghost" data-run-act="analytics" title="Its timeline, cost and tokens per agent, compared with its workflow's runs (Analytics › Run)">Open in Analytics</button>
      <span class="spacer"></span>
      <span class="muted small mono">${esc(r.runId)}</span>
    </div>
    ${r.error ? `<pre class="pr-error">${esc(r.error)}</pre>` : ''}
    ${runTaskBlock(r)}
    ${runArtifactsBlock(r, pv)}
    ${sessions.length ? `<table class="u-table pr-sessions">
      <thead><tr><th>Agent</th><th>Provider · model</th><th>Status</th><th class="num">Turns</th><th class="num">Tokens</th><th class="num">Cost</th><th></th></tr></thead>
      <tbody>${[...sessions].sort((a, b) => isOrchSession(b) - isOrchSession(a)).map((s) => {
        const m = pv.msgs.get(`${r.runId}:${s.id}`);
        return `<tr data-session="${esc(s.id)}" data-agent="${esc(s.agent)}" data-testid="run-session-card">
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

// An open row's artifacts (#200): loaded once (artifacts:list { runId }), again when the row's count
// changes; the entry { status: loading | ok | error, files, error, count, shown } lives in rl.arts.
function ensureRunArtifacts(rl, r, rerender) {
  if (!r.artifactCount) return;
  const arts = rl.arts || (rl.arts = new Map());
  const cur = arts.get(r.runId);
  if (cur && (cur.pending || cur.status === 'error' || cur.count === r.artifactCount)) return;
  // a reload keeps showing the files it has until the new list arrives
  const entry = { status: cur?.status === 'ok' ? 'ok' : 'loading', files: cur?.files || null, error: null, count: r.artifactCount, shown: cur?.shown || ART_PAGE, pending: true };
  arts.set(r.runId, entry);
  api.listArtifacts({ runId: r.runId })
    .then(([x] = []) => { entry.files = x?.artifacts || []; entry.status = 'ok'; }, (e) => { entry.status = 'error'; entry.error = errMsg(e); })
    .finally(() => { entry.pending = false; if (arts.get(r.runId) === entry) rerender(); });
}

// Artifacts by the step that saved them (in their order), then the run folder's other files and the
// project copies: [[label, files]].
function groupArtifacts(files) {
  const groups = new Map();
  for (const f of files) {
    const label = f.step || (f.location === 'external' ? 'Project copies' : 'Other files');
    (groups.get(label) || groups.set(label, []).get(label)).push(f);
  }
  const last = ['Other files', 'Project copies'];
  return [...groups].sort((a, b) => last.indexOf(a[0]) - last.indexOf(b[0]));
}

function runArtifactsBlock(r, pv) {
  if (!r.artifactCount) return '';
  const e = pv.arts?.get(r.runId);
  const head = `<div class="pr-arts-head">Artifacts <span class="muted">${r.artifactCount}</span>${r.imageCount ? ` <span class="badge" title="Images, e.g. the evidence step's screenshots">${r.imageCount} image${r.imageCount === 1 ? '' : 's'}</span>` : ''}</div>`;
  if (!e || e.status === 'loading') return `<div class="pr-arts">${head}<p class="muted small">Loading…</p></div>`;
  if (e.status === 'error') return `<div class="pr-arts">${head}<p class="error small">Could not load the artifacts: ${esc(e.error)} <button type="button" class="btn sm ghost" data-art-retry>Retry</button></p></div>`;
  const shown = e.files.slice(0, e.shown);
  const left = e.files.length - shown.length;
  return `<div class="pr-arts">${head}
    ${groupArtifacts(shown).map(([label, files]) => `<div class="pr-arts-group">
      <div class="pr-arts-step muted small"><span class="${label === 'Other files' || label === 'Project copies' ? '' : 'mono'}">${esc(label)}</span> <span>${files.length}</span></div>
      <div class="pr-arts-list">${files.map((a) => `
        <button class="pr-art ${a.exists ? '' : 'missing'}" data-art="${esc(a.path)}" title="${esc(a.path)}">
          ${artKindIcon(a.kind)}<span class="pr-art-name">${esc(a.name)}</span>
          ${a.location === 'external' ? '<span class="badge">project copy</span>' : ''}${a.exists ? '' : '<span class="muted small">deleted</span>'}
          <span class="muted small">${esc(fmtSize(a.size))}</span>
        </button>`).join('')}</div>
    </div>`).join('')}
    ${left > 0 ? `<button type="button" class="btn sm ghost pr-arts-more" data-art-more>Show ${Math.min(left, ART_PAGE)} more${left > ART_PAGE ? ` <span class="muted">(${left} left)</span>` : ''}</button>` : ''}
  </div>`;
}

// A run event updates that run's row (#200): the row again from the service (runs:list { ids }), at
// most once a second per run, in whichever list has it loaded; the full reloads are throttled apart.
const rowTimers = new Map();
function refreshRunRow(runId) {
  if (!runId || rowTimers.has(runId)) return;
  if (![state.wr, state.pv].some((rl) => rl?.runs?.some((r) => r.runId === runId))) return;
  rowTimers.set(runId, setTimeout(async () => {
    rowTimers.delete(runId);
    let item = null;
    try { [item = null] = (await api.listRuns({ ids: [runId] })).runs || []; } catch { return; }
    if (!item) return;
    for (const rl of [state.wr, state.pv]) {
      const i = rl?.runs ? rl.runs.findIndex((r) => r.runId === runId) : -1;
      if (i >= 0) rl.runs[i] = item;
    }
    noteRunMeta([item]);
    renderRunListsSoon();
  }, 1000));
}

// A session's tokens (sessionView: input + output + cache read + cache write, as on the Usage
// screen): the compact total, the exact breakdown on hover; — when the session has none (the engine).
const TOKEN_PARTS = [['input', 'Input'], ['output', 'Output'], ['cache_read', 'Cache read'], ['cache_write', 'Cache write'], ['reasoning', 'Reasoning (counted in output)']];
function tokensCell(t) {
  if (!t?.total) return '<td class="num mono muted">—</td>';
  const tip = TOKEN_PARTS.map(([k, label]) => `${label}: ${fmtNum(t[k])}`).join('\n');
  return `<td class="num mono" title="${esc(tip)}">${fmtTok(t.total)}</td>`;
}
// #233: a cost that includes an estimate (attempts stopped before their result, priced from their
// model calls), or that misses a stopped attempt of a run recorded before costs were estimated.
// The one badge pair for it: the run lists, the Run screen (views/run/run.js) and Analytics' Run tab.
function costMarks(estimatedUsd, notRecorded) {
  return `${estimatedUsd > 0 ? ` <span class="badge" title="${esc(`${fmtUsd(estimatedUsd)} of it estimated from the model calls of attempts stopped before their result`)}">estimated</span>` : ''}${notRecorded ? ' <span class="badge warn" title="An attempt stopped before its result: its cost was not recorded">cost not recorded</span>' : ''}`;
}
// Tokens with no cost: a model with no price (Codex, unpriced models), not a free session.
function sessionCostCell(s) {
  if (!s.costUsd && s.tokens?.total && s.provider !== 'mock' && !s.costNotRecorded) return '<td class="num mono muted" title="No price for this model: see Usage › Prices">—</td>';
  return `<td class="num mono">${fmtUsd(s.costUsd)}${costMarks(s.costEstimatedUsd, s.costNotRecorded)}</td>`;
}
function sessionsTotalRow(sessions) {
  const sum = (f) => sessions.reduce((a, s) => a + (f(s) || 0), 0);
  const tokens = Object.fromEntries([...TOKEN_PARTS.map(([k]) => [k, sum((s) => s.tokens?.[k])]), ['total', sum((s) => s.tokens?.total)]]);
  return `<tfoot><tr class="pr-total"><td colspan="3">Total</td><td class="num mono">${fmtNum(sum((s) => s.turns))}</td>
    ${tokensCell(tokens)}<td class="num mono" data-testid="run-total-cost">${fmtUsd(sum((s) => s.costUsd))}${costMarks(sum((s) => s.costEstimatedUsd), sessions.some((s) => s.costNotRecorded))}</td><td></td></tr></tfoot>`;
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

// Robot SVGs are large: one per provider/model/colour/state, reused. A workflow agent with a look
// saved in Agents (`workflow` + `agent`) gets its own entry, dropped when a look changes. Without a
// saved look the provider's robot is painted in the agent's colour (#227, agent-colors.js): the
// progress strip, the roadmap and the workflows list draw the same robot.
const avatarCache = new Map();
document.addEventListener('robots:changed', (e) => { if (e.detail?.name === 'workflow-agents') avatarCache.clear(); });
function robotAvatar(provider, model, st, workflow, agent) {
  const look = window.AgentLooks?.forWorkflow(workflow, agent);
  const color = !look && agent && window.AgentColors ? AgentColors.hexFor(agent, AgentColors.defIn(state.workflows, workflow, agent)) : '';
  const key = look ? `look|${workflow}/${agent}|${st}` : `${provider}|${model}|${color}|${st}`;
  if (!avatarCache.has(key)) {
    const variant = look || (window.Robots ? Robots.variantFor(window.RunChatModel?.providerType(provider, model) || provider, model || '') : null);
    avatarCache.set(key, variant ? Robots.svg(variant, st, { bubble: false, plaque: '', ...(color ? { color } : {}) }) : '');
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
  // the agent's fixed colour (#224): its robot is painted in it (#227), the engine's gear is drawn in it
  const def = !a.human && window.AgentColors ? AgentColors.defIn(state.workflows, workflow, a.agent) : null;
  const color = !a.human && window.AgentColors ? AgentColors.colorFor(a.agent, def) : '';
  const art = a.human ? PERSON_SVG : a.provider ? robotAvatar(a.provider, a.model, st, workflow, a.agent) : ENGINE_SVG;
  // the hover card: the agent's name with its role chip (#227), then the steps, provider, time and cost
  // (#236: the human gate's too; never a native title, which would open over the card)
  const card = a.human
    ? `<span class="rp-card" role="tooltip"><span><b>You (human gate)</b></span><span class="muted">${esc(tip)}</span></span>`
    : `<span class="rp-card" role="tooltip"><span><b>${esc(agentLabel(a.agent, names))}</b>${window.AgentColors ? AgentColors.roleChip(a.agent, def) : ''}</span><span class="muted">${esc(tip)}</span></span>`;
  return `<span class="rp-av${a.human ? ' human' : a.provider ? '' : ' engine'}" data-testid="progress-agent"${color ? ` style="--agent-color:${esc(color)}"` : ''} tabindex="0" aria-label="${esc(tip)}">${art}${card}</span>`;
}

// A small app tooltip (#236) for the strip's "+N" badges: the names it folds, as a card.
const foldCard = (text) => `<span class="rp-card" role="tooltip"><span class="muted">${esc(text)}</span></span>`;

function progressChip(c, names, workflow) {
  const label = {
    done: '✓',
    running: `${c.current}…`,
    waiting: 'waiting for you',
    failed: `✕ ${c.current}`,
    stopped: `stopped at ${c.current}`,
  }[c.status];
  const agents = c.agents.length ? c.agents : [{ agent: 'orchestrator', steps: c.steps.map((e) => e.step), cost: 0, durationMs: 0 }];
  const avs = agents.slice(0, 4).map((a) => progressAvatar(a, c, names, workflow)).join('') + (agents.length > 4 ? (() => {
    const more = `Also: ${agents.slice(4).map((a) => agentLabel(a.agent, names)).join(', ')}`;
    return `<span class="rp-av rp-more" tabindex="0" aria-label="${esc(more)}">+${agents.length - 4}${foldCard(more)}</span>`;
  })() : '');
  return `<div class="rp-chip st-${c.status}${c.status === 'done' ? ' still' : ''}">
    <div class="rp-avs">${avs}</div>
    <div class="rp-name${c.grouped ? '' : ' mono'}">${esc(c.name)}${c.round > 1 ? ` <span class="rp-round">×${c.round}</span>` : ''}</div>
    <div class="rp-state">${esc(label)}</div>
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
  const folded = skipped > 0 ? `Earlier steps: ${chips.slice(0, skipped).map((c) => c.name).join(' › ')}` : '';
  return `<div class="rp-strip">${skipped > 0 ? `<span class="rp-skip" tabindex="0" aria-label="${esc(folded)}">+${skipped}${foldCard(folded)}</span><span class="rp-sep">›</span>` : ''}${chips.slice(Math.max(0, skipped)).map((c) => progressChip(c, r.agentNames || live?.run?.agentNames, r.workflow || live?.run?.workflow)).join('<span class="rp-sep">›</span>')}</div>`;
}

// #236: the app's tooltips stay on screen. The agent card (.rp-card) and the Roadmap's steps popover
// (.rm-steps) are placed in the window as they show (position: fixed, so no scrolling container
// clips them), next to what opened them, moved left or flipped up when there is no room; long lines
// wrap within their max width (style.css). Without this (before the first hover) the CSS places them.
const POP_EDGE = 6;
function placePopover(pop, anchor, { gap = 4, alignRight = false } = {}) {
  if (!pop || !anchor || !pop.getClientRects().length) return;
  const a = anchor.getBoundingClientRect();
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  Object.assign(pop.style, { position: 'fixed', left: '0px', top: '0px', right: 'auto', bottom: 'auto', maxWidth: `${Math.max(120, vw - 2 * POP_EDGE)}px` });
  const r = pop.getBoundingClientRect();
  const left = Math.min(Math.max(POP_EDGE, alignRight ? a.right - r.width : a.left), Math.max(POP_EDGE, vw - r.width - POP_EDGE));
  const below = a.bottom + gap;
  const top = below + r.height <= vh - POP_EDGE || a.top - gap - r.height < POP_EDGE ? below : a.top - gap - r.height;
  pop.style.left = `${left}px`;
  pop.style.top = `${Math.max(POP_EDGE, Math.min(top, vh - r.height - POP_EDGE))}px`;
}
function placeShown(from) {
  const progress = from?.closest?.('.rm-progress');
  const av = from?.closest?.('.rp-av, .rp-skip');
  requestAnimationFrame(() => {
    // the popover first: the card inside it is placed from where the popover now is
    if (progress) placePopover(progress.querySelector(':scope > .rm-steps'), progress, { gap: 6, alignRight: true });
    if (av) placePopover(av.querySelector(':scope > .rp-card'), av);
  });
}
document.addEventListener('mouseover', (e) => placeShown(e.target));
document.addEventListener('focusin', (e) => placeShown(e.target));
// a pinned popover (the ring's click) follows its ring when the page scrolls
document.addEventListener('scroll', () => {
  for (const p of document.querySelectorAll('.rm-progress.open, .rm-progress:hover, .rm-progress:focus-within')) placeShown(p);
}, true);
