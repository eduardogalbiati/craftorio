/* global api */
// Workflows screen and its sidebar sub-items (state.workflowsTab): Runs (every run, in the shared run
// list of run-list.js), Definitions (#137: the workflows in sections by category, compact cards with
// origin badge, Restore default, Open in builder, Run, and the saved pipelines connected) and Builder (builder.js, with its two dialogs). The header has the
// Keep awake switch on Runs and Definitions (keep-awake.js, #162). The deep links
// showRunInList (app.js openPastRun) and showWorkflowDefinition (the Agents menu), and the runs'
// reload on run events (loadWorkflowRunsThrottled, workflowRunsVisible, renderWorkflowRuns) stay
// globals. Registers itself with registerView (view-registry.js); uses app.js globals ($, esc, state,
// api, errMsg, showView, openDrawer, noteRunMeta, confirmDialog, showToast, CATEGORIES).

const WORKFLOW_PAGES = {
  runs: 'Every run, live or finished.',
  definitions: 'Workflows are YAML files in the workflows folder.',
  builder: 'Draw a workflow: desks in a line, each with an agent, and approval gates. Saved as YAML in the workflows folder.',
};
function showWorkflowsTab(tab) {
  if (!WORKFLOW_PAGES[tab]) tab = 'runs';
  state.workflowsTab = tab;
  if (state.view !== 'workflows') return showView('workflows');
  document.querySelectorAll('[data-wtab]').forEach((b) => {
    const on = b.dataset.wtab === tab;
    b.classList.toggle('active', on);
    b.setAttribute('aria-current', on ? 'page' : 'false');
  });
  document.querySelectorAll('[data-wpage]').forEach((p) => p.classList.toggle('hidden', p.dataset.wpage !== tab));
  $('#workflows-page-title').textContent = { runs: 'Runs', definitions: 'Definitions', builder: 'Builder' }[tab];
  $('#workflows-page-hint').textContent = WORKFLOW_PAGES[tab];
  // Keep awake (#162) on Runs and Definitions; the Builder needs the room
  $('#workflows-keep-awake').classList.toggle('hidden', tab === 'builder');
  if (tab !== 'builder') refreshKeepAwake();
  if (tab === 'definitions') refreshWorkflows();
  if (tab === 'runs') { renderWorkflowRuns(); loadWorkflowRuns(); }
  if (tab === 'builder') window.showBuilder?.();
}

const workflowRunsVisible = () => state.view === 'workflows' && state.workflowsTab === 'runs';

// Every run, in the same list as Projects > Project.
function renderWorkflowRuns() {
  renderRunList(state.wr, {
    prefix: 'workflow', box: '#workflow-runs', empty: 'No workflows have run yet.',
    start: () => openDrawer(), rerender: renderWorkflowRuns,
  });
}

let wrLoading = null;
let wrLastLoad = 0;
let wrTimer = null;
function loadWorkflowRuns() {
  if (wrLoading) return wrLoading;
  const wr = state.wr;
  wrLoading = (async () => {
    try {
      wr.runs = (await api.listRuns()).runs || [];
      wr.error = null;
      noteRunMeta(wr.runs);
    } catch (e) {
      wr.error = errMsg(e);
    }
    wrLoading = null;
    wrLastLoad = Date.now();
    if (workflowRunsVisible()) renderWorkflowRuns();
  })();
  return wrLoading;
}

// At most one reload every 3 s from run events while the tab is visible.
function loadWorkflowRunsThrottled() {
  if (wrTimer || !workflowRunsVisible()) return;
  const wait = Math.max(0, 3000 - (Date.now() - wrLastLoad));
  wrTimer = setTimeout(() => { wrTimer = null; if (workflowRunsVisible()) loadWorkflowRuns(); }, wait);
}

// Definitions (#137): the workflows in sections by category (metadata.category; unknown → Other),
// each a compact card (modes, declared outputs, agents, the steps as a one-line flow that expands),
// and the saved pipelines (api.listPipelines, #135) as connected cards in their category's section.
// A section filter (pills) and a search narrow both; "Used in" links a workflow to its pipelines.
const WF_SECTIONS = {
  plan: 'Turn a request into issues, designs or reviewed documents.',
  build: 'Write, review, test and ship code.',
  monitor: 'Look back at runs and improve how the agents work.',
  other: 'Workflows whose category this app does not know.',
};
const wfDefs = { section: 'all', query: '', open: new Set(), pipelines: [], pipelinesError: null };
const wfSectionOf = (category) => (CATEGORIES[category] ? category : 'other');
const wfSectionName = (key) => CATEGORIES[key] || 'Other';
const wfByFile = (file) => state.workflows.find((w) => w.file === file);
// A pipeline sits in its own category's section, else in its first workflow's.
const pipeSection = (p) => wfSectionOf(p.category || wfByFile(p.stages[0]?.workflow)?.category);

function wfMatches(w, q) {
  if (!q) return true;
  const agents = Object.entries(w.agents || {}).flatMap(([n, a]) => [n, a.model, a.provider]);
  return [w.name, w.description, w.file, ...(w.tags || []), ...Object.keys(w.outputs || {}), ...(w.steps || []).map((s) => s.id), ...agents]
    .some((t) => String(t || '').toLowerCase().includes(q));
}
function pipeMatches(p, q) {
  if (!q) return true;
  return [p.name, p.description, p.file, ...p.stages.flatMap((s) => [s.workflow, wfByFile(s.workflow)?.name])]
    .some((t) => String(t || '').toLowerCase().includes(q));
}

async function refreshWorkflows() {
  wfDefs.pipelinesError = null;
  const [workflows, pipelines] = await Promise.all([
    api.listWorkflows(),
    (api.listPipelines ? api.listPipelines() : Promise.resolve([])).catch((e) => { wfDefs.pipelinesError = errMsg(e); return []; }),
  ]);
  state.workflows = workflows;
  wfDefs.pipelines = pipelines;
  renderWorkflowDefinitions();
}

function renderWorkflowDefinitions() {
  const box = $('#workflows-list');
  const filters = $('#wf-sections');
  if (!state.workflows.length) {
    filters.innerHTML = '';
    box.innerHTML = '<div class="empty-state"><b>No workflows</b><p class="muted">Add .yaml files to the workflows folder.</p></div>';
    return;
  }
  const q = wfDefs.query.trim().toLowerCase();
  const keys = [...Object.keys(CATEGORIES), 'other'];
  const workflows = state.workflows.filter((w) => wfMatches(w, q));
  const pipelines = wfDefs.pipelines.filter((p) => pipeMatches(p, q));
  const inSection = (key) => ({
    // bundled workflows first, then yours, each by name
    workflows: workflows.filter((w) => wfSectionOf(w.category) === key)
      .sort((a, b) => (a.origin === 'custom') - (b.origin === 'custom') || String(a.name).localeCompare(String(b.name))),
    pipelines: pipelines.filter((p) => pipeSection(p) === key),
  });
  const sections = Object.fromEntries(keys.map((k) => [k, inSection(k)]));
  const count = (k) => sections[k].workflows.length + sections[k].pipelines.length;
  const pills = [['all', 'All', workflows.length + pipelines.length], ...keys.filter((k) => k !== 'other' || count(k)).map((k) => [k, wfSectionName(k), count(k)])];
  if (wfDefs.section !== 'all' && !keys.includes(wfDefs.section)) wfDefs.section = 'all';
  filters.innerHTML = pills.map(([k, label, n]) => `<button class="chip ${wfDefs.section === k ? 'active' : ''}" data-section="${k}" aria-pressed="${wfDefs.section === k}">${esc(label)} <span class="muted">${n}</span></button>`).join('');
  filters.querySelectorAll('[data-section]').forEach((b) => (b.onclick = () => { wfDefs.section = b.dataset.section; renderWorkflowDefinitions(); }));

  const shown = keys.filter((k) => (wfDefs.section === 'all' || wfDefs.section === k) && count(k));
  if (!shown.length) {
    box.innerHTML = `<div class="empty-state"><b>No workflow matches</b><p class="muted">Nothing${q ? ` matches "${esc(wfDefs.query.trim())}"` : ''} in ${esc(wfDefs.section === 'all' ? 'any section' : wfSectionName(wfDefs.section))}.</p><button class="btn ghost sm" data-clear>Clear the filters</button></div>`;
    box.querySelector('[data-clear]').onclick = () => { wfDefs.section = 'all'; wfDefs.query = ''; $('#wf-search').value = ''; renderWorkflowDefinitions(); };
    return;
  }
  box.innerHTML = (wfDefs.pipelinesError ? `<p class="error small">Pipelines could not be read: ${esc(wfDefs.pipelinesError)}</p>` : '') + shown.map((k) => {
    const s = sections[k];
    const n = (x, one) => `${x} ${one}${x === 1 ? '' : 's'}`;
    return `
    <section class="wf-section" data-section="${k}">
      <header class="wf-section-head">
        <h2>${esc(wfSectionName(k))}</h2>
        <span class="badge cat-${k}">${n(s.workflows.length, 'workflow')}</span>
        ${s.pipelines.length ? `<span class="badge">${n(s.pipelines.length, 'pipeline')}</span>` : ''}
        <span class="muted small">${esc(WF_SECTIONS[k])}</span>
      </header>
      ${s.pipelines.length ? `<div class="wf-pipes">${s.pipelines.map(pipelineCard).join('')}</div>` : ''}
      ${s.workflows.length ? `<div class="wf-grid">${s.workflows.map(workflowCard).join('')}</div>` : ''}
    </section>`;
  }).join('');
  wireWorkflowDefinitions(box);
}

// The step list collapsed into one line of step chips (gates dashed); a long flow shows its first
// steps and how many more (its last steps in the file are often failure branches, not the end).
function stepFlow(w) {
  const steps = w.steps || [];
  const chip = (s) => `<span class="step-chip ${s.type === 'human_approval' ? 'human' : ''}" title="${esc(s.type === 'human_approval' ? `${s.id} (human approval)` : s.id)}">${esc(s.id)}</span>`;
  const shown = steps.length > 7 ? steps.slice(0, 6) : steps;
  return shown.map(chip).join('<span class="arrow">›</span>') + (steps.length > shown.length ? `<span class="muted small">+${steps.length - shown.length} more</span>` : '');
}

function workflowCard(w) {
  const open = wfDefs.open.has(w.file);
  const agents = Object.entries(w.agents || {});
  const avatars = agents.slice(0, 6).map(([n, a]) => `<span class="wf-av" title="${esc(`${n} · ${a.provider}${a.model ? `/${a.model}` : ''}`)}">${robotAvatar(a.provider, a.model, 'idle', w.name, n)}</span>`).join('')
    + (agents.length > 6 ? `<span class="wf-av wf-av-more" title="${esc(agents.slice(6).map(([n, a]) => `${n} · ${a.provider}/${a.model}`).join('\n'))}">+${agents.length - 6}</span>` : '');
  const mode = Array.isArray(w.inputs?.mode?.enum) ? w.inputs.mode : null;
  const modes = mode ? mode.enum.map((m) => `<span class="pill pill-idle" title="${esc(`${m === mode.default ? 'Default mode. ' : ''}${mode.description || ''}`)}">${esc(WorkflowInputs.optionLabel(mode, m))}</span>`).join('') : '';
  const outputs = Object.entries(w.outputs || {}).map(([o, d]) => `<span class="badge wf-out" title="${esc(`${d?.description ? `${d.description} ` : ''}Declared output: a later workflow of a pipeline can take it as an input`)}">⇢ ${esc(o)}</span>`).join('');
  const usedIn = wfDefs.pipelines.filter((p) => p.stages.some((s) => s.workflow === w.file));
  const used = usedIn.map((p) => {
    const i = p.stages.findIndex((s) => s.workflow === w.file);
    const role = i === 0 ? 'starts it' : `stage ${i + 1} of ${p.stages.length}`;
    return `<button class="link-btn" data-goto-pipe="${esc(p.file)}" title="${esc(`${p.name}: ${role}`)}">${esc(p.name)}</button> <span class="muted">(${role})</span>`;
  }).join(', ');
  const builderTip = w.origin !== 'custom' ? 'See it in the visual builder (read-only: clone it to change it)' : w.builder ? 'Edit it in the visual builder' : 'See it in the visual builder: its agents and prompts can be changed there, its steps stay as they are';
  return `
    <article class="wf-card${w.origin === 'custom' ? ' custom' : ''}" data-file="${esc(w.file)}" tabindex="-1">
      <div class="wf-card-head">
        <div class="wf-card-title">
          <h3 title="${esc(w.name)}">${esc(w.name)} ${w.version ? `<span class="muted small">v${esc(w.version)}</span>` : ''}</h3>
          <div class="badges">${originBadge(w)}<span class="badge mono wf-file" title="${esc(w.file)}">${esc(w.file)}</span></div>
        </div>
        ${avatars ? `<div class="wf-avs">${avatars}</div>` : ''}
      </div>
      <p class="muted small wf-desc" title="${esc(w.error ? `Error: ${w.error}` : w.description || '')}">${esc(w.error ? `Error: ${w.error}` : w.description || '')}</p>
      ${modes || outputs ? `<div class="wf-tags">${modes}${outputs}</div>` : ''}
      ${(w.steps || []).length ? `<button class="wf-flow steps-mini" data-flow aria-expanded="${open}" title="${open ? 'Hide the steps' : 'Show every step'}"><span class="badge">${w.steps.length} step${w.steps.length === 1 ? '' : 's'}</span>${stepFlow(w)}<span class="wf-flow-caret" aria-hidden="true">${open ? '▴' : '▾'}</span></button>` : ''}
      ${open ? `<ol class="wf-steps">${stepList(w)}</ol>` : ''}
      ${used ? `<p class="small wf-used"><span class="muted">Used in</span> ${used}</p>` : ''}
      <div class="row wf-actions">
        ${w.restorable ? '<button class="btn ghost sm" data-restore title="Move your edited copy to the trash and use the default bundled with the app">Restore default</button>' : ''}
        <span class="spacer"></span>
        <button class="btn ghost sm" data-builder ${w.error ? 'disabled' : ''} title="${esc(builderTip)}">Open in builder</button>
        <button class="btn primary sm" data-run ${w.error ? 'disabled' : ''}>Run</button>
      </div>
    </article>`;
}

// A pipeline (#135): its workflows connected, each arrow with the outputs it maps into the next
// workflow's inputs (map: { input: output }) and its condition; a Product Owner or queue stage ends it.
function pipelineCard(p) {
  const stages = p.stages.map((s, i) => {
    const w = s.workflow ? wfByFile(s.workflow) : null;
    const map = Object.entries(s.map || {}).map(([input, output]) => `<span class="badge" title="${esc(`Output "${output}" of the previous workflow → input "${input}"`)}">${esc(output === '@run' ? 'the run' : output)} → ${esc(input)}</span>`).join('');
    const link = i ? `<div class="wf-link"><span class="wf-link-arrow" aria-hidden="true">→</span>${map}<span class="muted small">on ${esc(s.on || s.when || 'success')}</span></div>` : '';
    if (s.target === 'product_owner') {
      return `${link}<span class="wf-stage wf-stage-target" title="The Product Owner places the produced issues in the project's roadmap as planned stages"><b>Product Owner</b><span class="badge">roadmap</span></span>`;
    }
    return `${link}<button class="wf-stage" data-goto="${esc(s.workflow)}" title="${esc(w ? `${s.target === 'queue' ? 'The produced issues are queued for ' : ''}${w.name} (${s.workflow})` : `${s.workflow}: not in the workflows folder`)}">
      <b>${s.target === 'queue' ? 'Queue: ' : ''}${esc(w?.name || s.workflow)}</b>
      ${w ? `<span class="badge cat-${esc(wfSectionOf(w.category))}">${esc(wfSectionName(wfSectionOf(w.category)))}</span>` : '<span class="badge warn">missing</span>'}
    </button>`;
  }).join('');
  return `
    <article class="wf-pipe" data-pipe="${esc(p.file)}" data-files="${esc(p.stages.map((s) => s.workflow || '').join('|'))}" tabindex="-1">
      <div class="wf-pipe-head">
        <span class="badge">pipeline</span>
        <h3 title="${esc(p.name)}">${esc(p.name)}</h3>
        <span class="muted small wf-desc" title="${esc(p.error ? `Error: ${p.error}` : p.description || '')}">${esc(p.error ? `Error: ${p.error}` : p.description || '')}</span>
        <span class="spacer"></span>
        ${p.origin ? originBadge(p) : ''}
        <span class="badge mono wf-file" title="${esc(p.file)}">${esc(p.file)}</span>
        ${p.restorable ? '<button class="btn ghost sm" data-restore-pipe title="Move your edited copy to the trash and use the default bundled with the app">Restore default</button>' : ''}
        <button class="btn primary sm" data-run-pipe ${p.error || !wfByFile(p.stages[0]?.workflow) ? 'disabled' : ''} title="Opens the Start drawer on the pipeline: it asks for the first stage's inputs, then runs every stage, each fed by the previous one">Run pipeline</button>
      </div>
      ${p.error ? `<p class="error small wf-pipe-error">${esc(p.error)}</p>` : ''}
      ${stages ? `<div class="wf-pipe-stages">${stages}</div>` : ''}
    </article>`;
}

function wireWorkflowDefinitions(box) {
  const cardOf = (el) => el.closest('.wf-card').dataset.file;
  const focus = (el) => { if (!el) return; el.scrollIntoView({ block: 'center', behavior: 'smooth' }); el.focus({ preventScroll: true }); el.classList.add('hl'); setTimeout(() => el.classList.remove('hl'), 1500); };
  box.querySelectorAll('[data-run]').forEach((b) => (b.onclick = () => openDrawer({ workflow: cardOf(b) })));
  box.querySelectorAll('[data-builder]').forEach((b) => (b.onclick = () => window.openInBuilder?.(cardOf(b))));
  box.querySelectorAll('[data-flow]').forEach((b) => (b.onclick = () => {
    const file = cardOf(b);
    if (!wfDefs.open.delete(file)) wfDefs.open.add(file);
    renderWorkflowDefinitions();
    box.querySelector(`.wf-card[data-file="${CSS.escape(file)}"] [data-flow]`)?.focus();
  }));
  box.querySelectorAll('[data-restore]').forEach((b) => (b.onclick = async () => {
    const file = cardOf(b);
    if (!(await confirmDialog('Restore default', `Move your edited "${file}" to the trash and restore the default bundled with the app?`, 'Restore'))) return;
    try { await api.restoreWorkflow(file); } catch (e) { showToast('Restore failed', e.message); }
    refreshWorkflows();
  }));
  box.querySelectorAll('[data-goto-pipe]').forEach((b) => (b.onclick = () => focus(box.querySelector(`.wf-pipe[data-pipe="${CSS.escape(b.dataset.gotoPipe)}"]`))));
  box.querySelectorAll('[data-goto]').forEach((b) => (b.onclick = () => focus(box.querySelector(`.wf-card[data-file="${CSS.escape(b.dataset.goto)}"]`))));
  // the Start drawer on the pipeline (#135): it asks for the first stage's inputs, then runPipeline
  box.querySelectorAll('[data-run-pipe]').forEach((b) => (b.onclick = () => {
    const p = wfDefs.pipelines.find((x) => x.file === b.closest('.wf-pipe').dataset.pipe);
    return api.runPipeline ? openDrawer({ pipeline: p.file }) : openDrawer({ workflow: p.stages[0].workflow });
  }));
  box.querySelectorAll('[data-restore-pipe]').forEach((b) => (b.onclick = async () => {
    const file = b.closest('.wf-pipe').dataset.pipe;
    if (!(await confirmDialog('Restore default', `Move your edited "${file}" to the trash and restore the pipeline bundled with the app?`, 'Restore'))) return;
    try { await api.restorePipeline(file); } catch (e) { showToast('Restore failed', errMsg(e)); }
    refreshWorkflows();
  }));
  // hovering a workflow lights up its pipelines, hovering a pipeline (or a "Used in" link) its workflows
  const light = (on, files, pipes) => {
    box.querySelectorAll('.wf-card').forEach((c) => c.classList.toggle('linked', on && files.includes(c.dataset.file)));
    box.querySelectorAll('.wf-pipe').forEach((p) => p.classList.toggle('linked', on && pipes.includes(p.dataset.pipe)));
  };
  const pipesOf = (file) => wfDefs.pipelines.filter((p) => p.stages.some((s) => s.workflow === file)).map((p) => p.file);
  box.querySelectorAll('.wf-card').forEach((c) => {
    c.onmouseenter = () => light(true, [], pipesOf(c.dataset.file));
    c.onmouseleave = () => light(false, [], []);
  });
  box.querySelectorAll('.wf-pipe').forEach((p) => {
    p.onmouseenter = () => light(true, p.dataset.files.split('|'), []);
    p.onmouseleave = () => light(false, [], []);
  });
}

// The whole step list of a workflow card, when its flow is expanded.
function stepList(w) {
  return (w.steps || []).map((s, i) => {
    const human = s.type === 'human_approval';
    const names = s.agents || [s.agent];
    const who = names.map((n) => `${esc(n)}${w.agents?.[n] ? ` · <span class="mono">${esc(w.agents[n].model)}</span>` : ''}`).join(s.agents ? '<br>' : '');
    const skillNames = [...new Set([...(s.skills || []), ...names.flatMap((n) => w.agents?.[n]?.skills || [])])];
    const others = s.next.filter((n) => n !== w.steps[i + 1]?.id);
    return `<li class="wf-step ${human ? 'human' : ''}">
      <span class="wf-step-n">${i + 1}</span>
      <div class="wf-step-body">
        <div class="wf-step-head"><b>${esc(s.id)}</b>
          ${s.agents ? '<span class="badge">parallel</span>' : ''}${s.goal ? '<span class="badge">/goal</span>' : ''}${s.loop ? '<span class="badge">/loop</span>' : ''}
          ${skillNames.map((k) => `<span class="badge" title="skill">⚡ ${esc(k.replace(/\{\{\s*inputs\.(\w+)\s*\}\}/g, '‹$1›'))}</span>`).join('')}</div>
        <div class="muted small">${human ? 'human approval' : s.type === 'screenshots' ? 'screenshots (no agent)' : s.type === 'workflow' ? `runs ${esc(s.workflow || 'a workflow')}${s.foreach ? ` for each item${s.max_parallel ? `, ${esc(String(s.max_parallel))} at a time` : ''}` : ''}` : who}</div>
        ${others.length ? `<div class="wf-step-next small">↳ ${others.map((n) => `<span class="mono">${esc(n)}</span>`).join(', ')}</div>` : ''}
      </div>
    </li>`;
  }).join('');
}

// Where a workflow file comes from (see src/seed.js): the bundled default, edited by the user or user-created.
function originBadge(w) {
  const badges = {
    default: '<span class="badge" title="Default bundled with the app; updated automatically with new app versions">default</span>',
    modified: '<span class="badge warn" title="Bundled default edited by you; app updates do not overwrite it">modified</span>',
    custom: '<span class="badge cat-build" title="Created by you">custom</span>',
  };
  const update = w.updateAvailable
    ? `<span class="badge warn" title="The app ships a newer default than the one you edited. Restore default to use it (your copy goes to the trash).">newer default${w.bundledVersion ? ` v${esc(w.bundledVersion)}` : ''}</span>`
    : '';
  return (badges[w.origin] || '') + update;
}

// Opens a run in Workflows › Runs, expanded.
function showRunInList(runId) {
  state.workflowsTab = 'runs';
  state.wr.filter = 'all';
  state.wr.showSim = true;
  state.wr.expanded.add(runId);
  showView('workflows');
  setTimeout(() => document.querySelector(`.pr-run[data-run="${CSS.escape(runId)}"]`)?.scrollIntoView({ block: 'center' }), 600);
}

// Opens a workflow in Workflows › Definitions, scrolled to and focused (the Agents menu's
// "Open in workflow").
function showWorkflowDefinition(file) {
  state.workflowsTab = 'definitions';
  // the card may be filtered out
  wfDefs.section = 'all';
  wfDefs.query = '';
  const search = document.querySelector('#wf-search');
  if (search) search.value = '';
  showView('workflows');
  setTimeout(() => {
    const card = document.querySelector(`.wf-card[data-file="${CSS.escape(file)}"]`);
    card?.scrollIntoView({ block: 'center' });
    card?.focus?.();
  }, 600);
}

registerView({
  id: 'workflows',
  nav: { label: 'Workflows', order: 60, icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="12" r="2.5" /><circle cx="6" cy="18" r="2.5" /><path d="M8.5 6H12a3 3 0 0 1 3 3v.5M8.5 18H12a3 3 0 0 0 3-3v-.5" /></svg>' },
  markup: `
      <section id="view-workflows" class="view hidden">
        <div class="page-head">
          <div>
            <h1>Workflows <span class="muted">›</span> <span id="workflows-page-title">Runs</span></h1>
            <p class="muted small"><span id="workflows-page-hint"></span> Folder: <span id="workflows-dir" class="mono"></span> (defaults bundled with the app are copied there; your edits are kept on app updates).</p>
          </div>
          <div class="row keep-awake-head">
            <div id="workflows-keep-awake" class="keep-awake">
              <div class="keep-awake-top">
                <b>Keep awake</b>
                <span class="badge keep-awake-status" data-keep-awake-status></span>
                <label class="switch" title="Keep awake"><input type="checkbox" data-keep-awake-toggle aria-label="Keep awake" /><span></span></label>
              </div>
              <span class="muted small">Keeps this computer from sleeping while runs or a roadmap are active (this workspace). Sleep, the lid and the power plan still apply.</span>
              <span class="error small" data-keep-awake-error></span>
            </div>
            <button id="btn-workflows-folder" class="btn ghost">Open folder</button>
          </div>
        </div>
        <div data-wpage="runs">
          <div class="pr-toolbar">
            <div id="workflow-run-filters" class="chips"></div>
            <span class="spacer"></span>
            <label class="check small"><input type="checkbox" id="workflow-show-sim" /><span>Show simulated</span></label>
            <button id="btn-workflow-runs-refresh" class="btn sm ghost">Refresh</button>
          </div>
          <p id="workflow-runs-error" class="error small"></p>
          <div id="workflow-runs" class="pr-list"></div>
        </div>
        <div data-wpage="definitions" class="hidden">
          <div class="pr-toolbar wf-toolbar">
            <div id="wf-sections" class="chips" role="group" aria-label="Section"></div>
            <span class="spacer"></span>
            <input type="text" id="wf-search" class="wf-search" placeholder="Search workflows and pipelines" aria-label="Search workflows and pipelines" spellcheck="false" />
          </div>
          <div id="workflows-list" class="wf-list"></div>
        </div>
        <div data-wpage="builder" class="hidden">
          <div id="wb" class="wb">
            <div class="wb-bar">
              <input type="text" id="wb-name" class="wb-name" placeholder="Workflow name" aria-label="Workflow name" spellcheck="false" />
              <select id="wb-category" aria-label="Category"></select>
              <span class="spacer"></span>
              <select id="wb-open" aria-label="Open a workflow in the builder"></select>
              <button id="wb-new" class="btn ghost sm" type="button">New</button>
              <button id="wb-clone" class="btn ghost sm hidden" type="button" title="Make your own copy of this workflow (custom), which you can change">Clone</button>
              <button id="wb-save" class="btn sm" type="button">Save</button>
              <button id="wb-run" class="btn primary sm" type="button" title="Save and open the start panel">Run</button>
            </div>
            <textarea id="wb-description" class="wb-description" rows="2" placeholder="What it does (shown when you start it)" aria-label="Description"></textarea>
            <p id="wb-banner" class="wb-banner small hidden"></p>
            <div class="wb-meta muted small"><span class="mono" id="wb-file"></span><span id="wb-dirty" class="badge warn hidden">unsaved</span>
              <span class="spacer"></span>
              <button id="wb-add-desk" class="btn ghost sm" type="button" title="Add an agent desk after the selected one">+ Desk</button>
              <button id="wb-add-gate" class="btn ghost sm" type="button" title="Add an approval gate after the selected desk">+ Approval gate</button>
            </div>
            <div class="wb-main">
              <div id="wb-canvas" class="wb-canvas" aria-label="Steps, in order"></div>
              <aside id="wb-panel" class="wb-panel"></aside>
            </div>
            <p id="wb-error" class="error small wb-error"></p>
          </div>
        </div>
      </section>`,
  modals: `
  <!-- Workflows > Builder: the skills of a desk -->
  <div id="wb-skills-modal" class="modal hidden">
    <div class="modal-card wide" role="dialog" aria-labelledby="wb-skills-title">
      <h3 id="wb-skills-title">Skills of this agent <span id="wb-skill-count" class="muted small"></span></h3>
      <input type="text" id="wb-skill-search" placeholder="Filter skills" aria-label="Filter skills" />
      <div id="wb-skill-list" class="ag-skills wb-skill-list"></div>
      <div class="modal-actions">
        <button type="button" id="btn-wb-skills-cancel" class="btn ghost">Cancel</button>
        <button type="button" id="btn-wb-skills-ok" class="btn primary">Apply</button>
      </div>
    </div>
  </div>
  <!-- Workflows > Builder: import an agent (Agents menu) into a desk -->
  <div id="wb-agents-modal" class="modal hidden">
    <div class="modal-card wb-agents-card" role="dialog" aria-labelledby="wb-agents-title">
      <h3 id="wb-agents-title">Import an agent</h3>
      <p class="muted small">Its look, prompt and skills go to the desk; you can still adjust them there.</p>
      <div id="wb-agents-list" class="card-grid agents-grid wb-agents-list"></div>
      <div class="modal-actions">
        <button type="button" id="btn-wb-agents-manage" class="btn ghost">Manage agents</button>
        <span class="spacer"></span>
        <button type="button" id="btn-wb-agents-cancel" class="btn ghost">Cancel</button>
      </div>
    </div>
  </div>`,
  mount() {
    // the sub-items, right under the sidebar entry (showView shows them on this screen only)
    $('nav.sidebar [data-view="workflows"]').insertAdjacentHTML('afterend', `
      <div class="nav-sub hidden" id="nav-workflows-sub" role="group" aria-label="Workflows">
        <button class="nav-subitem" data-wtab="runs">Runs</button>
        <button class="nav-subitem" data-wtab="definitions">Definitions</button>
        <button class="nav-subitem" data-wtab="builder">Builder</button>
      </div>`);
    $('#btn-workflows-folder').onclick = () => api.openPath(state.ws.workflows);
    document.querySelectorAll('[data-wtab]').forEach((b) => (b.onclick = () => { state.workflowsTab = b.dataset.wtab; showView('workflows'); }));
    $('#btn-workflow-runs-refresh').onclick = () => loadWorkflowRuns();
    $('#workflow-show-sim').onchange = (e) => { state.wr.showSim = e.target.checked; renderWorkflowRuns(); };
    $('#wf-search').oninput = (e) => { wfDefs.query = e.target.value; renderWorkflowDefinitions(); };
  },
  show: () => showWorkflowsTab(state.workflowsTab),
});
