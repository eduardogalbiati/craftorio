/* global api */
// Settings › Execution › Engine: where this window's engine runs (api.engineConnection, from
// src/preload.js or src/renderer/api-http.js). The desktop app on this computer's engine and the
// desktop app showing a remote engine both offer Change…, which opens the app's connection page
// (src/engine-connection-window.js: this computer or a remote engine, address and token, Test
// connection); a plain browser on `npm run serve` only says which engine serves it.
// window.EngineSettings = { where(), markup(where), render(el) }: settings.js draws it into #set-engine;
// uses app.js globals (esc, errMsg).
(() => {
  /** { mode: 'local' | 'remote' | 'browser', host?, canChange } */
  function where() {
    const c = api.engineConnection || { mode: api.platform === 'browser' ? 'browser' : 'local' };
    return { mode: c.mode, host: c.host || '', canChange: typeof api.openEngineConnection === 'function' && c.mode !== 'browser' };
  }

  const TEXT = {
    local: () => 'This computer runs the engine: runs, terminals and the workspace are here. Another computer of yours can run it instead (npm run serve), and this app becomes its window.',
    remote: (w) => `This window shows the engine on ${w.host}: runs, terminals, files and settings are on that computer. Change… switches back to this computer or to another engine (the app restarts).`,
    browser: (w) => `This page is served by the engine on ${w.host}. The desktop app on another computer can show this engine too: Settings › Execution › Engine there.`,
  };
  const BADGE = { local: 'This computer', remote: 'Remote engine', browser: 'Browser' };

  /** The group's markup for where(). */
  function markup(w) {
    const text = (TEXT[w.mode] || TEXT.local)(w);
    return `<div class="s-group" data-testid="settings-engine" data-engine-mode="${esc(w.mode)}">
        <div class="s-row">
          <div class="s-label"><b>Engine</b><span id="set-engine-help">${esc(text)}</span>
            <span class="keep-awake-line"><span class="badge${w.mode === 'remote' ? ' cat-monitor' : ''}" data-testid="settings-engine-mode">${esc(BADGE[w.mode] || BADGE.local)}${w.mode === 'remote' && w.host ? ` · ${esc(w.host)}` : ''}</span><span class="error small" id="set-engine-error"></span></span></div>
          ${w.canChange ? '<div class="s-ctrl"><button type="button" class="btn sm" data-testid="settings-engine-change" aria-describedby="set-engine-help">Change…</button></div>' : ''}
        </div>
      </div>`;
  }

  /** Draws the group into el; Change… opens the connection page. */
  function render(el) {
    if (!el) return;
    const w = where();
    el.innerHTML = markup(w);
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
