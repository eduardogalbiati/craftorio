// The Conflict map panel under the Roadmap (#150, src/conflict-map.js): the files and the single lines
// most runs of the project changed, from the saved map the Backlog payload carries (`conflictMap`,
// read-only: built when the Product Owner plans or a run merges). Each row gives its run count (a "hot"
// badge past the Product Owner's threshold, the merge conflicts that named it); a click shows the runs
// behind the count and the trend (the newer half of the map's runs against the older half).
// Rendered by backlog-roadmap.js (html), its clicks routed from BacklogRoadmap.onClick.
(() => {
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ROWS = 10;
  const HOT_WINDOW = 20;
  // the row whose runs are shown ('file:<path>' or 'line:<path>:<n>'), one at a time
  let open = null;

  const plural = (n, unit) => `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`;

  // more than half of the newest 20 runs (src/conflict-map.js hotSpots)
  function isHot(map, runIds) {
    const recent = new Set((map.runIds || []).slice(0, HOT_WINDOW));
    const n = (runIds || []).filter((id) => recent.has(id)).length;
    return n > 1 && n / recent.size > 0.5;
  }

  // the newer half of the map's runs against the older half: "3 → 6 of 10"
  function trend(map, runIds) {
    const all = map.runIds || [];
    const half = Math.floor(all.length / 2);
    if (half < 2) return '';
    const newer = new Set(all.slice(0, half));
    const older = new Set(all.slice(half, half * 2));
    const count = (set) => (runIds || []).filter((id) => set.has(id)).length;
    return `Trend: ${count(older)} of the older ${half} → ${count(newer)} of the newest ${half}`;
  }

  function row(map, unit, { key, testid, where, title, runIds, conflicts = 0, text = '' }) {
    const expanded = open === key;
    const runs = expanded ? `
      <div class="rm-cmap-runs small" data-testid="conflict-map-runs">
        <div class="muted">${esc(trend(map, runIds))}</div>
        <div class="rm-cmap-ids">${runIds.map((id) => `<span class="badge mono" title="${esc(id)}">${esc(id)}</span>`).join('')}</div>
      </div>` : '';
    return `<li>
      <button type="button" class="rm-cmap-row" data-testid="${testid}" data-cmap-row="${esc(key)}" aria-expanded="${expanded}" title="${esc(title)}">
        <span class="rm-cmap-where mono">${esc(where)}</span>
        ${text ? `<span class="rm-cmap-text mono muted small">${esc(text)}</span>` : ''}
        <span class="rm-cmap-badges"><span class="badge">${plural(runIds.length, unit)}</span>${isHot(map, runIds) ? '<span class="badge warn">hot</span>' : ''}${conflicts ? `<span class="badge" title="Merge conflicts that named this file">${plural(conflicts, 'conflicts')}</span>` : ''}</span>
      </button>${runs}
    </li>`;
  }

  function html(map) {
    const files = (map?.files || []).filter((f) => f.runs > 1).slice(0, ROWS);
    const lines = (map?.lines || []).slice(0, ROWS);
    const unit = map?.source === 'git' ? 'commits' : 'runs';
    const of = map?.runs ? `of the last ${plural(map.runs, map.source === 'git' ? 'commits of the branch' : 'finished runs')}` : '';
    const body = !files.length && !lines.length
      ? `<div class="empty-state small" data-testid="conflict-map-empty">No hot files yet. The map is built from the merged runs' commits when the Product Owner plans or a run merges; simulated runs never count.</div>`
      : [
        files.length ? `<div class="rm-cmap-sec small muted">Files most runs change</div><ul class="rm-cmap-list">${files.map((f) => row(map, unit, {
          key: `file:${f.file}`, testid: 'conflict-map-file', where: f.file, title: `${f.file}: changed by ${plural(f.runs, unit)}${f.lastRun ? `, last by ${f.lastRun}` : ''}. Click to see them.`, runIds: f.runIds || [], conflicts: f.conflicts,
        })).join('')}</ul>` : '',
        lines.length ? `<div class="rm-cmap-sec small muted">Lines several runs change</div><ul class="rm-cmap-list">${lines.map((l) => row(map, unit, {
          key: `line:${l.file}:${l.line}`, testid: 'conflict-map-line', where: `${l.file}:${l.line}`, title: `${l.file}:${l.line}: ${l.text || ''}`, runIds: l.runIds || [], text: l.text,
        })).join('')}</ul>` : '',
      ].join('');
    return `
      <section class="rm-cmap" data-testid="conflict-map" aria-label="Conflict map">
        <div class="rm-cmap-head"><b>Conflict map</b><span class="muted small">${esc(of)}${of ? ' · ' : ''}groups that touch one hot file go to different stages</span></div>
        ${body}
      </section>`;
  }

  // A row's click shows (or hides) its runs; true when the click was the panel's.
  function onClick(e, render) {
    const btn = e.target.closest('[data-cmap-row]');
    if (!btn) return false;
    open = open === btn.dataset.cmapRow ? null : btn.dataset.cmapRow;
    render();
    return true;
  }

  window.BacklogConflictMap = {
    html,
    onClick,
  };
})();
