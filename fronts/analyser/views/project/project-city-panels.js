// The City view's panels (#441): every panel of the project city minimizes to its title row and
// expands again, and the legend closes. A panel is an element with data-city-panel="<name>" (notes,
// connections, agents, replay, impact, release, legend; project-city-modes.js shows the mode's): its
// title row holds chevron(title) (data-testid="city-panel-toggle", aria-expanded) and its content is
// the element with data-city-panel-body. Minimized, the panel has the `min` class (project-city.css
// hides the body): it stays in the DOM with its state (the search typed, the issue picked, the
// replay's position) and its module keeps updating it. The legend (data-testid="project-city-legend")
// starts with legendClose() (city-legend-close); closed, legendOpen() ("Legend", city-legend-open) in
// its corner brings it back with the same rows. The states are remembered per viewer (the window's
// localStorage, STORE) and per mode: { [mode]: { min: [panel names], legend: false } }, so a mode opens
// the way the owner left it. attach(city) (project-city.js, every city) handles the clicks and gives
// apply() (the saved states on the panels drawn: the city calls it after each draw, city.applyUi())
// and destroy(). It also gives the city's left column (#428, .pc-left[data-pc-left]): city.leftColumn(node)
// puts a card at its top (the impact card), the notes of each draw go under it. Markup from fronts/analyser/poc/city-modes.html (panel(), the legend's head and its button).
// Uses app.js globals at call time: esc. Browser: window.ProjectCityPanels.
(() => {
  const STORE = 'multiagent.city.panels';
  const ICON = {
    chev: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4"/></svg>',
    close: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13"/></svg>',
    legend: '<svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2" y="3" width="4" height="4" rx="1"/><path d="M8 5h6"/><rect x="2" y="9" width="4" height="4" rx="1"/><path d="M8 11h6"/></svg>',
  }; // i18n-ignore
  let saved = null; // STORE's value, read once per window

  function states() {
    if (!saved) {
      try { saved = JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { saved = {}; }
    }
    return saved;
  }
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch { /* remembered until the window reloads */ }
  }
  const stateOf = (mode) => (states()[mode] ||= {});

  /** The chevron of a panel's title row: minimizes the panel to that row and expands it again. */
  const chevron = (title) => `<button type="button" class="pc-chev" data-testid="city-panel-toggle" data-name="${esc(title)}" aria-expanded="true" aria-label="${esc(t('project_city_panels.minimize_name', { name: title }))}" title="${esc(t('project_city_panels.minimize_or_expand'))}">${ICON.chev}</button>`;
  /** The legend's close button (an icon: the legend's text stays its rows). */
  const legendClose = () => `<button type="button" class="pc-x" data-pc-legend-close data-testid="city-legend-close" aria-label="${esc(t('project_city_panels.close_the_legend'))}" title="${esc(t('project_city_panels.close_the_legend'))}">${ICON.close}</button>`;
  /** The small button that brings the closed legend back, in its corner (hidden while the legend shows). */
  const legendOpen = () => `<button type="button" class="r3d-card pc-legend-btn" data-pc-legend-open data-testid="city-legend-open" title="${esc(t('project_city_panels.show_the_legend'))}" hidden>${ICON.legend}${esc(t('project_city_panels.legend'))}</button>`;

  function attach(city) {
    const el = city.el;
    const mode = () => el.getAttribute('data-city-mode') || 'explore';
    // #428: the city's left column, the impact card at its top and the notes under it; the HUD is
    // redrawn on each render, so apply() puts the column back with that draw's notes
    const left = document.createElement('div');
    left.className = 'pc-left';
    left.setAttribute('data-pc-left', '');
    function place() {
      const hud = el.querySelector('[data-pc-hud]');
      if (!hud || left.parentNode === hud) return;
      for (const old of left.querySelectorAll('.pc-notes')) old.remove();
      const notes = [...hud.children].find((n) => n.classList.contains('pc-notes'));
      if (notes) left.appendChild(notes);
      const header = hud.querySelector('[data-testid="project-city-header"]');
      if (header?.nextSibling) hud.insertBefore(left, header.nextSibling);
      else hud.appendChild(left);
    }
    city.leftColumn = (node) => { left.prepend(node); place(); };

    function apply() {
      place();
      const s = states()[mode()] || {};
      const min = new Set(s.min || []);
      for (const p of el.querySelectorAll('[data-city-panel]')) {
        const name = p.dataset.cityPanel;
        if (name === 'legend') continue;
        const on = min.has(name);
        p.classList.toggle('min', on);
        const btn = p.querySelector('[data-testid="city-panel-toggle"]');
        if (!btn) continue;
        btn.setAttribute('aria-expanded', String(!on));
        btn.setAttribute('aria-label', t(on ? 'project_city_panels.expand_name' : 'project_city_panels.minimize_name', { name: btn.dataset.name || '' }));
      }
      const legend = el.querySelector('[data-testid="project-city-legend"]');
      const open = el.querySelector('[data-pc-legend-open]');
      const closed = s.legend === false && !!legend;
      if (legend) legend.hidden = closed;
      if (open) open.hidden = !closed;
    }

    function onClick(e) {
      const chev = e.target.closest('[data-testid="city-panel-toggle"]');
      const name = chev?.closest('[data-city-panel]')?.dataset.cityPanel;
      const s = stateOf(mode());
      if (name) {
        const min = new Set(s.min || []);
        if (!min.delete(name)) min.add(name);
        s.min = [...min];
      } else if (e.target.closest('[data-pc-legend-close]')) s.legend = false;
      else if (e.target.closest('[data-pc-legend-open]')) delete s.legend;
      else return;
      save();
      apply();
      // the keyboard stays on the control that brings the legend back, or on the legend's close
      if (!name) el.querySelector(s.legend === false ? '[data-pc-legend-open]' : '[data-pc-legend-close]')?.focus?.();
    }

    el.addEventListener('click', onClick);
    return {
      apply,
      destroy() { el.removeEventListener('click', onClick); },
    };
  }

  window.ProjectCityPanels = {
    ICON,
    attach,
    chevron,
    legendClose,
    legendOpen,
  };
})();
