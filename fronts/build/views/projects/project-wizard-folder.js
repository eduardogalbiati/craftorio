/* global api, esc, t */
// @ts-check
// The folder step's state (#98), split out of project-wizard.js (its size cap): right after a folder is picked (and
// after Change folder), the engine says what it is (api.inspectOnboardingFolder, onboarding:inspect-folder) and step 2
// says what Next will do with it. window.ProjectWizardFolder({ cur, render }) gives the wizard, over its state (`cur()`,
// `folderState: { url, state }`):
// - inspect(url): reads the picked folder's state, then renders (an answer for an older pick is dropped);
// - stateLine(): wizard-folder-state (data-state = reading | repository | empty-repository | plain | missing |
//   unreadable), what will happen: a repository is cloned; a plain folder or a repository without a commit gets a
//   new git repository from a copy of its files, the original folder never changed; a missing or unreadable folder
//   says so. A state that could not be read (an onboarding resumed, an engine without the channel): the help line;
// - blocks(): Next stays off while reading and on a missing or unreadable folder (never on a resumed onboarding);
// - nextKey() / waitKey() / pointKeys(): Next's label, its wait text and the "What happens" points (create vs clone).
// Uses app.js globals (api, esc, t).

(function () {
  /** @param {{ cur: () => any, render: () => void }} deps */
  window.ProjectWizardFolder = function ({ cur, render }) {
    /** @type {Record<string, string>} */
    const STATE_KEYS = {
      'empty-repository': 'onboarding.folder_state_empty_repository',
      missing: 'onboarding.folder_state_missing',
      plain: 'onboarding.folder_state_plain',
      reading: 'onboarding.folder_state_reading',
      repository: 'onboarding.folder_state_repository',
      unreadable: 'onboarding.folder_state_unreadable',
    };
    const COPIED = ['empty-repository', 'plain'];

    /** the picked folder's state; 'unknown' when it was not read (or for another folder) */
    function state() {
      const w = cur();
      return w?.folderState && w.folderState.url === w.model.repository ? w.folderState.state : 'unknown';
    }

    /** @param {string} url the picked folder's file:// URL */
    function inspect(url) {
      const w = cur();
      if (!w) return;
      w.folderState = { url, state: 'reading' };
      Promise.resolve().then(() => api.inspectOnboardingFolder(url)).catch(() => null).then((answer) => {
        const now = cur();
        if (!now || now.folderState?.url !== url) return;
        now.folderState = { url, state: answer?.state && answer.state !== 'reading' && STATE_KEYS[answer.state] ? answer.state : 'unknown' };
        render();
      });
    }

    const copied = () => COPIED.includes(state());
    const blocks = () => !cur()?.projectId && ['missing', 'reading', 'unreadable'].includes(state());
    const nextKey = () => (copied() ? 'onboarding.next_create' : 'onboarding.next_clone');
    const waitKey = () => (copied() ? 'onboarding.creating_wait' : 'onboarding.cloning_wait');
    const pointKeys = () => (copied()
      ? ['onboarding.folder_next_copy_1', 'onboarding.folder_next_2', 'onboarding.folder_next_copy_3']
      : ['onboarding.folder_next_1', 'onboarding.folder_next_2', 'onboarding.folder_next_3']);

    function stateLine() {
      const s = state();
      if (s === 'unknown') return `<span class="muted small">${esc(t('onboarding.folder_help'))}</span>`;
      return `<p class="wizard-folder-state small" data-testid="wizard-folder-state" data-state="${esc(s)}" role="status">${esc(t(STATE_KEYS[s]))}</p>`;
    }

    return { blocks, inspect, nextKey, pointKeys, stateLine, waitKey };
  };
})();
