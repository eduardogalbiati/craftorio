// A release on the project city (#376), an overlay of the City view (project-city.js) built on its
// overlay API, so the city's own module does not grow. "Show on the map" (a release of the Releases
// screen, the release run's page: showRelease(projectId, { to, from? })) opens the project's City
// view (#430: in the city modal over the screen, project-city-modal.js, unless a city of the project is on screen) on the city as it was at the previous release (architecture:release: the tree and the facts at
// `from`, the current plan's rules; packages/engine/domains/releases/release-city.js), with what the release added in green, what
// it changed on the release's own ramp by the lines changed (#438: CityRelease.releaseRamp), renamed
// files on their old building with the rename sign (an accent marker labelled "renamed") and removed files
// marked as ghosts (a ghost-coloured marker labelled "removed" on the base building: #373's overlay
// API has highlights and markers, no outline mode), the rest grey (packages/shared/city-release.js). A card (data-testid="city-release")
// holds the header (headerMarkup: the counts by status, the "changed" chip with the four shades
// (city-release-ramp), the "renamed" one with the sign (city-release-rename-sign), by district and zone,
// the two-tag picker, the filter by issue through the commits that name it), the base's plan notes
// (#439, ProjectCityNotes.releaseHtml: only the plan's own problems, the files and districts that
// did not exist yet at `from` in one muted line, city-release-missing) and "Save image": a PNG of the city with the
// project, the release and the counts in a caption, for release notes. Close draws the project's
// own city again. A release puts the city in its mode (#440, project-city-modes.js: "Release <from> →
// <to>", no Live, no notes of today's plan) whose legend lists the release's colours (city.setLegend; the
// ramp's shades with the first line count of each);
// the card is a panel (#441: data-city-panel="release", its chevron). No model call.
// Uses app.js globals at call time: api, esc, errMsg. Browser: window.ProjectCityRelease.
(() => {
  const LAYER = 'release';
  const GHOST = '#9aa3b2';
  const CAPTION_PX = 40;
  // the legend's rows (#440), in the order of the header's counts
  const STATUSES = ['added', 'changed', 'renamed', 'removed'];
  const LEGEND_LABEL = { added: 'project_city_release.legend_added', changed: 'project_city_release.legend_changed', renamed: 'project_city_release.legend_renamed', removed: 'project_city_release.legend_removed' };
  const handles = new Set();
  let pending = null; // { projectId, to, from }: the release asked from the Releases screen or a run

  const dot = (colour) => ProjectCityCards.dot(colour);
  const countsHtml = (list, testid, label) => ProjectCityCards.countsHtml(list, testid, label);
  const options = (values, selected, label = (v) => v) => values.map((v) => `<option value="${esc(v)}" ${String(v) === String(selected) ? 'selected' : ''}>${esc(label(v))}</option>`).join('');
  // the app's select (select.js, #383); a page without select.js (a test's mini DOM) gets the same element from the DOM
  function selectMarkup(attrs, optionsHtml) {
    if (window.Select) return window.Select.markup(Object.entries(attrs).map(([k, v]) => (v === '' ? k : `${k}="${esc(v)}"`)).join(' '), optionsHtml);
    const el = document.createElement('select');
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.innerHTML = optionsHtml;
    return el.outerHTML;
  }
  // the status chips: each count with its sign on the map (#438: the ramp for changed, the rename marker for renamed)
  const statusColour = () => ({ added: CityRelease.ADDED_COLOUR, removed: GHOST });
  const renameSign = () => `<i class="pcr-rename" data-testid="city-release-rename-sign" style="--c:${esc(CityRelease.RENAME_COLOUR)}" aria-hidden="true"></i>`;
  // the change ramp, lightest first; each shade says the lines it stands for (CityRelease.releaseRamp's cuts), under it in the legend
  function rampHtml(cuts, numbers = false) {
    const shades = CityRelease.CHANGE_RAMP.map((colour, i) => {
      // an empty shade (close counts) has a fractional cut: no line count to say
      const [from, to] = ((cuts || [])[i] || []).filter(Number.isInteger);
      const said = from == null ? '' : t('project_city_release.ramp_lines', { from, to });
      const shade = `<i class="pcr-shade" data-testid="city-release-ramp-shade" style="--c:${esc(colour)}"${said ? ` title="${esc(said)}" aria-label="${esc(said)}"` : ''}></i>`;
      return numbers ? `<span class="pcr-step">${shade}<small>${from ?? ''}</small></span>` : shade;
    });
    // spaced: the line counts read apart (flex drops the spaces on screen)
    return `<span class="pcr-ramp" data-testid="city-release-ramp">${shades.join(' ')}</span>`;
  }
  const signHtml = (status, cuts, numbers) => (status === 'changed' ? rampHtml(cuts, numbers) : status === 'renamed' ? renameSign() : dot(statusColour()[status]));

  /** The two-tag picker; a commit typed elsewhere (a project without tags) stays selectable. */
  function pickerMarkup(tags, from, to) {
    const refs = [...tags, ...[to, from].filter((r) => r && !tags.includes(r))];
    return `<div class="pcr-picker">
        <label class="r3d-chip"><span>${t('project_city_release.from')}</span>${selectMarkup({ 'data-pcr-from': '', 'data-testid': 'city-release-from', 'aria-label': 'The previous release' }, options(refs, from))}</label>
        <label class="r3d-chip"><span>${t('project_city_release.to')}</span>${selectMarkup({ 'data-pcr-to': '', 'data-testid': 'city-release-to', 'aria-label': 'The release' }, options(refs, to))}</label>
      </div>`;
  }

  /** The release's header: the project, the two-tag picker, the counts by status, district and zone, the issue filter, Save image. */
  function headerMarkup(view) {
    const { project = '', from = null, to = null, header = {}, tags = [], issues = [], issue = null, cuts = [] } = view || {};
    const counts = header.counts || {};
    const chips = ['added', 'changed', 'renamed', 'removed'].filter((s) => counts[s] > 0)
      .map((s) => `<span class="pcr-count" data-testid="city-release-count-${s}">${signHtml(s, cuts)}${counts[s]} ${s}</span>`).join(' ');
    return `<div class="pci-header" data-testid="city-release-header">
      <div class="pci-title"><span title="${esc(project)}">${esc(project)}</span></div>
      ${pickerMarkup(tags, from, to)}
      <p class="pcr-counts">${chips || `<span class="muted">${t('project_city_release.no_file_changed')}</span>`}</p>
      ${countsHtml(header.districts || [], 'city-release-district', 'By district')}
      ${countsHtml(header.zones || [], 'city-release-zone', 'By zone')}
      <div class="pcr-actions">
        <label class="r3d-chip"><span>${t('project_city_release.issue')}</span>${selectMarkup({ 'data-pcr-issue': '', 'data-testid': 'city-release-issue', 'aria-label': 'Filter by issue' },
          `<option value="" ${issue == null ? 'selected' : ''}>${t('project_city_release.all_issues')}</option>${options(issues, issue, (n) => `#${n}`)}`)}</label>
        <span class="r3d-grow"></span>
        <button type="button" class="r3d-primary inline" data-pcr-save data-testid="city-release-save-image" title="${t('project_city_release.save_a_png_of_this_view')}">${t('project_city_release.save_image')}</button>
      </div>
    </div>`;
  }

  const loadImage = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('the capture did not load'));
    img.src = src;
  });

  // the city's box cut out of a window capture, the caption under it: a PNG data URL
  async function cityImage(box, caption) {
    const shot = await api.captureWindow();
    if (!shot) throw new Error('capturing the window is only available in the desktop app');
    const img = await loadImage(shot);
    const scale = img.naturalWidth / (window.innerWidth || img.naturalWidth);
    const r = box.getBoundingClientRect();
    const w = Math.round(r.width * scale);
    const h = Math.round(r.height * scale);
    const strip = Math.round(CAPTION_PX * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h + strip;
    const g = canvas.getContext('2d');
    g.drawImage(img, Math.round(r.left * scale), Math.round(r.top * scale), w, h, 0, 0, w, h);
    g.fillStyle = '#111827';
    g.fillRect(0, h, w, strip);
    g.fillStyle = '#e5e7eb';
    g.font = `${Math.round(13 * scale)}px system-ui, sans-serif`;
    g.textBaseline = 'middle';
    g.fillText(caption, Math.round(12 * scale), h + strip / 2, w - Math.round(24 * scale));
    return canvas.toDataURL('image/png');
  }

  const fileName = (project, from, to) => `${String(project || 'project').replace(/[^\w.-]+/g, '-')}-${from}-to-${to}.png`.replace(/[^\w.-]+/g, '-');

  function attach(city, { projectId }) {
    const el = document.createElement('div');
    el.className = 'r3d-card pci pcr hidden';
    el.setAttribute('data-testid', 'city-release');
    el.setAttribute('data-city-panel', 'release'); // #440: the release mode's card; #441: its chevron
    el.setAttribute('aria-live', 'polite');
    city.el.appendChild(el);
    let request = null; // { to, from }
    let data = null; // architecture:release's answer
    let issue = null; // the issue filter
    let applied = null; // the release's model drawn on the city
    let header = null;
    let error = null;
    let note = '';
    let missingOpen = false; // #439: the list of what did not exist yet, open across redraws
    let layered = false;
    let seq = 0;
    let destroyed = false;

    const changes = () => CityRelease.filterByIssue(data.changes || [], data.commits || [], issue);
    const issuesOf = () => [...new Set((data.commits || []).flatMap((c) => c.issues || []))].sort((a, b) => a - b);
    const projectName = () => (typeof state !== 'undefined' ? state.projects?.find((p) => p.id === projectId)?.name : '') || data?.plan?.project || projectId;

    // the base city plus the added files, on the city (its layout calls draw back)
    function applyModel() {
      applied = CityRelease.releaseModel(data.base.model, changes(), { plan: data.plan });
      city.reload({ state: 'ok', model: applied, validation: data.base.validation || null });
    }

    function close() {
      seq++;
      const was = applied;
      request = null;
      data = null;
      applied = null;
      draw();
      // the project's own city again
      if (was && city.model === was) city.reload();
    }

    // #440: the mode's title, "Release <from> → <to>" once the release is read
    const enterMode = () => city.setMode?.('release', {
      title: data?.from && data?.to ? t('project_city_modes.title_release', { from: data.from, to: data.to }) : t('project_city_modes.title_release_to', { to: request?.to || '' }),
      onLeave: close,
    });

    // the legend's rows: the colours the release paints (added, the change ramp with its cut points, the rename sign, removed as ghosts)
    function legendHtml(counts, cuts) {
      const rows = STATUSES.filter((s) => counts[s] > 0).map((s) => `<li>${signHtml(s, cuts, true)} <span>${t(LEGEND_LABEL[s])}</span> <small>${counts[s]}</small></li>`);
      return rows.length ? `<b>${t('project_city_release.changes')}</b><ul>${rows.join('')}</ul>` : null;
    }

    // the card's markup, then the mode's panels and their saved states (#440, #441)
    function draw() { drawCard(); city.applyUi?.(); }

    function drawCard() {
      if (destroyed) return;
      el.classList.toggle('hidden', !request);
      if (!request) {
        city.setLegend?.(LAYER, null);
        if (layered) ProjectCity.overlay(LAYER, null);
        layered = false;
        el.innerHTML = '';
        return;
      }
      const title = data && data.from && data.to ? `Release ${data.to}` : 'Release';
      const head = `<div class="pci-head pc-panel-head"><b>${esc(title)}</b><span class="r3d-grow"></span><button type="button" class="link-btn" data-pcr-close data-testid="city-release-close">${t('common.close')}</button>${window.ProjectCityPanels?.chevron(title) || ''}</div>`;
      const body = (html) => `${head}<div data-city-panel-body>${html}</div>`;
      if (error) { el.innerHTML = body(`<p class="small" role="alert">${t('project_city_release.could_not_read_the_release')} ${esc(error)}</p>`); return; }
      if (!data) { el.innerHTML = body(`<p class="muted small">${t('project_city_release.reading_the_release_and_the_city')}</p>`); return; }
      enterMode();
      if (data.state !== 'ok') {
        // two tags or commits or more: another pair can still be picked
        const tags = data.tags || [];
        el.innerHTML = body(`<p class="small" role="alert">${esc(stateText(data))}</p>${tags.length > 1 ? pickerMarkup(tags, data.from, data.to) : ''}`);
        return;
      }
      if (!city.layout || city.model !== applied) { el.innerHTML = body(`<p class="muted small">${t('project_city_release.laying_out_the_city_at_from', { from: esc(data.from) })}</p>`); return; }
      const list = changes();
      const overlay = CityRelease.releaseOverlay(list);
      const { cuts } = CityRelease.releaseRamp(list);
      header = CityRelease.releaseHeader(city.layout, list);
      const markers = [
        ...overlay.ghosts.map((p) => ({ path: p, colour: GHOST, label: 'removed' })),
        ...overlay.renamed.map((p) => ({ path: p, colour: CityRelease.RENAME_COLOUR, label: 'renamed' })),
      ];
      ProjectCity.overlay(LAYER, { highlight: overlay.highlight, markers });
      layered = true;
      city.setLegend?.(LAYER, legendHtml(header.counts || {}, cuts));
      // #439: the base's validation of today's plan without what arrived after the release
      const plan = window.ProjectCityNotes?.releaseHtml({ validation: data.base?.validation, from: data.from, plan: data.plan, open: missingOpen }) || '';
      el.innerHTML = body(`${headerMarkup({ project: projectName(), from: data.from, to: data.to, header, tags: data.tags || [], issues: issuesOf(), issue, cuts })}${plan}${note ? `<p class="muted small" role="status">${esc(note)}</p>` : ''}`);
    }

    function stateText(d) {
      if (d.state === 'first-release') return `${d.to || 'This release'} is the first tag: there is no previous release to compare with.${(d.tags || []).length > 1 ? ' Pick a later release below.' : ''}`;
      if (d.state === 'no-history') return 'The project has no commit to compare.';
      if (d.state === 'not-git') return 'The project folder is not a git repository.';
      if (d.state === 'unknown-ref') return `Git does not know ${d.from} or ${d.to} in this repository.`;
      return d.error || `The release could not be read (${d.state}).`;
    }

    async function show(req) {
      const mine = ++seq;
      request = { to: req.to || null, from: req.from || null };
      data = null;
      error = null;
      note = '';
      missingOpen = false;
      issue = req.issue ?? null;
      // #440: the release's mode replaces the one on screen before its city is drawn (no notes of today's plan on it)
      enterMode();
      draw();
      try {
        const answer = await api.architectureRelease({ projectId, from: request.from, to: request.to });
        if (destroyed || mine !== seq) return;
        data = answer || { state: 'error', error: 'the service gave no answer' };
        if (data.state === 'ok') applyModel();
        draw();
      } catch (e) {
        if (destroyed || mine !== seq) return;
        error = errMsg(e);
        draw();
      }
    }

    async function saveImage(btn) {
      if (!data || !header) return;
      btn.disabled = true;
      note = '';
      try {
        const caption = CityRelease.captionText({ project: projectName(), from: data.from, to: data.to, counts: header.counts, issue });
        const a = document.createElement('a');
        a.href = await cityImage(city.el, caption);
        a.download = fileName(projectName(), data.from, data.to);
        a.click();
      } catch (e) {
        note = `Could not save the image: ${errMsg(e)}`;
      }
      if (!destroyed) draw();
    }

    el.addEventListener('click', (e) => {
      // the card's Close leaves the release only: today's city and its notes come back (#439); the
      // header's mode Close and Esc still close what the release opened (#430)
      if (e.target.closest('[data-pcr-close]')) { close(); city.leaveMode?.(); }
      else if (e.target.closest('[data-pcr-save]')) saveImage(e.target.closest('[data-pcr-save]'));
    });
    el.addEventListener('change', (e) => {
      const t = e.target;
      if (t.matches('[data-pcr-issue]')) {
        issue = t.value === '' ? null : Number(t.value);
        // an issue's footprint: only its added files get a building
        applyModel();
        draw();
      } else if (t.matches('[data-pcr-from], [data-pcr-to]')) {
        const from = el.querySelector('[data-pcr-from]')?.value || null;
        const to = el.querySelector('[data-pcr-to]')?.value || null;
        show({ from, to });
      }
    });
    // <details> toggles do not bubble: caught on the way down, aria-expanded follows
    el.addEventListener('toggle', (e) => {
      const d = e.target;
      if (!d.matches?.('[data-testid="city-release-missing"]')) return;
      missingOpen = !!d.open;
      d.querySelector('summary')?.setAttribute('aria-expanded', String(missingOpen));
    }, true);
    const offLayout = city.onLayout(() => {
      // another city drawn (the tab read the project's again): the release is gone from the map
      if (request && applied && city.model !== applied) { seq++; request = null; data = null; applied = null; city.leaveMode?.(); }
      draw();
    });
    const handle = {
      city,
      projectId,
      show,
      destroy() {
        if (destroyed) return;
        destroyed = true;
        handles.delete(handle);
        el.remove();
        offLayout?.();
        city.setLegend?.(LAYER, null);
        if (layered) ProjectCity.overlay(LAYER, null);
      },
    };
    handles.add(handle);
    // a "Show on the map" clicked before the City was drawn
    const req = pending?.projectId === projectId ? pending : null;
    if (req) { pending = null; show(req); }
    return handle;
  }

  /** "Show on the map": a release (its tag `to`, the previous tag by default as `from`) on its project's city. */
  function showRelease(projectId, { to = null, from = null, issue = null } = {}) {
    pending = null;
    // #430: the city on screen, or the city modal over the screen it was asked from
    const targets = window.ProjectCityModal?.targets(handles, projectId, 'release') || [...handles].filter((h) => h.projectId === projectId);
    if (!targets.length) pending = { projectId, to, from, issue };
    for (const h of targets) h.show({ to, from, issue });
  }

  window.ProjectCityRelease = {
    attach,
    headerMarkup,
    showRelease,
  };
})();
