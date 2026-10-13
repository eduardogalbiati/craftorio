// The City view of a project's Architecture tab (#373): the project drawn as a 3D city from #371's
// model (architecture:city → src/shared/city-model.js), laid out by src/shared/city-layout.js and
// drawn by the prebuilt bundle generated/project-city.js (scripts/build-3d.js, src/renderer/city3d/),
// loaded with a plain <script src> the first time a City view shows, so the app's start does not
// change. Without WebGL, or without the bundle, the view says so and points to the Facts.
// The HUD is this file's, with the run's 3D view classes (run3d.css; project-city.css places them):
// - the header: the project, its files, zones and districts, the Danger Zone count, the plan's
//   coverage and the commit; a search that flies to a file, a district or a zone; "Colour by"
//   (Quadrant, the default when a tool measured the complexity, Zone otherwise, Churn) with its
//   legend; the Tests toggle; the dark / light toggle shared with the run's 3D view (Run3DTheme);
// - the notes under it: no plan (the folders as districts, "Map this project" and its estimate,
//   the Oracle's per-analysis estimate of architecture:estimate), a stale plan (the unmatched share
//   and "Refresh the map"), the plan's validation problems, the edges not read, the aggregation of
//   small files over 5,000;
// - the hover card of a building, a district or a zone, the card a click pins (a building's has
//   "Open in Facts", its hotspot row), the camera buttons (zoom, home);
// - the states: the facts still loading, not a git repository, no commits, an error with Retry.
// "Map this project" and "Refresh the map" start the plan workflow of #372 when it registers
// window.ProjectCityPlan.start(projectId); until then they are disabled and say why.
// The overlay API, for the city epic's next modules (they add their own files, not code here):
//   ProjectCity.overlay(name, { highlight: { path: colour }, markers: [path | { path, colour, label }] } | null)
//     sets or removes a named layer; the layers merge (later names win a file's colour) and the
//     buildings no layer highlights are greyed (city-layout.js applyOverlay);
//   ProjectCity.flyTo(name) flies to a file, a district or a zone (false when there is none);
//   ProjectCity.current() → { projectId, layout } of the city on screen (null when none);
//   ProjectCity.stats() → { firstFrameMs, fps }: the time to the first frame and the frame rate
//   while the camera moves (for the PR's measures).
// Uses app.js globals at call time: api, esc, errMsg. Browser: window.ProjectCity.
(() => {
  const BUNDLE = '../../generated/project-city.js';
  const MISSING = 'The City view is not built: run `npm run build:3d` (or `npm install`) and reload. The Facts view has the same numbers, as tables.';
  const STALE_COVERAGE = 0.9; // under this share of matched files, the plan is older than the code
  const ZOOM_IN = 0.72, ZOOM_OUT = 1.38;
  const COLOUR_LABEL = { quadrant: 'Quadrant', zone: 'Zone', churn: 'Churn' };
  const ICON_CITY = '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="1" y="7" width="4" height="8" rx="1"/><rect x="6" y="2" width="4" height="13" rx="1"/><rect x="11" y="5" width="4" height="10" rx="1"/></svg>';
  let bundle = null; // the bundle's load, once
  let gl = null; // why WebGL cannot draw here ('' = it can), checked once
  let shown = null; // the city on screen (the overlay API's)
  const layers = new Map(); // the overlay's layers, by name, in the order they were set

  const plural = (n, unit) => `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
  const pct = (x) => `${Math.round(x * 100)}%`;
  const base = (p) => String(p).split('/').pop();
  const dir = (p) => String(p).split('/').slice(0, -1).join('/') || '(root)';
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
      script.onload = () => (window.ProjectCityScene ? resolve() : reject(new Error(MISSING)));
      script.onerror = () => { bundle = null; script.remove(); reject(new Error(MISSING)); };
      document.head.append(script);
    });
    return bundle;
  }

  // the overlay's layers merged: { highlight, markers }
  function mergedOverlay() {
    const highlight = {};
    const markers = [];
    for (const l of layers.values()) {
      Object.assign(highlight, l.highlight || {});
      markers.push(...(l.markers || []));
    }
    return { highlight, markers };
  }

  /** A City view for project `projectId`: { el, update({ facts, estimate }), reload(), destroy(), flyTo(name), refreshOverlay() }. */
  function create({ projectId, name = '', onOpenFacts = () => {} }) {
    const el = document.createElement('div');
    el.className = 'r3d pc-city';
    el.setAttribute('data-testid', 'project-city');
    el.dataset.theme = theme();
    el.innerHTML = '<div class="pc-stage" data-pc-stage></div><div class="r3d-hud" data-pc-hud></div>';
    const stage = el.querySelector('[data-pc-stage]');
    const hud = el.querySelector('[data-pc-hud]');
    const c = {
      projectId, name, el, answer: null, loading: false, error: null, facts: null, estimate: null,
      colour: null, tests: true, theme: el.dataset.theme, layout: null, legend: [], handle: null, drawn: null,
      pinned: null, hover: null, seq: 0, destroyed: false,
    };

    // ---------- data ----------

    async function load() {
      const seq = ++c.seq;
      Object.assign(c, { loading: true, error: null });
      render();
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

    // the facts' quadrant per file (the city model has none: they come from the same facts read)
    const quadrants = () => Object.fromEntries((c.facts?.model?.files || []).filter((r) => r.quadrant).map((r) => [r.file, r.quadrant]));

    function relayout() {
      const model = c.answer?.model;
      c.layout = model && window.CityLayout ? CityLayout.layoutCity(model, { quadrants: quadrants() }) : null;
      if (c.layout && !c.colour) c.colour = CityLayout.defaultColourBy(model);
      render();
      draw();
    }

    // the buildings' colours (colour by, then the overlay) and the legend
    function paint() {
      const { colours, legend } = CityLayout.colourBy(c.layout, c.colour, { light: c.theme === 'light' });
      const coloured = { ...c.layout, buildings: c.layout.buildings.map((b, i) => ({ ...b, colour: colours[i] })) };
      const out = CityLayout.applyOverlay(coloured, mergedOverlay());
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

    const toFacts = '<button type="button" class="r3d-primary inline" data-pc-facts>Show the Facts</button>';

    async function draw() {
      if (!c.layout) return;
      const problem = webglProblem();
      if (problem) {
        stageMessage(`<p>${esc(problem)} The Facts view has the same numbers, as tables.</p>${toFacts}`, { alert: true });
        return;
      }
      const painted = paint();
      renderLegend();
      if (c.handle) {
        if (c.drawn !== c.layout) c.handle.update({ layout: c.layout, ...painted, tests: c.tests });
        else c.handle.update(painted);
        c.drawn = c.layout;
        return;
      }
      if (!stage.querySelector('canvas')) stageMessage('<p>Loading the city…</p><span class="r3d-bar open"><i></i></span>');
      try {
        await loadBundle();
      } catch (e) {
        if (!c.destroyed) stageMessage(`<p>${esc(e.message === MISSING ? MISSING : `The City view could not load: ${errMsg(e)}`)}</p>${toFacts}`, { alert: true });
        return;
      }
      if (c.destroyed || c.handle || !c.layout) return;
      stage.innerHTML = '';
      try {
        c.handle = ProjectCityScene.mount(stage, {
          layout: c.layout, ...paint(), tests: c.tests, theme: c.theme, relationsOf,
          onHover: (t) => { c.hover = t; renderHover(); },
          onPick: (t) => { c.pinned = t; renderDetail(); },
        });
        c.drawn = c.layout;
      } catch (e) {
        stageMessage(`<p>The city could not be drawn: ${esc(errMsg(e))}</p>${toFacts}`, { alert: true });
      }
    }

    // ---------- the HUD ----------

    function headerHtml(model, validation) {
      const facts = c.facts?.model;
      const measured = facts?.complexity?.status === 'measured';
      const danger = measured ? facts.files.filter((r) => r.quadrant === 'Danger Zone').length : null;
      const plan = model.grouping === 'plan' ? `plan covers ${pct(validation?.coverage ?? 1)}` : 'no plan: folders as districts';
      const facts1 = [
        plural(model.buildings.length, 'files'), plural(model.zones.length, 'zones'), plural(model.districts.length, 'districts'),
        danger == null ? 'Danger Zone not measured' : `${danger} in the Danger Zone`, plan, model.commit ? String(model.commit).slice(0, 10) : '',
      ].filter(Boolean).join(' · ');
      const title = model.project || c.name || projectId;
      const options = window.CityLayout.COLOUR_BY.map((k) => `<option value="${k}" ${k === c.colour ? 'selected' : ''}>${COLOUR_LABEL[k]}</option>`).join('');
      const targets = [...c.layout.zones.map((z) => z.name), ...c.layout.districts.map((d) => d.name), ...c.layout.buildings.filter((b) => !b.aggregate).map((b) => b.path)];
      const light = c.theme === 'light';
      return `<div class="r3d-top r3d-card" data-testid="project-city-header">
        <div class="r3d-brand"><i>${ICON_CITY}</i></div>
        <div class="r3d-run"><b title="${esc(title)}">${esc(title)}</b><small title="${esc(facts1)}" data-testid="project-city-facts">${esc(facts1)}</small></div>
        <span class="r3d-grow"></span>
        <label class="r3d-search"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="7" cy="7" r="5"/><path d="M11 11l4 4"/></svg>
          <input type="search" list="pc-targets-${esc(projectId)}" placeholder="Fly to a file or a district" aria-label="Search the city" data-pc-search data-testid="project-city-search" /></label>
        <datalist id="pc-targets-${esc(projectId)}">${targets.map((t) => `<option value="${esc(t)}"></option>`).join('')}</datalist>
        <label class="r3d-chip"><span>Colour by</span><select data-pc-colour aria-label="Colour by" data-testid="project-city-colour">${options}</select></label>
        <label class="r3d-chip" title="Show or hide the test files (smaller and lower buildings)"><input type="checkbox" data-pc-tests data-testid="project-city-tests" ${c.tests ? 'checked' : ''} /> Tests</label>
        <button type="button" class="r3d-close r3d-theme" data-pc-theme data-testid="project-city-theme" aria-label="${light ? 'Dark theme' : 'Light theme'}" title="${light ? 'Switch to the dark theme' : 'Switch to the light theme'} (the run's 3D view follows)">${light ? '☾' : '☀'}</button>
      </div>`;
    }

    function planButton(label, testid) {
      const ready = typeof window.ProjectCityPlan?.start === 'function';
      return `<button type="button" class="r3d-primary inline" data-pc-map data-testid="${testid}" ${ready ? '' : 'disabled'} title="${ready ? 'Start the plan workflow: an agent reads the project and writes its city plan' : 'The plan workflow (#372) is not in this version yet'}">${label}</button>`;
    }

    function notesHtml(model, validation) {
      const notes = [];
      if (model.grouping !== 'plan') {
        const e = c.estimate;
        const estimate = e ? `<span class="pc-estimate" title="The mean real cost of the last ${plural(e.basis, 'architecture analyses')}: one Oracle turn">≈ US$ ${Number(e.usd).toFixed(2)}</span>` : '<span class="muted">No estimate yet: the first real analysis shows its cost.</span>';
        notes.push(`<div class="r3d-card pc-note" data-testid="project-city-no-plan"><b>No city plan yet</b><p>The districts are the folders. A plan names the zones, the districts, the landmarks and the ports the project talks to.</p>
          <div class="pc-actions">${planButton('Map this project', 'project-city-map')}${estimate}</div></div>`);
      } else if ((validation?.coverage ?? 1) < STALE_COVERAGE) {
        notes.push(`<div class="r3d-card pc-note warn" data-testid="project-city-stale"><b>The plan is older than the code</b><p>${pct(1 - validation.coverage)} of the files (${validation.drawn - validation.matched} of ${validation.drawn}) match no district: they stand in the Outskirts.</p>
          <div class="pc-actions">${planButton('Refresh the map', 'project-city-refresh-map')}</div></div>`);
      }
      const v = validation || {};
      const problems = [
        ...(v.schemaErrors || []).map((s) => `The plan: ${s}`),
        ...(v.unknownZones || []).map((u) => `District ${u.district} names an unknown zone ${u.zone}: drawn in the Outskirts.`),
        ...(v.duplicateIds || []).map((id) => `The id ${id} is used twice.`),
        ...(v.missingPaths || []).map((p) => `${p} is not in the repository at this commit (a landmark or a port's file).`),
        ...(v.emptyDistricts || []).map((id) => `District ${id} has no file.`),
      ];
      if (model.grouping === 'plan' && problems.length) {
        notes.push(`<div class="r3d-card pc-note warn" data-testid="project-city-problems"><b>${plural(problems.length, 'problems')} in the city plan</b><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>`);
      }
      const notRead = typeof model.edges === 'string' ? [model.edges] : model.edgesNotRead || [];
      if (notRead.length) notes.push(`<div class="r3d-card pc-note" data-testid="project-city-edges"><b>Arcs</b> ${esc(notRead.join(', '))}: hovering those files draws no arc.</div>`);
      if (c.layout.aggregated) notes.push(`<div class="r3d-card pc-note" data-testid="project-city-aggregated"><b>Over 5,000 files</b> ${esc(c.layout.note)}</div>`);
      return notes.length ? `<div class="pc-notes">${notes.join('')}</div>` : '';
    }

    function renderLegend() {
      const box = hud.querySelector('[data-testid="project-city-legend"]');
      if (!box) return;
      box.innerHTML = `<b>${esc(COLOUR_LABEL[c.colour] || '')}</b><ul>${c.legend.map((l) => `<li><i class="r3d-dot" style="--c:${esc(l.colour)}"></i>${esc(l.label)}</li>`).join('')}</ul>`;
    }

    const stateMessage = (testid, title, text) => stageMessage(`<p><b>${esc(title)}</b></p><p>${esc(text)}</p>`, { testid });

    function render() {
      if (c.destroyed) return;
      const a = c.answer;
      if (!c.layout) {
        hud.innerHTML = '';
        if (c.error) stageMessage(`<p>Could not read the city: ${esc(c.error)}</p><button type="button" class="r3d-primary inline" data-pc-retry>Retry</button>`, { alert: true, testid: 'project-city-error' });
        else if (c.loading || !a) stageMessage('<p>Reading the facts and laying out the city…</p><span class="r3d-bar open"><i></i></span>', { testid: 'project-city-loading' });
        else if (a.state === 'not-git') stateMessage('project-city-not-git', 'Not a git repository', 'The project folder is not a git repository: there is no history to draw. Point the project to a git checkout.');
        else if (a.state === 'no-commits') stateMessage('project-city-no-commits', 'No commits yet', 'The city is drawn from the files at the last commit of the default branch.');
        else stageMessage(`<p>The city could not be laid out${window.CityLayout ? '' : ' (its layout script did not load)'}.</p>${toFacts}`, { alert: true });
        return;
      }
      const model = a.model;
      hud.innerHTML = `${headerHtml(model, a.validation)}${notesHtml(model, a.validation)}
        <div class="r3d-card pc-legend" data-testid="project-city-legend"></div>
        <div class="r3d-zoom r3d-card" role="toolbar" aria-label="Camera">
          <button type="button" title="Zoom in" aria-label="Zoom in" data-pc-zoom="in">+</button>
          <button type="button" title="Zoom out" aria-label="Zoom out" data-pc-zoom="out">−</button>
          <button type="button" title="The whole city" aria-label="The whole city" data-pc-home data-testid="project-city-home">⌂</button>
        </div>
        <div class="r3d-hint r3d-card">Drag to pan, right-drag to rotate, scroll to zoom; click a building to pin its card</div>
        <div class="r3d-card pc-hover hidden" data-pc-hover data-testid="project-city-hover"></div>
        <div class="r3d-detail r3d-card hidden" data-pc-detail data-testid="project-city-card"></div>`;
      if (c.layout) { c.legend = CityLayout.colourBy(c.layout, c.colour, { light: c.theme === 'light' }).legend; renderLegend(); }
      renderDetail();
    }

    // ---------- the cards ----------

    const row = (label, value) => `<dt>${esc(label)}</dt><dd title="${esc(value)}">${esc(value)}</dd>`;

    function cardHtml(t, pinned) {
      const L = c.layout;
      if (t.kind === 'building') {
        const i = L.buildings.findIndex((x) => x.path === t.id);
        const b = L.buildings[i];
        if (!b) return '';
        const colour = paintColour(i);
        if (b.aggregate) {
          return `<div class="r3d-d-head"><div><div class="r3d-kind">Small files</div><h3>${plural(b.aggregate, 'files')}</h3><p>${esc(districtName(b.district))}</p></div></div>
            <dl class="r3d-rows">${row('Lines', b.lines.toLocaleString('en-US'))}${row('Most commits', String(b.churn))}</dl>
            <div class="r3d-note">Over 5,000 files the smallest are drawn as one block per district.</div>`;
        }
        const rel = CityLayout.neighbours(L, b.path);
        const edges = typeof c.answer.model.edges === 'string' ? c.answer.model.edges : null;
        const measured = b.complexity != null;
        const status = b.quadrant || (measured ? '' : 'Complexity not measured');
        return `<div class="r3d-d-head"><div><div class="r3d-kind">${b.landmark ? `Landmark · ${esc(b.landmark)}` : b.test ? 'Test file' : 'File'}</div><h3 title="${esc(b.path)}">${esc(base(b.path))}</h3><p class="r3d-mono" title="${esc(b.path)}">${esc(dir(b.path))}</p></div></div>
          ${status ? `<div class="r3d-d-status"><span class="r3d-pill" style="--c:${esc(colour)}">${esc(status)}</span></div>` : ''}
          <dl class="r3d-rows">${row('Lines', b.lines.toLocaleString('en-US'))}${row('Commits', String(b.churn))}
            ${measured ? `${row('Complexity', String(b.complexity))}${row('Worst function', String(b.worst ?? '—'))}${row('Functions', String(b.functions ?? '—'))}` : ''}
            ${row('District', districtName(b.district))}${row('Zone', zoneName(b.zone))}
            ${edges ? row('Arcs', edges) : `${row('Requires', plural(rel.requires.length, 'files'))}${row('Required by', plural(rel.requiredBy.length, 'files'))}`}
            ${b.lastChange ? row('Last change', String(b.lastChange).slice(0, 10)) : ''}</dl>
          ${pinned ? '<button type="button" class="r3d-primary" data-pc-open-facts data-testid="project-city-open-facts">Open in Facts</button>' : ''}`;
      }
      if (t.kind === 'district') {
        const d = L.districts.find((x) => x.id === t.id);
        if (!d) return '';
        const rel = CityLayout.districtNeighbours(L, d.id);
        const deps = rel.requires.length || rel.requiredBy.length ? `${row('Depends on', plural(rel.requires.length, 'districts'))}${row('Used by', plural(rel.requiredBy.length, 'districts'))}` : '';
        return `<div class="r3d-d-head"><div><div class="r3d-kind">District</div><h3 title="${esc(d.name)}">${esc(d.name)}</h3><p>${esc(zoneName(d.zone))}</p></div></div>
          <dl class="r3d-rows">${row('Files', String(d.files))}${row('Lines', d.lines.toLocaleString('en-US'))}${deps}</dl>
          ${d.purpose ? `<div class="r3d-note">${esc(d.purpose)}</div>` : ''}`;
      }
      const z = L.zones.find((x) => x.id === t.id);
      if (!z) return '';
      return `<div class="r3d-d-head"><div><div class="r3d-kind">Zone · ${esc(z.kind)}</div><h3 title="${esc(z.name)}">${esc(z.name)}</h3></div></div>
        <dl class="r3d-rows">${row('Districts', String(L.districts.filter((d) => d.zone === z.id).length))}${row('Files', String(z.files))}${row('Lines', z.lines.toLocaleString('en-US'))}</dl>
        ${z.purpose ? `<div class="r3d-note">${esc(z.purpose)}</div>` : ''}`;
    }

    const districtName = (id) => c.layout.districts.find((d) => d.id === id)?.name || id;
    const zoneName = (id) => c.layout.zones.find((z) => z.id === id)?.name || id;
    function paintColour(i) {
      try { return CityLayout.colourBy(c.layout, c.colour, { light: c.theme === 'light' }).colours[i]; } catch { return ''; }
    }

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
      box.innerHTML = html ? `<button type="button" class="pc-detail-close" data-pc-unpin aria-label="Close the card" title="Close">×</button>${html}` : '';
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

    function setTheme(name) {
      c.theme = name;
      el.dataset.theme = name;
      window.Run3DTheme?.save(name);
      render();
      if (c.handle) c.handle.update({ theme: name, ...paint() });
      renderLegend();
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
      else if (t.closest('[data-pc-map]')) window.ProjectCityPlan?.start?.(projectId);
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-pc-colour]')) {
        c.colour = t.value;
        if (c.handle) c.handle.update(paint());
        else c.legend = CityLayout.colourBy(c.layout, c.colour, { light: c.theme === 'light' }).legend;
        renderLegend();
      } else if (t.matches('[data-pc-tests]')) {
        c.tests = t.checked;
        c.handle?.update({ tests: c.tests });
      } else if (t.matches('[data-pc-search]')) {
        const found = !t.value.trim() || flyTo(t.value.trim());
        t.setAttribute('aria-invalid', String(!found));
        t.title = found ? '' : `No file, district or zone named "${t.value.trim()}"`;
      }
    });

    const self = {
      el,
      get projectId() { return projectId; },
      get layout() { return c.layout; },
      /** The tab's facts and estimate (the quadrants, the Danger Zone count, the plan's estimate); reads the city the first time. */
      update({ facts, estimate } = {}) {
        const factsChanged = facts !== undefined && facts !== c.facts;
        if (facts !== undefined) c.facts = facts;
        if (estimate !== undefined) c.estimate = estimate;
        shown = self;
        if (!c.answer && !c.loading && !c.error) { load(); return; }
        if (factsChanged && c.answer?.model) relayout();
        else render();
      },
      /** Reads the city again (after a refresh of the facts). */
      reload() { c.answer = null; load(); },
      flyTo,
      /** Repaints after a change of the overlay's layers. */
      refreshOverlay() { if (c.handle && c.layout) c.handle.update(paint()); },
      stats: () => c.handle?.stats() || null,
      destroy() {
        c.destroyed = true;
        if (shown === self) shown = null;
        try { c.handle?.unmount(); } catch { /* the scene failed already: nothing left to release */ }
        c.handle = null;
        el.remove();
      },
    };
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
