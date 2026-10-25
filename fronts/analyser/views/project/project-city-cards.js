// The cards of the City view (#373; project-city.js shows them): what the pointer is on (the hover
// card) and what a click pinned (the detail card, with "Open in Facts" for a file). A file's card:
// its name and folder, its quadrant pill (or "Complexity not measured"), lines, commits, the
// measured complexity, worst function and functions, district, zone, what it requires and what
// requires it (or why the arcs are not read), its last change; an aggregated block of small files
// (over 5,000 files); a district's: files, lines, what it depends on and what uses it, its purpose;
// a zone's: its kind, districts, files, lines, its purpose.
// html({ layout, model, colour, light, target, pinned }) → the card's HTML ('' for an unknown
// target); `colour` / `light`: the "Colour by" mode and theme, for the pill's colour.
// dot(colour), countsHtml(list, testid, label): the overlays' card pieces (project-city-impact.js,
// project-city-release.js).
// Uses app.js globals at call time: esc. Browser: window.ProjectCityCards.
(() => {
  const plural = (n, key) => t(`project_city_cards.${key}`, { count: n });
  const base = (p) => String(p).split('/').pop();
  const dir = (p) => String(p).split('/').slice(0, -1).join('/') || '(root)';
  // label: the catalog key's last part (project_city_cards.<label>)
  const row = (label, value) => `<dt>${esc(t(`project_city_cards.${label}`))}</dt><dd title="${esc(value)}">${esc(value)}</dd>`;
  const head = (kind, title, sub) => `<div class="r3d-d-head"><div><div class="r3d-kind">${kind}</div><h3 title="${esc(title)}">${esc(title)}</h3>${sub ? `<p${sub.mono ? ' class="r3d-mono"' : ''} title="${esc(sub.text)}">${esc(sub.text)}</p>` : ''}</div></div>`;
  const purpose = (x) => (x.purpose ? `<div class="r3d-note">${esc(x.purpose)}</div>` : '');

  function buildingHtml({ layout, model, colour, light, pinned }, b, i) {
    const districtName = (id) => layout.districts.find((d) => d.id === id)?.name || id;
    const zoneName = (id) => layout.zones.find((z) => z.id === id)?.name || id;
    if (b.aggregate) {
      return `${head(t('project_city_cards.small_files'), plural(b.aggregate, 'files_count'), { text: districtName(b.district) })}
        <dl class="r3d-rows">${row('lines', b.lines.toLocaleString('en-US'))}${row('most_commits', String(b.churn))}</dl>
        <div class="r3d-note">${t('project_city_cards.over_5_000_files_the_smallest')}</div>`;
    }
    let pill = '';
    try { pill = window.CityLayout.colourBy(layout, colour, { light }).colours[i]; } catch { /* no colour: the pill keeps the theme's */ }
    const rel = window.CityLayout.neighbours(layout, b.path);
    const edges = typeof model.edges === 'string' ? model.edges : null;
    const measured = b.complexity != null;
    const status = b.quadrant || (measured ? '' : t('project_city_cards.complexity_not_measured'));
    return `${head(b.landmark ? t('project_city_cards.landmark_name', { name: esc(b.landmark) }) : t(b.test ? 'project_city_cards.test_file' : 'project_city_cards.file'), base(b.path), { text: dir(b.path), mono: true })}
      ${status ? `<div class="r3d-d-status"><span class="r3d-pill" style="--c:${esc(pill)}">${esc(status)}</span></div>` : ''}
      <dl class="r3d-rows">${row('lines', b.lines.toLocaleString('en-US'))}${row('commits', String(b.churn))}
        ${measured ? `${row('complexity', String(b.complexity))}${row('worst_function', String(b.worst ?? '—'))}${row('functions', String(b.functions ?? '—'))}` : ''}
        ${row('district', districtName(b.district))}${row('zone', zoneName(b.zone))}
        ${edges ? row('arcs', edges) : `${row('requires', plural(rel.requires.length, 'files_count'))}${row('required_by', plural(rel.requiredBy.length, 'files_count'))}`}
        ${b.lastChange ? row('last_change', String(b.lastChange).slice(0, 10)) : ''}</dl>
      ${pinned ? `<button type="button" class="r3d-primary" data-pc-open-facts data-testid="project-city-open-facts">${t('project_city_cards.open_in_facts')}</button>` : ''}`;
  }

  /** The card of `target` ({ kind, id }), see the header. */
  function html(ctx) {
    const { layout, target } = ctx;
    if (target.kind === 'building') {
      const i = layout.buildings.findIndex((x) => x.path === target.id);
      return i < 0 ? '' : buildingHtml(ctx, layout.buildings[i], i);
    }
    if (target.kind === 'district') {
      const d = layout.districts.find((x) => x.id === target.id);
      if (!d) return '';
      const rel = window.CityLayout.districtNeighbours(layout, d.id);
      const deps = rel.requires.length || rel.requiredBy.length ? `${row('depends_on', plural(rel.requires.length, 'districts_count'))}${row('used_by', plural(rel.requiredBy.length, 'districts_count'))}` : '';
      return `${head(t('project_city_cards.district'), d.name, { text: layout.zones.find((z) => z.id === d.zone)?.name || d.zone })}<dl class="r3d-rows">${row('files', String(d.files))}${row('lines', d.lines.toLocaleString('en-US'))}${deps}</dl>${purpose(d)}`;
    }
    const z = layout.zones.find((x) => x.id === target.id);
    if (!z) return '';
    return `${head(t('project_city_cards.zone_kind', { kind: esc(z.kind) }), z.name, null)}<dl class="r3d-rows">${row('districts', String(layout.districts.filter((d) => d.zone === z.id).length))}${row('files', String(z.files))}${row('lines', z.lines.toLocaleString('en-US'))}</dl>${purpose(z)}`;
  }

  // the overlays' cards (#375 impact, #376 release): a colour dot, and a list of counts by district or zone
  const dot = (colour) => `<i class="r3d-dot" style="--c:${esc(colour)}"></i>`;
  const countsHtml = (list, testid, label) => (list.length
    ? `<ul class="pci-counts" aria-label="${esc(label)}">${list.map((d) => `<li data-testid="${testid}"><span title="${esc(d.name)}">${esc(d.name)}</span> <strong>${d.count}</strong></li>`).join('')}</ul>` : '');

  window.ProjectCityCards = {
    countsHtml,
    dot,
    html,
  };
})();
