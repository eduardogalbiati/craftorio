// Naming a release (#436): what the Roadmap's cut line dialog (backlog.js #cut-line-modal, opened by
// backlog-roadmap.js) and the Releases screen's version field (releases.js) share. The last three
// shipped releases as text above the field ("1.1.2 · 2026-10-13 · 4 issues"), a "Suggest version"
// button and the line under the field saying why. The suggestion is packages/shared/release-version.js's
// (window.ReleaseVersion), from labels only: no model call; the button fills the field, never submits.
// The cut line's dialog itself is here too (cutLineDialog, #454: saved while it stays open).
// Uses app.js's esc and errMsg, the api and the catalog's t.

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

  // The cut line's dialog (#cut-line-modal of backlog.js, opened by backlog-roadmap.js's "Release here"
  // and Rename) after stage `at`: → its name, or null. #436: the last releases above it; "Suggest
  // version" from the issues done since the last release and planned up to the cut.
  // #454 `submit(name)` saves it while the dialog stays open: → null (saved, the dialog closes) or the
  // reason it was refused, shown in #cut-line-error with the name kept for another try.
  function cutLineDialog(current, ctx, data, at, submit = async () => null) {
    const q = (sel) => document.querySelector(sel);
    const [modal, input] = [q('#cut-line-modal'), q('#cut-line-name')];
    input.value = current;
    q('#cut-line-error').textContent = q('#cut-line-recent').innerHTML = ''; q('#cut-line-suggest').innerHTML = suggestHtml(); q('#cut-line-why').innerHTML = reasonHtml('cut-line-reason');
    q('#btn-cut-line-ok').textContent = current ? t('common.save') : t('backlog_roadmap.add_cut_line');
    const listed = Promise.resolve().then(() => api.listReleases(ctx.projectId)).catch(() => null)
      .then((l) => { q('#cut-line-recent').innerHTML = recentHtml(l?.releases); return l; });
    q('#cut-line-form').onclick = async (e) => {
      if (!e.target.closest('[data-testid="suggest-version"]')) return; const l = await listed;
      suggest({ input, reasonEl: q('#cut-line-reason'), releases: l?.releases, issues: ReleaseVersion.releaseIssues(data?.roadmap?.stages, at, l?.next?.issues), catalog: data?.issues || [] });
    };
    modal.classList.remove('hidden'); input.focus({ preventScroll: true });
    return new Promise((resolve) => {
      const close = (value) => { modal.classList.add('hidden'); resolve(value); };
      let busy = false;
      q('#cut-line-form').onsubmit = async (e) => {
        e.preventDefault(); const name = input.value.trim();
        if (!name) { q('#cut-line-error').textContent = t('backlog_roadmap.give_the_release_a_name_or'); return; }
        if (busy) return;
        busy = true; q('#cut-line-error').textContent = '';
        const error = await submit(name).catch((err) => errMsg(err));
        busy = false;
        if (!error) { close(name); return; }
        input.value = name; q('#cut-line-error').textContent = error;
        modal.classList.remove('hidden'); input.focus({ preventScroll: true });
      };
      q('#btn-cut-line-cancel').onclick = () => close(null);
    });
  }

  window.ReleaseName = { cutLineDialog, reasonHtml, recentHtml, recentItems, suggest, suggestHtml };
})();
