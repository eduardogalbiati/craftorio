/* global api, esc, t, showToast, errMsg */
// The onboarding's progress tray (#641), split out of project-wizard.js (its size cap, #724).
// window.ProjectWizardTray({ ... }) gives the wizard { render, refresh, scheduleLeave } over the wizard's own
// maps (states: projectId → the engine's last state; names; finished):
// - #onboarding-tray (data-testid="onboarding-tray"): one tray-item per imported project (data-project,
//   data-status = the engine's status), its name, a running one tray-spinner, and when failed (or a paid job
//   failed, #725) the reason and Retry (api.retryOnboarding); a finished one can be dismissed.
// - #724: hidden while the wizard is open (wizardOpen(): the wizard shows the progress itself, the markup
//   stays current for when it closes); closed, it lists what needs attention: running or failed.
// - #724: a finished import (ready / analyzed, no paid job failed) leaves the tray LEAVE_MS later with the
//   toast "<name> imported" and Open the project (Actions openProject); none when the wizard showed that
//   import as it finished or shows it still, nor when Finish's own toast (finished_analyzed) says it. Running again or failed meanwhile, it stays.
// Uses app.js globals (api, esc, t, showToast, errMsg) and window.Actions.

(function () {
  const LEAVE_MS = 5000;

  window.ProjectWizardTray = function ({ active, failedPaid, finished, jobReason, names, remember, shownInWizard, spinner, states, statusText, wizardOpen }) {
    let tray = null;
    const leaving = new Map(); // projectId → the timer that takes a finished import out of the tray

    const isDone = (s) => ['ready', 'analyzed'].includes(s.status) && !failedPaid(s);
    function scheduleLeave(s) {
      const pid = s.projectId;
      if (!isDone(s)) {
        clearTimeout(leaving.get(pid));
        leaving.delete(pid);
        return;
      }
      if (leaving.has(pid)) return;
      // the wizard showed it when it finished (or still shows it 5 s later): no toast either way
      const notify = !(finished.has(pid) && s.status === 'analyzed') && !shownInWizard(pid);
      leaving.set(pid, setTimeout(() => {
        leaving.delete(pid);
        if (!states.has(pid) || !isDone(states.get(pid))) return;
        states.delete(pid);
        render();
        if (!notify || shownInWizard(pid)) return;
        const name = names.get(pid) || pid;
        showToast(t('onboarding.imported', { name }), '', null, null, {
          action: { label: t('onboarding.open_project'), run: () => window.Actions.call('openProject', pid) },
        });
      }, LEAVE_MS));
    }

    function render() {
      if (!tray) {
        tray = document.createElement('aside');
        tray.setAttribute('id', 'onboarding-tray');
        tray.setAttribute('data-testid', 'onboarding-tray');
        tray.setAttribute('aria-live', 'polite');
        tray.setAttribute('aria-label', t('onboarding.tray_title'));
        tray.className = 'onboarding-tray';
        tray.addEventListener('click', onClick);
        document.body.appendChild(tray);
      }
      tray.hidden = wizardOpen() || states.size === 0;
      const item = (s) => {
        const name = names.get(s.projectId) || s.projectId;
        // #725: a failed paid analysis (the onboarding analyzed) says why too, with its Retry
        const job = s.status === 'failed' ? null : failedPaid(s);
        const why = s.status === 'failed' ? (s.reason || t('onboarding.no_reason')) : job ? jobReason(s.jobs[job]) : '';
        const failed = why
          ? `<p class="small tray-reason"${job ? ` title="${esc(s.jobs[job].error || '')}"` : ''}>${esc(why)}</p>
             <button type="button" class="btn small" data-act="retry" data-project="${esc(s.projectId)}">${esc(t('onboarding.retry'))}</button>` : '';
        const dismiss = active.includes(s.status) ? ''
          : `<button type="button" class="btn ghost small tray-dismiss" data-act="dismiss" data-project="${esc(s.projectId)}" aria-label="${esc(t('onboarding.dismiss', { name }))}">×</button>`;
        return `<li class="tray-item" data-testid="tray-item" data-project="${esc(s.projectId)}" data-status="${esc(s.status)}">
            <div class="tray-head">${active.includes(s.status) ? spinner('tray-spinner') : ''}<strong class="tray-name" title="${esc(name)}">${esc(name)}</strong><span class="badge status-${esc(s.status)}">${esc(statusText(s.status))}</span>${dismiss}</div>
            ${failed}
          </li>`;
      };
      tray.innerHTML = `<h3 class="tray-title">${esc(t('onboarding.tray_title'))}</h3>
        <ul class="tray-items">${[...states.values()].reverse().map(item).join('')}</ul>`;
    }

    async function onClick(e) {
      const btn = e.target?.closest?.('[data-act]');
      const id = btn?.dataset.project;
      if (!id) return;
      if (btn.dataset.act === 'dismiss') { states.delete(id); render(); return; }
      if (btn.dataset.act !== 'retry') return;
      try {
        remember(await api.retryOnboarding(id));
      } catch (err) {
        showToast(t('onboarding.action_failed'), errMsg(err));
      }
    }

    // the wizard opened or closed: only a tray that exists follows (none before the first import)
    const refresh = () => { if (tray) render(); };

    return { refresh, render, scheduleLeave };
  };
})();
