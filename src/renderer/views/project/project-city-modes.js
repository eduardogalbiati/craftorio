// The City view's modes (#440): the project city serves one use at a time, each with only the panels
// its question needs (poc/city-modes.html, the owner's decision of 2026-10-21):
//   explore (the default: how is the project?) the notes, Most connected, the legend;
//   live (where are the agents working now? the Live switch of Explore) Agents at work;
//   replay (what did this run touch, in order? a run's "Replay on the map") the timeline;
//   impact / stage (where will this issue change the code? do the stage's items touch the same files?) its card;
//   release (what changed between two releases?) its card.
// attach(city) (project-city.js, every city) puts the city in Explore and gives it:
//   city.mode, the mode's name (the root's data-city-mode);
//   city.setMode(name, { title, onLeave }): enters a mode; the previous mode's onLeave runs first (its
//     layer, card, legend rows and poll go), unless it is the same onLeave (a mode updating its title);
//   city.leaveMode(): back to Explore (the mode's onLeave runs);
//   city.closeMode(): what Close (data-testid="city-mode-close", the cards' own Close) and Esc (not in
//     full screen) do: back to Explore, then `city.back()` once, the screen the mode was opened from
//     (set by the Architecture tab's openCity; none in the tab itself).
// apply() (after each draw, city.applyUi()) writes the mode on the root and the header: the title
// (data-testid="city-mode-title": the project in Explore, "Live", "Replay of run …", "Issue #n",
// "Stage <name>", "Release <from> → <to>"), Close (none in Explore), the Live switch (city-live-toggle,
// in Explore and Live only, never on a release's city; project-city-agents.js turns it on and off),
// the search, Colour by and Tests (Explore only), and hides every panel ([data-city-panel]) the mode
// does not own. The modes' layout is poc/city-modes.html's (MODES, renderHeader, renderPanels).
// Uses app.js globals at call time: esc. Browser: window.ProjectCityModes.
(() => {
  // each mode's panels (data-city-panel names)
  const PANELS = {
    explore: ['connections', 'legend', 'notes'],
    impact: ['impact', 'legend'],
    live: ['agents', 'legend'],
    release: ['legend', 'release'],
    replay: ['legend', 'replay'],
    stage: ['impact', 'legend'],
  };
  const EXPLORE_ONLY = ['[data-pc-search]', '[data-pc-colour]', '[data-pc-tests]'];
  const icon = () => window.ProjectCityPanels?.ICON.close || '×';

  const liveHtml = () => `<label class="r3d-chip pc-live" title="${esc(t('project_city_modes.live_title'))}"><input type="checkbox" data-pc-live data-testid="city-live-toggle" /> ${esc(t('project_city_modes.live'))}</label>`;
  const closeHtml = () => `<button type="button" class="r3d-close pc-close" data-pc-mode-close data-testid="city-mode-close" aria-label="${esc(t('project_city_modes.close_the_mode'))}" title="${esc(t('project_city_modes.close_the_mode_title'))}" hidden>${icon()}</button>`;

  function attach(city) {
    const el = city.el;
    let cur = { name: 'explore', title: null, onLeave: null };

    function enter(next) {
      const prev = cur;
      cur = next;
      city.mode = next.name;
      if (prev.onLeave && prev.onLeave !== next.onLeave) {
        try { prev.onLeave(); } catch (e) { console.error(e); }
      }
      apply();
    }

    // the header's mode: its title, its controls, its Close
    function applyHeader(head) {
      const explore = cur.name === 'explore';
      const b = head.querySelector('[data-testid="city-mode-title"]');
      if (b) {
        b.dataset.project ??= b.textContent;
        b.textContent = cur.title || b.dataset.project;
        b.title = b.textContent;
      }
      for (const sel of EXPLORE_ONLY) {
        const chip = head.querySelector(sel)?.closest('label');
        if (chip) chip.hidden = !explore;
      }
      if (!head.querySelector('[data-pc-live]')) head.querySelector('[data-pc-tests]')?.closest('label')?.insertAdjacentHTML('afterend', liveHtml());
      const live = head.querySelector('[data-pc-live]');
      if (live) {
        const offered = explore || cur.name === 'live';
        live.checked = cur.name === 'live';
        live.disabled = !offered;
        live.closest('label').hidden = !offered;
        live.closest('label').classList.toggle('on', cur.name === 'live');
      }
      if (!head.querySelector('[data-pc-mode-close]')) head.insertAdjacentHTML('beforeend', closeHtml());
      head.querySelector('[data-pc-mode-close]').hidden = explore;
    }

    function apply() {
      el.setAttribute('data-city-mode', cur.name);
      const own = new Set(PANELS[cur.name] || []);
      for (const p of el.querySelectorAll('[data-city-panel]')) p.hidden = !own.has(p.dataset.cityPanel);
      const head = el.querySelector('[data-testid="project-city-header"]');
      if (head) applyHeader(head);
    }

    city.mode = cur.name;
    city.back = null;
    city.setMode = (name, { title = null, onLeave = null } = {}) => enter({ name, title, onLeave });
    city.leaveMode = () => { if (cur.name !== 'explore') enter({ name: 'explore', title: null, onLeave: null }); };
    city.closeMode = () => {
      city.leaveMode();
      const back = city.back;
      city.back = null;
      back?.();
    };

    // Esc belongs to what is on top: app.js closes an open modal, the supervisor's drawer or the
    // usage popover with the same key, without preventDefault.
    const layerOnTop = () => !!document.querySelector('.modal:not(.hidden), #sup-drawer.open, #usage-pop:not(.hidden)');
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.defaultPrevented && cur.name !== 'explore' && !city.expanded && el.isConnected && !layerOnTop()) city.closeMode();
    };
    const onClick = (e) => { if (e.target.closest('[data-pc-mode-close]')) city.closeMode(); };
    document.addEventListener('keydown', onKey);
    el.addEventListener('click', onClick);
    apply();
    return {
      apply,
      destroy() {
        document.removeEventListener('keydown', onKey);
        el.removeEventListener('click', onClick);
      },
    };
  }

  window.ProjectCityModes = {
    PANELS,
    attach,
  };
})();
