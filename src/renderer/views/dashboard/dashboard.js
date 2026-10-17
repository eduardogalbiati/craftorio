// Home (the start screen; view id `dashboard`, the menu's Home, #254), #255: one overview of the flow
// from Inbox to Release for the header's project, with Analytics as its second tab.
// Tabs: Overview (this file) and Analytics (views/analytics/, a view without a menu entry drawn in
// this section: its `panel` sits next to the overview, showView('analytics') opens the tab and
// paintHomeTabs lights it). The Oracle's dock (views/oracle/) stays on the Overview.
// Overview:
// - the last Night watch's morning summary (views/nightwatch/);
// - the flow strip: Inbox → Discovery → Ready → Backlog To do → Running → Merged locally → Released,
//   each stage with its count (HOME_STAGES); a count opens its screen on that stage (the Backlog's
//   board, Workflows › Runs filtered on the runs in progress); a stage whose screen is not registered
//   yet (the Discovery board, #261) is left out;
// - "What needs you": the gates waiting (their age, and the gate's phone page link while Phone gates
//   is on, #226), the discovery cards whose thread ends with a question (the Inbox opens the card to
//   answer it), the runs paused after their current turn (#368, Open run: its Resume) and the
//   roadmap's failed items, each with one button;
// - "Today": the real cost of the day and of the last night (the Night watch's window), the runs
//   finished and failed, the 24/7 occupancy (#188) and the roadmap's next stage;
// - a new workspace (no project, no run): how to start.
// Registers itself with registerView (view-registry.js); uses viewRegistry and the globals of app.js and
// the shared pieces ($, esc, state, dateOf, pendingGates, openGateOf, showRun, showView, openDrawer,
// openProjectModal, issueRefs, displayName, fmtUsd, usageBusy).
// renderDashboard is also called by app.js (init, and renderHeader on run events): it paints from
// what was read last (nothing is redrawn while it reads the same) and reads again at most every
// HOME_REFRESH_MS (at once when Home opens or the header's project changes; every HOME_REFRESH_MS
// while Home stays open).

const HOME_REFRESH_MS = 30e3;
// the newest runs read for "Today" (the day's and the last night's are among them)
const HOME_RUNS = 60;
// The flow's stages in order: `view` is the screen a count opens (no such screen: the stage is hidden).
const HOME_STAGES = [
  { id: 'inbox', label: 'Inbox', view: 'inbox', hint: 'Ideas captured, not triaged yet' },
  { id: 'discovery', label: 'Discovery', view: 'discovery', hint: 'Cards in Triage, Shape and Define' },
  { id: 'ready', label: 'Ready', view: 'discovery', hint: 'Cards ready to become issues' },
  { id: 'todo', label: 'Backlog To do', view: 'backlog', hint: 'Open issues nobody works on yet' },
  { id: 'running', label: 'Running', view: 'workflows', hint: 'Runs of this project in progress' },
  { id: 'merged', label: 'Merged locally', view: 'backlog', hint: 'Issues merged into the local base, not pushed yet' },
  { id: 'released', label: 'Released', view: 'releases', hint: 'Releases shipped' },
];
const HOME_FAILED = ['failed', 'cancelled', 'interrupted'];
// the attributes of the overview's buttons (onHomeClick)
const HOME_ACTIONS = ['data-home-run', 'data-home-card', 'data-home-roadmap', 'data-home-act', 'data-stage'];
// asked: the project of the last read started (undefined: none yet); data: what the last read answered
// html: what the overview shows now
// occupancy: the 24/7 summary (#389: undefined until its first answer, null without figures)
const homeView = { seq: 0, at: 0, asked: undefined, data: null, morning: null, html: null, occupancy: undefined };

const homeProject = () => window.CurrentProject?.get() || null;
// the roadmap's items, each with its stage's number (1-based) and name
const homeItems = (d) => (d.backlog?.roadmap?.stages || []).flatMap((s, n) => (s.items || []).map((x) => ({ ...x, stage: n + 1, stageName: s.name || t('dashboard.stage_n', { n: n + 1 }) })));
const homeList = (v) => (Array.isArray(v) ? v : []);
// "40 min", "1 h 30 min", "2 d 3 h": by the minute, so a waiting gate does not redraw the list every second
function homeAge(iso) {
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return min ? `${min} min` : '<1 min';
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

// Reads what the overview shows of the header's project. Every source may be missing (no project, a
// backlog never synced, an app before the channel): its stage then counts 0.
async function loadHome() {
  const projectId = homeProject();
  const seq = ++homeView.seq;
  homeView.at = Date.now();
  homeView.asked = projectId;
  const read = async (fn) => { try { return await fn(); } catch { return null; } };
  // #389: the slow reads never hold the overview back: the 24/7 occupancy paints when it answers
  // (busy until its first answer), "Cost today" when the top bar's usage does (usage-widget.js)
  read(() => api.getOccupancy({ summary: true })).then((o) => {
    if (seq !== homeView.seq) return;
    homeView.occupancy = o || null;
    paintHome();
  });
  const [inbox, cards, waiting, backlog, releases, active, runs] = await Promise.all([
    read(() => projectId && api.listDiscoveryCards(projectId, 'inbox')),
    read(() => projectId && viewRegistry.has('discovery') && api.listDiscoveryCards(projectId)),
    read(() => projectId && api.listDiscoveryWaiting(projectId)),
    read(() => projectId && api.getBacklog(projectId)),
    read(() => projectId && api.listReleases(projectId)),
    read(() => api.listActiveRuns()),
    // simulated runs count only where nothing else can run (simulation-only mode)
    read(() => api.listRuns({ limit: HOME_RUNS, showSim: !!state.simulationOnly })),
  ]);
  if (seq !== homeView.seq) return; // a newer read (the project changed) answers instead
  homeView.data = {
    projectId, backlog: backlog || null, releases: releases || null,
    inbox: homeList(inbox), cards: homeList(cards), waiting: homeList(waiting), active: homeList(active), runs: homeList(runs?.runs || runs),
  };
  paintHome();
}

// The project's runs in progress: this app's, and the roadmap's items running in another app.
function homeRunning(d) {
  const ids = new Set(d.active.filter((r) => (r.projectId || r.project_id) === d.projectId).map((r) => r.runId));
  for (const x of homeItems(d)) if (x.status === 'running' && x.runId) ids.add(x.runId);
  return ids;
}

function homeCounts(d) {
  // the board's columns: no epic (#253), no archived issue (#238)
  const onBoard = (i) => !i.isEpic && window.BacklogArchive?.issueState(i) !== 'archived';
  const column = (id) => homeList(d.backlog?.issues).filter((i) => onBoard(i) && (i.column || (i.state === 'closed' ? 'done' : 'todo')) === id);
  const cards = (columns) => d.cards.filter((c) => columns.includes(c.column)).length;
  // merged locally: the board's column, and the issues of the commits not pushed yet (a simulated
  // run never moves a card, its local merge still waits for a push)
  const merged = new Set([...column('local').map((i) => i.number), ...homeList(d.backlog?.local?.issues)]);
  return {
    inbox: d.inbox.length,
    discovery: cards(['triage', 'shape', 'define']),
    ready: cards(['ready']),
    todo: column('todo').length,
    running: homeRunning(d).size,
    merged: merged.size,
    released: homeList(d.releases?.releases).length,
  };
}

// "#21 Refund a failed payment" (+ how many more), else the item's workflow
function homeItemTitle(x) {
  const issues = homeList(x.issues);
  if (!issues.length) return x.workflow || 'Roadmap item';
  return `#${issues[0].number}${issues[0].title ? ` ${issues[0].title}` : ''}${issues.length > 1 ? ` +${issues.length - 1} more` : ''}`;
}

// What waits for the owner: { kind: gate | card | failed-item, title, detail, since?, runId?, cardId?, stage?, phoneUrl? }.
function homeNeeds(d) {
  const name = (id, names) => (typeof displayName === 'function' ? displayName(id, names) : id);
  // the gates of this app's runs, whatever their project
  const gates = pendingGates().map((g) => {
    const r = state.runs.get(g.run_id)?.run;
    return {
      kind: 'gate', runId: g.run_id, since: g.requested_at || g.ts || null, phoneUrl: g.phoneUrl || null,
      title: [r?.workflow ? name(r.workflow) : 'workflow', r?.project, issueRefs(r)].filter(Boolean).join(' · '),
      detail: g.message || `step ${name(g.step_id, r?.stepNames)}`,
    };
  });
  const mine = new Set(gates.map((g) => g.runId));
  const items = homeItems(d);
  // the roadmap's runs waiting at a gate in another app: opened there, shown here
  const elsewhere = items.filter((x) => x.status === 'running' && x.waiting && x.runId && !mine.has(x.runId)).map((x) => ({
    kind: 'gate', runId: x.runId, since: x.run?.progress?.at(-1)?.ts || x.run?.startedAt || null, phoneUrl: null,
    title: homeItemTitle(x), detail: x.run?.gate || t('dashboard.roadmap_stagename', { stageName: x.stageName }),
  }));
  const failed = items.filter((x) => x.status === 'failed').map((x) => ({
    kind: 'failed-item', stage: x.stage, title: homeItemTitle(x), detail: x.error || t('dashboard.roadmap_stagename', { stageName: x.stageName }),
  }));
  // #368: the runs paused after their current turn wait for the owner's Resume (nothing else resumes them)
  const paused = d.runs.filter((r) => r.status === 'paused').map((r) => ({
    kind: 'paused-run', runId: r.runId, since: r.finishedAt || null,
    title: r.title || (r.workflow ? name(r.workflow) : r.runId), detail: t('dashboard.paused_after_its_current_turn_resume'),
  }));
  // the discovery cards whose thread ends with a question (e.g. a grill-me question); a card that left
  // the Inbox needs the Discovery board (#261) to be answered
  const questions = d.waiting.filter((c) => viewRegistry.has(c.column === 'inbox' ? 'inbox' : 'discovery')).map((c) => ({
    kind: 'card', cardId: c.id, since: c.question?.ts || null,
    title: c.title || t('dashboard.discovery_card'), detail: [c.question?.author, c.question?.text].filter(Boolean).join(': '),
  }));
  return [...gates, ...elsewhere, ...questions, ...paused, ...failed];
}

const HOME_NEED_BADGES = {
  gate: `<span class="badge warn">${t('dashboard.gate')}</span>`,
  card: `<span class="badge warn">${t('dashboard.question')}</span>`,
  'failed-item': `<span class="pill pill-failed">${t('dashboard.failed')}</span>`,
  'paused-run': StatusPill.statusPill('paused'),
};
// the one button of a "What needs you" row
function homeNeedButton(n) {
  if (n.kind === 'gate' || n.kind === 'paused-run') return `<button type="button" class="btn sm primary" data-home-run="${esc(n.runId)}">${t('dashboard.open_run')}</button>`;
  if (n.kind === 'card') return `<button type="button" class="btn sm primary" data-home-card="${esc(n.cardId)}">${t('dashboard.answer')}</button>`;
  return `<button type="button" class="btn sm" data-home-roadmap="${n.stage}">${t('dashboard.open_roadmap')}</button>`;
}

function homeStripHtml(d) {
  const counts = homeCounts(d);
  const project = state.projects.find((p) => p.id === d.projectId);
  const stages = HOME_STAGES.filter((s) => viewRegistry.has(s.view)).map((s) => ({ ...s, label: t(`dashboard.stage_${s.id}`), hint: t(`dashboard.stage_${s.id}_hint`) })).map((s) => `<div class="home-stage" data-testid="home-flow-stage" data-stage="${s.id}" title="${esc(`${s.label}: ${s.hint}`)}">
      <button type="button" class="home-count" data-testid="home-flow-count" data-stage="${s.id}" aria-label="${esc(t('dashboard.label_value_open_it', { label: s.label, value: counts[s.id] }))}">${counts[s.id]}</button>
      <span class="home-stage-label">${esc(s.label)}</span>
    </div>`);
  return `<section class="home-block" aria-label="${t('dashboard.flow')}">
    <h2 class="home-title">${t('dashboard.flow')}${project ? ` <span class="muted" title="${t('dashboard.the_header_s_project')}">· ${esc(project.name)}</span>` : ''}</h2>
    <div class="card home-strip" data-testid="home-flow-strip" role="group" aria-label="${t('dashboard.flow_from_inbox_to_release')}">${stages.join('<span class="home-arrow" aria-hidden="true">→</span>')}</div>
  </section>`;
}

function homeNeedsHtml(d) {
  const needs = homeNeeds(d);
  const rows = needs.map((n) => {
    const age = n.since && Date.parse(n.since) ? `<span class="muted small home-need-age" title="${t('dashboard.asked_since', { since: esc(dateOf(n.since)) })}">${t('dashboard.waiting')} ${esc(homeAge(n.since))}</span>` : '';
    const phone = n.phoneUrl ? `<a class="small home-need-phone" href="${esc(n.phoneUrl)}" target="_blank" rel="noopener" title="${t('dashboard.this_gate_s_page_for_a')}">${t('dashboard.phone_link')}</a>` : '';
    return `<div class="home-need" data-testid="home-needs-item" data-kind="${n.kind}">
      ${HOME_NEED_BADGES[n.kind]}
      <span class="home-need-text"><b title="${esc(n.title)}">${esc(n.title)}</b><span class="muted small" title="${esc(n.detail)}">${esc(n.detail)}</span></span>
      ${age}${phone}
      ${homeNeedButton(n)}
    </div>`;
  });
  return `<section class="home-block" data-testid="home-needs-you" aria-label="${t('dashboard.what_needs_you')}">
    <h2 class="home-title">${t('dashboard.what_needs_you')}${needs.length ? ` <span class="badge warn">${needs.length}</span>` : ''}</h2>
    <div class="card home-needs">${rows.join('') || `<p class="muted small home-none">${t('dashboard.nothing_waits_for_you')}</p>`}</div>
  </section>`;
}

function homeTodayHtml(d) {
  const start = TimeZone.startOfDay(Date.now(), TimeZone.current()); // #273: the owner's local today
  const today = (iso) => Date.parse(iso) >= start;
  const finished = d.runs.filter((r) => r.status === 'success' && today(r.finishedAt)).length;
  const failed = d.runs.filter((r) => HOME_FAILED.includes(r.status) && today(r.finishedAt || r.startedAt)).length;
  const sp = state.usage?.spending;
  const usd = (p) => (p ? `${p.estimated ? '≈ ' : ''}${fmtUsd(p.spentUsd)}` : '—');
  // the night: tonight's while the Night watch is on, else the real runs started in the last one's window
  const w = homeView.morning?.window;
  const inNight = (r) => !r.mock && Date.parse(r.startedAt) >= Date.parse(w.from) && Date.parse(r.startedAt) <= Date.parse(w.to);
  const night = sp?.night ? [t('dashboard.cost_tonight'), usd(sp.night), t('dashboard.spent_by_real_runs_since_the_night')]
    : w ? [t('dashboard.cost_last_night'), fmtUsd(d.runs.filter(inNight).reduce((a, r) => a + (Number(r.costUsd) || 0), 0)), t('dashboard.cost_of_the_real_runs_started_during')]
      : [t('dashboard.cost_last_night'), '—', t('dashboard.no_night_watch_ended_recently')];
  // undefined: not answered yet (#389: shown as loading), null: no figures
  const o = homeView.occupancy;
  const occupancyBusy = o === undefined;
  const occupancy = occupancyBusy ? '…' : o && !o.empty ? `${Math.round((Number(o.occupancy) || 0) * 100)}%` : '—';
  const occupancyTitle = occupancyBusy ? t('occupancy_chip.reading_the_last_24_h') : o && !o.empty ? window.OccupancyChip?.chipModel(o).tooltip || '' : t('occupancy_chip.no_runs_yet_start_one_to');
  const costBusy = usageBusy();
  const stages = d.backlog?.roadmap?.stages || [];
  const next = RoadmapModel.currentStage({ stages });
  const nextName = next < 0 ? '' : stages[next].name || t('dashboard.stage_n', { n: next + 1 });
  // `attrs`: a test id and, while its figure loads, aria-busy
  const stat = (label, value, title, attrs = '') => `<div class="u-stat" title="${esc(title)}"${attrs}><label>${esc(label)}</label><b>${value}</b></div>`;
  const busy = (on) => (on ? ' aria-busy="true"' : '');
  return `<section class="home-block" data-testid="home-today" aria-label="${t('dashboard.today')}">
    <h2 class="home-title">${t('dashboard.today')}</h2>
    <div class="home-stats">
      ${stat(t('dashboard.cost_today'), esc(costBusy ? '…' : usd(sp?.day)), costBusy ? t('dashboard.reading_the_usage') : t('dashboard.spent_today_by_real_runs_live'), ` data-testid="home-cost-today"${busy(costBusy)}`)}
      ${stat(night[0], esc(night[1]), night[2])}
      ${stat(t('dashboard.runs_finished'), finished, t('dashboard.runs_that_succeeded_today'))}
      ${stat(t('dashboard.runs_failed'), failed, t('dashboard.runs_that_failed_were_cancelled_or'))}
      ${stat(t('dashboard.n24_7_occupancy'), occupancy, occupancyTitle, ` data-testid="home-occupancy"${busy(occupancyBusy)}`)}
      ${stat(t('dashboard.next_roadmap_stage'), nextName ? `<button type="button" class="link-btn home-next" data-home-roadmap="${next + 1}" title="${esc(t('dashboard.stage_value_of_length_nextname_open', { value: next + 1, length: stages.length, nextName }))}">${esc(nextName)}</button>` : '—', nextName ? t('dashboard.the_first_stage_with_work_left') : t('dashboard.no_roadmap_stage_with_work_left'))}
    </div>
  </section>`;
}

const HOME_EMPTY_HTML = `<div class="empty-state home-empty" data-testid="home-empty">
    <b>${t('dashboard.welcome_three_steps_to_your_first')}</b>
    <p class="muted">${t('dashboard.home_shows_the_flow_from_an')}</p>
    <div class="home-steps">
      <div class="home-step"><b>${t('dashboard.n1_create_a_project')}</b><span class="muted small">${t('dashboard.the_repository_or_folder_the_agents')}</span>
        <button type="button" class="btn primary" data-testid="home-empty-create-project" data-home-act="project">${t('dashboard.create_a_project')}</button></div>
      <div class="home-step"><b>${t('dashboard.n2_capture_a_first_idea')}</b><span class="muted small">${t('dashboard.a_line_in_the_inbox_is')}</span>
        <button type="button" class="btn" data-testid="home-empty-capture-idea" data-home-act="idea">${t('dashboard.capture_an_idea')}</button></div>
      <div class="home-step"><b>${t('dashboard.n3_run_a_workflow')}</b><span class="muted small">${t('dashboard.pick_a_workflow_and_a_task')}</span>
        <button type="button" class="btn" data-testid="home-empty-run-workflow" data-home-act="run">${t('dashboard.run_a_workflow')}</button></div>
    </div>
  </div>`;

// The overview from what was read last (the gates are the window's own: always current).
function paintHome() {
  const d = homeView.data;
  const body = $('#home-body');
  const fresh = d && !state.projects.length && !state.runs.size && !d.runs.length;
  const html = !d ? `<p class="muted small home-none">${t('dashboard.loading')}</p>` : fresh ? HOME_EMPTY_HTML : homeStripHtml(d) + homeNeedsHtml(d) + homeTodayHtml(d);
  if (html === homeView.html) return;
  homeView.html = html;
  // the button in focus keeps it across the redraw
  const at = document.activeElement?.closest?.('#home-body') ? document.activeElement : null;
  const mark = at && HOME_ACTIONS.map((a) => [a, at.getAttribute(a)]).find(([, v]) => v != null);
  body.innerHTML = html;
  if (mark) [...body.querySelectorAll(`button[${mark[0]}]`)].find((b) => b.getAttribute(mark[0]) === mark[1])?.focus({ preventScroll: true });
}

function renderDashboard() {
  paintHome();
  if (homeView.asked !== homeProject() || Date.now() - homeView.at > HOME_REFRESH_MS) loadHome().catch((e) => console.error('home:', e));
  // the last Night watch's morning summary (#172, views/nightwatch/); its window dates "Cost last night"
  window.NightWatchView?.renderMorning($('#dash-nightwatch'))?.then((m) => {
    if ((m || null) === homeView.morning) return;
    homeView.morning = m || null;
    paintHome();
  }).catch((e) => console.error('home:', e));
}

// The tab of the open view: Analytics on showView('analytics'), the Overview otherwise.
function paintHomeTabs() {
  const analytics = state.view === 'analytics';
  $('#view-dashboard').classList.toggle('home-on-analytics', analytics);
  $('#home-overview').classList.toggle('hidden', analytics);
  $('#view-analytics').classList.toggle('hidden', !analytics);
  document.querySelectorAll('#view-dashboard [data-home-tab]').forEach((b) => {
    const on = (b.dataset.homeTab === 'analytics') === analytics;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
}

// A stage's count opens its screen on that stage.
function openHomeStage(id) {
  const stage = HOME_STAGES.find((s) => s.id === id);
  if (!stage || !viewRegistry.has(stage.view)) return;
  if (stage.view === 'backlog') window.BacklogActions?.showColumns();
  if (stage.view === 'workflows') {
    // the runs in progress of the header's project (the search matches its name), simulated ones included
    state.workflowsTab = 'runs';
    Object.assign(state.wr, { filter: 'running', showSim: true, workflow: '', q: state.projects.find((p) => p.id === homeProject())?.name || '' });
  }
  showView(stage.view);
}

// A waiting card opens where its question is answered: the Inbox with the card open, else the Discovery board.
function openHomeCard(id) {
  const card = homeView.data?.waiting.find((c) => c.id === id);
  return card?.column === 'inbox' ? window.InboxActions?.openCard(id) : showView('discovery');
}

function onHomeClick(e) {
  const tab = e.target.closest('[data-home-tab]');
  if (tab) return showView(tab.dataset.homeTab === 'analytics' ? 'analytics' : 'dashboard');
  const run = e.target.closest('[data-home-run]');
  if (run) return state.runs.has(run.dataset.homeRun) ? openGateOf(run.dataset.homeRun) : showRun(run.dataset.homeRun);
  const card = e.target.closest('[data-home-card]');
  if (card) return openHomeCard(card.dataset.homeCard);
  const roadmap = e.target.closest('[data-home-roadmap]');
  if (roadmap) return window.BacklogActions?.openStage(Number(roadmap.dataset.homeRoadmap));
  const act = e.target.closest('[data-home-act]')?.dataset.homeAct;
  if (act === 'project') return openProjectModal(null, { fromHeader: true });
  if (act === 'idea') return showView('inbox');
  if (act === 'run') return openDrawer();
  const stage = e.target.closest('[data-stage]');
  if (stage) return openHomeStage(stage.dataset.stage);
  return undefined;
}

registerView({
  id: 'dashboard',
  // #254: the menu's first entry, Home
  nav: { label: 'Home', order: 20, icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 11 9-8 9 8" /><path d="M5 9.5V20h14V9.5" /><path d="M10 20v-6h4v6" /></svg>' },
  // the only section shown before any showView: no `hidden`
  markup: () => `
      <section id="view-dashboard" class="view">
        <div class="home-main">
          <div class="tabs page-tabs" role="tablist" aria-label="${t('dashboard.home')}"><button type="button" class="tab active" role="tab" aria-selected="true" data-home-tab="overview" data-testid="home-tab-overview">${t('dashboard.overview')}</button><button type="button" class="tab" role="tab" aria-selected="false" data-home-tab="analytics" data-testid="home-tab-analytics">${t('dashboard.analytics')}</button></div>
          <div id="home-overview" class="home-overview" role="tabpanel">
            <div id="dash-nightwatch" class="home-night hidden"></div>
            <div id="home-body"></div>
          </div>
          ${viewRegistry.get('analytics')?.panel?.() ||'<div id="view-analytics" class="hidden"></div>'}
        </div>
      </section>`,
  mount() {
    $('#view-dashboard').addEventListener('click', onHomeClick);
    // an open Home stays current without run events (a gate waiting in another app, the ages)
    setInterval(() => {
      if (state.view !== 'dashboard' || document.hidden) return;
      homeView.at = 0;
      renderDashboard();
    }, HOME_REFRESH_MS);
    // the start screen's sidebar entry starts highlighted, as showView would
    $('nav.sidebar [data-view="dashboard"]').classList.toggle('active', state.view === 'dashboard');
  },
  show() {
    paintHomeTabs();
    homeView.at = 0; // opened: read again
    renderDashboard();
  },
});
