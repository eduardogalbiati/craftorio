// The Roadmap screen (#106; Code & Build › Roadmap since #254, drawn by backlog.js): a project's ordered stages of runs (src/roadmap.js), each stage started
// when the previous one has finished and merged. Each item leads with its issues' titles (a list,
// one line per issue, linked; #110), then badges: its status (#266, StatusPill: the kanban's run chip
// when it has a run: the readable status, pulsing while it runs, the workflow's name and the run's
// title, a click opens the run; a pill otherwise: Planned, Skipped, "Failed to start" with the error
// when the start was refused before any run), the workflow's short name (while it has no run: the
// chip names the workflow; kept when the workflow pushes, #195), the mode (a one-click toggle
// on planned and failed items, saved at once), the complexity total of its `complexity:n` labels;
// and the Product Owner's reason (#105) under the titles. The other inputs are edited in an
// Edit form built from the workflow's input definitions (api.listWorkflows, loaded once) by
// WorkflowInputs (workflow-inputs.js, #116: human labels, pills, switches, show_if), with Save / Cancel. The plan is edited too:
// stages and items up/down or by drag, an issue dragged from one item to another, items removed, a
// stage renamed or given a note ("add note"). Start (optionally simulated), Pause, Stop, Clear;
// Retry / Skip on a failed item; Run this stage on a stage's head (#141: only its items, then the
// roadmap pauses; out of order after a confirmation). A Product Owner proposal (#105, JSON) is added or replaces the
// roadmap as planned; the plain queue's items can be moved in. Every edit saves the whole list of
// stages (api.saveRoadmap); the service keeps each item's runs by id.
// #279: when Self-healing can apply merged fixes to this app (api.appUpdateState), a card not finished
// has an "Update the app after this" switch (item.updateAfter), saved at once.
// "Group by epic" (#138, shown when the backlog has epics) lists the items under their issues' epics,
// each with its stage and the epic's items done.
// Live roadmap (#164): a box under the last stage with its switch (on only while running: turning it
// on otherwise asks to start the roadmap) and the last refill; `liveBanner` is the banner backlog.js
// shows on top of every view while it is on.
// When it finishes (#134): an item's chain (its run's `then`) is a badge, and the Edit form has the
// ChainPicker (chain-picker.js), mounted by mountChain once backlog.js drew the form.
// Cost (#205, #206): each item shows its estimate ("≈ $X", tooltip: how and from how many runs; "no
// estimate yet" without history), its real cost once it has a run, and the Product Owner's Cost step
// (a badge: the tests, screenshots and grouping it chose); each stage its estimate. A roadmap the
// budget cap paused offers "Raise for today" and "Resume anyway" (api.roadmapBudget).
// Time (#215): the estimated time next to the cost ("≈ 1 h 45 min"; a stage: its longest item); once
// the run ends, "$22.21 / ≈ $15.18" and "3 h 41 min / ≈ 1 h 45 min" coloured by Estimates.verdict
// (estimates.js: green at or under, amber up to +25%, red above, with an arrow), the difference and
// the longest step in the tooltip; while it runs, "58 min of ≈ 1 h 45", amber or red once past it.
// A finished stage shows its real total against its estimate the same way.
// Inputs (#216): the item's inputs as WorkflowInputs.inputPills ("Unit tests: Run existing").
// What it shows (#217, #268): html()'s `view` ({ epic, showAll, since }, remembered by backlog.js). The
// Planned | All switch: Planned (showAll off) is the open work, every item but the done and skipped
// ones, a stage with nothing left hidden; All is every item. The date range (`since`: last 24 hours
// by default … Total) filters by an item's last activity (added, its run's start, its run's end): in
// Planned the open items show whatever their date and the range picks the finished items folded
// under a stage's green "+n done" chip (#267: a click unfolds that stage only, remembered per stage
// id while it has something to fold); in All it filters every item. The header counts "N of M items
// · last 24 hours"; the epic keeps only its items. Stage numbers and edits use the real indexes.
// Pages (#268): about 15 stages (60 items) at a time, from a little before the current stage; a
// "Loading…" row loads the next page when it comes near the screen (mounted), "earlier stages" the
// page above; a change of the view goes back to the first page, a re-read of the file keeps them.
// An item with a run (#194) has a progress ring on the right of its card: the estimated % (RunProgress.
// estimateProgress over the item's `run` from the service: its trail and its workflow's typical step
// times), the current step or group with its agent, the gate / failure / done states; hovering or
// clicking the ring shows the run's steps (the runs list's chips), a chip opens the run at that group.
// The run's summary (estimate, elapsed and time left, now, gate, run id) heads that popover (#236):
// the ring, the step text and the chips carry no native title over the app's popover and cards.
// Under the ring (#272): the run's timer ("23:41", gate waits left out, frozen at the end; tick()
// moves it every second), green within the item's time estimate, amber up to 130% of it, red beyond.
// A run sent back to a step it had done (a fix round) keeps the progress it had earned and says
// "round 2 · fix round after Code review" under the step: the same run, not a new one.
// A refused start (#196: kept work, the item that paused the roadmap, an error without a run) offers
// Retry / Skip like a failed run; the bar's "Show the item" scrolls to the item that paused it.
// Start, Resume and Run this stage list the items whose workflow pushes while the default development
// workflow (#195, DefaultWorkflow) merges locally: switch them to the default, or start anyway.
// Cut lines (#260): "Release here" on a stage's head asks for the release's name (the #cut-line-modal
// dialog of backlog.js) and draws a cut line after the stage (`stage.release`, saved with the stages):
// its name, the state of its release run (in progress, on hold, failed, shipped) with a link to the
// run, Rename and Remove while no run is going. The stages below wait until the release shipped; a
// finished stage hidden by the open-work filter still shows its line while it waits, and so does
// the view grouped by epic (the waiting lines lead it, each with its stage).
// The bar (#269): the roadmap's state is a dot before its title (blue and pulsing while running, amber
// paused, red paused by a failure, grey planned, green done; the readable state in its tooltip and
// aria-label), then the counts, Start / Resume, Pause (amber, with its icon), Stop (red, with its icon,
// after a confirmation) and a ⋮ menu built from MENU (Clear, Restore an earlier version…; the keyboard
// opens it, the arrows move in it, Esc closes it). The filters (the epic, Planned | All, the date range,
// Group by epic) sit on a filter row above the bar. A pause by an item's failure is the page's error
// alert (#270, alerts(): Retry / Skip, Show the item); other pause notes (the budget cap, a stage run
// on its own that ended, a release on hold) stay in the bar.
// Ask the Oracle (#271): a card whose item failed, was interrupted or stopped, or could not start has
// "Ask the Oracle about this failure" beside Retry / Skip (the gate button's code, gate-oracle.js).
// Undo (#281): removing, moving or dragging an item, a stage or an issue, renaming a stage, removing a
// cut line, Clear and Replace show a toast with Undo (app.js showToast's action; api.undoRoadmap puts
// back what the edit changed); "Restore an earlier version…" lists the versions kept before each edit.
// Rendered into #bl-list by backlog.js (mode 'roadmap'), which passes `ctx`
// ({ projectId, setData, render, setError, setShowAll, setSince, setEpic, showRoadmap }). Uses app.js globals (esc, state, errMsg, devMode, confirmDialog,
// fmtDur, agentLabel, scheduleRender, showToast), run-list.js's (progressChip, robotAvatar, PERSON_SVG, ENGINE_SVG),
// choiceDialog (kept-work-dialog.js), RunProgress, StatusPill, DefaultWorkflow and GateOracle.
/* global api */
(() => {
  const ICON = {
    validated: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
    // #269: the bar's Pause and Stop
    pause: '<svg class="icon" data-icon="pause" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><rect x="5" y="4" width="5" height="16" rx="1" fill="currentColor"/><rect x="14" y="4" width="5" height="16" rx="1" fill="currentColor"/></svg>',
    stop: '<svg class="icon" data-icon="stop" viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2" fill="currentColor"/></svg>',
  };
  const COMPLEXITY = /^complexity\s*[:=/-]?\s*(\d+)/i;
  // an item's issues: its `issues` list, or (an item stored before #163) the item itself as one issue
  const refs = (x) => (x.issues?.length ? x.issues : x.number ? [{ number: x.number, url: x.url, title: x.title, body: x.body, knownPullRequests: x.knownPullRequests }] : []);
  const editable = (x) => x.status === 'planned' || x.status === 'failed';
  // #237: the stage run on its own (#141), or -1 when there is none or it is over (no unfinished item,
  // or no longer in the roadmap): such a scope is dropped by the engine, a Resume runs the roadmap
  const scopedStage = (r) => (r.scope ? r.stages.findIndex((s) => s.id === r.scope.stage && s.items.some((x) => x.status !== 'done' && x.status !== 'skipped')) : -1);
  const clone = (stages) => JSON.parse(JSON.stringify(stages || []));
  // inputs the Backlog fills itself when the run starts (as backlog.js's skipInput): never edited here
  const skipInput = (k, def) => k === 'task' || k === 'issue' || k === 'issues' || def.type === 'run' || ((def.type || 'string') === 'string' && /path|dir/i.test(k));

  // The workflows' input definitions (file → workflow), loaded once when the Roadmap is first drawn.
  let workflows = null;
  let loading = false;
  function loadWorkflows(rerender) {
    if (workflows || loading) return;
    loading = true;
    api.listWorkflows()
      .then((list) => { workflows = new Map((list || []).filter((w) => !w.error).map((w) => [w.file, w])); rerender?.(); })
      .catch(() => { workflows = new Map(); })
      .finally(() => { loading = false; });
  }
  const inputDefs = (x) => workflows?.get(x.workflow)?.inputs || {};

  // #279: whether Self-healing can apply merged fixes to this app (api.appUpdateState): the cards
  // offer "Update the app after this" only then. Read when the Roadmap is drawn, at most once a minute.
  let updateApplies = false;
  let updateCheckedAt = 0;
  function loadAppUpdate(rerender) {
    // a main process older than #279 has no such channel: never offered then
    if (Date.now() - updateCheckedAt < 60000 || typeof api.appUpdateState !== 'function') return;
    updateCheckedAt = Date.now();
    Promise.resolve(api.appUpdateState(false))
      .then((s) => { const next = !!s?.applies; if (next !== updateApplies) { updateApplies = next; rerender?.(); } })
      .catch(() => { updateApplies = false; });
  }
  // the switch on a card not finished (saved at once; only planned and failed items can change it)
  function updateAfterHtml(x, locked) {
    if (!updateApplies || ['done', 'skipped'].includes(x.status)) return '';
    return `<label class="rm-update-after small" title="Self-healing updates the app (and restarts it) once this item's run has merged"><input type="checkbox" data-testid="roadmap-update-after" data-rm-update-after aria-label="Update the app after this"${x.updateAfter ? ' checked' : ''}${locked ? ' disabled' : ''} /> Update the app after this</label>`;
  }
  // #195: an item whose workflow pushes (a branch, a PR/MR, CI minutes) while the default merges locally
  function pushesAgainstDefault(x) {
    const def = window.DefaultWorkflow?.current();
    return def?.merge === 'local' && x.workflow !== def.file && workflows?.get(x.workflow)?.merge === 'remote';
  }
  // #196: Retry / Skip on a failed run and on a refused start (the item that paused the roadmap, or an
  // error without a run, e.g. kept work of an ended run), never while its run is alive
  const refusedStart = (x) => !x.runId && !!x.error && x.status !== 'skipped' && x.status !== 'done';
  const retryable = (x, r) => x.status === 'failed' || (x.status !== 'running' && (r?.pausedBy === x.id || refusedStart(x)));
  // #271: "Ask the Oracle about this failure" on an item whose run failed, was interrupted or stopped,
  // or that could not start; never on a planned (no ended run), running, waiting or done one. The
  // button and what it asks are the gate button's code (gate-oracle.js, looked up when drawn).
  const RUN_FAILED = new Set(['failed', 'cancelled', 'interrupted']);
  const askable = (x) => x.status === 'failed' || refusedStart(x) || (x.status === 'planned' && RUN_FAILED.has(x.run?.status));
  const askOracleHtml = (x) => (askable(x) && window.GateOracle?.failureButtonHtml ? window.GateOracle.failureButtonHtml(x, 'data-rm-ask-oracle data-testid="roadmap-ask-oracle"') : '');
  // #269: the bar's ⋮ menu (open or not) and its entries: a new action is a line here, the bar stays
  let menuOpen = false;
  const MENU = [
    { id: 'clear', label: 'Clear', title: 'Remove every stage (asks first; runs in progress go on)', show: (r) => r.stages.length > 0 },
    { id: 'versions', label: 'Restore an earlier version…', title: 'The roadmap as it was before each of your last edits', show: () => true },
  ];
  let editing = null; // the item whose Edit form is open
  let adding = false; // its "add input" name + value pair is shown
  let noteEditing = null; // the stage whose note is being edited
  // #138: the items grouped by their issues' epics instead of by stage (remembered)
  const BY_EPIC_KEY = 'multiagent.roadmapByEpic';
  let byEpic = (() => { try { return localStorage.getItem(BY_EPIC_KEY) === '1'; } catch { return false; } })();

  /** The badges of an issue card: its place in the roadmap ("Roadmap: stage 2") and the release that shipped it (#260, "Released v1.4"). */
  function badge(i) {
    const released = i.released ? `<span class="badge bl-released" data-testid="issue-released" title="${esc(`Shipped with the release ${i.released}`)}">Released ${esc(i.released)}</span>` : '';
    if (!i.roadmap) return released;
    return `<span class="badge bl-roadmap" data-status="${esc(i.roadmap.status)}" title="${esc(`${i.roadmap.name}: ${i.roadmap.status}`)}">Roadmap: stage ${i.roadmap.stage}${i.roadmap.status === 'planned' ? '' : ` · ${esc(StatusPill.statusLabel(i.roadmap.status))}`}</span>${released}`;
  }

  // An id as people read it (#245, display-name.js; `names`: the run's own names for them)
  const readable = (id, names) => (typeof displayName === 'function' ? displayName(id, names) : String(id || ''));

  /** A workflow's short name for its badge ("Local hero", "Software dev", "AI development local hero"); the file is in the tooltip. */
  function shortWorkflow(file) {
    const base = String(file || '').replace(/\.ya?ml$/i, '');
    if (base === 'software-development') return 'Software dev';
    return readable(base.replace(/^software-development-/, ''));
  }

  /** The sum of the item's issues' `complexity:n` labels (null when none has one). */
  function complexity(x, byNumber) {
    const known = refs(x).map((i) => (byNumber.get(i.number)?.labels || [])
      .map((l) => String(l?.name ?? l).match(COMPLEXITY)).find(Boolean)).filter(Boolean).map((m) => Number(m[1]));
    return known.length ? known.reduce((a, c) => a + c, 0) : null;
  }

  // The mode: a toggle with the workflow's enum values on an editable item, a badge otherwise.
  function modeHtml(x, locked) {
    const def = inputDefs(x).mode;
    const values = Array.isArray(def?.enum) ? def.enum.map(String) : x.inputs?.mode != null ? [String(x.inputs.mode)] : [];
    if (!values.length) return '';
    const value = String(x.inputs?.mode ?? def?.default ?? values[0]);
    // the workflow's labels for its values (`options`, e.g. auto → Automatic; WorkflowInputs, #116)
    const label = (v) => `${ICON[v] || ''}${esc(WorkflowInputs.optionLabel(def || {}, v))}`;
    const help = def?.description ? `. ${def.description}` : '';
    if (locked || values.length < 2) return `<span class="badge rm-mode rm-mode-${esc(value)}" title="${esc(`Mode: ${WorkflowInputs.optionLabel(def || {}, value)}${help}`)}">${label(value)}</span>`;
    return `<span class="seg sm rm-mode-seg" role="group" aria-label="Mode" title="${esc(`Mode (saved at once)${help}`)}">${values.map((v) =>
      `<button type="button" class="rm-mode-${esc(v)}${v === value ? ' active' : ''}" data-rm-mode="${esc(v)}" aria-pressed="${v === value}">${label(v)}</button>`).join('')}</span>`;
  }

  const money = (n) => `$${Number(n || 0).toFixed(2)}`;
  const mins = (n) => Estimates.formatMinutes(n);

  // #215: a real value against its estimate, coloured by the verdict (Estimates.verdict) with an
  // arrow, so colour is never the only signal; the difference in the tooltip. `fmt` formats a value,
  // `more`: the tooltip's difference ("$7.03 more"), `extra`: more tooltip lines.
  function vsBadge(kind, actual, estimate, fmt, more, extra = []) {
    const v = Estimates.verdict(actual, estimate);
    if (!v) return `<span class="badge rm-actual rm-${kind}">${fmt(actual)}</span>`;
    const pct = `${v.percent > 0 ? '+' : v.percent < 0 ? '−' : '±'}${Math.abs(v.percent)}%`;
    const tip = [`${pct}, ${more(v.diff)} than the estimate (${fmt(estimate)})`, ...extra].filter(Boolean).join('\n');
    return `<span class="badge rm-actual rm-${kind} rm-verdict rm-verdict-${v.level}" title="${esc(tip)}"><span class="rm-sign" aria-hidden="true">${v.sign}</span> <b>${esc(fmt(actual))}</b> / ≈ ${esc(fmt(estimate))}</span>`;
  }
  const moneyMore = (d) => `${money(Math.abs(d))} ${d < 0 ? 'less' : 'more'}`;
  const timeMore = (d) => `${mins(Math.abs(d))} ${d < 0 ? 'less' : 'more'}`;
  // "1 h 45" in "58 min of ≈ 1 h 45" (the running badge's short form)
  const minsShort = (n) => mins(n).replace(/^(\d+ h \d+) min$/, '$1');
  const topStep = (x) => (x.actualTopStep ? `Longest step: ${x.actualTopStep.step} ${mins(x.actualTopStep.minutes)}` : '');

  // #206, #215: the item's estimate (cost and time) and, once it has a run, what it cost and took
  // against it (so far, while it runs: elapsed vs estimate, coloured only once past it)
  function costHtml(x) {
    const e = x.estimate;
    const running = x.status === 'running' || x.waiting;
    const ran = x.actualUsd != null || x.actualMinutes != null;
    const runsWord = `run${(x.runs || []).length > 1 ? 's' : ''}`;
    let spend = '';
    let time = '';
    if (!e) {
      spend = '<span class="badge rm-estimate rm-no-estimate" title="No successful real run of this workflow yet: nothing to estimate from">no estimate yet</span>';
      if (x.actualUsd != null) spend += `<span class="badge rm-actual" title="${esc(`What its ${runsWord} cost${running ? ' so far' : ''}`)}">${money(x.actualUsd)}${running ? ' so far' : ''}</span>`;
      if (x.actualMinutes != null) time = `<span class="badge rm-actual rm-time" title="${esc([`How long its ${runsWord} took${running ? ' so far' : ''} (gate waits left out)`, topStep(x)].filter(Boolean).join('\n'))}">${mins(x.actualMinutes)}${running ? ' so far' : ''}</span>`;
    } else if (running && ran) {
      const cost = Estimates.verdict(x.actualUsd, e.usd);
      spend = `<span class="badge rm-estimate" title="${esc(e.basis)}">≈ ${money(e.usd)}${e.estimated ? ' (est.)' : ''}</span>`
        + (x.actualUsd != null ? `<span class="badge rm-actual${cost && cost.level !== 'good' ? ` rm-verdict rm-verdict-${cost.level}` : ''}" title="${esc(`What its ${runsWord} cost so far, next to the estimate`)}">${cost && cost.level !== 'good' ? `<span class="rm-sign" aria-hidden="true">${cost.sign}</span> ` : ''}${money(x.actualUsd)} so far</span>` : '');
      if (x.actualMinutes != null && e.minutes) {
        const v = Estimates.verdict(x.actualMinutes, e.minutes);
        const over = v && v.level !== 'good';
        time = `<span class="badge rm-actual rm-time${over ? ` rm-verdict rm-verdict-${v.level}` : ''}" title="${esc([`Elapsed (gate waits left out) against the estimate${over ? `: ${timeMore(v.diff)}` : ''}`, e.timeBasis].filter(Boolean).join('\n'))}">${over ? `<span class="rm-sign" aria-hidden="true">${v.sign}</span> ` : ''}${mins(x.actualMinutes)} of ≈ ${minsShort(e.minutes)}</span>`;
      }
    } else if (ran) {
      if (x.actualUsd != null) spend = vsBadge('cost', x.actualUsd, e.usd, money, moneyMore, [e.basis]);
      if (x.actualMinutes != null) time = e.minutes ? vsBadge('time', x.actualMinutes, e.minutes, mins, timeMore, [topStep(x), e.timeBasis]) : `<span class="badge rm-actual rm-time">${mins(x.actualMinutes)}</span>`;
    } else {
      spend = `<span class="badge rm-estimate" title="${esc(e.basis)}">≈ ${money(e.usd)}${e.estimated ? ' (est.)' : ''}</span>`;
      if (e.minutes) time = `<span class="badge rm-estimate rm-time" title="${esc(e.timeBasis || `From ${e.runs} past runs`)}">≈ ${mins(e.minutes)}</span>`;
    }
    // #205: the Product Owner's Cost step and what it chose for this item
    const c = x.cost;
    const tip = c ? [`Cost: ${c.name}`, Object.entries(c.inputs || {}).map(([k, v]) => `${k}: ${v}`).join(', '), c.grouping, ...(c.notAdjustable || [])].filter(Boolean).join('\n') : '';
    const step = c ? `<span class="badge rm-cost rm-cost-${Number(c.level) || 3}" title="${esc(tip)}">${esc(c.name)}${c.grouping ? ' · grouped' : ''}</span>` : '';
    return `${step}${spend}${time}`;
  }

  // #215: the stage's estimate (its items' costs summed, its longest item's time) and, once every
  // item has ended, its real total against it
  function stageCostHtml(stage, finished) {
    const e = stage.estimate;
    if (!e) return '';
    const plus = e.missing ? ' +' : '';
    const runs = `each from up to ${e.runs} past runs of its workflow`;
    const missing = e.missing ? `; ${e.missing} item(s) have no estimate yet` : '';
    if (finished && stage.actualUsd != null) {
      return vsBadge('cost', stage.actualUsd, e.usd, money, moneyMore, [`The real cost of its items' runs against the sum of their estimates${missing}`])
        + (stage.actualMinutes && e.minutes ? vsBadge('time', stage.actualMinutes, e.minutes, mins, timeMore, ['Its longest item\'s real duration against its longest estimate (items run in parallel)']) : '');
    }
    return `<span class="badge rm-estimate" title="${esc(`The sum of its items' estimates (${runs})${missing}`)}">≈ ${money(e.usd)}${plus}</span>`
      + (e.minutes ? `<span class="badge rm-estimate rm-time" title="${esc(`Its longest item's estimate: its items run in parallel (${runs})${missing}`)}">≈ ${mins(e.minutes)}${plus}</span>` : '');
  }

  // The Product Owner's reason for the group and for the mode (#105): one line, expandable.
  function reasonHtml(x) {
    if (!x.reason && !x.modeReason) return '';
    const head = x.reason ? `<span class="muted">Why:</span> ${esc(x.reason)}` : `<span class="muted">Mode:</span> ${esc(x.modeReason)}`;
    return `<details class="rm-reason small"><summary title="The Product Owner's reason (click for all of it)">${head}</summary>
      ${x.reason && x.modeReason ? `<p><span class="muted">Mode:</span> ${esc(x.modeReason)}</p>` : ''}</details>`;
  }

  // The Edit form: the workflow's inputs (but the mode, which has its toggle) drawn by WorkflowInputs
  // (#116: human labels, pills / switches, show_if against the item's mode); inputs the workflow
  // does not define (added with "add input") as text.
  function formHtml(x) {
    const defs = inputDefs(x);
    const fields = Object.fromEntries(Object.entries(defs).filter(([k, def]) => k !== 'mode' && !skipInput(k, def || {})));
    for (const k of Object.keys(x.inputs || {})) if (k !== 'mode' && !defs[k]) fields[k] = {};
    const mode = x.inputs?.mode ?? defs.mode?.default;
    const grid = Object.keys(fields).length
      ? WorkflowInputs.formHtml(fields, {
        values: x.inputs || {}, context: { mode }, autofocus: !adding,
        id: (k) => `rm-f-${x.id}-${k}`, attrs: (k) => `data-rm-field="${esc(k)}"`,
      })
      : '<p class="small muted">This workflow has no other inputs.</p>';
    const add = adding
      ? `<div class="field rm-add"><label>New input</label><div class="row"><input type="text" data-rm-newname placeholder="name" aria-label="New input name" autofocus /><input type="text" data-rm-newvalue placeholder="value" aria-label="New input value" /></div></div>`
      : '<button class="link-btn small" type="button" data-rm-addinput>+ add input</button>';
    return `
      <div class="rm-form" role="group" aria-label="Edit the inputs of this item"${WorkflowInputs.scopeAttrs({ mode })}>
        <div class="rm-form-grid wi-grid">${grid}</div>
        ${add}
        <div class="rm-chain" data-rm-chain="${esc(x.id)}"></div>
        <div class="rm-form-actions">
          <label class="check small dev-only"><input type="checkbox" data-rm-field-mock${x.mock ? ' checked' : ''} /><span>Simulation</span></label>
          <span class="spacer"></span>
          <button class="btn sm ghost" type="button" data-rm-cancel>Cancel</button>
          <button class="btn sm primary" type="button" data-rm-save>Save</button>
        </div>
      </div>`;
  }

  // ---- the run's progress ring (#194) -------------------------------------------------------------------
  const RING_ROBOT = { running: 'thinking', waiting: 'waiting', failed: 'error', stopped: 'sleeping', done: 'idle' };
  let ringOpen = null; // the run whose steps a click pinned open (hover shows them too)
  const dur = (ms) => (ms == null ? 'unknown' : fmtDur(ms));

  // The estimate of an item's run, from the service's `run` (trail, typical step times) and the
  // workflow's steps in order (api.listWorkflows); null without a run.
  function estimate(x) {
    const run = x.run;
    if (!x.runId || !run) return null;
    const path = (workflows?.get(x.workflow)?.steps || []).map((st) => st.id);
    const est = RunProgress.estimateProgress({ steps: run.progress || [], path, typical: run.stepTimes || {}, status: run.status, startedAt: run.startedAt, keep: true });
    return x.waiting && est.state === 'running' ? { ...est, state: 'waiting' } : est;
  }

  // ---- the run's timer (#272): its working time under the ring, against the item's time estimate ----
  const toMs = (ts) => { const t = Date.parse(ts || ''); return Number.isFinite(t) ? t : null; };
  const pad2 = (n) => String(n).padStart(2, '0');
  // "23:41", "1:05:12"
  function clockText(ms) {
    const s = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(s / 3600);
    return `${h ? `${h}:${pad2(Math.floor((s % 3600) / 60))}` : Math.floor(s / 60)}:${pad2(s % 60)}`;
  }
  // within the estimate, up to 130% of it, beyond; neutral without an estimate
  function timerTone(ms, minutes) {
    if (!(minutes > 0)) return 'neutral';
    const ratio = ms / (minutes * 60000);
    return ratio < 1 ? 'ok' : ratio <= 1.3 ? 'warn' : 'over';
  }
  /**
   * How long a run has worked, gate waits left out as #215 counts them (a finished human gate's
   * duration, and the time since the gate it waits at started): → { ms, since }, or null when the run
   * has no start. `since`: the instant the timer counts from while it ticks (the run's start moved by
   * its gate waits); null while it is paused at a gate or frozen at the run's end.
   */
  function runClock(run, now = Date.now()) {
    const start = toMs(run.startedAt) ?? toMs(run.progress?.[0]?.ts);
    const active = run.status === 'running' || run.status === 'pending';
    const end = active ? now : toMs(run.finishedAt);
    if (start == null || end == null) return null;
    let gates = 0;
    let paused = false;
    for (const e of run.progress || []) {
      if (e.type !== 'human_approval' && e.status !== 'waiting') continue;
      if (e.status !== 'waiting' && e.status !== 'running') gates += e.durationMs || 0;
      else if (active && toMs(e.ts) != null) { gates += Math.max(0, now - toMs(e.ts)); paused = true; }
    }
    return { ms: Math.max(0, end - start - gates), since: active && !paused ? start + gates : null };
  }
  // "23 min of ≈ 22 min (estimate from 30 past runs)"
  function timeAgainst(ms, e) {
    const spent = mins(Math.floor(ms / 60000));
    if (!(e?.minutes > 0)) return `${spent} so far (no estimate yet)`;
    return `${spent} of ≈ ${mins(e.minutes)} (${e.runs ? `estimate from ${plural(e.runs, 'past run')}` : e.timeBasis || 'estimated'})`;
  }
  // data-tone is what the E2E steps read, data-timer-state the unit tests: the same value
  function timerHtml(clock, e) {
    const tone = timerTone(clock.ms, e?.minutes);
    return `<span class="rm-timer rm-timer-${tone}" role="timer" data-rm-timer="${clock.since ?? ''}" data-estimate="${Number(e?.minutes) || ''}" data-testid="roadmap-run-timer" data-timer-state="${tone}" data-tone="${tone}" aria-label="${esc(timeAgainst(clock.ms, e))}">${clockText(clock.ms)}</span>`;
  }
  /** Every second (backlog.js): the timers of the runs at work read the clock again, without a redraw. */
  function tick(root) {
    for (const el of root?.querySelectorAll('[data-rm-timer]') || []) {
      const since = Number(el.dataset.rmTimer);
      if (!since) continue; // paused at a gate, or frozen at the run's end
      const ms = Math.max(0, Date.now() - since);
      const tone = timerTone(ms, Number(el.dataset.estimate));
      el.textContent = clockText(ms);
      if (el.dataset.tone === tone) continue;
      el.classList.replace(`rm-timer-${el.dataset.tone}`, `rm-timer-${tone}`);
      el.dataset.tone = tone;
      el.dataset.timerState = tone;
    }
  }

  function progressHtml(x) {
    const est = estimate(x);
    if (!est) return '';
    const run = x.run;
    const last = (run.progress || []).at(-1);
    const groupOf = new Map((run.groups || []).flatMap((g) => (g.steps || []).map((id) => [id, g.name])));
    // #245: the step's readable name (the run's own `stepNames`), its id only in the tooltips
    const where = est.step ? groupOf.get(est.step) || readable(est.step, run.stepNames) : 'starting';
    const whereId = est.step && !groupOf.has(est.step) ? ` (${est.step})` : '';
    const label = { waiting: 'Waiting for you', failed: `Failed at ${where}`, stopped: `Stopped at ${where}`, done: 'Done' }[est.state] || where;
    // #272: a fix round (the run went back to a step it had done): the same run, said under the step
    const sender = est.sentBackBy ? groupOf.get(est.sentBackBy) || readable(est.sentBackBy, run.stepNames) : '';
    const round = est.round > 1 && est.state !== 'done' ? `round ${est.round}${sender ? ` · fix round after ${sender}` : ''}` : '';
    const clock = runClock(run);
    // who works there: the human at a gate, else the step's first agent (the engine when none yet)
    // (before its first message the trail has no provider yet: the workflow's agent definition gives it)
    const first = last?.agents?.[0];
    const wfAgent = first && workflows?.get(x.workflow)?.agents?.[first.agent];
    const agent = first && { ...first, provider: first.provider || wfAgent?.provider || null, model: first.model || wfAgent?.model || null };
    const human = last?.type === 'human_approval' || est.state === 'waiting';
    const art = human ? PERSON_SVG : agent?.provider ? robotAvatar(agent.provider, agent.model, RING_ROBOT[est.state], run.workflow, agent.agent) : ENGINE_SVG;
    const who = human ? 'You (human gate)' : agent ? agentLabel(agent.agent, run.agentNames) : 'the orchestrator';
    const basis = est.basis === 'history'
      ? `${est.done} of ${est.total} steps along the usual path, each weighted by its typical time in ${run.history} past run${run.history === 1 ? '' : 's'} of this workflow`
      : `${est.done} of ${est.total} steps of the workflow, each counted the same (no finished run to time them yet)`;
    // #236: the run's summary heads the steps popover (no native title over the app's popover)
    const summary = [
      `Estimate: ${est.state === 'done' ? 100 : est.percent}%${est.state === 'done' ? ' (finished)' : ''}`,
      `Elapsed ${dur(est.elapsedMs)}${est.state === 'done' ? '' : ` · about ${dur(est.leftMs)} left`}`,
      clock ? `Working time (gate waits left out): ${timeAgainst(clock.ms, x.estimate)}` : '',
      round ? `Same run, ${round}` : '',
      `Now:${label}${est.state === 'running' || est.state === 'waiting' ? ` (${who})` : ''}`,
      // the gate's "What happened" line (#213)
      est.state === 'waiting' && run.gate ? `Gate: ${run.gate}` : '',
      `Run ${x.runId}${run.mock ? ' (simulated)' : ''}`,
    ].filter(Boolean);
    const how = `How: ${basis}. A return to an earlier step (a fix round) keeps what the run had earned; it stays under 100% until the run ends.`;
    const pct = est.state === 'done' ? 100 : est.percent;
    const chips = RunProgress.progressGroups(run.progress || [], run.groups || [], run.status === 'running' || run.status === 'pending' ? 'running' : run.status);
    const steps = chips.length
      ? `<div class="rp-strip">${chips.map((c) => `<button type="button" class="rm-chip" data-rm-chip="${esc(c.name)}" data-grouped="${c.grouped ? '1' : ''}" aria-label="${esc(`Open the run at ${c.grouped ? c.name : `${readable(c.name, run.stepNames)} (${c.name})`}`)}">${progressChip(c, run.agentNames, run.workflow, run.stepNames)}</button>`).join('<span class="rp-sep">›</span>')}</div>`
      : '<p class="small muted">No step has started yet.</p>';
    const head = `<div class="rm-run-summary small" data-testid="roadmap-run-summary">${summary.map((l) => `<div>${esc(l)}</div>`).join('')}<div class="muted">${esc(how)}</div><div class="muted">Click a step to open the run there.</div></div>`;
    return `
      <div class="rm-progress st-${est.state}${run.mock ? ' sim' : ''}${ringOpen === x.runId ? ' open' : ''}" data-rm-progress="${esc(x.runId)}" data-workflow="${esc(run.workflow || x.workflowName || '')}">
        <div class="rm-ring-col">
          <button type="button" class="rm-ring" data-rm-ring aria-expanded="${ringOpen === x.runId}" aria-label="${esc(`${pct}% estimated, ${label}${whereId}${round ? `, ${round}` : ''}. Show the run's steps`)}">
            <svg viewBox="0 0 36 36" aria-hidden="true"><circle class="rm-ring-track" cx="18" cy="18" r="15.9155"/><circle class="rm-ring-bar" cx="18" cy="18" r="15.9155" stroke-dasharray="${pct} ${100 - pct}"/></svg>
            <span class="rm-ring-pct">${pct}%</span>
          </button>
          ${clock ? timerHtml(clock, x.estimate) : ''}
        </div>
        <div class="rm-progress-text">
          <span class="rm-progress-step" data-testid="roadmap-progress-step"><span class="rp-av${human ? ' human' : agent?.provider ? '' : ' engine'}" aria-hidden="true">${art}</span><span>${esc(label)}</span></span>
          ${round ? `<span class="rm-round" data-testid="roadmap-round">${esc(round)}</span>` : ''}
          ${run.mock ? '<span class="badge p-mock">Simulated</span>' : ''}
        </div>
        <div class="rm-steps" role="group" aria-label="The run's steps">${head}${steps}</div>
      </div>`;
  }

  // ---- an item's status (#266): the kanban's run chip when it has a run, a pill otherwise ----------------
  // how a run that ended reads on an item planned again (the roadmap stopped, a Retry not started yet)
  const RUN_END = { success: 'done', failed: 'failed', cancelled: 'stopped', interrupted: 'interrupted' };
  function chipStatus(x) {
    if (x.waiting) return 'waiting';
    if (x.status !== 'planned') return x.status;
    return RUN_END[x.run?.status] || x.run?.status || 'planned';
  }
  function statusHtml(x) {
    // refused before any run: nothing to open, the error is the tooltip (and under the card)
    if (refusedStart(x)) return StatusPill.statusPill('failed_to_start', { title: x.error, className: 'rm-state' });
    const gate = x.waiting && x.run?.gate ? x.run.gate : '';
    if (!x.runId) return StatusPill.statusPill(x.waiting ? 'waiting' : x.status, { title: gate, className: 'rm-state' });
    const workflow = readable(String(x.run?.workflow || x.workflow || '').replace(/\.ya?ml$/i, ''));
    const named = x.workflowName || x.workflow || '';
    const title = window.runTitle ? runTitle({ runId: x.runId, workflow: named, issues: refs(x) }) : '';
    return `<button class="bl-run rm-run-chip" type="button" data-testid="run-chip" data-run="${esc(x.runId)}" data-workflow="${esc(x.workflowName || '')}" title="${esc(`Open the run ${x.runId} of ${x.workflow} (Resume from step… is there)`)}">${StatusPill.statusPill(chipStatus(x), { title: gate })}<span class="rm-run-wf">${esc(workflow)}</span>${title && title !== named ? `<span>${esc(title)}</span>` : ''}</button>`;
  }

  // `r`: the roadmap (which item paused it, #196)
  function itemHtml(x, s, n, byNumber, r) {
    const status = x.waiting ? 'waiting' : x.status;
    const locked = !editable(x);
    const refused = refusedStart(x);
    const push = pushesAgainstDefault(x);
    const open = !locked && editing === x.id;
    const size = complexity(x, byNumber);
    const titles = refs(x).map((i) => {
      const title = i.title && i.title !== `#${i.number}` ? i.title : '';
      const text = i.url ? `<a class="rm-title" href="${esc(i.url)}" target="_blank" rel="noopener" draggable="false">${esc(title || 'Open the issue')}</a>` : `<span class="rm-title">${esc(title)}</span>`;
      return `<li class="rm-issue"${locked || open ? '' : ` draggable="true" data-drag-issue="${i.number}" data-from="${esc(x.id)}"`} title="${esc(`#${i.number} ${title}`.trim())}"><span class="rm-num mono">#${i.number}</span>${text}</li>`;
    }).join('');
    // the card carries its status id once the item has started or ended (E2E steps count the done,
    // running and skipped cards); a planned item's id is on its pill only
    return `
      <div class="rm-item rm-${esc(status)}" data-testid="roadmap-item"${status === 'planned' ? '' : ` data-status="${esc(status)}"`} data-item="${esc(x.id)}" data-stage="${s}"${locked || open ? '' : ' draggable="true" data-drag-item'}>
        <div class="rm-item-head">
          <ul class="rm-titles">${titles}</ul>
          <div class="rm-actions">
            ${retryable(x, r) ? `<button class="btn sm primary" type="button" data-rm-item="retry" title="${refused ? 'Start it again: when an ended run kept work for its issues, you choose to resume that run or start from scratch' : 'Run it again (a new run)'}">Retry</button><button class="btn sm ghost" type="button" data-rm-item="skip" title="Count it as finished: the roadmap goes on">Skip</button>` : ''}
            ${askOracleHtml(x)}
            ${locked ? '' : `<button class="btn sm ghost" type="button" data-rm-move="up" title="Earlier in the stage (or into the previous stage)"${n === 0 && s === 0 ? ' disabled' : ''}>↑</button>
            <button class="btn sm ghost" type="button" data-rm-move="down" title="Later in the stage (or into the next stage)">↓</button>
            <button class="link-btn small" type="button" data-rm-remove title="Take this item out of the roadmap">remove</button>`}
          </div>
          ${progressHtml(x)}
        </div>
        <div class="rm-meta">
          ${statusHtml(x)}
          ${x.runId && !push ? '' : `<span class="badge rm-wf${push ? ' rm-wf-push' : ''}" title="${esc(`${x.workflowName && x.workflowName !== x.workflow ? `${x.workflowName} (${x.workflow})` : x.workflow}${push ? `. It pushes a branch and opens a PR/MR, while the default development workflow (${DefaultWorkflow.current().file}) merges locally` : ''}`)}">${push ? '<span aria-hidden="true">⇡ </span>' : ''}${esc(shortWorkflow(x.workflow))}</span>`}
          ${modeHtml(x, locked)}
          ${size != null ? `<span class="badge rm-size" title="The sum of the issues' complexity:n labels">complexity ${size}</span>` : ''}
          ${costHtml(x)}
          ${x.mock ? '<span class="badge p-mock">Simulated</span>' : ''}
          ${x.then ? ChainModel.chainBadgesHtml({ then: x.then }) : ''}
          ${updateAfterHtml(x, locked)}
          ${WorkflowInputs.inputPills(workflows?.get(x.workflow) || null, x.inputs, { skip: ['mode'] })}
          ${locked || open ? '' : '<button class="link-btn small" type="button" data-rm-edit title="Edit this item\'s inputs">Edit</button>'}
        </div>
        ${reasonHtml(x)}
        ${x.error ? `<div class="small rm-error ${x.status === 'failed' || refused ? 'error' : 'muted'}">${esc(x.error)}${refused && x.status !== 'skipped'
    ? '<div class="rm-error-hint muted">Retry starts it again: when an ended run kept work for its issues, you choose to resume that run or start from scratch. Skip counts it as finished.</div>' : ''}</div>` : ''}
        ${open ? formHtml(x) : ''}
      </div>`;
  }

  // "Stages 1–2", "Stages 1, 3", "Stage 2" (0-based indexes in)
  function stagesText(list) {
    const n = list.map((s) => s + 1);
    if (n.length === 1) return `Stage ${n[0]}`;
    return `Stages ${n.every((x, k) => !k || x === n[k - 1] + 1) ? `${n[0]}–${n[n.length - 1]}` : n.join(', ')}`;
  }

  // "#240 Agent inboxes (done), #246+#247 (done)": the items a stage's "+n done" chip folds
  const foldedNames = (items) => items.map((x) => {
    const of = refs(x);
    return `${of.length === 1 ? `#${of[0].number} ${of[0].title || ''}`.trim() : of.map((i) => `#${i.number}`).join('+')} (${x.status})`;
  }).join(', ');

  // `scoped`: the index of the stage run on its own (#141), -1 when none; `r`: the roadmap; `shown`:
  // what the view draws of it (visibleStages, pageOf): its `items`, its finished items `folded` under
  // the "+n done" chip (#267; `open`: unfolded, drawn below the chip), `cut`: only its first cards (#268,
  // the rest comes with the next page).
  function stageHtml(stage, s, count, current, byNumber, scoped, r, shown) {
    const done = stage.items.every(finished);
    const { items, folded, open, cut = Infinity } = shown;
    const card = (x) => itemHtml(x, s, stage.items.indexOf(x), byNumber, r);
    const n = folded.length;
    const chip = n && cut >= items.length
      ? `<button type="button" class="rm-done-chip" data-rm-done="${esc(stageKey(stage, s))}" data-testid="roadmap-done-chip" aria-expanded="${open}" aria-label="${open ? 'Hide' : 'Show'} ${n} done item${n === 1 ? '' : 's'} of stage ${s + 1}" title="${esc(foldedNames(folded))}">${open ? `Hide ${n}` : `+${n}`} done</button>` : '';
    const cards = items.slice(0, cut).map(card).join('') + chip + (open ? folded.slice(0, Math.max(0, cut - items.length)).map(card).join('') : '');
    const noteOpen = noteEditing != null && noteEditing === stage.id;
    const note = noteOpen
      ? `<input type="text" class="rm-note small" data-rm-note value="${esc(stage.note || '')}" placeholder="Why this order" aria-label="Stage note" autofocus />`
      : stage.note ? `<p class="rm-note-text small muted">${esc(stage.note)} <button class="link-btn small" type="button" data-rm-addnote>edit</button></p>` : '';
    const runnable = r.state !== 'running' && stage.items.some((x) => x.status === 'planned');
    const runTitle = r.state === 'running' ? 'The roadmap is running: pause or stop it first' : runnable ? 'Run only this stage\'s items; the roadmap pauses when they are done' : 'No planned item in this stage';
    const stateBadge = s === scoped ? `<span class="badge ${r.state === 'running' ? 'live' : 'warn'}">${r.state === 'running' ? 'Running this stage only' : 'This stage only · paused'}</span>`
      : s === current ? '<span class="badge live">current</span>' : done ? '<span class="badge" data-status="done">Done</span>' : '';
    return `
      <section class="rm-stage${s === current ? ' current' : ''}${s === scoped ? ' scoped' : ''}${done ? ' finished' : ''}" data-stage="${s}" data-drop-stage="${s}" data-testid="roadmap-stage">
        <div class="rm-stage-head">
          <span class="muted small">Stage ${s + 1}</span>
          <input type="text" class="rm-name" data-rm-name value="${esc(stage.name)}" placeholder="Name (optional)" aria-label="Stage name" />
          ${stateBadge}
          ${stageCostHtml(stage, done && stage.items.length > 0)}
          ${stage.note || noteOpen ? '' : '<button class="link-btn small" type="button" data-rm-addnote>add note</button>'}
          <span class="spacer"></span>
          ${stage.release?.name ? '' : '<button class="btn sm ghost" type="button" data-rm-release="add" title="Draw a cut line after this stage: when the roadmap reaches it, the whole unit and E2E suites run and you Ship or Hold; the stages below wait for it"><span aria-hidden="true">✂</span> Release here</button>'}
          <button class="btn sm ghost rm-run-stage" type="button" data-rm-run-stage title="${esc(runTitle)}"${runnable ? '' : ' disabled'}><span aria-hidden="true">▶</span> Run this stage</button>
          <button class="btn sm ghost" type="button" data-rm-stage="up" title="Run this stage earlier"${s === 0 ? ' disabled' : ''}>↑</button>
          <button class="btn sm ghost" type="button" data-rm-stage="down" title="Run this stage later"${s === count - 1 ? ' disabled' : ''}>↓</button>
        </div>
        ${note}
        <div class="rm-items">${cards}</div>
      </section>`;
  }

  // ---- cut lines (#260): "Release here" after a stage, the stages below wait for its release run ----
  // a line's state: [badge tone, label, what it means]
  const RELEASE_STATE = {
    running: ['live', 'release run in progress', 'The whole unit and E2E suites run, then its Ship gate waits for you'],
    held: ['warn', 'on hold', 'Its release run ended without shipping: resume that run from its Ship gate, or Resume the roadmap to check the release again'],
    failed: ['warn', 'release run failed', 'Its release run failed: open it, then Resume the roadmap to check the release again'],
    shipped: ['', 'shipped', 'Pushed and tagged: the stages below run'],
  };
  // `where`: says after which stage it sits (the view grouped by epic shows no stages)
  function cutLineHtml(stage, s, where = false) {
    const rel = stage.release;
    if (!rel?.name) return '';
    const [tone, label, help] = RELEASE_STATE[rel.status] || ['', '', 'The stages below wait until this release shipped'];
    const locked = rel.status === 'running' || rel.status === 'shipped';
    return `
      <div class="rm-cut${rel.status === 'shipped' ? ' shipped' : ''}" data-testid="roadmap-cut-line" data-cut-stage="${s}" title="${esc(help)}">
        <span class="rm-cut-label"><span aria-hidden="true">✂</span> Release here</span>
        <b class="rm-cut-name">${esc(rel.name)}</b>
        ${where ? `<span class="muted small">after stage ${s + 1}</span>` : ''}
        ${label ? `<span class="badge ${tone}">${esc(label)}</span>` : ''}
        ${rel.runId ? `<button class="link-btn small" type="button" data-rm-release-run="${esc(rel.runId)}" title="Open the release run ${esc(rel.runId)}">Open the run</button>` : ''}
        ${locked ? '' : `<button class="link-btn small" type="button" data-rm-release="edit" aria-label="Rename the release ${esc(rel.name)}">Rename</button>
        <button class="link-btn small" type="button" data-rm-release="remove" aria-label="Remove the cut line ${esc(rel.name)}" title="The stages below no longer wait for a release">Remove</button>`}
      </div>`;
  }

  // The cut line's dialog (the #cut-line-modal of backlog.js): → the release's name, or null when cancelled.
  function cutLineDialog(current) {
    const q = (sel) => document.querySelector(sel);
    const modal = q('#cut-line-modal');
    const input = q('#cut-line-name');
    input.value = current;
    q('#cut-line-error').textContent = '';
    q('#btn-cut-line-ok').textContent = current ? 'Save' : 'Add cut line';
    modal.classList.remove('hidden');
    input.focus({ preventScroll: true });
    return new Promise((resolve) => {
      const close = (value) => { modal.classList.add('hidden'); resolve(value); };
      q('#cut-line-form').onsubmit = (e) => {
        e.preventDefault();
        const name = input.value.trim();
        if (!name) { q('#cut-line-error').textContent = 'Give the release a name or a version.'; return; }
        close(name);
      };
      q('#btn-cut-line-cancel').onclick = () => close(null);
    });
  }

  // ---- what the Roadmap shows (#217, #268): Planned | All, the date range, the epic filter, in pages ------
  const finished = (x) => x.status === 'done' || x.status === 'skipped';
  const DAY_MS = 24 * 60 * 60 * 1000;
  // the date ranges: [id, the option, in the header's count, its length in ms (null: no limit)]
  const SINCE = [
    ['24h', 'Last 24 hours', 'last 24 hours', DAY_MS],
    ['2d', 'Last 2 days', 'last 2 days', 2 * DAY_MS],
    ['3d', 'Last 3 days', 'last 3 days', 3 * DAY_MS],
    ['1w', 'Last week', 'last week', 7 * DAY_MS],
    ['15d', 'Last 15 days', 'last 15 days', 15 * DAY_MS],
    ['1m', 'Last month', 'last month', 30 * DAY_MS],
    ['total', 'Total', 'all time', null],
  ];
  // An item's last activity: the latest of when it joined the roadmap (`origin`), its run's start and
  // its run's end; a run in progress is active now. An item without any date is in every range.
  function inRange(x, v, now) {
    if (v.rangeMs == null || x.status === 'running' || x.waiting) return true;
    const at = [x.origin, x.run?.startedAt, x.run?.finishedAt].map(toMs).filter((t) => t != null);
    return !at.length || Math.max(...at) >= now - v.rangeMs;
  }
  // #267: the stages whose "+n done" chip is unfolded, by stage id (kept across the re-reads of the file)
  const unfolded = new Set();
  const stageKey = (stage, s) => String(stage.id || `#${s}`);
  // #268: the pages drawn of the current view (`key`): `more` pages after the first, `earlier` before it
  const PAGE_STAGES = 15;
  const PAGE_ITEMS = 60;
  const LEAD_STAGES = 2; // the first page starts this many stages before the current one
  let pages = { key: '', more: 0, earlier: 0, fresh: false };
  /** The next page (the "Loading…" row came near the screen); the owner redraws. */
  function loadMore() {
    pages.more += 1;
  }
  const NO_EPIC = 'none'; // BacklogEpics.NONE
  // the item belongs to the epic filter ('' every item, NO_EPIC an issue in no epic, else an epic's id)
  function inEpic(x, epic, byNumber) {
    if (!epic) return true;
    return refs(x).some((i) => {
      const e = byNumber.get(i.number)?.epic || '';
      return epic === NO_EPIC ? !e : e === epic;
    });
  }
  /**
   * The stages the view shows: [{ stage, s (its real index), items (the ones drawn, in order), folded
   * (Planned: its finished items of the date range, under the "+n done" chip), open (the chip is
   * unfolded: they are drawn too) }]. `v`: { epic, showAll, rangeMs }.
   */
  function visibleStages(r, v, byNumber, now) {
    const out = [];
    r.stages.forEach((stage, s) => {
      if (!stage.items.length && !v.epic) { out.push({ stage, s, items: [], folded: [], open: false }); return; }
      const mine = stage.items.filter((x) => inEpic(x, v.epic, byNumber));
      if (v.showAll) {
        const items = mine.filter((x) => inRange(x, v, now));
        if (items.length) out.push({ stage, s, items, folded: [], open: false });
        return;
      }
      const items = mine.filter((x) => !finished(x));
      const folded = mine.filter((x) => finished(x) && inRange(x, v, now));
      const key = stageKey(stage, s);
      // nothing left to fold (or to show): the stage's choice is forgotten
      if (!items.length || !folded.length) unfolded.delete(key);
      if (items.length) out.push({ stage, s, items, folded, open: unfolded.has(key) });
    });
    return out;
  }
  const cardCount = (x) => x.items.length + (x.open ? x.folded.length : 0);
  /**
   * The page of the visible stages to draw: from LEAD_STAGES before the current stage (so it is in
   * the first page however long the finished history is), PAGE_STAGES stages or PAGE_ITEMS cards per
   * page (a longer stage is cut: `cut`, its first cards). → { drawn, earlier (visible stages above
   * the page), more (something is left below it) }
   */
  function pageOf(list, current) {
    const at = Math.max(0, list.findIndex((x) => x.s >= current));
    const base = Math.max(0, at - LEAD_STAGES);
    const start = Math.max(0, base - pages.earlier * PAGE_STAGES);
    let stagesLeft = PAGE_STAGES * (1 + pages.more);
    let cardsLeft = PAGE_ITEMS * (1 + pages.more);
    const drawn = list.slice(start, base);
    let more = false;
    for (let k = base; k < list.length && !more; k++) {
      const cards = cardCount(list[k]);
      if (stagesLeft <= 0 || cardsLeft <= 0) more = true;
      else if (cards > cardsLeft) { drawn.push({ ...list[k], cut: cardsLeft }); more = true; } else drawn.push(list[k]);
      stagesLeft -= 1;
      cardsLeft -= cards;
    }
    return { drawn, earlier: start, more };
  }
  // After backlog.js drew the view: the "Loading…" row asks for the next page when it comes near the
  // screen (as the runs list's does), never while the owner edits (`ownerBusy`: a field with the
  // focus, an open Edit form, a drag: a redraw would lose it; the next draw asks again); a view just
  // changed whose page starts below earlier stages shows its current stage.
  let observer = null;
  function mounted(list, rerender, ownerBusy = busy) {
    observer?.disconnect();
    observer = null;
    const row = list?.querySelector('[data-rm-load-more]');
    if (row && typeof IntersectionObserver === 'function') {
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting) || ownerBusy()) return;
        loadMore();
        rerender();
      }, { rootMargin: '300px' });
      observer.observe(row);
    }
    if (!pages.fresh) return;
    pages.fresh = false;
    if (list?.querySelector('[data-rm-earlier]')) list.querySelector('.rm-stage.current')?.scrollIntoView({ block: 'nearest' });
  }

  // ---- Live roadmap (#164, src/live-roadmap.js) ----------------------------------------------------
  const clock = (at) => {
    const d = new Date(at);
    return Number.isNaN(d.getTime()) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  // the last refill in a few words: [text, tone] (tone: '' | 'warn' | 'error')
  function refillText(r) {
    const f = r.liveRefill;
    if (!f) return [r.state === 'running' ? 'no refill yet: it comes when the last stage ends' : 'no refill yet', ''];
    if (f.status === 'refilling') return ['refilling now: the Product Owner is picking the next issues…', ''];
    if (f.status === 'added') return [`last refill ${clock(f.at)} (+${plural(f.added || 0, 'stage')})`, ''];
    if (f.status === 'budget') return ['daily budget reached: no more refills', 'warn'];
    if (f.status === 'failed') return [`the last refill failed (${clock(f.at)})`, 'error'];
    return [String(f.message || '').replace(/^Live roadmap: /, ''), ''];
  }

  /** The banner at the top of the Backlog (every view) while the roadmap is live; '' when it is not. */
  function liveBanner(r) {
    if (!r?.live) return '';
    const [text, tone] = refillText(r);
    const idle = r.state !== 'running';
    return `<span class="bl-live-dot${idle ? ' idle' : ''}" aria-hidden="true"></span>
      <span class="bl-live-text"><b>Live roadmap</b>: refills itself from the backlog · <span class="${tone ? `${tone}-text` : ''}" title="${esc(r.liveRefill?.message || '')}">${esc(text)}</span>${idle ? ` · <span class="muted">roadmap ${esc(r.state)}</span>` : ''}</span>
      <span class="spacer"></span>
      <button class="btn sm ghost" type="button" data-live-off title="The current stages finish; nothing more is added">Turn off</button>`;
  }

  // The box under the last stage: the switch, what it does, and its state.
  function liveBox(r) {
    const [text, tone] = refillText(r);
    const since = r.live && r.liveSince ? ` · on since ${clock(r.liveSince)}${r.liveBy ? ` by ${esc(r.liveBy)}` : ''}` : '';
    const hint = r.live ? `${esc(text)}${since}` : r.state === 'running' ? 'Off: the roadmap ends with its last stage.' : 'Off. Turning it on starts the roadmap first.';
    return `
      <div class="rm-live${r.live ? ' on' : ''}" role="group" aria-label="Live roadmap">
        <label class="switch" title="${r.live ? 'Turn off: the current stages finish, nothing more is added' : 'Turn on: the roadmap refills itself from the backlog'}"><input type="checkbox" role="switch" data-rm-live aria-label="Live roadmap"${r.live ? ' checked' : ''} /><span></span></label>
        <div class="rm-live-body">
          <div><b>Live roadmap</b>${r.live ? ' <span class="badge rm-live-badge">LIVE</span>' : ''}</div>
          <div class="small muted">When the last stage ends, the Product Owner adds the next issues from the backlog and the roadmap goes on.</div>
          <div class="small ${tone ? `${tone === 'error' ? 'error' : 'warn-text'}` : 'muted'} rm-live-state" title="${esc(r.liveRefill?.message || '')}">${hint}</div>
        </div>
      </div>`;
  }

  // The switch: on asks to start a roadmap that is not running (live works on a running roadmap)
  // and says what a real refill costs; off goes at once.
  async function setLive(ctx, r, on) {
    try {
      if (on) {
        const simulated = r.state === 'running' ? !!r.simulated || !!state.simulationOnly : !!document.querySelector('#rm-simulate')?.checked && devMode();
        const cost = simulated ? 'Simulated: the Product Owner answers without a model call.' : 'Each refill is a Product Owner answer and real runs: they cost money (Settings › Live roadmap caps the daily spend).';
        if (r.state !== 'running') {
          if (!await confirmDialog('Start the roadmap and go live', `Only a running roadmap can go live: start it now? When its last stage ends, the Product Owner adds the next issues from the backlog, again and again. ${cost} Human gates still wait for you.`, 'Start and go live')) return;
          ctx.setData(await api.startRoadmap(ctx.projectId, simulated, null));
        } else if (!simulated && !await confirmDialog('Go live', `When the last stage ends, the Product Owner adds the next issues from the backlog, again and again. ${cost} Human gates still wait for you.`, 'Go live')) return;
      }
      ctx.setData(await api.setRoadmapLive(ctx.projectId, on));
    } catch (err) {
      failed(ctx, 'live', err);
    } finally {
      ctx.render();
    }
  }

  /**
   * The Roadmap view (into #bl-list): its bar, the plain queue's items, the stages in order. `rerender`
   * redraws once the workflows are loaded. `view` (#217, #268): what backlog.js remembers, { epic,
   * showAll, since, project (its id: another project starts at its first page) }: Planned (showAll off) is the open work, a stage's finished items of the date
   * range folded; All is every item of the range; the epic keeps only its items and hides the stages
   * left empty. A change of the view goes back to the first page.
   */
  function html(data, rerender, view = {}) {
    loadWorkflows(rerender);
    loadAppUpdate(rerender);
    const [since, , sinceText, rangeMs] = SINCE.find(([id]) => id === view.since) || SINCE[0];
    const v = { epic: view.epic || '', showAll: !!view.showAll, since, rangeMs };
    const key = `${view.project || ''}|${v.showAll ? 'all' : 'planned'}|${since}|${v.epic}`;
    if (pages.key !== key) pages = { key, more: 0, earlier: 0, fresh: true };
    const r = data?.roadmap || { state: 'planned', stages: [] };
    const q = data?.queue?.items || [];
    const byNumber = new Map((data?.issues || []).map((i) => [i.number, i]));
    // a stage run on its own (#141) is the one in progress; the others keep their planned look
    const scoped = scopedStage(r);
    const current = scoped >= 0 ? scoped : r.stages.findIndex((s) => s.items.some((x) => x.status !== 'done' && x.status !== 'skipped'));
    // #269: the state is a dot before the title (blue and pulsing while running, amber paused, red
    // paused by a failure, grey planned, green done), readable in its tooltip and aria-label; a stage
    // run on its own (#141) is still named, in a badge after the title
    const pausedByFailure = failedPause(r);
    const dotState = pausedByFailure ? 'failed' : ['running', 'paused', 'done'].includes(r.state) ? r.state : 'planned';
    const stateLabel = pausedByFailure ? 'Paused by a failure' : StatusPill.statusLabel(r.state);
    const dotTitle = `${stateLabel}${r.simulated ? ' · simulated' : ''}`;
    const dot = `<span class="rm-state-dot is-${dotState}" data-testid="roadmap-state-dot" data-state="${pausedByFailure ? 'paused-failed' : dotState}" role="img" aria-label="${esc(dotTitle)}" title="${esc(dotTitle)}"><span class="sr-only">${esc(stateLabel)}</span></span>`;
    const scopeBadge = scoped >= 0
      ? `<span class="badge ${r.state === 'running' ? 'live' : r.state === 'paused' ? 'warn' : ''}" data-status="${esc(r.state)}">${esc(StatusPill.statusLabel(r.state))} · stage ${scoped + 1} only${r.simulated ? ' · simulated' : ''}</span>`
      : r.simulated ? '<span class="badge p-mock">Simulated</span>' : '';
    // a pause that is not an item's failure (the budget cap, a stage run on its own that ended, a
    // release on hold) keeps its line here; a failure is the page's error alert (#270, alerts())
    const note = r.error && !pausedByFailure ? `<span class="${r.state === 'paused' ? 'warn-text' : 'error'} small">${esc(r.error)}${r.state === 'paused' && r.budget ? ` <button class="btn sm primary" type="button" data-rm="budget-raise" title="${esc(`The ${r.budget.period === 'night' ? 'night' : 'daily'} budget becomes what is spent plus the next stage, for ${r.budget.period === 'night' ? 'tonight' : 'today'} only; the roadmap goes on`)}">Raise for ${r.budget.period === 'night' ? 'tonight' : 'today'}</button> <button class="btn sm ghost" type="button" data-rm="budget-resume" title="${esc(`This roadmap ignores the budget until ${r.budget.period === 'night' ? 'the night' : 'the day'} ends; the budget stays as it is`)}">Resume anyway</button>` : ''}</span>` : '';
    const menuItems = MENU.filter((m) => m.show(r));
    const menu = `<span class="bl-menu-wrap rm-menu-wrap"><button class="btn sm ghost rm-menu-btn" type="button" data-rm-menu data-testid="roadmap-menu-button" aria-label="Roadmap actions" title="More actions" aria-haspopup="menu" aria-expanded="${menuOpen}">⋮</button>${menuOpen ? `<div class="bl-menu rm-menu" role="menu" data-testid="roadmap-menu" aria-label="Roadmap actions">${menuItems.map((m) => `<button type="button" role="menuitem" data-rm="${m.id}" title="${esc(m.title)}">${esc(m.label)}</button>`).join('')}</div>` : ''}</span>`;
    const bar = `
      <div class="bl-queue rm-bar" data-testid="roadmap-bar">
        <span class="rm-bar-title">${dot}<b>Roadmap</b> ${scopeBadge} ${r.stages.length} stage${r.stages.length === 1 ? '' : 's'}</span>
        ${note}
        <span class="spacer"></span>
        ${r.state !== 'running' && r.stages.length ? `<label class="check small dev-only"><input type="checkbox" id="rm-simulate"${state.simulationOnly || r.simulated ? ' checked' : ''} /><span>Simulated</span></label>
          <button class="btn sm primary" type="button" data-rm="start"${scoped >= 0 && r.state === 'paused' ? ` title="Resume stage ${scoped + 1} only"` : ''}>${r.state === 'paused' ? 'Resume' : 'Start'}</button>` : ''}
        ${r.state === 'running' ? `<button class="btn sm btn-icon warn-ghost" type="button" data-rm="pause" title="Nothing new starts; runs in progress go on">${ICON.pause}Pause</button>` : ''}
        ${r.state === 'running' || r.state === 'paused' ? `<button class="btn sm btn-icon ghost danger" type="button" data-rm="stop" title="Back to a plan: nothing starts until Start (asks first)">${ICON.stop}Stop</button>` : ''}
        ${menu}
      </div>`;
    const queued = q.length ? `
      <div class="bl-queue rm-queued small"><span>${q.length} run${q.length === 1 ? '' : 's'} in the plain queue (${esc(q.flatMap((x) => refs(x)).map((i) => `#${i.number}`).join(', '))}): they start whenever a slot is free, not in order.</span>
        <span class="spacer"></span><button class="btn sm ghost" type="button" data-rm="from-queue">Move into the roadmap</button></div>` : '';
    const importBox = `
      <details class="rm-import"><summary class="small muted">Product Owner proposal…</summary>
        <p class="small muted">Paste the Product Owner's "Build a roadmap" answer (JSON: { "stages": [{ "name", "note", "items": [{ "workflow", "issues": [12, 13], "inputs", "mock", "reason", "mode_reason" }] }] }). It arrives as planned and never starts until Start.</p>
        <textarea id="rm-proposal" rows="5" class="mono small" spellcheck="false"></textarea>
        <div class="modal-actions"><button class="btn sm ghost" type="button" data-rm="replace">Replace the roadmap</button><button class="btn sm primary" type="button" data-rm="propose">Add to roadmap</button></div>
      </details>`;
    const epics = data?.epics || [];
    const grouped = byEpic && epics.length > 0 && r.stages.length > 0;
    const toggle = epics.length && r.stages.length ? `<label class="check small rm-by-epic" title="Show the roadmap's items under their issues' epics (the stages keep their order)"><input type="checkbox" data-rm-by-epic${grouped ? ' checked' : ''} /><span>Group by epic</span></label>` : '';
    // #268: the Planned | All switch (the remembered open-work flag) and the date range
    const SWITCH = [
      ['planned', 'Planned', 'The open work: every item but the done and skipped ones; a stage\'s finished items of the date range fold under its "+n done"'],
      ['all', 'All', 'Every item of the date range, the done and skipped ones too'],
    ];
    const viewSeg = r.stages.length ? `<span class="seg sm rm-view-seg" role="group" aria-label="Roadmap items">${SWITCH.map(([id, label, tip]) => {
      const on = (id === 'all') === v.showAll;
      return `<button type="button"${on ? ' class="active"' : ''} data-rm-view="${id}" aria-pressed="${on}" title="${esc(tip)}">${label}</button>`;
    }).join('')}</span>` : '';
    const sinceSelect = r.stages.length ? `<select class="rm-since" data-rm-since data-testid="roadmap-date-filter" aria-label="Date range" title="Filter by each item's last activity (added, its run's start, its run's end); in Planned the open items always show">${SINCE.map(([id, label]) =>
      `<option value="${id}"${id === since ? ' selected' : ''}>${label}</option>`).join('')}</select>` : '';
    const now = Date.now();
    const vis = visibleStages(r, v, byNumber, now);
    const allItems = r.stages.flatMap((s) => s.items);
    const shownItems = vis.reduce((a, x) => a + cardCount(x), 0);
    const epicName = v.epic === NO_EPIC ? 'with no epic' : `in epic ${epics.find((e) => e.id === v.epic)?.title || v.epic}`;
    const count = r.stages.length ? `<span class="small muted rm-count" data-testid="roadmap-count"${v.epic ? ` title="${esc(`Items ${epicName}`)}"` : ''}>${shownItems} of ${allItems.length} item${allItems.length === 1 ? '' : 's'} · ${sinceText}</span>` : '';
    const nothing = `<div class="empty-state"><b>No ${v.showAll ? '' : 'open '}roadmap items${v.showAll && rangeMs ? ` in the ${sinceText}` : ''}${v.epic ? ` ${esc(epicName)}` : ''}.</b>
      <p class="muted">${v.showAll ? 'Pick a longer date range, or another epic.' : 'Done and skipped items are under All.'}</p>${v.showAll ? '' : '<button class="btn sm ghost" type="button" data-rm-view="all">Show all items</button>'}</div>`;
    // the page to draw; #260: each drawn stage with its cut line; a hidden (finished) stage's line
    // still shows while its release has not shipped (between the drawn stages, and beyond them when
    // the page reaches that end of the roadmap)
    const page = pageOf(vis, current);
    const drawn = new Map(page.drawn.map((x) => [x.s, x]));
    const from = page.earlier ? page.drawn[0].s : 0;
    const to = page.more ? page.drawn.at(-1).s : r.stages.length - 1;
    const staged = r.stages.map((stage, s) => {
      if (s < from || s > to) return '';
      const x = drawn.get(s);
      if (x) return stageHtml(stage, s, r.stages.length, current, byNumber, scoped, r, x) + cutLineHtml(stage, s);
      return !v.epic && stage.release?.status !== 'shipped' ? cutLineHtml(stage, s) : '';
    }).join('');
    const earlier = page.earlier ? `<button class="link-btn small rm-earlier" type="button" data-rm-earlier title="Draw the stages before these">↑ ${plural(page.earlier, 'earlier stage')}</button>` : '';
    const loadingRow = page.more ? '<div class="rm-loading small muted" role="status" data-rm-load-more data-testid="roadmap-loading">Loading…</div>' : '';
    const stages = !r.stages.length
      ? '<div class="empty-state"><b>No roadmap yet</b><p class="muted">Select issues, Assign workflow…, then Add to roadmap: each addition is a stage that starts when the previous one has finished and merged.</p></div>'
      // grouped by epic: no stages to draw the lines between, so the ones still waiting lead the list
      : grouped ? r.stages.map((stage, s) => (stage.release?.status !== 'shipped' ? cutLineHtml(stage, s, true) : '')).join('') + byEpicHtml(r, epics, byNumber, v, (x) => (v.showAll ? inRange(x, v, now) : !finished(x)))
        : staged.trim() ? `${earlier}${staged}${loadingRow}` : nothing;
    const liveHtml = r.stages.length ? liveBox(r) : '';
    // #269: the filters sit on one row above the bar: the epic (backlog.js's choice, `view.epicOptions`:
    // [{ id, title, count }]), Planned | All, the date range, Group by epic; the bar keeps the counts
    const options = view.epicOptions || [];
    const epicSelect = options.length ? `<select class="rm-epic${v.epic ? ' active' : ''}" data-rm-epic aria-label="Epic" title="Show the items of one epic, or those in no epic"><option value="">All epics</option>${options.map((o) =>
      `<option value="${esc(o.id)}"${o.id === v.epic ? ' selected' : ''}>${esc(o.title)} (${o.count})</option>`).join('')}</select>` : '';
    const filters = epicSelect || viewSeg || sinceSelect || toggle ? `<div class="rm-filters" data-testid="filter-row">${epicSelect}${viewSeg}${sinceSelect}${toggle}</div>` : '';
    return `<div class="rm">${filters}${bar.replace('<span class="spacer"></span>', `${count}<span class="spacer"></span>`)}${queued}${stages}${liveHtml}${importBox}</div>`;
  }

  // #270: a pause by an item (its run failed, or its start was refused: "Could not start #14: …")
  const failedPause = (r) => r?.state === 'paused' && !!r.pausedBy;
  /**
   * What the roadmap tells the page's alerts (backlog.js, alerts.js): paused by an item is an error,
   * with that item's Retry / Skip and "Show the item" (`shown`: the Roadmap is on screen; elsewhere
   * "Open the Roadmap"). It leaves when the roadmap goes on.
   */
  function alerts(data, ctx, { shown = true } = {}) {
    const r = data?.roadmap;
    if (!failedPause(r) || !r.error) return [];
    const item = r.stages.flatMap((s) => s.items).find((x) => x.id === r.pausedBy);
    const act = (action) => async () => {
      try { await itemAction(ctx, r.pausedBy, action); } catch (err) { failed(ctx, 'edit', err); }
      ctx.render();
    };
    return [{
      id: `roadmap-paused:${ctx.projectId}:${r.pausedBy}`,
      level: 'error',
      title: 'Roadmap paused',
      text: r.error,
      dismissible: false,
      actions: [
        ...(item && retryable(item, r) ? [
          { label: 'Retry', primary: true, title: 'Start the item that paused the roadmap again', onClick: act('retry') },
          { label: 'Skip', title: 'Count it as finished: the roadmap goes on', onClick: act('skip') },
        ] : []),
        shown
          ? { label: 'Show the item', title: 'Scroll to the item that paused the roadmap', onClick: () => showItem(r.pausedBy) }
          : { label: 'Open the Roadmap', onClick: () => ctx.showRoadmap?.() },
      ],
    }];
  }

  // #138: the items under their issues' epics (an item of issues in two epics shows under both; "No
  // epic" last), each with its stage; editing stays in the stage view. `v`: the view's filter (#217);
  // `shows`: the items the view keeps (#268: Planned | All, the date range).
  function byEpicHtml(r, epics, byNumber, v = {}, shows = () => true) {
    const sections = [...epics.map((e) => ({ id: e.id, title: e.title })), { id: '', title: 'No epic' }].map((e) => {
      if (v.epic && v.epic !== (e.id || NO_EPIC)) return '';
      const rows = [];
      r.stages.forEach((stage, s) => stage.items.forEach((x, n) => {
        const ids = new Set(refs(x).map((i) => byNumber.get(i.number)?.epic || ''));
        if (ids.has(e.id) && shows(x)) rows.push(itemHtml(x, s, n, byNumber, r).replace('<div class="rm-meta">', `<div class="rm-meta"><span class="badge" title="Its stage in the roadmap">stage ${s + 1}</span>`));
      }));
      if (!rows.length) return '';
      const items = r.stages.flatMap((st) => st.items).filter((x) => refs(x).some((i) => (byNumber.get(i.number)?.epic || '') === e.id));
      const done = items.filter((x) => x.status === 'done').length;
      return `<section class="rm-stage rm-epic">
          <div class="rm-stage-head"><b title="${esc(e.title)}">${esc(e.title)}</b>${e.id ? ` <span class="badge bl-epic" title="Epic ${esc(e.id)}">${esc(e.id)}</span>` : ''}
            <span class="spacer"></span><span class="muted small">${done} of ${items.length} item${items.length === 1 ? '' : 's'} done</span></div>
          <div class="rm-items">${rows.join('')}</div>
        </section>`;
    }).join('');
    return sections;
  }

  // ---- edits: a copy of the stages, changed, then saved whole ------------------------------
  function locate(stages, el) {
    const box = el.closest('[data-item]');
    const s = Number((box || el.closest('[data-stage]')).dataset.stage);
    const n = box ? stages[s].items.findIndex((x) => x.id === box.dataset.item) : -1;
    return { s, n };
  }

  function moveItem(stages, s, n, dir) {
    const [item] = stages[s].items.splice(n, 1);
    const to = n + dir;
    if (to >= 0 && to <= stages[s].items.length) { stages[s].items.splice(to, 0, item); return; }
    // past the stage's edge: into the previous/next stage (a new last stage when there is none)
    const t = s + dir;
    if (t < 0) { stages[s].items.unshift(item); return; }
    if (!stages[t]) stages.push({ name: '', note: '', items: [] });
    if (dir < 0) stages[t].items.push(item); else stages[t].items.unshift(item);
  }

  // Why issue `d.issue` of item `d.from` can't join item `toId` ('' when it can; #163).
  function dropProblem(stages, d, toId) {
    const items = (stages || []).flatMap((s) => s.items || []);
    const from = items.find((x) => x.id === d.from);
    const to = items.find((x) => x.id === toId);
    if (!from || !refs(from).some((i) => i.number === d.issue)) return `#${d.issue} is no longer in that item: the roadmap changed.`;
    if (!to) return 'Drop the issue on another item to run them together.';
    if (to === from) return `#${d.issue} is already in this item.`;
    if (!editable(to)) return `This item is ${to.waiting ? 'waiting at a gate' : to.status}: only planned or failed items take issues.`;
    return '';
  }

  // Moves issue `number` from item `fromId` into item `toId` (a group while it has two or more); the
  // emptied item goes. Items of either shape (an `issues` list, or a single issue stored as the item);
  // both keep their first issue's fields at the top for older readers.
  function moveIssue(stages, number, fromId, toId) {
    if (dropProblem(stages, { issue: number, from: fromId }, toId)) return false;
    const items = stages.flatMap((s) => s.items);
    const from = items.find((x) => x.id === fromId);
    const to = items.find((x) => x.id === toId);
    const issue = refs(from).find((i) => i.number === number);
    const left = refs(from).filter((i) => i.number !== number);
    setIssues(to, [...refs(to), issue]);
    if (left.length) setIssues(from, left);
    else for (const s of stages) s.items = s.items.filter((x) => x !== from);
    return true;
  }

  function setIssues(item, issues) {
    const { number, url, title, body, knownPullRequests } = issues[0];
    Object.assign(item, { number, url, title, body, knownPullRequests, issues });
  }

  /** The inputs of the Edit form `form` applied to `item` (its fields, the new name + value pair, Simulation). */
  function applyForm(item, form) {
    const inputs = { ...item.inputs };
    for (const el of form.querySelectorAll('[data-rm-field]')) {
      const k = el.dataset.rmField;
      // a switch: true/false for a boolean, "true"/"false" for an enum of those strings
      if (el.type === 'checkbox') inputs[k] = el.dataset.wiFlag === 'text' ? String(el.checked) : el.checked;
      else if (el.value.trim() === '') delete inputs[k];
      else inputs[k] = el.value.trim();
    }
    const name = form.querySelector('[data-rm-newname]')?.value.trim();
    if (name) {
      if (!/^[\w.-]+$/.test(name)) throw new Error('An input name has letters, digits, "_", "." or "-" only.');
      inputs[name] = form.querySelector('[data-rm-newvalue]')?.value.trim() || '';
    }
    item.inputs = inputs;
    const mock = form.querySelector('[data-rm-field-mock]');
    if (mock) item.mock = mock.checked;
    if (chainPicker) {
      const then = chainPicker.value();
      if (then) item.then = then; else delete item.then;
    }
  }

  // The Edit form's "When it finishes" (#134): mounted into the open form after each draw.
  // A redraw of the same open form (e.g. "+ add input") keeps what was picked.
  let chainPicker = null;
  let chainFor = null;
  function mountChain(data) {
    const box = document.querySelector('#bl-list [data-rm-chain]');
    const item = box && (data?.roadmap?.stages || []).flatMap((st) => st.items || []).find((x) => x.id === box.dataset.rmChain);
    if (!item) { chainPicker = null; chainFor = null; return; }
    const value = chainFor === item.id && chainPicker ? chainPicker.value() : item.then || null;
    const list = () => [...(workflows?.values() || [])];
    chainPicker = ChainPicker.mount(box, { workflows: list, source: () => workflows?.get(item.workflow) || null, value });
    chainFor = item.id;
  }

  // An edit's error: in the screen's error line and the console, never an unhandled rejection (#163).
  function failed(ctx, what, err) {
    console.error(`roadmap ${what}:`, err);
    ctx.setError(errMsg(err));
  }

  // `edit` (#281): { label, detail?, quiet? }: what the edit did, in the roadmap's words: the line of
  // the version kept before it (src/roadmap-history.js) and the title of its toast with Undo (not for a
  // `quiet` one: a mode, an input, a note, a cut line set).
  async function save(ctx, stages, edit = null) {
    try {
      const out = await (edit ? api.saveRoadmap(ctx.projectId, stages, edit.label) : api.saveRoadmap(ctx.projectId, stages));
      ctx.setData(out);
      if (edit && !edit.quiet) undoToast(ctx, out, edit.label, edit.detail);
    } catch (e) { failed(ctx, 'save', e); }
    ctx.render();
  }

  // #195: before a start (Start, Resume, Run this stage; `scope`: a stage id), the items still to run
  // whose workflow pushes while the default development workflow merges locally are listed: Switch
  // them to the default (saved, then the start goes on), Start anyway, or Cancel. → the roadmap to
  // start from (the switched one), or null when cancelled.
  async function checkPushes(ctx, r, scope) {
    const items = r.stages.filter((st) => !scope || st.id === scope).flatMap((st) => st.items).filter((x) => editable(x) && pushesAgainstDefault(x));
    if (!items.length) return r;
    const def = DefaultWorkflow.current();
    const names = items.map((x) => `${refs(x).map((i) => `#${i.number}`).join(' + ')} (${shortWorkflow(x.workflow)})`);
    const choice = await choiceDialog(
      `${items.length} item${items.length === 1 ? '' : 's'} will push and open PRs`,
      `${names.join(', ')}: ${items.length === 1 ? 'its workflow pushes' : 'their workflows push'} a branch and open${items.length === 1 ? 's' : ''} a PR/MR (CI minutes), while your default development workflow, ${def.name}, merges locally.`,
      [
        { id: 'switch', label: `Switch them to ${DefaultWorkflow.label(def.file)}`, line: `Switch: the items run with ${def.file} (their other inputs are kept).`, primary: true },
        { id: 'anyway', label: 'Start anyway', line: 'Start anyway: they push and open PRs as planned.' },
      ],
    );
    if (!choice) return null;
    if (choice === 'anyway') return r;
    const ids = new Set(items.map((x) => x.id));
    const stages = clone(r.stages);
    for (const x of stages.flatMap((st) => st.items)) if (ids.has(x.id)) Object.assign(x, { workflow: def.file, workflowName: def.name });
    const out = await api.saveRoadmap(ctx.projectId, stages);
    ctx.setData(out);
    return out?.roadmap || r;
  }

  // Run this stage (#141): only stage `s`'s items start, with Start's simulated choice and real-run
  // confirmation; earlier stages not done ask first (the Product Owner's order is a recommendation).
  async function runStage(ctx, r, s) {
    const stage = r.stages[s];
    if (!stage) return;
    const earlier = r.stages.slice(0, s).map((x, n) => (x.items.some((i) => i.status !== 'done' && i.status !== 'skipped') ? n : -1)).filter((n) => n >= 0);
    if (earlier.length && !await confirmDialog(`Run stage ${s + 1} out of order`, `${stagesText(earlier)} ${earlier.length > 1 ? 'are' : 'is'} not done: ${earlier.length > 1 ? 'their' : 'its'} issues may conflict with this stage's. They stay planned.`, 'Run this stage')) return;
    if (!await checkPushes(ctx, r, stage.id)) return;
    const simulated = !!document.querySelector('#rm-simulate')?.checked && devMode();
    const real = !simulated && stage.items.some((x) => !x.mock && editable(x));
    if (real && !await confirmDialog(`Run stage ${s + 1}`, 'Its items run as real runs: they use your CLI subscriptions and cost money. Human gates still wait for you. The roadmap pauses when this stage is done.', 'Run')) return;
    ctx.setData(await api.startRoadmap(ctx.projectId, simulated, stage.id));
  }

  // #194: a step chip of an item's ring opens its run with that group open (the Run screen's steps).
  function openRunAt(el) {
    const box = el.closest('[data-rm-progress]');
    const runId = box.dataset.rmProgress;
    window.showRun(runId, { workflow: box.dataset.workflow || undefined });
    if (el.dataset.grouped) state.runs.get(runId)?.openGroups?.set(el.dataset.rmChip, true);
    scheduleRender();
  }

  // #196: the bar's "Show the item": the item that paused the roadmap, scrolled into view and marked.
  function showItem(id) {
    const el = [...document.querySelectorAll('#bl-list [data-item]')].find((x) => x.dataset.item === id);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  // Retry or Skip an item (its card's buttons, the paused roadmap's alert): a retry that would redo an
  // ended run's kept work asks first (#112, #170): resume that run or start from scratch
  async function itemAction(ctx, itemId, action) {
    let out = await api.roadmapItem(ctx.projectId, itemId, action);
    if (out?.kept) {
      if (await keptWorkDialog(out.kept) !== 'scratch') return;
      out = await api.roadmapItem(ctx.projectId, itemId, action, true);
    }
    ctx.setData(out);
  }

  // ---- the ⋮ menu (#269) and the earlier versions (#281) -------------------------------------------------
  const focusMenu = (sel) => document.querySelector(`#bl-list .rm-menu-wrap ${sel}`)?.focus({ preventScroll: true });
  /** Closes the bar's ⋮ menu (a click elsewhere on the page); true when it was open. */
  function closeMenu() {
    const was = menuOpen;
    menuOpen = false;
    return was;
  }
  /** Keys of the ⋮ menu: Escape closes it (the focus goes back to its button), the arrows move between its entries. True when the key was the menu's. */
  function onKeyDown(e, ctx) {
    if (!menuOpen) return false;
    if (e.key === 'Escape') {
      e.preventDefault?.();
      menuOpen = false;
      ctx.render();
      focusMenu('[data-rm-menu]');
      return true;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return false;
    const items = [...document.querySelectorAll('#bl-list .rm-menu [role="menuitem"]')];
    if (!items.length) return false;
    e.preventDefault?.();
    const at = items.indexOf(document.activeElement);
    items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus({ preventScroll: true });
    return true;
  }

  // #281: an edit saved at once can be taken back from its toast: Undo puts back what the edit changed
  // (api.undoRoadmap → src/roadmap-undo.js), "Restored" or why it cannot be done takes the toast's place
  function undoToast(ctx, out, title, detail) {
    if (!out?.edit?.id) return;
    window.showToast?.(title, detail || '', null, null, {
      action: { label: 'Undo', run: async () => { ctx.setData(await api.undoRoadmap(ctx.projectId, out.edit.id)); ctx.render(); } },
    });
  }
  const numbers = (x) => refs(x).map((i) => `#${i.number}`).join(', ');
  const brief = (text, max = 40) => (String(text).length > max ? `${String(text).slice(0, max - 1)}…` : String(text));
  const stageName = (stage, s) => (stage?.name ? `stage "${brief(stage.name)}"` : `stage ${s + 1}`);

  // "Restore an earlier version…" (#281, the #rm-versions-modal dialog of backlog.js): the roadmap as it
  // was before each of the last edits, newest first; Restore follows Undo's rule (the service refuses
  // with the reason) and can itself be undone from its toast.
  const timeOf = (iso) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? '' : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };
  async function openVersions(ctx) {
    const q = (sel) => document.querySelector(sel);
    const modal = q('#rm-versions-modal');
    if (!modal) return;
    const list = q('#rm-versions');
    const error = q('#rm-versions-error');
    const close = () => modal.classList.add('hidden');
    error.textContent = '';
    list.innerHTML = '<li class="muted small">Loading…</li>';
    modal.classList.remove('hidden');
    q('#btn-rm-versions-close').onclick = close;
    q('#btn-rm-versions-close').focus({ preventScroll: true });
    let versions = [];
    try { versions = await api.roadmapVersions(ctx.projectId) || []; } catch (err) { error.textContent = errMsg(err); }
    list.innerHTML = versions.length
      ? versions.map((v) => `<li class="rm-version" data-testid="roadmap-version"><span class="rm-version-what" title="${esc(`The roadmap as it was before: ${v.label}`)}"><b>${esc(v.label)}</b><span class="muted small">${esc(timeOf(v.at))}</span></span><button class="btn sm" type="button" data-rm-restore="${esc(v.id)}" title="Put the roadmap back as it was before this edit">Restore</button></li>`).join('')
      : '<li class="muted small">No earlier version yet: one is kept before each edit of the roadmap.</li>';
    list.onclick = async (e) => {
      const btn = e.target.closest('[data-rm-restore]');
      if (!btn) return;
      btn.disabled = true;
      try {
        const out = await api.restoreRoadmapVersion(ctx.projectId, btn.dataset.rmRestore);
        ctx.setData(out);
        close();
        ctx.render();
        undoToast(ctx, out, 'Restored an earlier version', 'The roadmap is as it was before that edit; items that started since kept their runs.');
      } catch (err) {
        // refused (an issue is planned elsewhere now, the version is gone): nothing changed
        error.textContent = errMsg(err);
        btn.disabled = false;
      }
    };
  }

  // The owner's buttons; true when the click was the roadmap's. A click outside the ⋮ menu closes it.
  async function onClick(e, ctx, data) {
    const closing = menuOpen && !e.target.closest('.rm-menu-wrap');
    if (closing) menuOpen = false;
    const mine = await clicked(e, ctx, data);
    if (closing) ctx.render();
    return mine;
  }
  async function clicked(e, ctx, data) {
    const r = data?.roadmap;
    if (!r) return false;
    // #269: the ⋮ button opens its menu (the first entry gets the focus) or closes it
    if (e.target.closest('[data-rm-menu]')) {
      menuOpen = !menuOpen;
      ctx.render();
      focusMenu(menuOpen ? '[role="menuitem"]' : '[data-rm-menu]');
      return true;
    }
    // #271: the Oracle asked about the item's failure (gate-oracle.js: its drawer, the context chip, the question sent)
    const askBtn = e.target.closest('[data-rm-ask-oracle]');
    if (askBtn) {
      const id = askBtn.closest('[data-item]')?.dataset.item;
      const stage = r.stages.findIndex((s) => s.items.some((x) => x.id === id));
      const item = r.stages[stage]?.items.find((x) => x.id === id);
      if (item) window.GateOracle?.askAboutFailure({ item, roadmap: r, stage, project: ctx.projectId, run: state.runs?.get?.(item.runId)?.run || null });
      return true;
    }
    // #268: the Planned | All switch (and the empty state's "Show all items")
    const viewBtn = e.target.closest('[data-rm-view]');
    if (viewBtn) { ctx.setShowAll?.(viewBtn.dataset.rmView === 'all'); return true; }
    // #267: a stage's "+n done" chip unfolds its finished items, that stage only
    const doneChip = e.target.closest('[data-rm-done]');
    if (doneChip) {
      const key = doneChip.dataset.rmDone;
      if (!unfolded.delete(key)) unfolded.add(key);
      ctx.render();
      return true;
    }
    // #268: the page above; the stage that led the list stays where the owner reads
    const earlier = e.target.closest('[data-rm-earlier]');
    if (earlier) {
      const first = earlier.closest('.rm')?.querySelector('.rm-stage')?.dataset.stage;
      pages.earlier += 1;
      ctx.render();
      document.querySelector(`#bl-list .rm-stage[data-stage="${first}"]`)?.scrollIntoView({ block: 'start' });
      return true;
    }
    // the ring (#194): a click pins its steps open (hover shows them too); a chip opens the run there
    const chip = e.target.closest('[data-rm-chip]');
    if (chip) { openRunAt(chip); return true; }
    const ring = e.target.closest('[data-rm-ring]');
    if (ring) {
      const id = ring.closest('[data-rm-progress]').dataset.rmProgress;
      ringOpen = ringOpen === id ? null : id;
      ctx.render();
      return true;
    }
    const goto = e.target.closest('[data-rm-goto]');
    if (goto) { showItem(goto.dataset.rmGoto); return true; }
    // #260: a cut line's release run
    const releaseRun = e.target.closest('[data-rm-release-run]');
    if (releaseRun) { window.showRun(releaseRun.dataset.rmReleaseRun); return true; }
    const act = e.target.closest('[data-rm]')?.dataset.rm;
    const stages = clone(r.stages);
    try {
      if (act === 'start') {
        const simulated = !!document.querySelector('#rm-simulate')?.checked && devMode();
        // Resume on a stage run on its own (#141) goes on with that stage only
        // (a finished scope is not sent: #237); #243: a Resume's confirm says Resume
        const at = r.state === 'paused' ? scopedStage(r) : -1;
        const scope = at >= 0 ? r.stages[at].id : null;
        if (!await checkPushes(ctx, r, scope)) return true;
        const real = !simulated && r.stages.some((s) => (!scope || s.id === scope) && s.items.some((x) => !x.mock && editable(x)));
        const cost = 'they use your CLI subscriptions and cost money). Human gates still wait for you.';
        const [title, body, label] = r.state !== 'paused'
          ? ['Start the roadmap', 'Its items run as real runs: they use your CLI subscriptions and cost money. Human gates still wait for you.', 'Start']
          : at >= 0
            ? [`Resume stage ${at + 1}`, `Runs in progress keep going; the next planned items of stage ${at + 1} start as real runs (${cost} The roadmap pauses again when that stage is done.`, 'Resume']
            : ['Resume the roadmap', `Runs in progress keep going; the next planned items start as real runs (${cost}`, 'Resume'];
        if (real && !await confirmDialog(title, body, label)) return true;
        ctx.setData(await api.startRoadmap(ctx.projectId, simulated, scope));
      } else if (e.target.closest('[data-rm-run-stage]')) {
        await runStage(ctx, r, locate(stages, e.target).s);
      } else if (act === 'budget-raise' || act === 'budget-resume') {
        // #206: the budget cap paused it; real runs start again (they cost money)
        if (act === 'budget-resume' && !await confirmDialog('Resume anyway', 'The roadmap goes on past the budget until the day (or the night) ends. Its items run as real runs and cost money.', 'Resume')) return true;
        ctx.setData(await api.roadmapBudget(ctx.projectId, act === 'budget-raise' ? 'raise' : 'resume'));
      } else if (act === 'pause' || act === 'stop') {
        // #269: Stop asks first (the roadmap goes back to a plan); Pause is one click away from Resume
        if (act === 'stop' && !await confirmDialog('Stop the roadmap', 'The roadmap goes back to a plan: nothing new starts until you press Start. Runs in progress go on.', 'Stop')) return true;
        ctx.setData(await api.pauseRoadmap(ctx.projectId, act === 'stop'));
      } else if (act === 'clear') {
        menuOpen = false;
        if (!await confirmDialog('Clear the roadmap', 'Every stage is removed. Runs in progress go on.', 'Clear')) { ctx.render(); return true; }
        const out = await api.clearRoadmap(ctx.projectId);
        ctx.setData(out);
        undoToast(ctx, out, 'Cleared the roadmap', `${plural(r.stages.length, 'stage')} removed.`);
      } else if (act === 'versions') {
        menuOpen = false;
        ctx.render();
        await openVersions(ctx);
        return true;
      } else if (act === 'from-queue') {
        ctx.setData(await api.roadmapFromQueue(ctx.projectId));
      } else if (act === 'propose' || act === 'replace') {
        const text = document.querySelector('#rm-proposal')?.value.trim();
        if (!text) return true;
        let proposal;
        try { proposal = JSON.parse(text); } catch { throw new Error('The proposal is not valid JSON.'); }
        if (act === 'replace' && r.stages.length && !await confirmDialog('Replace the roadmap', 'The current stages are removed and the proposal takes their place, planned.', 'Replace')) return true;
        const out = await api.proposeRoadmap(ctx.projectId, proposal, act === 'replace');
        ctx.setData(out);
        if (out.dropped?.length) ctx.setError(`Already in the roadmap, left out of the proposal: ${out.dropped.map((n) => `#${n}`).join(', ')}`);
        if (act === 'replace') undoToast(ctx, out, 'Replaced the roadmap', `${plural(r.stages.length, 'stage')} gave way to the proposal.`);
      } else if (e.target.closest('[data-rm-item]')) {
        const box = e.target.closest('[data-item]');
        await itemAction(ctx, box.dataset.item, e.target.closest('[data-rm-item]').dataset.rmItem);
      } else if (e.target.closest('[data-rm-mode]')) {
        // the mode toggle: saved at once, on planned and failed items only
        const { s, n } = locate(stages, e.target);
        const item = stages[s]?.items[n];
        if (!item || !editable(item)) return true;
        item.inputs = { ...item.inputs, mode: e.target.closest('[data-rm-mode]').dataset.rmMode };
        await save(ctx, stages, { label: `Changed the mode of ${numbers(item)}`, quiet: true });
        return true;
      } else if (e.target.matches?.('input[data-rm-update-after]')) {
        // #279 "Update the app after this": saved at once, like the mode
        const { s, n } = locate(stages, e.target);
        const item = stages[s]?.items[n];
        if (!item || !editable(item)) return true;
        item.updateAfter = !!e.target.checked;
        await save(ctx, stages, { label: `Changed "Update the app after this" of ${numbers(item)}`, quiet: true });
        return true;
      } else if (e.target.closest('[data-rm-edit]')) {
        editing = e.target.closest('[data-item]').dataset.item;
        adding = false;
      } else if (e.target.closest('[data-rm-cancel]')) {
        editing = null;
        adding = false;
      } else if (e.target.closest('[data-rm-addinput]')) {
        adding = true;
      } else if (e.target.closest('[data-rm-save]')) {
        const { s, n } = locate(stages, e.target);
        const item = stages[s]?.items[n];
        if (!item || !editable(item)) return true;
        applyForm(item, e.target.closest('.rm-form'));
        editing = null;
        adding = false;
        await save(ctx, stages, { label: `Edited the inputs of ${numbers(item)}`, quiet: true });
        return true;
      } else if (e.target.closest('[data-rm-release]')) {
        // #260: a cut line after the stage: named in the dialog (add, rename) or removed, saved at once
        const el = e.target.closest('[data-rm-release]');
        const cut = el.closest('[data-cut-stage]');
        const stage = stages[cut ? Number(cut.dataset.cutStage) : locate(stages, el).s];
        if (!stage) return true;
        if (el.dataset.rmRelease === 'remove') {
          const name = stage.release?.name || '';
          if (!await confirmDialog('Remove the cut line', `The stages after it no longer wait for the release ${name}. Nothing is pushed either way.`, 'Remove')) return true;
          delete stage.release;
          await save(ctx, stages, { label: `Removed the cut line ${name}`.trim(), detail: 'The stages after it no longer wait for that release.' });
        } else {
          const name = await cutLineDialog(stage.release?.name || '');
          if (!name) return true;
          stage.release = { name };
          await save(ctx, stages, { label: `Set the cut line ${name}`, quiet: true });
        }
        return true;
      } else if (e.target.closest('[data-rm-addnote]')) {
        noteEditing = r.stages[locate(stages, e.target).s]?.id ?? null;
      } else if (e.target.closest('[data-rm-stage]')) {
        const { s } = locate(stages, e.target);
        const up = e.target.closest('[data-rm-stage]').dataset.rmStage === 'up';
        const t = s + (up ? -1 : 1);
        if (!stages[t]) return true;
        [stages[s], stages[t]] = [stages[t], stages[s]];
        await save(ctx, stages, { label: `Moved stage ${s + 1} ${up ? 'up' : 'down'}`, detail: `It is stage ${t + 1} now.` });
        return true;
      } else if (e.target.closest('[data-rm-move]')) {
        const { s, n } = locate(stages, e.target);
        const up = e.target.closest('[data-rm-move]').dataset.rmMove === 'up';
        const what = stages[s]?.items[n] ? numbers(stages[s].items[n]) : 'an item';
        moveItem(stages, s, n, up ? -1 : 1);
        await save(ctx, stages, { label: `Moved ${what} ${up ? 'up' : 'down'}` });
        return true;
      } else if (e.target.closest('[data-rm-remove]')) {
        const { s, n } = locate(stages, e.target);
        const [gone] = stages[s].items.splice(n, 1);
        // its stage goes with its last item (the service drops empty stages): the toast says so
        const detail = stages[s].items.length ? '' : `Its ${stageName(stages[s], s)} went too.`;
        await save(ctx, stages, { label: `Removed ${gone ? numbers(gone) : 'an item'} from the roadmap`, detail });
        return true;
      } else {
        return false;
      }
    } catch (err) {
      failed(ctx, 'edit', err);
    }
    ctx.render();
    // the form or note just opened: its first control gets the focus
    document.querySelector('.rm [autofocus]')?.focus({ preventScroll: true });
    return true;
  }

  // The stage's name and note: saved when they change (the Edit form saves with its Save button).
  async function onChange(e, ctx, data) {
    const r = data?.roadmap;
    const el = e.target;
    if (r && el.matches('[data-rm-live]')) {
      await setLive(ctx, r, el.checked);
      return true;
    }
    // #268: the date range (remembered by the owner)
    if (el.matches('[data-rm-since]')) {
      ctx.setSince?.(el.value);
      return true;
    }
    if (el.matches('[data-rm-by-epic]')) {
      byEpic = el.checked;
      try { localStorage.setItem(BY_EPIC_KEY, byEpic ? '1' : ''); } catch { /* storage unavailable */ }
      ctx.render();
      return true;
    }
    // #269: the filter row's epic (backlog.js keeps the choice, shared with the Board)
    if (el.matches('[data-rm-epic]')) {
      ctx.setEpic?.(el.value);
      return true;
    }
    if (!r || !el.closest('.rm-stage')) return false;
    const name = el.matches('[data-rm-name]');
    if (!name && !el.matches('[data-rm-note]')) return false;
    try {
      const stages = clone(r.stages);
      const { s } = locate(stages, el);
      const before = stages[s].name || '';
      if (name) stages[s].name = el.value;
      else { stages[s].note = el.value; noteEditing = null; }
      await save(ctx, stages, name
        ? { label: `Renamed stage ${s + 1}`, detail: `${before ? `"${brief(before)}"` : 'No name'} → ${el.value.trim() ? `"${brief(el.value.trim())}"` : 'no name'}` }
        : { label: `Changed the note of stage ${s + 1}`, quiet: true });
    } catch (err) {
      failed(ctx, 'edit', err);
      ctx.render();
    }
    return true;
  }

  // Drag: an item onto another stage (or item: before it), an issue onto another item. While
  // dragging, the target under the cursor is marked (#163): the item an issue joins, the line where
  // an item lands, or a refused item with its reason (`data-drop-why`).
  let dragging = null;
  let over = null; // { key, ok }: the target marked last
  let marked = [];
  function clearMarks() {
    for (const el of marked) { el.classList.remove('rm-drop-target', 'rm-drop-before', 'rm-drop-end', 'rm-drop-denied'); delete el.dataset.dropWhy; }
    marked = [];
    over = null;
  }
  function mark(el, cls, why) {
    el.classList.add(cls);
    if (why) el.dataset.dropWhy = why;
    marked.push(el);
  }
  function onDragStart(e) {
    const issue = e.target.closest('[data-drag-issue]');
    const item = e.target.closest('[data-drag-item]');
    if (issue) dragging = { issue: Number(issue.dataset.dragIssue), from: issue.dataset.from };
    else if (item) dragging = { item: item.dataset.item };
    else return;
    e.stopPropagation();
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', JSON.stringify(dragging));
  }
  function onDragOver(e, data) {
    const stageEl = dragging ? e.target.closest('[data-drop-stage]') : null;
    if (!stageEl) { clearMarks(); return; }
    const itemEl = e.target.closest('[data-item]');
    const key = itemEl ? `item:${itemEl.dataset.item}` : `stage:${stageEl.dataset.dropStage}`;
    if (over?.key !== key) {
      clearMarks();
      let ok = true;
      if (dragging.issue) {
        const why = dropProblem(data?.roadmap?.stages, dragging, itemEl?.dataset.item);
        ok = !why;
        // its own item stays unmarked while the drag has just started there; once the cursor has
        // left it, coming back shows why it is refused ("already in this item")
        const home = itemEl?.dataset.item === dragging.from;
        if (!home) dragging.left = true;
        if (!home || dragging.left) mark(itemEl || stageEl, ok ? 'rm-drop-target' : 'rm-drop-denied', why);
      } else if (itemEl?.dataset.item === dragging.item) {
        ok = false;
      } else if (itemEl) {
        mark(itemEl, 'rm-drop-before');
      } else {
        mark(stageEl, 'rm-drop-end');
      }
      over = { key, ok };
    }
    if (over.ok) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
  }
  // The drag ended (dropped or cancelled): the marks go.
  function onDragEnd() {
    dragging = null;
    clearMarks();
  }
  async function onDrop(e, ctx, data) {
    const d = dragging;
    onDragEnd();
    const r = data?.roadmap;
    const stageEl = e.target.closest('[data-drop-stage]');
    if (!d || !r || !stageEl) return;
    e.preventDefault();
    try {
      const stages = clone(r.stages);
      const targetItem = e.target.closest('[data-item]')?.dataset.item;
      const t = Number(stageEl.dataset.dropStage);
      let label;
      if (d.issue) {
        const why = dropProblem(stages, d, targetItem);
        if (why) { ctx.setError(why); ctx.render(); return; }
        const onto = stages.flatMap((st) => st.items).find((x) => x.id === targetItem);
        label = `Moved #${d.issue} ${onto ? `into the item of ${numbers(onto)}` : `to stage ${t + 1}`}`;
        moveIssue(stages, d.issue, d.from, targetItem);
      } else {
        const s = stages.findIndex((st) => st.items.some((x) => x.id === d.item));
        if (s < 0 || targetItem === d.item) return;
        const [item] = stages[s].items.splice(stages[s].items.findIndex((x) => x.id === d.item), 1);
        const at = targetItem ? stages[t].items.findIndex((x) => x.id === targetItem) : -1;
        stages[t].items.splice(at < 0 ? stages[t].items.length : at, 0, item);
        label = `Moved ${numbers(item)} ${s === t ? `within stage ${t + 1}` : `to stage ${t + 1}`}`;
      }
      await save(ctx, stages, { label });
    } catch (err) {
      failed(ctx, 'drop', err);
      ctx.render();
    }
  }

  /** A new stage at the end with the assign dialog's issues: one item (group) or one per issue; `reason`/`modeReason`/`origin`: the Product Owner's. */
  // then: the items' chain (#134), from the Assign dialog's "When it finishes"
  async function addStage(ctx, data, { issues: asked, workflow, workflowName, inputs, mock, group, reason, modeReason, origin, then, cost }) {
    // #253: an epic groups issues, it is never planned as work
    const issues = asked.filter((i) => !i?.isEpic);
    if (!issues.length) return;
    const stages = clone(data?.roadmap?.stages);
    const why = { ...(reason ? { reason } : {}), ...(modeReason ? { modeReason } : {}), ...(origin ? { origin } : {}), ...(then ? { then } : {}), ...(cost ? { cost } : {}) };
    const items = group ? [{ workflow, workflowName, inputs, mock, issues, ...why }] : issues.map((n) => ({ workflow, workflowName, inputs, mock, issues: [n], ...why }));
    stages.push({ name: '', note: '', items });
    ctx.setData(await api.saveRoadmap(ctx.projectId, stages));
  }

  // #204: a live reload waits while the owner drags, or edits an item or a stage's note; Reload in
  // the Edit form's "The roadmap changed" notice closes the form (its values were not saved).
  const busy = () => !!(dragging || editing || noteEditing);
  function closeEdit() {
    editing = null;
    adding = false;
    noteEditing = null;
  }

  window.BacklogRoadmap = {
    addStage,
    alerts,
    badge,
    busy,
    closeEdit,
    closeMenu,
    dropProblem,
    html,
    liveBanner,
    loadMore,
    mountChain,
    mounted,
    moveIssue,
    onChange,
    onClick,
    onDragEnd,
    onDragOver,
    onDragStart,
    onDrop,
    onKeyDown,
    tick,
  };
})();
