/* global api */
// Settings › Execution › Engine: where this window's engine runs (api.engineConnection, from
// src/preload.js or src/renderer/api-http.js). The desktop app on this computer's engine and the
// desktop app showing a remote engine both offer Change…, which opens the app's connection page
// (src/engine-connection-window.js: this computer or a remote engine, address and token, Test
// connection); a plain browser on `npm run serve` only says which engine serves it. Its texts are
// settings.engine.* keys of the catalog (#329), drawn again when the interface language changes.
// window.EngineSettings = { where(), markup(where), render(el) }: settings.js draws it into #set-engine;
// uses app.js globals (esc, errMsg) and the catalog's t.
(() => {
  /** { mode: 'local' | 'remote' | 'browser', host?, canChange } */
  function where() {
    const c = api.engineConnection || { mode: api.platform === 'browser' ? 'browser' : 'local' };
    return { mode: c.mode, host: c.host || '', canChange: typeof api.openEngineConnection === 'function' && c.mode !== 'browser' };
  }

  const MODES = ['local', 'remote', 'browser'];
  const modeOf = (w) => (MODES.includes(w.mode) ? w.mode : 'local');

  /** The group's markup for where(). */
  function markup(w) {
    const mode = modeOf(w);
    const text = t(`settings.engine.${mode}_help`, { host: w.host });
    const badge = t(`settings.engine.badge_${mode}`) + (mode === 'remote' && w.host ? ` · ${w.host}` : '');
    const change = w.canChange
      ? `<div class="s-ctrl"><button type="button" class="btn sm" data-testid="settings-engine-change" aria-describedby="set-engine-help">${esc(t('settings.engine.change'))}</button></div>`
      : '';
    return `<div class="s-group" data-testid="settings-engine" data-engine-mode="${esc(mode)}">
        <div class="s-row">
          <div class="s-label"><b>${esc(t('settings.engine.title'))}</b><span id="set-engine-help">${esc(text)}</span>
            <span class="keep-awake-line"><span class="badge${mode === 'remote' ? ' cat-monitor' : ''}" data-testid="settings-engine-mode">${esc(badge)}</span><span class="error small" id="set-engine-error"></span></span></div>
          ${change}
        </div>
      </div>`;
  }

  /** Draws the group into el; Change… opens the connection page. */
  function render(el) {
    if (!el) return;
    el.innerHTML = markup(where());
    const btn = el.querySelector('[data-testid="settings-engine-change"]');
    if (btn) {
      btn.onclick = async () => {
        try {
          await api.openEngineConnection();
        } catch (e) {
          el.querySelector('#set-engine-error').textContent = errMsg(e);
        }
      };
    }
  }

  window.EngineSettings = { where, markup, render };
})();
