/* global esc, t */
// #740: the new-project wizard's gh / glab parts, split out of project-wizard.js (its size cap).
// window.ProjectWizardCli({ cur, root, render, refresh }) gives the wizard, over its own state (`cur()`,
// `root()`):
// - errorBlock(o): wizard-error data-error="no-access" | "clone-failed" | "failed" with the engine's reason,
//   Retry, Sign in (no-access with a known provider) and Edit the URL (no-access on the repository step);
//   #107: "repo-not-found" | "repo-no-access" | "not-a-git-repo" (an import that made no project, Edit the URL
//   too) each titled by its own message in the interface language;
//   (the CLI warning, wizard-cli-warning, is the column module's cliWarning: project-wizard-workflows.js);
// - openSetup(): Open Setup and Sign in open Settings › Agents & CLIs (window.Settings.open, settings-clis.js)
//   with the warned CLI highlighted, never the first-run Setup. The wizard is only hidden (its state kept) and
//   comes back on its step once the section closes: render(), then refresh() (the tray, the CLI checked again).
// Uses app.js globals (esc, t) and window.Platforms.

(function () {
  window.ProjectWizardCli = function ({ cur, root, render, refresh }) {
    const platformOfRepo = (url) => window.Platforms?.platformOfRepoUrl?.(url) || null;
    const platformById = (id) => window.Platforms?.findPlatform?.(id) || null;

    // the title of each code (#107: an import refused before anything was made names its cause), 'onboarding.failed' else
    const TITLES = {
      'clone-failed': 'onboarding.clone_failed',
      'no-access': 'onboarding.no_access',
      'not-a-git-repo': 'onboarding.import_not_a_git_repo',
      'repo-no-access': 'onboarding.import_repo_no_access',
      'repo-not-found': 'onboarding.import_repo_not_found',
    };
    const NO_ACCESS = ['no-access', 'repo-no-access'];

    function errorBlock(o) {
      const code = o.code || 'failed';
      const provider = (platformById(o.cli?.provider) || platformOfRepo(cur().model.repository))?.label || '';
      const signIn = NO_ACCESS.includes(code) && provider
        ? `<button type="button" class="btn" data-act="setup">${esc(t('onboarding.sign_in', { provider }))}</button>` : '';
      // #107: an import that made no project (no projectId) is edited and started again
      const edit = (code === 'no-access' || !cur().projectId) && cur().model.step === 'repository'
        ? `<button type="button" class="btn ghost" data-act="edit-repo" data-testid="wizard-edit-repo">${esc(t('onboarding.edit_repo'))}</button>` : '';
      return `<div class="wizard-alert error" role="alert" data-testid="wizard-error" data-error="${esc(code)}">
          <strong>${esc(t(TITLES[code] || 'onboarding.failed'))}</strong>
          <p>${esc(o.reason || t('onboarding.no_reason'))}</p>
          <p class="muted small">${esc(t(NO_ACCESS.includes(code) ? 'onboarding.no_access_hint' : 'onboarding.failed_hint'))}</p>
          <div class="wizard-actions"><button type="button" class="btn primary" data-act="retry">${esc(t('onboarding.retry'))}</button>${signIn}${edit}</div>
        </div>`;
    }

    function openSetup() {
      const c = cur();
      const el = root();
      if (!c || !el || !window.Settings?.open) return;
      const provider = platformById(c.onboarding?.cli?.provider) || platformOfRepo(c.model.repository);
      el.hidden = true;
      refresh(false);
      window.Settings.open('agents', {
        highlight: provider?.cli || null,
        onClose: () => {
          const back = root();
          if (!cur() || !back) return;
          back.hidden = false;
          render();
          refresh(true);
          back.querySelector('.wizard-panel')?.focus?.();
        },
      });
    }

    return { errorBlock, openSetup };
  };
})();
