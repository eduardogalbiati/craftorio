// The connections panel of the project city (#382), an overlay of the City view (project-city.js)
// built on its API, so the city's own module does not grow. attach(city) adds a card to the city
// (data-testid="city-connections") listing the files with the most connections (requires plus
// required by, from the city's edges: src/shared/city-connections.js rank), the two counts, a
// search, the top RANK_LIMIT shown. A click on a file flies to it and pins its connections: its
// arcs stay drawn on the city (city.setPins), outgoing and incoming in their colours, until it is
// clicked again; several files can be pinned at once; "Clear pins" removes them all. In a language
// without edges (#371) the card says so instead of showing an empty list. The card redraws when the
// city's layout changes (city.onLayout) and drops the pins the new layout lacks.
// Uses app.js globals at call time: esc. Browser: window.ProjectCityConnections.
(() => {
  const base = (p) => String(p).split('/').pop();
  const dir = (p) => String(p).split('/').slice(0, -1).join('/') || '(root)';

  function attach(city) {
    const el = document.createElement('div');
    el.className = 'r3d-card pcc';
    el.setAttribute('data-testid', 'city-connections');
    city.el.appendChild(el);
    let query = '';
    let pins = [];
    let destroyed = false;

    const rowHtml = (r) => `<li><button type="button" class="pcc-file${pins.includes(r.path) ? ' on' : ''}" data-pcc-file="${esc(r.path)}" data-testid="city-connection" aria-pressed="${pins.includes(r.path)}" title="${esc(t(pins.includes(r.path) ? 'project_city_connections.file_unpin' : 'project_city_connections.file_fly_and_pin', { path: r.path, requires: r.requires, requiredBy: r.requiredBy }))}">`
      + `<span class="pcc-name"><b>${esc(base(r.path))}</b><small class="r3d-mono">${esc(dir(r.path))}</small></span>`
      + `<span class="pcc-counts"><em class="out" title="${t('project_city_connections.requires')}">${r.requires}</em><em class="in" title="${t('project_city_connections.required_by')}">${r.requiredBy}</em></span></button></li>`;

    function draw() {
      if (destroyed) return;
      const layout = city.layout;
      const model = city.model;
      if (!layout || !model || !window.CityConnections) { el.classList.add('hidden'); return; }
      el.classList.remove('hidden');
      const state = CityConnections.edgesState(model);
      const head = `<div class="pcc-head"><b>${t('project_city_connections.most_connected')}</b>${pins.length ? `<button type="button" class="link-btn" data-pcc-clear data-testid="city-connections-clear">${t('project_city_connections.clear_pins_length', { length: pins.length })}</button>` : ''}</div>`;
      if (!state.ok) {
        el.innerHTML = `${head}<p class="pcc-empty muted" data-testid="city-connections-empty">${t('project_city_connections.no_connections_to_list_arcs_reason', { reason: esc(state.reason) })}</p>`;
        return;
      }
      const rows = CityConnections.rank(layout, { query });
      el.innerHTML = `${head}
        <label class="r3d-search pcc-search"><input type="search" placeholder="${t('project_city_connections.filter_the_files')}" aria-label="${t('project_city_connections.filter_the_most_connected_files')}" data-pcc-query data-testid="city-connections-search" value="${esc(query)}" /></label>
        ${rows.length ? `<ul class="pcc-list" data-testid="city-connections-list">${rows.map(rowHtml).join('')}</ul>` : `<p class="pcc-empty muted">${t('project_city_connections.no_file_matches_query', { query: esc(query) })}</p>`}
        <p class="pcc-hint muted"><em class="out">${t('project_city_connections.requires')}</em> · <em class="in">${t('project_city_connections.required_by')}</em>${t('project_city_connections.a_click_pins_the_arcs')}</p>`;
    }

    function setPins(next) {
      pins = next;
      city.setPins(pins);
      draw();
    }

    el.addEventListener('click', (e) => {
      const file = e.target.closest('[data-pcc-file]');
      if (file) {
        const p = file.dataset.pccFile;
        if (pins.includes(p)) setPins(pins.filter((x) => x !== p));
        else { city.flyTo(p); setPins([...pins, p]); }
        return;
      }
      if (e.target.closest('[data-pcc-clear]')) setPins([]);
    });
    el.addEventListener('input', (e) => {
      if (!e.target.matches('[data-pcc-query]')) return;
      query = e.target.value;
      const list = el.querySelector('[data-testid="city-connections-list"]');
      const rows = CityConnections.rank(city.layout, { query });
      if (list && rows.length) list.innerHTML = rows.map(rowHtml).join('');
      else draw(), el.querySelector('[data-pcc-query]')?.focus({ preventScroll: true });
    });
    // a new layout: the pins it lacks go, the rest stay drawn
    const off = city.onLayout(() => {
      const paths = new Set((city.layout?.buildings || []).map((b) => b.path));
      const kept = pins.filter((p) => paths.has(p));
      if (kept.length !== pins.length) setPins(kept); else { city.setPins(pins); draw(); }
    });
    draw();
    return {
      el,
      get pins() { return [...pins]; },
      destroy() {
        if (destroyed) return;
        destroyed = true;
        off();
        el.remove();
      },
    };
  }

  window.ProjectCityConnections = { attach };
})();
