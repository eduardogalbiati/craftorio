/* global esc, t, uiLocale */
// The import step's list of the account's repositories (mock-2, #848), split out of project-wizard.js (its size cap).
// window.ProjectWizardRepos({ cur, pickedProvider, platformById, repoUrl }) gives the wizard, over its own state (`cur()`):
// - repoList(): wizard-repo-list, the first five repositories (API order, newest first) of the picked provider whose
//   owner/name holds the list's filter text (#wizard-repo-filter, any case), each a wizard-repo-option (the owner
//   muted, the name leading, private/public and "updated 2 days ago"); wizard-repo-more past five, wizard-repo-none
//   when the filter keeps none. #103: a pasted URL of the picked platform's host filters as its owner/name (with a
//   trailing / or .git); a URL of another host lists nothing; 'owner/name/' filters as 'owner/name'.
// Uses app.js globals (esc, t, uiLocale) and window.Platforms (parseRepoUrl).

(function () {
  window.ProjectWizardRepos = function ({ cur, pickedProvider, platformById, repoUrl }) {
    // "updated 2 days ago" in the interface's language
    function updatedAgo(iso) {
      const s = (Date.parse(iso) - Date.now()) / 1000;
      if (!Number.isFinite(s)) return '';
      /** @type {[Intl.RelativeTimeFormatUnit, number][]} */
      const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
      const [unit, size] = units.find(([, n]) => Math.abs(s) >= n) || units[units.length - 1];
      try {
        const lang = typeof uiLocale === 'function' ? uiLocale() : undefined;
        return t('onboarding.repo_updated', { ago: new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }).format(Math.round(s / size), unit) });
      } catch { return ''; }
    }

    // the filter box's text as the part of owner/name to look for; null when it is a URL of another host
    function filterQuery(text) {
      const url = window.Platforms?.parseRepoUrl?.(text);
      if (url) return url.host === platformById(pickedProvider())?.host ? String(url.path).toLowerCase() : null;
      return text.replace(/(\/[^/]+)\/+$/, '$1').toLowerCase(); // 'owner/name/' as 'owner/name'; 'owner/' stays the owner's
    }

    function repoList() {
      const w = cur();
      const typed = w.model.repository.trim().replace(/\.git$/, '');
      const text = String(w.repoFilter || '').trim(); // the list's own filter box (wizard-repo-filter)
      const query = filterQuery(text);
      const mine = w.repos[pickedProvider()] || [];
      const all = w.projectId || query === null ? [] : mine.filter((r) => String(r.name || '').toLowerCase().includes(query));
      const repos = all.slice(0, 5);
      // the owner muted, the repository's own name leading the row
      const named = (name) => { const cut = String(name).lastIndexOf('/'); return `<span class="muted">${esc(String(name).slice(0, cut + 1))}</span>${esc(String(name).slice(cut + 1))}`; };
      const meta = (r) => [t(r.private ? 'onboarding.repo_private' : 'onboarding.repo_public'), updatedAgo(r.updatedAt)].filter(Boolean).join(' · ');
      const item = (r) => `<li><button type="button" class="wizard-repo-item" data-act="pick-repo" data-repo="${esc(r.name)}" data-testid="wizard-repo-option" aria-pressed="${typed === repoUrl(r.name)}">
            <span class="text-cut" title="${esc(r.name)}">${named(r.name)}</span><span class="muted">${esc(meta(r))}</span></button></li>`;
      return repos.length ? `<ul class="wizard-repos" data-testid="wizard-repo-list" aria-label="${esc(t('onboarding.repo_list'))}">${repos.map(item).join('')}</ul>${
        all.length > 5 ? `<p class="muted small" data-testid="wizard-repo-more">${esc(t('onboarding.repo_list_more'))}</p>` : ''}`
        : text && !w.projectId && mine.length ? `<p class="muted small" data-testid="wizard-repo-none">${esc(t('onboarding.repo_list_none'))}</p>` : '';
    }

    return { repoList };
  };
})();
