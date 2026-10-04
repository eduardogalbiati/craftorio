// The Roadmap screen (#106; Code & Build › Roadmap since #254, drawn by backlog.js): a project's ordered stages of runs (src/roadmap.js), each stage started
// when the previous one has finished and merged. Each item leads with its issues' titles (a list,
// one line per issue, linked; #110), then badges: its state (planned / running / waiting at a gate /
// done / failed / skipped), the workflow's short name, the mode (a one-click toggle on planned and
// failed items, saved at once), the complexity total of its `complexity:n` labels, a link to the
// run; and the Product Owner's reason (#105) under the titles. The other inputs are edited in an
// Edit form built from the workflow's input definitions (api.listWorkflows, loaded once) by
// WorkflowInputs (workflow-inputs.js, #116: human labels, pills, switches, show_if), with Save / Cancel. The plan is edited too:
// stages and items up/down or by drag, an issue dragged from one item to another, items removed, a
// stage renamed or given a note ("add note"). Start (optionally simulated), Pause, Stop, Clear;
// Retry / Skip on a failed item; Run this stage on a stage's head (#141: only its items, then the
// roadmap pauses; out of order after a confirmation). A Product Owner proposal (#105, JSON) is added or replaces the
// roadmap as planned; the plain queue's items can be moved in. Every edit saves the whole list of
// stages (api.saveRoadmap); the service keeps each item's runs by id.
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
// Open work (#217): html()'s `view` ({ epic, showAll }, the Backlog's filter shared with the Board
// tab) hides finished stages ("N finished stages hidden") and folds a stage's done items ("+N done")
// unless Show all; the epic keeps only its items. Stage numbers and edits use the real indexes.
// An item with a run (#194) has a progress ring on the right of its card: the estimated % (RunProgress.
// estimateProgress over the item's `run` from the service: its trail and its workflow's typical step
// times), the current step or group with its agent, the gate / failure / done states; hovering or
// clicking the ring shows the run's steps (the runs list's chips), a chip opens the run at that group.
// The run's summary (estimate, elapsed and time left, now, gate, run id) heads that popover (#236):
// the ring, the step text and the chips carry no native title over the app's popover and cards.
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
// Rendered into #bl-list by backlog.js (mode 'roadmap'), which passes `ctx`
// ({ projectId, setData, render, setError }). Uses app.js globals (esc, state, errMsg, devMode, confirmDialog,
// fmtDur, agentLabel, scheduleRender), run-list.js's (progressChip, robotAvatar, PERSON_SVG, ENGINE_SVG),
// choiceDialog (kept-work-dialog.js), RunProgress and DefaultWorkflow.
/* global api */
(() => {
  const STATE_LABEL = { planned: 'planned', running: 'running', paused: 'paused', done: 'done' };
  // an item's state: [pill colour, label]
  const ITEM_STATE = {
    planned: ['idle', 'planned'],
    running: ['running', 'running'],
    waiting: ['cancelled', 'waiting at a gate'],
    done: ['success', 'done'],
    failed: ['failed', 'failed'],
    skipped: ['interrupted', 'skipped'],
  };
  const ICON = {
    validated: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    auto: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M13 2 3 14h9l-1 8 10-12h-9z"/></svg>',
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
  // #195: an item whose workflow pushes (a branch, a PR/MR, CI minutes) while the default merges locally
  function pushesAgainstDefault(x) {
    const def = window.DefaultWorkflow?.current();
    return def?.merge === 'local' && x.workflow !== def.file && workflows?.get(x.workflow)?.merge === 'remote';
  }
  // #196: Retry / Skip on a failed run and on a refused start (the item that paused the roadmap, or an
  // error without a run, e.g. kept work of an ended run), never while its run is alive
  const refusedStart = (x) => !x.runId && !!x.error && x.status !== 'skipped' && x.status !== 'done';
  const retryable = (x, r) => x.status === 'failed' || (x.status !== 'running' && (r?.pausedBy === x.id || refusedStart(x)));
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
    return `<span class="badge bl-roadmap" title="${esc(`${i.roadmap.name}: ${i.roadmap.status}`)}">Roadmap: stage ${i.roadmap.stage}${i.roadmap.status === 'planned' ? '' : ` · ${esc(i.roadmap.status)}`}</span>${released}`;
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
    const est = RunProgress.estimateProgress({ steps: run.progress || [], path, typical: run.stepTimes || {}, status: run.status, startedAt: run.startedAt });
    return x.waiting && est.state === 'running' ? { ...est, state: 'waiting' } : est;
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
      `Now: ${label}${est.state === 'running' || est.state === 'waiting' ? ` (${who})` : ''}`,
      // the gate's "What happened" line (#213)
      est.state === 'waiting' && run.gate ? `Gate: ${run.gate}` : '',
      `Run ${x.runId}${run.mock ? ' (simulated)' : ''}`,
    ].filter(Boolean);
    const how = `How: ${basis}. A return to an earlier step lowers it; it stays under 100% until the run ends.`;
    const pct = est.state === 'done' ? 100 : est.percent;
    const chips = RunProgress.progressGroups(run.progress || [], run.groups || [], run.status === 'running' || run.status === 'pending' ? 'running' : run.status);
    const steps = chips.length
      ? `<div class="rp-strip">${chips.map((c) => `<button type="button" class="rm-chip" data-rm-chip="${esc(c.name)}" data-grouped="${c.grouped ? '1' : ''}" aria-label="${esc(`Open the run at ${c.grouped ? c.name : `${readable(c.name, run.stepNames)} (${c.name})`}`)}">${progressChip(c, run.agentNames, run.workflow, run.stepNames)}</button>`).join('<span class="rp-sep">›</span>')}</div>`
      : '<p class="small muted">No step has started yet.</p>';
    const head = `<div class="rm-run-summary small" data-testid="roadmap-run-summary">${summary.map((l) => `<div>${esc(l)}</div>`).join('')}<div class="muted">${esc(how)}</div><div class="muted">Click a step to open the run there.</div></div>`;
    return `
      <div class="rm-progress st-${est.state}${run.mock ? ' sim' : ''}${ringOpen === x.runId ? ' open' : ''}" data-rm-progress="${esc(x.runId)}" data-workflow="${esc(run.workflow || x.workflowName || '')}">
        <button type="button" class="rm-ring" data-rm-ring aria-expanded="${ringOpen === x.runId}" aria-label="${esc(`${pct}% estimated, ${label}${whereId}. Show the run's steps`)}">
          <svg viewBox="0 0 36 36" aria-hidden="true"><circle class="rm-ring-track" cx="18" cy="18" r="15.9155"/><circle class="rm-ring-bar" cx="18" cy="18" r="15.9155" stroke-dasharray="${pct} ${100 - pct}"/></svg>
          <span class="rm-ring-pct">${pct}%</span>
        </button>
        <div class="rm-progress-text">
          <span class="rm-progress-step" data-testid="roadmap-progress-step"><span class="rp-av${human ? ' human' : agent?.provider ? '' : ' engine'}" aria-hidden="true">${art}</span><span>${esc(label)}</span></span>
          ${run.mock ? '<span class="badge p-mock">simulated</span>' : ''}
        </div>
        <div class="rm-steps" role="group" aria-label="The run's steps">${head}${steps}</div>
      </div>`;
  }

  // `r`: the roadmap (which item paused it, #196)
  function itemHtml(x, s, n, byNumber, r) {
    const status = x.waiting ? 'waiting' : x.status;
    const [pill, stateLabel] = ITEM_STATE[status] || ['idle', status];
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
    return `
      <div class="rm-item rm-${esc(status)}" data-testid="roadmap-item" data-item="${esc(x.id)}" data-stage="${s}"${locked || open ? '' : ' draggable="true" data-drag-item'}>
        <div class="rm-item-head">
          <ul class="rm-titles">${titles}</ul>
          <div class="rm-actions">
            ${retryable(x, r) ? `<button class="btn sm primary" type="button" data-rm-item="retry" title="${refused ? 'Start it again: when an ended run kept work for its issues, you choose to resume that run or start from scratch' : 'Run it again (a new run)'}">Retry</button><button class="btn sm ghost" type="button" data-rm-item="skip" title="Count it as finished: the roadmap goes on">Skip</button>` : ''}
            ${locked ? '' : `<button class="btn sm ghost" type="button" data-rm-move="up" title="Earlier in the stage (or into the previous stage)"${n === 0 && s === 0 ? ' disabled' : ''}>↑</button>
            <button class="btn sm ghost" type="button" data-rm-move="down" title="Later in the stage (or into the next stage)">↓</button>
            <button class="link-btn small" type="button" data-rm-remove title="Take this item out of the roadmap">remove</button>`}
          </div>
          ${progressHtml(x)}
        </div>
        <div class="rm-meta">
          <span class="pill pill-${pill} rm-state"${x.waiting && x.run?.gate ? ` title="${esc(x.run.gate)}"` : ''}>${esc(stateLabel)}</span>
          <span class="badge rm-wf${push ? ' rm-wf-push' : ''}" title="${esc(`${x.workflowName && x.workflowName !== x.workflow ? `${x.workflowName} (${x.workflow})` : x.workflow}${push ? `. It pushes a branch and opens a PR/MR, while the default development workflow (${DefaultWorkflow.current().file}) merges locally` : ''}`)}">${push ? '<span aria-hidden="true">⇡ </span>' : ''}${esc(shortWorkflow(x.workflow))}</span>
          ${modeHtml(x, locked)}
          ${size != null ? `<span class="badge rm-size" title="The sum of the issues' complexity:n labels">complexity ${size}</span>` : ''}
          ${costHtml(x)}
          ${x.mock ? '<span class="badge p-mock">simulated</span>' : ''}
          ${x.then ? ChainModel.chainBadgesHtml({ then: x.then }) : ''}
          ${WorkflowInputs.inputPills(workflows?.get(x.workflow) || null, x.inputs, { skip: ['mode'] })}
          ${x.runId ? `<button class="bl-run link-btn small" type="button" data-run="${esc(x.runId)}" data-workflow="${esc(x.workflowName || '')}" title="Open the run (Resume from step… is there)">run ${esc(x.runId)}</button>` : ''}
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

  // `scoped`: the index of the stage run on its own (#141), -1 when none; `r`: the roadmap; `show`:
  // which items the view shows (#217, every item by default); `folded`: its finished items hidden.
  function stageHtml(stage, s, count, current, byNumber, scoped, r, show = () => true, folded = 0) {
    const done = stage.items.every(finished);
    const noteOpen = noteEditing != null && noteEditing === stage.id;
    const note = noteOpen
      ? `<input type="text" class="rm-note small" data-rm-note value="${esc(stage.note || '')}" placeholder="Why this order" aria-label="Stage note" autofocus />`
      : stage.note ? `<p class="rm-note-text small muted">${esc(stage.note)} <button class="link-btn small" type="button" data-rm-addnote>edit</button></p>` : '';
    const runnable = r.state !== 'running' && stage.items.some((x) => x.status === 'planned');
    const runTitle = r.state === 'running' ? 'The roadmap is running: pause or stop it first' : runnable ? 'Run only this stage\'s items; the roadmap pauses when they are done' : 'No planned item in this stage';
    const stateBadge = s === scoped ? `<span class="badge ${r.state === 'running' ? 'live' : 'warn'}">${r.state === 'running' ? 'Running this stage only' : 'This stage only · paused'}</span>`
      : s === current ? '<span class="badge live">current</span>' : done ? '<span class="badge">done</span>' : '';
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
        <div class="rm-items">${stage.items.map((x, n) => (show(x) ? itemHtml(x, s, n, byNumber, r) : '')).join('')}${folded
    ? `<button class="link-btn small rm-folded" type="button" data-rm-show-all title="Done or skipped items of this stage, hidden: Show all brings them back">+${folded} done</button>` : ''}</div>
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

  // ---- what the Roadmap shows (#217): the open work by default, Show all, the epic filter ------
  const finished = (x) => x.status === 'done' || x.status === 'skipped';
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
   * The stages the view shows: [{ stage, s (its real index), show (item → bool), folded }] and how
   * many finished stages it hides. `view`: { epic, showAll } (the Backlog's filter, both tabs).
   */
  function visibleStages(r, view, byNumber) {
    const out = [];
    let hidden = 0;
    r.stages.forEach((stage, s) => {
      const mine = stage.items.filter((x) => inEpic(x, view.epic, byNumber));
      if (!stage.items.length && !view.epic) { out.push({ stage, s, show: () => true, folded: 0 }); return; }
      if (!mine.length) return;
      const open = mine.filter((x) => !finished(x));
      if (view.showAll) { out.push({ stage, s, show: (x) => mine.includes(x), folded: 0 }); return; }
      if (!open.length) { hidden++; return; }
      out.push({ stage, s, show: (x) => open.includes(x), folded: mine.length - open.length });
    });
    return { stages: out, hidden };
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
      <span class="bl-live-text"><b>Live roadmap</b>: refills itself from the backlog · <span class="${tone ? `${tone}-text` : ''}" title="${esc(r.liveRefill?.message || '')}">${esc(text)}</span>${idle ? ` · <span class="muted">roadmap ${esc(STATE_LABEL[r.state] || r.state)}</span>` : ''}</span>
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
   * redraws once the workflows are loaded. `view` (#217): the Backlog's filter shared with the Board
   * tab, { epic, showAll }: without Show all, only the open work (finished stages hidden, a stage's
   * finished items folded); the epic keeps only its items and hides the stages left empty.
   */
  function html(data, rerender, view = {}) {
    loadWorkflows(rerender);
    const v = { epic: view.epic || '', showAll: !!view.showAll };
    const r = data?.roadmap || { state: 'planned', stages: [] };
    const q = data?.queue?.items || [];
    const byNumber = new Map((data?.issues || []).map((i) => [i.number, i]));
    // a stage run on its own (#141) is the one in progress; the others keep their planned look
    const scoped = scopedStage(r);
    const current = scoped >= 0 ? scoped : r.stages.findIndex((s) => s.items.some((x) => x.status !== 'done' && x.status !== 'skipped'));
    const stateBadge = `<span class="badge ${r.state === 'running' ? 'live' : r.state === 'paused' ? 'warn' : ''}">${esc(STATE_LABEL[r.state] || r.state)}${scoped >= 0 ? ` · stage ${scoped + 1} only` : ''}${r.simulated ? ' · simulated' : ''}</span>`;
    const bar = `
      <div class="bl-queue rm-bar" data-testid="roadmap-bar">
        <span><b>Roadmap</b> ${stateBadge} ${r.stages.length} stage${r.stages.length === 1 ? '' : 's'}</span>
        ${r.error ? `<span class="${r.state === 'paused' ? 'warn-text' : 'error'} small">${esc(r.error)}${r.pausedBy ? ` <button class="link-btn small" type="button" data-rm-goto="${esc(r.pausedBy)}" title="Scroll to the item that paused the roadmap: Retry or Skip it there">Show the item</button>` : ''}${r.state === 'paused' && r.budget ? ` <button class="btn sm primary" type="button" data-rm="budget-raise" title="${esc(`The ${r.budget.period === 'night' ? 'night' : 'daily'} budget becomes what is spent plus the next stage, for ${r.budget.period === 'night' ? 'tonight' : 'today'} only; the roadmap goes on`)}">Raise for ${r.budget.period === 'night' ? 'tonight' : 'today'}</button> <button class="btn sm ghost" type="button" data-rm="budget-resume" title="${esc(`This roadmap ignores the budget until ${r.budget.period === 'night' ? 'the night' : 'the day'} ends; the budget stays as it is`)}">Resume anyway</button>` : ''}</span>` : ''}
        <span class="spacer"></span>
        ${r.state !== 'running' && r.stages.length ? `<label class="check small dev-only"><input type="checkbox" id="rm-simulate"${state.simulationOnly || r.simulated ? ' checked' : ''} /><span>Simulated</span></label>
          <button class="btn sm primary" type="button" data-rm="start"${scoped >= 0 && r.state === 'paused' ? ` title="Resume stage ${scoped + 1} only"` : ''}>${r.state === 'paused' ? 'Resume' : 'Start'}</button>` : ''}
        ${r.state === 'running' ? '<button class="btn sm ghost" type="button" data-rm="pause" title="Nothing new starts; runs in progress go on">Pause</button>' : ''}
        ${r.state === 'running' || r.state === 'paused' ? '<button class="btn sm ghost" type="button" data-rm="stop" title="Back to a plan: nothing starts until Start">Stop</button>' : ''}
        ${r.stages.length ? '<button class="btn sm ghost" type="button" data-rm="clear">Clear</button>' : ''}
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
    const showAllToggle = r.stages.length ? `<label class="check small rm-show-all" title="Show the done and skipped stages and items too (by default only the open work: running, waiting, failed and planned)"><input type="checkbox" data-rm-show-all-toggle${v.showAll ? ' checked' : ''} /><span>Show all</span></label>` : '';
    const vis = visibleStages(r, v, byNumber);
    const allItems = r.stages.flatMap((s) => s.items);
    const shownItems = vis.stages.reduce((a, x) => a + x.stage.items.filter(x.show).length, 0);
    const epicName = v.epic === NO_EPIC ? 'with no epic' : `in epic ${epics.find((e) => e.id === v.epic)?.title || v.epic}`;
    const count = r.stages.length && (v.epic || !v.showAll) ? `<span class="small muted rm-count">${shownItems} of ${allItems.length} item${allItems.length === 1 ? '' : 's'} shown</span>` : '';
    const hiddenLine = vis.hidden ? `<p class="small muted rm-hidden-line">${vis.hidden} finished stage${vis.hidden === 1 ? '' : 's'} hidden${v.epic ? ` (${esc(epicName)})` : ''} · <button class="link-btn small" type="button" data-rm-show-all>Show all</button></p>` : '';
    const nothing = `<div class="empty-state"><b>No ${v.showAll ? '' : 'open '}roadmap items${v.epic ? ` ${esc(epicName)}` : ''}.</b>
      <p class="muted">${v.showAll ? 'Pick another epic, or All epics.' : 'Finished work is hidden.'}</p>${v.showAll ? '' : '<button class="btn sm ghost" type="button" data-rm-show-all>Show all</button>'}</div>`;
    // #260: each shown stage with its cut line; a hidden (finished) stage's line still shows while its release has not shipped
    const shown = new Map(vis.stages.map((x) => [x.s, x]));
    const staged = r.stages.map((stage, s) => {
      const x = shown.get(s);
      if (x) return stageHtml(stage, s, r.stages.length, current, byNumber, scoped, r, x.show, x.folded) + cutLineHtml(stage, s);
      return !v.epic && stage.release?.status !== 'shipped' ? cutLineHtml(stage, s) : '';
    }).join('');
    const stages = !r.stages.length
      ? '<div class="empty-state"><b>No roadmap yet</b><p class="muted">Select issues, Assign workflow…, then Add to roadmap: each addition is a stage that starts when the previous one has finished and merged.</p></div>'
      // grouped by epic: no stages to draw the lines between, so the ones still waiting lead the list
      : grouped ? r.stages.map((stage, s) => (stage.release?.status !== 'shipped' ? cutLineHtml(stage, s, true) : '')).join('') + byEpicHtml(r, epics, byNumber, v)
        : staged.trim() ? staged : nothing;
    const liveHtml = r.stages.length ? liveBox(r) : '';
    return `<div class="rm">${bar.replace('<span class="spacer"></span>', `${count}<span class="spacer"></span>${showAllToggle}${toggle}`)}${queued}${grouped ? '' : hiddenLine}${stages}${liveHtml}${importBox}</div>`;
  }

  // #138: the items under their issues' epics (an item of issues in two epics shows under both; "No
  // epic" last), each with its stage; editing stays in the stage view. `v`: the view's filter (#217).
  function byEpicHtml(r, epics, byNumber, v = {}) {
    const sections = [...epics.map((e) => ({ id: e.id, title: e.title })), { id: '', title: 'No epic' }].map((e) => {
      if (v.epic && v.epic !== (e.id || NO_EPIC)) return '';
      const rows = [];
      r.stages.forEach((stage, s) => stage.items.forEach((x, n) => {
        const ids = new Set(refs(x).map((i) => byNumber.get(i.number)?.epic || ''));
        if (ids.has(e.id) && (v.showAll || !finished(x))) rows.push(itemHtml(x, s, n, byNumber, r).replace('<div class="rm-meta">', `<div class="rm-meta"><span class="badge" title="Its stage in the roadmap">stage ${s + 1}</span>`));
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

  async function save(ctx, stages) {
    try { ctx.setData(await api.saveRoadmap(ctx.projectId, stages)); } catch (e) { failed(ctx, 'save', e); }
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

  // The owner's buttons; true when the click was the roadmap's.
  async function onClick(e, ctx, data) {
    const r = data?.roadmap;
    if (!r) return false;
    // #217: "Show all" (the hidden-stages line, a stage's "+N done", the empty state)
    if (e.target.closest('[data-rm-show-all]')) { ctx.setShowAll?.(true); return true; }
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
        ctx.setData(await api.pauseRoadmap(ctx.projectId, act === 'stop'));
      } else if (act === 'clear') {
        if (!await confirmDialog('Clear the roadmap', 'Every stage is removed. Runs in progress go on.', 'Clear')) return true;
        ctx.setData(await api.clearRoadmap(ctx.projectId));
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
      } else if (e.target.closest('[data-rm-item]')) {
        const box = e.target.closest('[data-item]');
        const action = e.target.closest('[data-rm-item]').dataset.rmItem;
        let out = await api.roadmapItem(ctx.projectId, box.dataset.item, action);
        // a retry that would redo an ended run's kept work asks first (#112, #170): resume that run or start from scratch
        if (out?.kept) {
          if (await keptWorkDialog(out.kept) !== 'scratch') return true;
          out = await api.roadmapItem(ctx.projectId, box.dataset.item, action, true);
        }
        ctx.setData(out);
      } else if (e.target.closest('[data-rm-mode]')) {
        // the mode toggle: saved at once, on planned and failed items only
        const { s, n } = locate(stages, e.target);
        const item = stages[s]?.items[n];
        if (!item || !editable(item)) return true;
        item.inputs = { ...item.inputs, mode: e.target.closest('[data-rm-mode]').dataset.rmMode };
        await save(ctx, stages);
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
        await save(ctx, stages);
        return true;
      } else if (e.target.closest('[data-rm-release]')) {
        // #260: a cut line after the stage: named in the dialog (add, rename) or removed, saved at once
        const el = e.target.closest('[data-rm-release]');
        const cut = el.closest('[data-cut-stage]');
        const stage = stages[cut ? Number(cut.dataset.cutStage) : locate(stages, el).s];
        if (!stage) return true;
        if (el.dataset.rmRelease === 'remove') {
          if (!await confirmDialog('Remove the cut line', `The stages after it no longer wait for the release ${stage.release?.name || ''}. Nothing is pushed either way.`, 'Remove')) return true;
          delete stage.release;
        } else {
          const name = await cutLineDialog(stage.release?.name || '');
          if (!name) return true;
          stage.release = { name };
        }
        await save(ctx, stages);
        return true;
      } else if (e.target.closest('[data-rm-addnote]')) {
        noteEditing = r.stages[locate(stages, e.target).s]?.id ?? null;
      } else if (e.target.closest('[data-rm-stage]')) {
        const { s } = locate(stages, e.target);
        const t = s + (e.target.closest('[data-rm-stage]').dataset.rmStage === 'up' ? -1 : 1);
        if (!stages[t]) return true;
        [stages[s], stages[t]] = [stages[t], stages[s]];
        await save(ctx, stages);
        return true;
      } else if (e.target.closest('[data-rm-move]')) {
        const { s, n } = locate(stages, e.target);
        moveItem(stages, s, n, e.target.closest('[data-rm-move]').dataset.rmMove === 'up' ? -1 : 1);
        await save(ctx, stages);
        return true;
      } else if (e.target.closest('[data-rm-remove]')) {
        const { s, n } = locate(stages, e.target);
        stages[s].items.splice(n, 1);
        await save(ctx, stages);
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
    if (el.matches('[data-rm-show-all-toggle]')) {
      ctx.setShowAll?.(el.checked);
      return true;
    }
    if (el.matches('[data-rm-by-epic]')) {
      byEpic = el.checked;
      try { localStorage.setItem(BY_EPIC_KEY, byEpic ? '1' : ''); } catch { /* storage unavailable */ }
      ctx.render();
      return true;
    }
    if (!r || !el.closest('.rm-stage')) return false;
    const name = el.matches('[data-rm-name]');
    if (!name && !el.matches('[data-rm-note]')) return false;
    try {
      const stages = clone(r.stages);
      const { s } = locate(stages, el);
      if (name) stages[s].name = el.value;
      else { stages[s].note = el.value; noteEditing = null; }
      await save(ctx, stages);
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
      if (d.issue) {
        const why = dropProblem(stages, d, targetItem);
        if (why) { ctx.setError(why); ctx.render(); return; }
        moveIssue(stages, d.issue, d.from, targetItem);
      } else {
        const s = stages.findIndex((st) => st.items.some((x) => x.id === d.item));
        if (s < 0 || targetItem === d.item) return;
        const [item] = stages[s].items.splice(stages[s].items.findIndex((x) => x.id === d.item), 1);
        const t = Number(stageEl.dataset.dropStage);
        const at = targetItem ? stages[t].items.findIndex((x) => x.id === targetItem) : -1;
        stages[t].items.splice(at < 0 ? stages[t].items.length : at, 0, item);
      }
      await save(ctx, stages);
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
    badge,
    busy,
    closeEdit,
    dropProblem,
    html,
    liveBanner,
    mountChain,
    moveIssue,
    onChange,
    onClick,
    onDragEnd,
    onDragOver,
    onDragStart,
    onDrop,
  };
})();
