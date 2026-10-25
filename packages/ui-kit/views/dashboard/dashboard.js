// Home (the start screen; view id `dashboard`, the menu's Home, #254), #255: one overview of the flow
// from Inbox to Release for the header's project, with Analytics as its second tab.
// Tabs: Overview (this file) and Analytics (the analyser front's views/analytics/, a view without a
// menu entry drawn in this section: its `panel` sits next to the overview, showView('analytics')
// opens the tab and paintHomeTabs lights it; without that front the tab is hidden). The Oracle's dock
// (the AI front's views/oracle/) stays on the Overview.
// Home is the shell's, its content the fronts' (phase 3 of docs/reorganisation-study-2026-10.md,
// decision 5): each front registers a card with HomeCards (home-cards.js) as it loads, and Home draws
// what the registered cards give it, so a composition without a front shows none of its parts:
// - the banner above the body: a card's `morning` (the AI front: the last Night watch's summary);
// - the flow strip: the cards' stages in order (the plan front: Inbox, Discovery, Ready; the build
//   front: Backlog To do, Running, Merged locally, Released), each with its count; a count opens its
//   screen on that stage; a stage whose screen is not registered is left out;
// - "What needs you": the shell's rows (the gates waiting, with their age and the gate's phone page
//   link while Phone gates is on, #226; the runs paused after their current turn, #368) and the cards'
//   (the discovery cards whose thread ends with a question, the roadmap's runs waiting elsewhere and
//   its failed items), each with one button;
// - "Today": the shell's stats (the real cost of the day, the runs finished and failed, the 24/7
//   occupancy, #188) and the cards' (the cost of the last night, the roadmap's next stage);
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
const HOME_FAILED = ['failed', 'cancelled', 'interrupted'];
// the attributes of the overview's own buttons (onHomeClick); the cards' are their `actions` keys
const HOME_ACTIONS = ['data-home-run', 'data-home-act', 'data-stage'];
// asked: the project of the last read started (undefined: none yet); data: what the last read answered
// html: what the overview shows now
// occupancy: the 24/7 summary (#389: undefined until its first answer, null without figures)
const homeView = { seq: 0, at: 0, asked: undefined, data: null, html: null, occupancy: undefined };

const homeProject = () => window.CurrentProject?.get() || null;
const homeList = (v) => (Array.isArray(v) ? v : []);
const homeCards = () => (window.HomeCards ? window.HomeCards.list() : []);
// "40 min", "1 h 30 min", "2 d 3 h": by the minute, so a waiting gate does not redraw the list every second
function homeAge(iso) {
  const min = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  if (min < 60) return min ? `${min} min` : '<1 min';
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} h ${String(min % 60).padStart(2, '0')} min` : `${Math.floor(h / 24)} d ${h % 24} h`;
}

// Reads what the overview shows of the header's project: the shell's runs, then each card's own
// data. Every source may be missing (no project, a backlog never synced, an app before the channel):
// its stage then counts 0.
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
  const ctx = { projectId, api, state, list: homeList, read };
  const cards = homeCards();
  const [active, runs, ...own] = await Promise.all([
    read(() => api.listActiveRuns()),
    // simulated runs count only where nothing else can run (simulation-only mode)
    read(() => api.listRuns({ limit: HOME_RUNS, showSim: !!state.simulationOnly })),
    ...cards.map((card) => (card.read ? read(() => card.read(ctx)) : Promise.resolve(null))),
  ]);
  if (seq !== homeView.seq) return; // a newer read (the project changed) answers instead
  const previous = homeView.data?.cards || {};
  homeView.data = {
    projectId, active: homeList(active), runs: homeList(runs?.runs || runs),
    // a card's banner (own.morning) outlives its reads: the banner refreshes on its own clock
    cards: Object.fromEntries(cards.map((card, i) => [card.id, { ...(own[i] || {}), morning: previous[card.id]?.morning ?? null }])),
  };
  paintHome();
}

// A card's own data (an empty object until its first read, so a card's functions never see undefined).
const ownOf = (d, card) => d.cards?.[card.id] || {};

// The flow strip's stages: every card's, those whose screen is registered.
const homeStages = () => (window.HomeCards ? window.HomeCards.stages() : []).filter((s) => viewRegistry.has(s.view));

// What waits for the owner: the shell's rows (the gates of this app's runs, whatever their project;
// the runs paused after their turn) and the cards', by order.
function homeNeeds(d) {
  const name = (id, names) => (typeof displayName === 'function' ? displayName(id, names) : id);
  const gates = pendingGates().map((g) => {
    const r = state.runs.get(g.run_id)?.run;
    return {
      kind: 'gate', order: 10, since: g.requested_at || g.ts || null, phoneUrl: g.phoneUrl || null,
      title: [r?.workflow ? name(r.workflow) : 'workflow', r?.project, issueRefs(r)].filter(Boolean).join(' · '),
      detail: g.message || `step ${name(g.step_id, r?.stepNames)}`,
      button: { label: t('dashboard.open_run'), attr: 'data-home-run', value: g.run_id, primary: true },
    };
  });
  // #368: the runs paused after their current turn wait for the owner's Resume (nothing else resumes them)
  const paused = d.runs.filter((r) => r.status === 'paused').map((r) => ({
    kind: 'paused-run', order: 40, since: r.finishedAt || null,
    title: r.title || (r.workflow ? name(r.workflow) : r.runId), detail: t('dashboard.paused_after_its_current_turn_resume'),
    button: { label: t('dashboard.open_run'), attr: 'data-home-run', value: r.runId, primary: true },
  }));
  // the cards' rows know the gates this app shows (a roadmap run waiting here is not listed twice)
  const shell = { gates: gates.map((g) => g.button.value) };
  const fromCards = homeCards().flatMap((card) => (card.needs ? homeList(card.needs(ownOf(d, card), d, shell)) : []));
  return [...gates, ...paused, ...fromCards].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// the badge of a row's kind; an unknown kind gets a warn badge with the kind as its text
const homeBadge = (kind) => ({
  gate: `<span class="badge warn">${t('dashboard.gate')}</span>`,
  card: `<span class="badge warn">${t('dashboard.question')}</span>`,
  'failed-item': `<span class="pill pill-failed">${t('dashboard.failed')}</span>`,
  'paused-run': StatusPill.statusPill('paused'),
}[kind] || `<span class="badge warn">${esc(kind)}</span>`);
// the one button of a "What needs you" row
const homeNeedButton = (b) => `<button type="button" class="btn sm${b.primary ? ' primary' : ''}" ${esc(b.attr)}="${esc(b.value)}">${esc(b.label)}</button>`;

function homeStripHtml(d) {
  const project = state.projects.find((p) => p.id === d.projectId);
  const stages = homeStages().map((s) => ({ ...s, label: t(`dashboard.stage_${s.id}`), hint: t(`dashboard.stage_${s.id}_hint`), count: Number(s.count?.(ownOf(d, s.card), d)) || 0 }))
    .map((s) => `<div class="home-stage" data-testid="home-flow-stage" data-stage="${s.id}" title="${esc(`${s.label}: ${s.hint}`)}">
      <button type="button" class="home-count" data-testid="home-flow-count" data-stage="${s.id}" aria-label="${esc(t('dashboard.label_value_open_it', { label: s.label, value: s.count }))}">${s.count}</button>
      <span class="home-stage-label">${esc(s.label)}</span>
    </div>`);
  if (!stages.length) return '';
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
    return `<div class="home-need" data-testid="home-needs-item" data-kind="${esc(n.kind)}">
      ${homeBadge(n.kind)}
      <span class="home-need-text"><b title="${esc(n.title)}">${esc(n.title)}</b><span class="muted small" title="${esc(n.detail)}">${esc(n.detail)}</span></span>
      ${age}${phone}
      ${n.button ? homeNeedButton(n.button) : ''}
    </div>`;
  });
  return `<section class="home-block" data-testid="home-needs-you" aria-label="${t('dashboard.what_needs_you')}">
    <h2 class="home-title">${t('dashboard.what_needs_you')}${needs.length ? ` <span class="badge warn">${needs.length}</span>` : ''}</h2>
    <div class="card home-needs">${rows.join('') || `<p class="muted small home-none">${t('dashboard.nothing_waits_for_you')}</p>`}</div>
  </section>`;
}

// "Today": the shell's stats and the cards', by order (the cost first, the roadmap's next stage last).
function homeTodayHtml(d) {
  const start = TimeZone.startOfDay(Date.now(), TimeZone.current()); // #273: the owner's local today
  const today = (iso) => Date.parse(iso) >= start;
  const finished = d.runs.filter((r) => r.status === 'success' && today(r.finishedAt)).length;
  const failed = d.runs.filter((r) => HOME_FAILED.includes(r.status) && today(r.finishedAt || r.startedAt)).length;
  const sp = state.usage?.spending;
  const usd = (p) => (p ? `${p.estimated ? '≈ ' : ''}${fmtUsd(p.spentUsd)}` : '—');
  // undefined: not answered yet (#389: shown as loading), null: no figures
  const o = homeView.occupancy;
  const occupancyBusy = o === undefined;
  const occupancy = occupancyBusy ? '…' : o && !o.empty ? `${Math.round((Number(o.occupancy) || 0) * 100)}%` : '—';
  const occupancyTitle = occupancyBusy ? t('occupancy_chip.reading_the_last_24_h') : o && !o.empty ? window.OccupancyChip?.chipModel(o).tooltip || '' : t('occupancy_chip.no_runs_yet_start_one_to');
  const costBusy = usageBusy();
  const busy = (on) => (on ? ' aria-busy="true"' : '');
  const shell = [
    { order: 10, label: t('dashboard.cost_today'), value: esc(costBusy ? '…' : usd(sp?.day)), title: costBusy ? t('dashboard.reading_the_usage') : t('dashboard.spent_today_by_real_runs_live'), attrs: ` data-testid="home-cost-today"${busy(costBusy)}` },
    { order: 30, label: t('dashboard.runs_finished'), value: finished, title: t('dashboard.runs_that_succeeded_today') },
    { order: 40, label: t('dashboard.runs_failed'), value: failed, title: t('dashboard.runs_that_failed_were_cancelled_or') },
    { order: 50, label: t('dashboard.n24_7_occupancy'), value: occupancy, title: occupancyTitle, attrs: ` data-testid="home-occupancy"${busy(occupancyBusy)}` },
  ];
  const fromCards = homeCards().flatMap((card) => (card.today ? homeList(card.today(ownOf(d, card), d)) : []));
  // `attrs`: a test id and, while its figure loads, aria-busy
  const stat = (s) => `<div class="u-stat" title="${esc(s.title)}"${s.attrs || ''}><label>${esc(s.label)}</label><b>${s.value}</b></div>`;
  return `<section class="home-block" data-testid="home-today" aria-label="${t('dashboard.today')}">
    <h2 class="home-title">${t('dashboard.today')}</h2>
    <div class="home-stats">
      ${[...shell, ...fromCards].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(stat).join('\n      ')}
    </div>
  </section>`;
}

// A new workspace: the three steps; the idea step only where the Inbox is shipped.
const homeEmptyHtml = () => `<div class="empty-state home-empty" data-testid="home-empty">
    <b>${t('dashboard.welcome_three_steps_to_your_first')}</b>
    <p class="muted">${t('dashboard.home_shows_the_flow_from_an')}</p>
    <div class="home-steps">
      <div class="home-step"><b>${t('dashboard.n1_create_a_project')}</b><span class="muted small">${t('dashboard.the_repository_or_folder_the_agents')}</span>
        <button type="button" class="btn primary" data-testid="home-empty-create-project" data-home-act="project">${t('dashboard.create_a_project')}</button></div>
      ${viewRegistry.has('inbox') ? `<div class="home-step"><b>${t('dashboard.n2_capture_a_first_idea')}</b><span class="muted small">${t('dashboard.a_line_in_the_inbox_is')}</span>
        <button type="button" class="btn" data-testid="home-empty-capture-idea" data-home-act="idea">${t('dashboard.capture_an_idea')}</button></div>` : ''}
      <div class="home-step"><b>${t('dashboard.n3_run_a_workflow')}</b><span class="muted small">${t('dashboard.pick_a_workflow_and_a_task')}</span>
        <button type="button" class="btn" data-testid="home-empty-run-workflow" data-home-act="run">${t('dashboard.run_a_workflow')}</button></div>
    </div>
  </div>`;

// the attributes a button of the overview may carry: the shell's and every card's actions
const homeActionAttrs = () => [...HOME_ACTIONS, ...homeCards().flatMap((card) => Object.keys(card.actions || {}))];

// The overview from what was read last (the gates are the window's own: always current).
function paintHome() {
  const d = homeView.data;
  const body = $('#home-body');
  const fresh = d && !state.projects.length && !state.runs.size && !d.runs.length;
  const html = !d ? `<p class="muted small home-none">${t('dashboard.loading')}</p>` : fresh ? homeEmptyHtml() : homeStripHtml(d) + homeNeedsHtml(d) + homeTodayHtml(d);
  if (html === homeView.html) return;
  homeView.html = html;
  // the button in focus keeps it across the redraw
  const at = document.activeElement?.closest?.('#home-body') ? document.activeElement : null;
  const mark = at && homeActionAttrs().map((a) => [a, at.getAttribute(a)]).find(([, v]) => v != null);
  body.innerHTML = html;
  if (mark) [...body.querySelectorAll(`button[${mark[0]}]`)].find((b) => b.getAttribute(mark[0]) === mark[1])?.focus({ preventScroll: true });
}

function renderDashboard() {
  paintHome();
  if (homeView.asked !== homeProject() || Date.now() - homeView.at > HOME_REFRESH_MS) loadHome().catch((e) => console.error('home:', e));
  // the cards' banners (#172, the Night watch's morning summary: its window dates "Cost last night")
  for (const card of homeCards()) {
    if (!card.morning) continue;
    card.morning($('#dash-nightwatch'))?.then((m) => {
      const own = homeView.data && ownOf(homeView.data, card);
      if (!own || (m || null) === own.morning) return;
      own.morning = m || null;
      paintHome();
    }).catch((e) => console.error('home:', e));
  }
}

// The tab of the open view: Analytics on showView('analytics'), the Overview otherwise; without the
// Analytics screen (the analyser front not shipped) the tab is hidden.
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
  $('#view-dashboard [data-home-tab="analytics"]')?.classList.toggle('hidden', !viewRegistry.has('analytics'));
}

// A stage's count opens its screen on that stage (the card's `open`, else the screen).
function openHomeStage(id) {
  const stage = homeStages().find((s) => s.id === id);
  if (!stage) return;
  if (stage.open) stage.open(ownOf(homeView.data || {}, stage.card), homeView.data || {});
  else showView(stage.view);
}

function onHomeClick(e) {
  const tab = e.target.closest('[data-home-tab]');
  if (tab) return showView(tab.dataset.homeTab === 'analytics' ? 'analytics' : 'dashboard');
  const run = e.target.closest('[data-home-run]');
  if (run) return state.runs.has(run.dataset.homeRun) ? openGateOf(run.dataset.homeRun) : showRun(run.dataset.homeRun);
  const act = e.target.closest('[data-home-act]')?.dataset.homeAct;
  if (act === 'project') return openProjectModal(null, { fromHeader: true });
  if (act === 'idea') return viewRegistry.has('inbox') ? showView('inbox') : undefined;
  if (act === 'run') return openDrawer();
  const stage = e.target.closest('[data-stage]');
  if (stage) return openHomeStage(stage.dataset.stage);
  // a card's button: the first card whose actions name the attribute
  for (const card of homeCards()) {
    for (const [attr, fn] of Object.entries(card.actions || {})) {
      const el = e.target.closest(`[${attr}]`);
      if (el) return fn(el.dataset?.[attr.replace(/^data-/, '').replace(/-([a-z])/g, (m, c) => c.toUpperCase())] ?? el.getAttribute(attr), ownOf(homeView.data || {}, card), homeView.data || {});
    }
  }
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
