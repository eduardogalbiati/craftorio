// Naming a release (#436): what the Roadmap's cut line dialog (backlog.js #cut-line-modal, opened by
// backlog-roadmap.js) and the Releases screen's version field (releases.js) share. The last three
// shipped releases as text above the field ("1.1.2 · 2026-10-13 · 4 issues"), a "Suggest version"
// button and the line under the field saying why. The suggestion is src/shared/release-version.js's
// (window.ReleaseVersion), from labels only: no model call; the button fills the field, never submits.
// Uses app.js's esc and the catalog's t.

(() => {
  const RV = () => window.ReleaseVersion;

  // the lines of the last releases (the list's content)
  function recentItems(releases) {
    const recent = RV()?.recentReleases(releases) || [];
    if (!recent.length) return `<li class="muted">${t('releases.no_release_yet')}</li>`;
    return recent.map((r) => `<li><span class="mono">${esc(r.version)}</span> · ${esc(String(r.date || '').slice(0, 10))} · ${esc(t('releases.issues_count', { count: r.issues?.length || 0 }))}</li>`).join('');
  }

  const recentHtml = (releases) => `<ul class="rel-recent small muted" data-testid="recent-releases" aria-label="${t('release_version.last_releases')}">${recentItems(releases)}</ul>`;
  const suggestHtml = () => `<button type="button" class="btn sm ghost" data-testid="suggest-version" title="${t('release_version.suggest_tip')}">${t('release_version.suggest')}</button>`;
  const reasonHtml = (id) => `<div class="hint" id="${id}" data-testid="suggest-version-reason" aria-live="polite"></div>`;

  // Fills `input` with the suggestion for `issues` ({ number, labels? }; `catalog`: the Backlog's
  // issues, whose labels win) after the last shipped release, and writes why into `reasonEl`.
  function suggest({ input, reasonEl, releases, issues, catalog = [] }) {
    const labels = new Map(catalog.map((i) => [i.number, i.labels]));
    const last = RV()?.recentReleases(releases, 1)[0]?.version || null;
    const out = RV().suggestVersion({ last, issues: (issues || []).map((i) => ({ number: i.number, labels: labels.get(i.number) || i.labels || [] })) });
    if (out.version) input.value = out.version;
    if (reasonEl) reasonEl.textContent = RV().reasonText(out.reason);
    return out;
  }

  window.ReleaseName = { reasonHtml, recentHtml, recentItems, suggest, suggestHtml };
})();
