// The City view of a project's Architecture tab (#373): the project drawn as a 3D city from #371's
// model (architecture:city → packages/shared/city-model.js), laid out by packages/shared/city-layout.js and
// drawn by the prebuilt bundle generated/project-city.js (scripts/build-3d.js, fronts/analyser/city3d/), loaded with a
// plain <script src> the first time a City view shows. Without WebGL, or without the bundle, the view says so.
// The HUD is this file's, with the run's 3D view classes (run3d.css; project-city.css places them):
// - the header: the project (the mode's title, #440), its files, zones and districts, the Danger Zone count, the plan's
//   coverage and the commit; a search that flies to a file, a district or a zone; "Colour by" (Quadrant, the default
//   when a tool measured the complexity, Zone otherwise, Churn; #782: the pick and the unmeasured code's part of the
//   legend are project-city-notes.js's) with its legend; the Tests toggle; City life and Glow
//   (#450: switches on by default, sent as scene updates); the dark / light toggle shared with the run's 3D view
//   (Run3DTheme); Expand (#381): the city over the whole window (`expanded`), Close or Esc brings it back as it was;
// - the notes under it (project-city-notes.js): no plan, a stale plan, commits since the analysis or a current plan
//   (#782), with the tab's one action (#381: `onAnalyze`, its combined estimate next to it) and its state, the plan's problems;
// - the hover card of a building, a district or a zone, the card a click pins (project-city-cards.js), the camera
//   buttons (zoom, home); the states: the facts still loading, not a git repository, no commits, an error with Retry.
// The overlay API, for the city epic's modules (they add their own files, not code here):
//   ProjectCity.overlay(name, { highlight: { path: colour }, markers: [path | { path, colour, label }] } | null) sets or removes
//     a named layer; the layers merge (later names win) and the buildings no layer highlights are greyed (city-layout.js applyOverlay);
//   ProjectCity.flyTo(name) flies to a file, a district or a zone (false when none); ProjectCity.current() → { projectId, layout };
//   ProjectCity.stats() → { firstFrameMs, fps, buildings, cityLife, glow, props } (the PR's measures, #449's drawn files, #450's switches).
//   A created city also has `model`, `setPins(paths)` (#382), `onLayout(fn)` (returns the unsubscribe), `reload(answer?)` (#376: another
//   answer drawn), `setLegend(name, html | null)` (a mode's rows in place of Colour by's), `applyUi()` (after a panel's draw) and
//   the modes and panels of project-city-modes.js and project-city-panels.js (#440: `setMode`, `leaveMode`, `closeMode`; #441).
// Uses app.js globals at call time: api, esc, errMsg, state (its settings' cityGlow). Browser: window.ProjectCity.
(() => {
  const BUNDLE = '../../../generated/project-city.js';
  const MISSING = 'The City view is not built: run `npm run build:3d` (or `npm install`) and reload. The Facts view has the same numbers, as tables.';
  const ZOOM_IN = 0.72, ZOOM_OUT = 1.38;
  const COLOUR_LABEL = { quadrant: 'Quadrant', zone: 'Zone', churn: 'Churn' };
  const ICON_CITY = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="7" width="4" height="8" rx="1"/><rect x="6" y="2" width="4" height="13" rx="1"/><rect x="11" y="5" width="4" height="10" rx="1"/></svg>';
  const ICON_EXPAND = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 9 7M6.5 13.5h-4v-4M2.5 13.5 7 9"/></svg>', ICON_CLOSE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13"/></svg>'; // i18n-ignore
  // #450's switches (fronts/analyser/poc/city-modes.html's icons: a tree and a lamp, a sun's rays): the flag, its test id and label key, its icon
  const FLAGS = { cityLife: ['life', 'city_life', '<path d="M5 14V9M5 9a3.2 3.2 0 1 1 0-6.4A3.2 3.2 0 0 1 5 9zM11 14V5M11 5l-2.2 1.2M11 5l2.2 1.2M8.8 2.6h4.4"/>'], glow: ['glow', 'glow', '<circle cx="8" cy="8" r="2.6"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4"/>'] }; // i18n-ignore
  let bundle = null; // the bundle's load, once
  let gl = null; // why WebGL cannot draw here ('' = it can), checked once
  let shown = null; // the city on screen (the overlay API's)
  const layers = new Map(); // the overlay's layers, by name, in the order they were set

  const plural = (n, key) => t(key, { count: n });
  const pct = (x) => `${Math.round(x * 100)}%`;
  const theme = () => window.Run3DTheme?.load() || 'dark';

  function webglProblem() {
    if (gl != null) return gl;
    try {
      const ctx = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
      gl = ctx ? '' : 'WebGL is not available in this window, so the city cannot be drawn.';
      ctx?.getExtension?.('WEBGL_lose_context')?.loseContext();
    } catch (e) {
      gl = `WebGL is not available in this window: ${e.message}`;
    }
    return gl;
  }

  function loadBundle() {
    if (window.ProjectCityScene) return Promise.resolve();
    bundle ||= new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = BUNDLE;
      // a failed load (or a script without the global) is forgotten, so Retry loads it again
      const fail = () => { bundle = null; script.remove(); reject(new Error(MISSING)); };
      script.onload = () => (window.ProjectCityScene ? resolve() : fail());
      script.onerror = fail;
      document.head.append(script);
    });
    return bundle;
  }

  /** A City view for project `projectId`: { el, update({ facts, estimate, analysis }), reload(), destroy(), flyTo(name), refreshOverlay(), setPins(paths), onLayout(fn) }. */
  function create({ projectId, name = '', onOpenFacts = () => {}, onAnalyze = null }) {
    const el = document.createElement('div');
    el.className = 'r3d pc-city';
    el.setAttribute('data-testid', 'project-city');
    el.dataset.theme = theme();
    el.innerHTML = '<div class="pc-stage" data-pc-stage></div><div class="r3d-hud" data-pc-hud></div>';
    const stage = el.querySelector('[data-pc-stage]');
    const hud = el.querySelector('[data-pc-hud]');
    const c = {
      projectId, name, el, answer: null, loading: false, error: null, facts: null, estimate: null, analysis: null,
      colour: null, tests: true, theme: el.dataset.theme, layout: null, legend: [], rows: new Map(), ui: [], handle: null, drawn: null,
      pinned: null, hover: null, pins: [], expanded: false, seq: 0, destroyed: false, cityLife: true, glow: typeof state === 'undefined' || state?.settings?.cityGlow !== false,
    };
    const listeners = new Set(); // onLayout's

    // ---------- data ----------

    async function load() {
      const seq = ++c.seq;
      Object.assign(c, { loading: true, error: null });
      if (!c.layout) render(); // a reload keeps the city on screen until the new one is laid out
      try {
        const answer = await api.architectureCity(projectId);
        if (c.destroyed || seq !== c.seq) return;
        c.answer = answer || { state: 'error' };
        if (!answer) c.error = 'the service gave no answer';
      } catch (e) {
        if (c.destroyed || seq !== c.seq) return;
        c.error = errMsg(e);
      }
      c.loading = false;
      relayout();
    }

    // the facts' quadrant and score per file (#449: the badges; the city model has none: same facts read)
    const byFile = (key) => Object.fromEntries((c.facts?.model?.files || []).filter((r) => r[key] != null && r[key] !== '').map((r) => [r.file, r[key]]));

    function relayout() {
      const model = c.answer?.model;
      c.layout = model && window.CityLayout ? CityLayout.layoutCity(model, { quadrants: byFile('quadrant'), scores: byFile('score') }) : null;
      if (c.layout && !c.colour) Object.assign(c, window.ProjectCityNotes?.openingColour(projectId, model) || { colour: CityLayout.defaultColourBy(model) });
      // a new layout starts with nothing hovered or pinned (the scene drops its own too)
      c.hover = null;
      c.pinned = null;
      render();
      draw();
      for (const fn of listeners) { try { fn(c.layout); } catch (e) { console.error(e); } }
    }

    // the buildings' colours (colour by, then the overlay) and the legend
    function paint() {
      const { colours, legend } = CityLayout.colourBy(c.layout, c.colour, { light: c.theme === 'light' });
      const coloured = { ...c.layout, buildings: c.layout.buildings.map((b, i) => ({ ...b, colour: colours[i] })) };
      const out = CityLayout.applyOverlay(coloured, CityLayout.mergeOverlays(layers.values()));
      c.legend = legend;
      return { paint: { colours: out.buildings.map((b) => b.colour), greyed: out.buildings.map((b) => b.greyed) }, markers: out.markers };
    }

    const relationsOf = (kind, id) => (kind === 'district' ? CityLayout.districtNeighbours(c.layout, id) : CityLayout.neighbours(c.layout, id));

    // ---------- the scene ----------

    // a message in place of the scene (the scene, if any, gives its WebGL context back)
    function stageMessage(html, { alert = false, testid = 'project-city-message' } = {}) {
      if (c.handle) { try { c.handle.unmount(); } catch { /* already gone */ } c.handle = null; c.drawn = null; }
      stage.innerHTML = `<div class="r3d-message"${alert ? ' role="alert"' : ' role="status"'} data-testid="${testid}">${html}</div>`;
    }

    const toFacts = `<button type="button" class="r3d-primary inline" data-pc-facts>${t('project_city.show_the_facts')}</button>`;

    async function draw() {
      if (!c.layout) return;
      const problem = webglProblem();
      if (problem) {
        stageMessage(`<p>${esc(problem)} ${t('project_city.the_facts_view_has_the_same')}</p>${toFacts}`, { alert: true });
        return;
      }
      const painted = paint();
      renderLegend();
      if (c.handle) {
        if (c.drawn !== c.layout) c.handle.update({ layout: c.layout, ...painted, tests: c.tests, pins: c.pins });
        else c.handle.update(painted);
        c.drawn = c.layout;
        return;
      }
      if (!stage.querySelector('canvas')) stageMessage(`<p>${t('project_city.loading_the_city')}</p><span class="r3d-bar open"><i></i></span>`);
      try {
        await loadBundle();
      } catch (e) {
        if (!c.destroyed) stageMessage(`<p>${esc(e.message === MISSING ? MISSING : t('project_city.the_city_view_could_not_load', { e: errMsg(e) }))}</p>${toFacts}`, { alert: true });
        return;
      }
      if (c.destroyed || c.handle || !c.layout) return;
      stage.innerHTML = '';
      try {
        c.handle = ProjectCityScene.mount(stage, {
          layout: c.layout, ...paint(), tests: c.tests, pins: c.pins, theme: c.theme, cityLife: c.cityLife, glow: c.glow, relationsOf,
          onHover: (t) => { c.hover = t; renderHover(); },
          onPick: (t) => { c.pinned = t; renderDetail(); },
        });
        c.drawn = c.layout;
      } catch (e) {
        stageMessage(`<p>${t('project_city.the_city_could_not_be_drawn')} ${esc(errMsg(e))}</p>${toFacts}`, { alert: true });
      }
    }

    // ---------- the HUD ----------

    function headerHtml(model, validation) {
      const facts = c.facts?.model;
      const measured = facts?.complexity?.status === 'measured';
      const danger = measured ? facts.files.filter((r) => r.quadrant === 'Danger Zone').length : null;
      const plan = model.grouping === 'plan' ? t('project_city.plan_covers', { share: pct(validation?.coverage ?? 1) }) : t('project_city.no_plan_folders_as_districts');
      const facts1 = [
        plural(model.buildings?.length || 0, 'project_city.files_count'), plural(model.zones?.length || 0, 'project_city.zones_count'), plural(model.districts?.length || 0, 'project_city.districts_count'),
        danger == null ? t('project_city.danger_zone_not_measured') : t('project_city.in_the_danger_zone_count', { count: danger }), plan, model.commit ? String(model.commit).slice(0, 10) : '',
      ].filter(Boolean).join(' · ');
      const title = model.project || c.name || projectId;
      const options = window.CityLayout.COLOUR_BY.map((k) => `<option value="${k}" ${k === c.colour ? 'selected' : ''}>${COLOUR_LABEL[k]}</option>`).join('');
      const targets = [...c.layout.zones.map((z) => z.name), ...c.layout.districts.map((d) => d.name), ...c.layout.buildings.filter((b) => !b.aggregate).map((b) => b.path)];
      const light = c.theme === 'light';
      return `<div class="r3d-top r3d-card" data-testid="project-city-header">
        <div class="r3d-brand"><i>${ICON_CITY}</i></div>
        <div class="r3d-run"><b title="${esc(title)}" data-testid="city-mode-title">${esc(title)}</b> <small title="${esc(facts1)}" data-testid="project-city-facts">${esc(facts1)}</small></div>
        <span class="r3d-grow"></span>
        <label class="r3d-search"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l4 4"/></svg>
          <input type="search" role="searchbox" list="pc-targets-${esc(projectId)}" placeholder="${t('project_city.fly_to_a_file_or_a')}" aria-label="${t('project_city.search_the_city')}" data-pc-search data-testid="project-city-search" /></label>
        <datalist id="pc-targets-${esc(projectId)}">${targets.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>
        <label class="r3d-chip"><span>${t('project_city.colour_by')}</span><select data-pc-colour aria-label="${t('project_city.colour_by')}" data-testid="project-city-colour">${options}</select></label>
        <label class="r3d-chip" title="${t('project_city.show_or_hide_the_test_files')}"><input type="checkbox" data-pc-tests data-testid="project-city-tests" ${c.tests ? 'checked' : ''} /> ${t('project_city.tests')}</label>
        ${Object.entries(FLAGS).map(([k, [id, key, icon]]) => `<button type="button" class="r3d-close pc-flag" data-pc-flag="${k}" data-testid="project-city-${id}" aria-pressed="${c[k]}" aria-label="${t(`project_city.${key}`)}" title="${t(`project_city.${key}_title`)}"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icon}</svg></button>`).join('')}
        <button type="button" class="r3d-close" data-pc-theme data-testid="project-city-theme" aria-label="${light ? t('project_city.dark_theme') : t('project_city.light_theme')}" title="${light ? t('project_city.switch_to_dark_theme') : t('project_city.switch_to_light_theme')}">${light ? '☾' : '☀'}</button>
        <button type="button" class="r3d-close r3d-theme" data-pc-expand data-testid="project-city-expand" aria-pressed="${c.expanded}" aria-label="${c.expanded ? t('project_city.close_the_full_screen') : t('project_city.expand_to_the_whole_window')}" title="${c.expanded ? t('project_city.back_into_the_tab_esc') : t('project_city.expand_the_city_over_the_whole')}">${c.expanded ? ICON_CLOSE : ICON_EXPAND}</button>
      </div>`;
    }

    // the notes under the header (project-city-notes.js): the action (#381), its state, the plan's problems (none on a past release's city, #440)
    const notesHtml = (model, validation) => (self.mode === 'release' ? '' : window.ProjectCityNotes?.html({ model, validation, layout: c.layout, analysis: c.analysis, analysed: c.answer?.analysed ?? null, ready: typeof onAnalyze === 'function' }) || '');

    // a mode's own rows (setLegend) in place of Colour by's, after the legend's close (#441)
    function renderLegend() {
      const box = hud.querySelector('[data-testid="project-city-legend"]');
      if (!box) return;
      box.innerHTML = `${window.ProjectCityPanels?.legendClose() || ''}${[...c.rows.values()].join('') || `<b>${esc(COLOUR_LABEL[c.colour] || '')}</b><ul>${c.legend.map((l) => `<li><i class="r3d-dot" style="--c:${esc(l.colour)}"></i>${esc(l.label)}${l.sub ? `<small>${esc(l.sub)}</small>` : ''}</li>`).join('')}</ul>${window.ProjectCityNotes?.unmeasuredHtml({ model: c.answer?.model, colour: c.colour, auto: c.colourAuto }) || ''}`}`;
    }

    const stateMessage = (testid, title, text) => stageMessage(`<p><b>${esc(title)}</b></p><p>${esc(text)}</p>`, { testid });

    function render() {
      if (c.destroyed) return;
      const a = c.answer;
      if (!c.layout || !a) {
        hud.innerHTML = '';
        if (c.error) stageMessage(`<p>${t('project_city.could_not_read_the_city')} ${esc(c.error)}</p><button type="button" class="r3d-primary inline" data-pc-retry>${t('project_city.retry')}</button>`, { alert: true, testid: 'project-city-error' });
        else if (c.loading || !a) stageMessage(`<p>${t('project_city.reading_the_facts_and_laying_out')}</p><span class="r3d-bar open"><i></i></span>`, { testid: 'project-city-loading' });
        else if (a.state === 'not-git') stateMessage('project-city-not-git', 'Not a git repository', 'The project folder is not a git repository: there is no history to draw. Point the project to a git checkout.');
        else if (a.state === 'no-commits') stateMessage('project-city-no-commits', 'No commits yet', 'The city is drawn from the files at the last commit of the default branch.');
        else stageMessage(`<p>${t(window.CityLayout ? 'project_city.the_city_could_not_be_laid' : 'project_city.the_city_could_not_be_laid_no_script')}</p>${toFacts}`, { alert: true });
        return;
      }
      const model = a.model;
      hud.innerHTML = `${headerHtml(model, a.validation)}${notesHtml(model, a.validation)}
        <div class="r3d-card pc-legend" data-testid="project-city-legend" data-city-panel="legend"></div>${window.ProjectCityPanels?.legendOpen() || ''}
        <div class="r3d-zoom r3d-card" role="toolbar" aria-label="${t('project_city.camera')}">
          <button type="button" title="${t('project_city.zoom_in')}" aria-label="${t('project_city.zoom_in')}" data-pc-zoom="in">+</button>
          <button type="button" title="${t('project_city.zoom_out')}" aria-label="${t('project_city.zoom_out')}" data-pc-zoom="out">−</button>
          <button type="button" title="${t('project_city.the_whole_city')}" aria-label="${t('project_city.the_whole_city')}" data-pc-home data-testid="project-city-home">⌂</button>
        </div>
        <div class="r3d-hint r3d-card">${t('project_city.drag_to_pan_right_drag_to')}</div>
        <div class="r3d-card pc-hover hidden" data-pc-hover data-testid="project-city-hover"></div>
        <div class="r3d-detail r3d-card hidden" data-pc-detail data-testid="project-city-card"></div>`;
      c.legend = CityLayout.colourBy(c.layout, c.colour, { light: c.theme === 'light' }).legend;
      renderLegend();
      renderDetail();
      self.applyUi();
    }

    // ---------- the cards ----------

    // the hover and detail cards (project-city-cards.js)
    const cardHtml = (target, pinned) => window.ProjectCityCards?.html({ layout: c.layout, model: c.answer.model, colour: c.colour, light: c.theme === 'light', target, pinned }) || '';

    function renderHover() {
      const box = hud.querySelector('[data-pc-hover]');
      if (!box) return;
      const t = c.hover;
      const same = t && c.pinned && t.kind === c.pinned.kind && t.id === c.pinned.id;
      if (!t || same) { box.classList.add('hidden'); return; }
      if (box.dataset.for !== `${t.kind}:${t.id}`) {
        box.innerHTML = cardHtml(t, false);
        box.dataset.for = `${t.kind}:${t.id}`;
      }
      box.classList.remove('hidden');
      const r = el.getBoundingClientRect();
      const x = Math.min(t.x - r.left + 16, r.width - 276), y = Math.min(t.y - r.top + 16, r.height - box.offsetHeight - 8);
      box.style.left = `${Math.max(8, x)}px`;
      box.style.top = `${Math.max(8, y)}px`;
    }

    function renderDetail() {
      const box = hud.querySelector('[data-pc-detail]');
      if (!box) return;
      const html = c.pinned && c.layout ? cardHtml(c.pinned, true) : '';
      box.classList.toggle('hidden', !html);
      box.innerHTML = html ? `<button type="button" class="pc-detail-close" data-pc-unpin aria-label="${t('project_city.close_the_card')}" title="${t('common.close')}">×</button>${html}` : '';
      renderHover();
    }

    // ---------- controls ----------

    function flyTo(name) {
      if (!c.layout) return false;
      let target = CityLayout.flyTarget(c.layout, name);
      if (!target) {
        const first = CityLayout.findTargets(c.layout, name)[0];
        target = first ? CityLayout.flyTarget(c.layout, first.id) : null;
      }
      if (!target) return false;
      c.handle?.flyTo(target);
      if (target.kind === 'building') {
        c.pinned = { kind: 'building', id: target.id };
        c.handle?.pin(c.pinned);
        renderDetail();
      }
      return true;
    }

    // #782: the owner's colour, from the select or the legend's action: remembered, it wins over the default
    function setColour(value) {
      Object.assign(c, { colour: value, colourAuto: false });
      window.ProjectCityNotes?.saveColour(projectId, value);
      const select = hud.querySelector('[data-pc-colour]');
      if (select) select.value = value;
      if (c.handle) c.handle.update(paint());
      else c.legend = CityLayout.colourBy(c.layout, c.colour, { light: c.theme === 'light' }).legend;
      renderLegend();
    }

    function setTheme(name) {
      c.theme = name;
      el.dataset.theme = name;
      window.Run3DTheme?.save(name);
      render();
      if (c.handle) c.handle.update({ theme: name, ...paint() });
      renderLegend();
    }

    // #381: the city over the whole window; Esc or Close brings it back (the scene follows its box)
    const onKey = (e) => { if (e.key === 'Escape' && c.expanded) { e.stopPropagation(); setExpanded(false); } };
    function setExpanded(on) {
      if (c.expanded === on) return;
      c.expanded = on;
      el.classList.toggle('expanded', on);
      if (on) document.addEventListener('keydown', onKey, true);
      else document.removeEventListener('keydown', onKey, true);
      const btn = hud.querySelector('[data-pc-expand]');
      if (btn) {
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('aria-label', on ? t('project_city.close_the_full_screen') : t('project_city.expand_to_the_whole_window'));
        btn.title = on ? t('project_city.back_into_the_tab_esc') : t('project_city.expand_the_city_over_the_whole');
        btn.innerHTML = on ? ICON_CLOSE : ICON_EXPAND;
      }
      window.dispatchEvent(new Event('resize'));
    }

    el.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest('[data-pc-facts]')) onOpenFacts(null);
      else if (t.closest('[data-pc-open-facts]') && c.pinned) onOpenFacts(c.pinned.id);
      else if (t.closest('[data-pc-retry]')) load();
      else if (t.closest('[data-pc-unpin]')) { c.pinned = null; c.handle?.pin(null); renderDetail(); }
      else if (t.closest('[data-pc-home]')) c.handle?.home();
      else if (t.closest('[data-pc-zoom]')) c.handle?.zoom(t.closest('[data-pc-zoom]').dataset.pcZoom === 'in' ? ZOOM_IN : ZOOM_OUT);
      else if (t.closest('[data-pc-theme]')) setTheme(c.theme === 'light' ? 'dark' : 'light');
      else if (t.closest('[data-pc-expand]')) setExpanded(!c.expanded);
      else if (t.closest('[data-pc-flag]')) { const b = t.closest('[data-pc-flag]'), k = b.dataset.pcFlag; c[k] = !c[k]; b.setAttribute('aria-pressed', String(c[k])); c.handle?.update({ [k]: c[k] }); }
      else if (t.closest('[data-pc-analyze]')) onAnalyze?.(projectId);
      else if (t.closest('[data-pc-colour-to]')) setColour(t.closest('[data-pc-colour-to]').dataset.pcColourTo);
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-pc-colour]')) {
        setColour(t.value);
      } else if (t.matches('[data-pc-tests]')) {
        c.tests = t.checked;
        c.handle?.update({ tests: c.tests });
      } else if (t.matches('[data-pc-search]')) {
        const found = !t.value.trim() || flyTo(t.value.trim());
        t.setAttribute('aria-invalid', String(!found));
        t.title = found ? '' : I18n.t('project_city.no_file_district_or_zone_named', { value: t.value.trim() });
      }
    });

    const sameAnalysis = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);

    const self = {
      el,
      get projectId() { return projectId; },
      get layout() { return c.layout; },
      get model() { return c.answer?.model || null; },
      get expanded() { return c.expanded; },
      /** The tab's facts, estimate and analysis state (the quadrants, the Danger Zone count, the action's estimate and its run); reads the city the first time. */
      update({ facts, estimate, analysis } = {}) {
        const factsChanged = facts !== undefined && facts !== c.facts;
        const estimateChanged = estimate !== undefined && estimate !== c.estimate;
        const analysisChanged = analysis !== undefined && !sameAnalysis(analysis, c.analysis);
        if (facts !== undefined) c.facts = facts;
        if (estimate !== undefined) c.estimate = estimate;
        if (analysis !== undefined) c.analysis = analysis;
        shown = self;
        if (!c.answer && !c.loading && !c.error) { load(); return; }
        if (factsChanged && c.answer?.model) relayout();
        // the tab re-renders on each event: keep the drawn HUD (the search's text, the hover card)
        else if (factsChanged || estimateChanged || analysisChanged || !hud.innerHTML) render();
      },
      /** Reads the city again (after a refresh of the facts, or a run that saved a plan); with `answer` ({ state, model, validation }), draws that city instead (#376). */
      reload(answer) { if (answer) { c.seq++; Object.assign(c, { answer, loading: false, error: null }); relayout(); } else { c.answer = null; load(); } },
      flyTo,
      /** Repaints after a change of the overlay's layers. */
      refreshOverlay() { if (c.handle && c.layout) c.handle.update(paint()); },
      setPins(paths) { c.pins = [...(paths || [])]; c.handle?.update({ pins: c.pins }); }, // #382: the files whose connections stay drawn
      onLayout(fn) { listeners.add(fn); return () => listeners.delete(fn); }, // calls `fn(layout)` after every new layout
      setLegend(name, html) { if (html) c.rows.set(name, html); else c.rows.delete(name); renderLegend(); },
      applyUi() { for (const u of c.ui) u.apply(); }, // the mode and the panels' states on what was drawn (#440, #441)
      expand: setExpanded,
      stats: () => c.handle?.stats() || null,
      destroy() {
        c.destroyed = true;
        for (const u of c.ui) u.destroy();
        setExpanded(false);
        listeners.clear();
        if (shown === self) shown = null;
        try { c.handle?.unmount(); } catch { /* the scene failed already: nothing left to release */ }
        c.handle = null;
        el.remove();
      },
    };
    c.ui = [window.ProjectCityModes, window.ProjectCityPanels].filter(Boolean).map((m) => m.attach(self));
    return self;
  }

  window.ProjectCity = {
    create,
    current: () => (shown && shown.layout ? { projectId: shown.projectId, layout: shown.layout } : null),
    flyTo: (name) => !!shown?.flyTo(name),
    overlay(name, spec) {
      if (spec) layers.set(name, { highlight: spec.highlight || {}, markers: spec.markers || [] });
      else layers.delete(name);
      shown?.refreshOverlay();
    },
    stats: () => shown?.stats() || null,
  };
})();
