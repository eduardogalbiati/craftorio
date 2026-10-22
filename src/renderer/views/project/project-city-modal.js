// The city modal (#430): every "Show on the map" (an issue or a roadmap item, a roadmap stage, a release,
// a run's replay) opens the project's City view (project-city.js) full screen in a modal over the screen
// it was asked from, with the overlay it asked for and its card; nothing navigates (the owner's decision
// of 2026-10-21). The entry points (ProjectCityImpact.showIssue / showStage / fromRoadmap,
// ProjectCityRelease.showRelease, ProjectCityAgents.replay) ask targets(handles, projectId, key): the
// overlays of a city of the project on screen (the Project screen's Architecture tab), or else the
// modal's own overlay, the modal opened (or kept: one at a time, a second "Show on the map" replaces its
// overlay through the city's mode; another project's city replaces the modal's).
// The modal (data-testid="city-modal", role="dialog", aria-modal) holds a title bar, "Open in Projects"
// (city-modal-open-project: closes the modal, then the project's Architecture tab, openProjectView) and
// Close (city-modal-close), then the City view with the tab's overlays (#374 agents with Live off,
// #382 connections, #375 impact, #376 release). The city's states (loading, not a git repository, no
// WebGL) are its own. Close, Esc (a capture listener of the document: before the city's own Esc and
// app.js's, even when app.js marked the key as taken) and a mode's Close (city.back) close the modal:
// the overlays and the city are destroyed, the focus goes back to the element that had it, the screen
// under it, the Architecture tab and its remembered mode are left as they were.
// Uses app.js globals at call time: api, esc, state, openProjectView. Browser: window.ProjectCityModal.
(() => {
  let cur = null; // the open modal: { projectId, el, city, agents, connections, impact, release, opener }

  const projectName = (id) => (typeof state !== 'undefined' ? state?.projects?.find((p) => p.id === id)?.name : '') || '';

  // shown: in the document, no ancestor hidden by the attribute or the class
  function shownInPage(el) {
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (n.hasAttribute('hidden') || n.classList.contains('hidden')) return false;
    }
    return true;
  }

  /** Whether `city` is on screen outside the modal: the Project screen's city (or one with no app screen around it). */
  function onScreen(city) {
    const el = city?.el;
    if (!el || !el.isConnected || (cur && cur.el.contains(el))) return false;
    if (typeof state !== 'undefined' && state?.view && state.view !== 'project') return false;
    return shownInPage(el);
  }

  function teardown() {
    const m = cur;
    cur = null;
    m.city.back = null;
    for (const h of [m.agents, m.connections, m.impact, m.release]) {
      try { h?.destroy(); } catch (e) { console.error(e); }
    }
    m.city.destroy();
    m.el.remove();
  }

  /** Closes the modal; the focus goes back to the element that opened it. */
  function close() {
    if (!cur) return;
    const { opener } = cur;
    teardown();
    if (opener?.isConnected && typeof opener.focus === 'function') opener.focus();
  }

  /** Opens (or keeps) the modal on project `projectId`'s city → { city, agents, connections, impact, release }. */
  function open(projectId) {
    if (cur && cur.projectId === projectId) {
      cur.city.back = close;
      return cur;
    }
    const opener = cur ? cur.opener : document.activeElement;
    if (cur) teardown();
    const name = projectName(projectId) || String(projectId);
    const el = document.createElement('div');
    el.className = 'city-modal';
    el.setAttribute('data-testid', 'city-modal');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', t('project_city_modal.title', { project: name }));
    el.innerHTML = `<div class="city-modal-bar">
        <b class="city-modal-title" title="${esc(name)}">${t('project_city_modal.title', { project: esc(name) })}</b>
        <span class="r3d-grow"></span>
        <button type="button" class="btn sm ghost" data-city-modal-open data-testid="city-modal-open-project" title="${esc(t('project_city_modal.open_in_projects_title'))}">${esc(t('project_city_modal.open_in_projects'))}</button>
        <button type="button" class="btn sm" data-city-modal-close data-testid="city-modal-close">${esc(t('project_city_modal.close'))}</button>
      </div><div class="city-modal-body" data-city-modal-body></div>`;
    document.body.appendChild(el);
    // the City view without the tab's action (no onAnalyze): the overlays in the tab's order; "Show the
    // facts" closes the modal, then the project's Architecture tab on its Facts
    const toFacts = () => {
      close();
      if (window.ProjectArchitecture?.openFacts) window.ProjectArchitecture.openFacts(projectId);
      else openProjectView(projectId, { tab: 'architecture' });
    };
    const city = ProjectCity.create({ projectId, name, onOpenFacts: toFacts });
    el.querySelector('[data-city-modal-body]').appendChild(city.el);
    cur = {
      projectId, el, city, opener,
      agents: (window.CityAgents && window.ProjectCityAgents?.attach(city, { projectId, live: false })) || null,
      connections: (window.CityConnections && window.ProjectCityConnections?.attach(city)) || null,
      impact: (window.CityImpact && window.ProjectCityImpact?.attach(city, { projectId })) || null,
      release: (window.CityRelease && window.ProjectCityRelease?.attach(city, { projectId })) || null,
    };
    city.back = close; // a mode's Close closes the modal, not back to Explore inside it
    city.update({ facts: null, estimate: null });
    // the facts' quadrants (the Danger Zone, Colour by Quadrant), as the tab reads them
    const mine = cur;
    Promise.resolve(api.architectureFacts?.(projectId, { since: null, until: null, includeMass: true }))
      .then((facts) => { if (cur === mine && facts?.model) city.update({ facts }); })
      .catch(() => { /* the city is drawn without them */ });
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-city-modal-close]')) close();
      else if (e.target.closest('[data-city-modal-open]')) { close(); openProjectView(projectId, { tab: 'architecture' }); }
      // a run of the agents layer, a collision's Conflict map link: their own handlers navigated, the modal
      // must not cover the screen they opened
      else if (cur === mine && e.target.closest('[data-pca-run], [data-pcm-link]')) close();
    });
    el.querySelector('[data-city-modal-close]').focus();
    return cur;
  }

  /** The overlays (`key`: 'impact' | 'release' | 'agents') to show a request on: the city on screen's, or the modal's. */
  function targets(handles, projectId, key) {
    const here = [...handles].filter((h) => h.projectId === projectId && onScreen(h.city));
    if (here.length) return here;
    const m = open(projectId);
    return m[key] ? [m[key]] : [];
  }

  document.addEventListener('keydown', (e) => {
    if (!cur || e.key !== 'Escape') return;
    e.stopImmediatePropagation();
    e.preventDefault();
    close();
  }, true);

  window.ProjectCityModal = {
    close,
    isOpen: () => !!cur,
    onScreen,
    open,
    targets,
  };
})();
