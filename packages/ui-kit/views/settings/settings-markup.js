// Settings' markup (#329): the whole <section id="view-settings">, every tab, drawn in the interface
// language (its texts are settings.* keys of packages/shared/i18n/en.json). A function, so the view is
// drawn again when the language changes (view-registry.js redrawMarkup); settings.js registers it
// and fills the values. Uses window.Select, the catalog's t and settings.js's selfHealingHtml and
// appUpdateHtml, at call time.
(() => {
  // names, not words: the same in every language
  const INDEX_FILE = 'index.db';
  const VOICE_COMMAND = 'whisper-cli';

  window.SettingsMarkup = () => `
      <section id="view-settings" class="view hidden">
        <div class="settings">
          <aside class="settings-nav" data-testid="settings-tabs">
            <h1>${t('settings.title')}</h1>
            <button class="settings-tab active" data-stab="general">${t('settings.tabs.general')}</button>
            <button class="settings-tab" data-stab="agents">${t('settings.tabs.agents')}</button>
            <button class="settings-tab" data-stab="execution">${t('settings.tabs.execution')}</button>
            <button class="settings-tab" data-stab="phone">${t('settings.tabs.phone')}</button>
            <button class="settings-tab" data-stab="about">${t('settings.tabs.about')}</button>
          </aside>
          <div class="settings-body">
            <div class="settings-page" data-spage="general">
              <h2 class="settings-title">${t('settings.tabs.general')}</h2>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.general.workspace')}</b><span>${t('settings.general.workspace_help')}</span><code id="set-ws-path"></code></div>
                  <div class="s-ctrl row"><button id="btn-ws-open" class="btn sm ghost">${t('settings.open')}</button><button id="btn-ws-change" class="btn sm">${t('settings.general.change')}</button></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.general.registry')}</b><span>${t('settings.general.registry_help')}</span><code id="set-ws-registry"></code></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.time_zone.label')}</b><span>${t('settings.time_zone.help')}</span><span id="set-time-zone-now" class="muted small"></span></div>
                  <div class="s-ctrl">${window.Select.markup(`id="set-time-zone" aria-label="${t('settings.time_zone.label')}" data-testid="settings-time-zone"`)}</div>
                </div>
              </div>
              <p id="ws-error" class="error small"></p>
              <div id="set-language"></div>
              <h3 class="s-subtitle">${t('settings.backlog.title')}</h3>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.backlog.platform')}</b><span>${t('settings.backlog.platform_help')}</span></div>
                  <div class="s-ctrl"><select id="set-backlog-platform" aria-label="${t('settings.backlog.platform_label')}"></select></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.backlog.group')}</b><span>${t('settings.backlog.group_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-backlog-group" min="2" max="20" aria-label="${t('settings.backlog.group_label')}" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.backlog.refresh')}</b><span>${t('settings.backlog.refresh_help')}</span></div>
                  <div class="s-ctrl"><select id="set-backlog-refresh" aria-label="${t('settings.backlog.refresh')}">
                    <option value="12">${t('settings.backlog.hours', { count: 12 })}</option>
                    <option value="24">${t('settings.backlog.hours', { count: 24 })}</option>
                    <option value="48">${t('settings.backlog.days', { count: 2 })}</option>
                    <option value="168">${t('settings.backlog.days', { count: 7 })}</option>
                    <option value="0">${t('settings.off')}</option>
                  </select></div>
                </div>
              </div>
              <h3 class="s-subtitle">${t('settings.live.title')}</h3>
              <div id="set-live" class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.live.cap')}</b><span>${t('settings.live.cap_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-live-cap" min="1" max="10" class="s-num" aria-label="${t('settings.live.cap_label')}" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.live.stages')}</b><span>${t('settings.live.stages_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-live-stages" min="1" max="10" class="s-num" aria-label="${t('settings.live.stages_label')}" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.daily_budget')}</b><span>${t('settings.live.budget_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-live-budget" min="0" max="10000" step="1" class="s-num" aria-label="${t('settings.live.budget_label')}" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.live.refresh')}</b><span>${t('settings.live.refresh_help')}</span></div>
                  <div class="s-ctrl"><label class="switch"><input type="checkbox" role="switch" id="set-live-refresh" aria-label="${t('settings.live.refresh_label')}" /><span></span></label></div>
                </div>
              </div>
              <h3 class="s-subtitle">${t('settings.budget.title')}</h3>
              <p class="muted small">${t('settings.budget.intro')}</p>
              <div id="set-budget" class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.daily_budget')}</b><span>${t('settings.budget.day_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-budget-day" min="0" max="100000" step="1" class="s-num" placeholder="${t('settings.budget.no_cap')}" aria-label="${t('settings.budget.day_label')}" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.budget.night')}</b><span>${t('settings.budget.night_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-budget-night" min="0" max="100000" step="1" class="s-num" placeholder="${t('settings.budget.no_cap')}" aria-label="${t('settings.budget.night_label')}" /></div>
                </div>
              </div>
              <h3 class="s-subtitle">${t('settings.voice.title')}</h3>
              <p class="muted small">${t('settings.voice.intro')}</p>
              <div id="set-voice" class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.voice.cli')}</b><span id="set-voice-cli">${t('settings.checking')}</span></div>
                  <div class="s-ctrl"><input type="text" id="set-voice-command" spellcheck="false" placeholder="${VOICE_COMMAND}" aria-label="${t('settings.voice.command_label')}" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.voice.model')}</b><span id="set-voice-model-info">${t('settings.voice.model_help')}</span></div>
                  <div class="s-ctrl row"><select id="set-voice-model" aria-label="${t('settings.voice.model_label')}"></select><button id="btn-voice-download" class="btn sm">${t('settings.voice.download')}</button></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.voice.language')}</b><span>${t('settings.voice.language_help')}</span></div>
                  <div class="s-ctrl"><select id="set-voice-language" aria-label="${t('settings.voice.language_label')}"></select></div>
                </div>
              </div>
              <h3 class="s-subtitle">${t('settings.folders.title')}</h3>
              <div id="set-ws-folders" class="s-group"></div>
              <h3 class="s-subtitle">${t('settings.index.title')}</h3>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${INDEX_FILE}</b><span>${t('settings.index.help')} <span id="set-index-status"></span></span><code id="set-index-path"></code></div>
                  <div class="s-ctrl"><button id="btn-index-rebuild" class="btn sm">${t('settings.index.rebuild')}</button></div>
                </div>
              </div>
              <h3 class="s-subtitle">${t('settings.deps.title')}</h3>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.deps.label')} <span id="set-deps-size" class="badge">…</span></b><span>${t('settings.deps.help')} <span id="set-deps-status"></span></span><code id="set-deps-path"></code></div>
                  <div class="s-ctrl"><button id="btn-deps-clear" class="btn sm">${t('settings.deps.clear')}</button></div>
                </div>
              </div>
              <h3 class="s-subtitle">${t('settings.findings.title')}</h3>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.findings.button')}</b><span>${t('settings.findings.button_help')}</span></div>
                  <label class="switch"><input type="checkbox" data-setting="findingsButton" data-testid="settings-findings-button" aria-label="${t('settings.findings.button')}" /><span></span></label>
                </div>
                <div class="s-row fd-list-row">
                  <div class="s-label"><b>${t('settings.findings.saved')}</b><span>${t('settings.findings.saved_help')}</span>
                    <ul id="set-findings-list" class="fd-list" data-testid="settings-findings-list" aria-label="${t('settings.findings.saved')}" data-empty="${t('settings.findings.empty')}"></ul>
                  </div>
                </div>
              </div>
            </div>

            <div class="settings-page hidden" data-spage="agents">
              <!-- #740: the CLIs on the engine's machine (settings-clis.js), the Setup's rows, a close button, no stepper -->
              <section class="settings-clis" data-testid="settings-clis" aria-labelledby="settings-clis-title">
                <div class="row settings-clis-head">
                  <h2 id="settings-clis-title" class="settings-title">${t('settings.tabs.agents')}</h2>
                  <span class="spacer"></span>
                  <button type="button" id="btn-settings-clis-close" class="icon-btn" data-testid="settings-clis-close" aria-label="${t('settings.agents.close')}" title="${t('settings.agents.close')}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg></button>
                </div>
                <p class="muted small">${t('settings.agents.intro')}</p>
                <div id="set-tools" class="s-group"><div class="s-row"><div class="s-label"><span>${t('settings.checking')}</span></div></div></div>
                <div id="set-cli-console"></div>
                <div class="row">
                  <button type="button" id="btn-tools-refresh" class="btn sm ghost">${t('settings.agents.check_again')}</button>
                  <button type="button" id="btn-setup-again" class="btn sm ghost" data-testid="setup-again">${t('settings.agents.setup_again')}</button>
                </div>
              </section>
              <h3 class="s-subtitle">${t('settings.fallbacks.title')}</h3>
              <p class="muted small">${t('settings.fallbacks.intro')}</p>
              <div id="set-fallbacks" class="s-group" data-testid="settings-fallbacks"></div>
              <h3 class="s-subtitle">${t('settings.accounts.title')}</h3>
              <p class="muted small">${t('settings.accounts.intro')}</p>
              <p class="small acct-terms" data-testid="settings-accounts-terms">${t('settings.accounts.terms')}</p>
              <div id="set-accounts" class="s-group" data-testid="settings-accounts"></div>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.accounts.cooldown')}</b><span>${t('settings.accounts.cooldown_help')}</span></div>
                  <input id="set-account-cooldown" type="number" min="1" step="1" class="s-num" data-testid="settings-account-cooldown" aria-label="${t('settings.accounts.cooldown')}" />
                </div>
              </div>
              <h3 class="s-subtitle">${t('settings.limits.title')}</h3>
              <p class="muted small">${t('settings.limits.intro')}</p>
              <div id="set-model-limits" class="s-group" data-testid="settings-model-limits"></div>
              <div class="row">
                <span id="set-fallbacks-msg" class="small"></span>
                <span class="spacer"></span>
                <button id="btn-fallbacks-cancel" class="btn sm ghost" type="button">${t('common.cancel')}</button>
                <button id="btn-fallbacks-save" class="btn sm primary" type="button" data-testid="settings-fallbacks-save">${t('common.save')}</button>
              </div>
            </div>

            <div class="settings-page hidden" data-spage="execution">
              <h2 class="settings-title">${t('settings.tabs.execution')}</h2>
              <!-- where the engine runs: this computer or a remote one (settings-engine.js) -->
              <div id="set-engine"></div>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.developer')}</b><span>${t('settings.execution.developer_help')}</span></div>
                  <label class="switch"><input type="checkbox" data-setting="developerMode" data-testid="settings-developer-mode" aria-label="${t('settings.execution.developer')}" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.open_run')}</b><span>${t('settings.execution.open_run_help')}</span></div>
                  <label class="switch"><input type="checkbox" data-setting="openRunOnStart" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.confirm_stop')}</b><span>${t('settings.execution.confirm_stop_help')}</span></div>
                  <label class="switch"><input type="checkbox" data-setting="confirmStop" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.chip')}</b><span>${t('settings.execution.chip_help')}</span></div>
                  <label class="switch"><input type="checkbox" data-setting="showOccupancyChip" data-testid="setting-occupancy-chip" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.city_glow')}</b><span>${t('settings.execution.city_glow_help')}</span></div>
                  <label class="switch"><input type="checkbox" data-setting="cityGlow" data-testid="setting-city-glow" aria-label="${t('settings.execution.city_glow')}" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.keep_awake')}</b><span>${t('settings.execution.keep_awake_help')}</span>
                    <span class="keep-awake-line"><span class="badge keep-awake-status" data-keep-awake-status></span><span class="error small" data-keep-awake-error></span></span></div>
                  <label class="switch"><input type="checkbox" data-keep-awake-toggle aria-label="${t('settings.execution.keep_awake')}" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.control')}</b><span>${t('settings.execution.control_help')}</span>
                    <span class="keep-awake-line"><span class="badge" data-testid="control-channel-status" id="set-control-status"></span><span class="error small" id="set-control-error"></span></span>
                    <span class="keep-awake-line hidden" id="set-control-ctl"><span class="muted small">${t('settings.execution.control_client')}</span><code class="small" data-testid="control-ctl-path" id="set-control-ctl-path"></code><button type="button" class="btn sm ghost" data-testid="control-ctl-copy" id="btn-control-ctl-copy" aria-label="${t('settings.execution.copy_label')}">${t('settings.execution.copy')}</button></span></div>
                  <label class="switch"><input type="checkbox" data-setting="controlChannel" data-testid="setting-control-channel" aria-label="${t('settings.execution.control')}" /><span></span></label>
                </div>
              </div>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.notify_runs')}</b><span>${t('settings.execution.notify_runs_help')}</span></div>
                  <label class="switch"><input type="checkbox" data-setting="notifyRuns" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.notify_sessions')}</b><span>${t('settings.execution.notify_sessions_help')}</span></div>
                  <label class="switch"><input type="checkbox" data-setting="notifySessions" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.notify_po')}</b><span>${t('settings.execution.notify_po_help')}</span></div>
                  <label class="switch"><input type="checkbox" data-setting="notifyPO" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.notify_oracle')}</b><span>${t('settings.execution.notify_oracle_help')}</span></div>
                  <label class="switch"><input type="checkbox" data-setting="notifyOracle" /><span></span></label>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.execution.retention')}</b><span>${t('settings.execution.retention_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-notif-retention" min="0" max="3650" step="1" class="s-num" aria-label="${t('settings.execution.retention_label')}" /></div>
                </div>
              </div>
              <h3 class="s-subtitle">${t('settings.concurrency.title')}</h3>
              <div id="set-concurrency" class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.concurrency.several')}</b><span>${t('settings.concurrency.several_help')}</span></div>
                  <label class="switch"><input type="checkbox" id="set-cr-enabled" /><span></span></label>
                </div>
                <div class="s-row" id="set-mp-row">
                  <div class="s-label"><b>${t('settings.concurrency.machine')} <span class="badge" id="set-mp-state" data-testid="machine-profile-state"></span></b><span id="set-mp-line" data-testid="machine-profile-line"></span><span id="set-mp-hint" class="muted small"></span></div>
                  <div class="s-ctrl">
                    <button type="button" class="btn sm" id="set-mp-use" data-testid="machine-profile-use">${t('settings.concurrency.use')}</button>
                    <button type="button" class="link-btn" id="set-mp-auto" data-testid="machine-profile-back-to-auto">${t('settings.concurrency.back_to_auto')}</button>
                  </div>
                </div>
                <div class="s-row hidden" id="set-mp-suggestion" data-testid="machine-profile-suggestion">
                  <div class="s-label"><b id="set-mp-suggestion-title"></b><span id="set-mp-suggestion-evidence"></span></div>
                  <div class="s-ctrl"><button type="button" class="btn sm" id="set-mp-apply" data-testid="machine-profile-apply">${t('settings.concurrency.apply')}</button></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.concurrency.max')}</b><span>${t('settings.concurrency.max_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-cr-max" min="1" max="20" step="1" class="s-num" aria-label="${t('settings.concurrency.max')}" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.concurrency.workers')}</b><span>${t('settings.concurrency.workers_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-mp-workers" data-testid="machine-profile-test-workers" min="1" max="64" step="1" class="s-num" aria-label="${t('settings.concurrency.workers')}" /></div>
                </div>
                <div class="s-row cr-opt">
                  <div class="s-label"><b>${t('settings.concurrency.per_project')}</b><span>${t('settings.concurrency.per_project_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-cr-project" min="1" max="20" step="1" class="s-num" placeholder="${t('settings.concurrency.no_limit')}" aria-label="${t('settings.concurrency.per_project_label')}" /></div>
                </div>
                <div class="s-row cr-opt">
                  <div class="s-label"><b>${t('settings.concurrency.sims')}</b><span>${t('settings.concurrency.sims_help')}</span></div>
                  <label class="switch"><input type="checkbox" id="set-cr-sims" /><span></span></label>
                </div>
              </div>
              <h3 class="s-subtitle">${t('settings.memory.title')}</h3>
              <div id="set-memory-guard" class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.memory.stop')}</b><span>${t('settings.memory.stop_help')}</span></div>
                  <label class="switch"><input type="checkbox" id="set-mg-enabled" data-testid="memory-guard-enabled" aria-label="${t('settings.memory.enabled_label')}" /><span></span></label>
                </div>
                <div class="s-row mg-opt">
                  <div class="s-label"><b>${t('settings.memory.limit')}</b><span id="set-mg-limit-hint" data-testid="memory-guard-limit-hint"></span></div>
                  <div class="s-ctrl"><input type="number" id="set-mg-limit" data-testid="memory-guard-limit" min="5" max="90" step="1" class="s-num" aria-label="${t('settings.memory.limit_label')}" /></div>
                </div>
                <div class="s-row mg-opt">
                  <div class="s-label"><b>${t('settings.memory.floor')}</b><span>${t('settings.memory.floor_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-mg-floor" data-testid="memory-guard-floor" min="0" max="50" step="1" class="s-num" aria-label="${t('settings.memory.floor_label')}" /></div>
                </div>
              </div>
              <h3 class="s-subtitle">${t('settings.base.title')}</h3>
              <div class="s-group">
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.base.on_red')}</b><span>${t('settings.base.on_red_help')}</span></div>
                  <div class="s-ctrl">${window.Select.markup(`id="set-base-check-on-red" aria-label="${t('settings.base.on_red')}" data-testid="base-check-on-red"`, [['off', t('settings.off')], ['issue', t('settings.base.issue')], ['fix', t('settings.base.fix')]], 'fix')}</div>
                </div>
              </div>
              <!-- #568: platform triggers, one switch per project (settings.js renderTriggers) -->
              <h3 class="s-subtitle">${t('settings.triggers.title')}</h3>
              <div id="set-triggers" class="s-group" data-testid="settings-triggers"></div>
              <h3 class="s-subtitle">${t('settings.oracle.title')}</h3>
              <div id="set-oracle" class="s-group">
                <div class="s-row" id="set-oracle-self-healing-row">${selfHealingHtml({}, null)}</div>
                <div class="s-row" id="set-app-update-row" data-testid="app-update-row">${appUpdateHtml({}, null)}</div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.daily_budget')}</b><span>${t('settings.oracle.budget_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-oracle-budget" min="0" max="10000" step="0.5" class="s-num" aria-label="${t('settings.oracle.budget_label')}" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.oracle.compact')}</b><span>${t('settings.oracle.compact_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-oracle-compact" min="10000" max="1000000" step="10000" class="s-num" aria-label="${t('settings.oracle.compact_label')}" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.oracle.park')}</b><span>${t('settings.oracle.park_help')}</span></div>
                  <div class="s-ctrl"><input type="number" id="set-oracle-park" min="1" max="1440" step="1" class="s-num" aria-label="${t('settings.oracle.park_label')}" data-testid="settings-oracle-park-after" /></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.oracle.wake')}</b><span>${t('settings.oracle.wake_help')}</span></div>
                  <div class="s-ctrl"><select id="set-oracle-wake" aria-label="${t('settings.oracle.wake_label')}"><option value="all">${t('settings.oracle.wake_all')}</option><option value="watched">${t('settings.oracle.wake_watched')}</option><option value="off">${t('settings.off')}</option></select></div>
                </div>
                <div class="s-row">
                  <div class="s-label"><b>${t('settings.oracle.wake_on')}</b><span>${t('settings.oracle.wake_on_help')}</span></div>
                  <div class="s-ctrl oracle-wake-kinds" id="set-oracle-wake-on"></div>
                </div>
              </div>
            </div>

            <!-- #226: answering the human gates from a paired phone (settings-phone.js) -->
            <div class="settings-page hidden" data-spage="phone">
              <h2 class="settings-title">${t('settings.tabs.phone')}</h2>
              <div id="set-phone" data-testid="phone-gates"></div>
            </div>

            <div class="settings-page hidden" data-spage="about">
              <h2 class="settings-title">${t('settings.tabs.about')}</h2>
              <div id="set-about" class="s-group"></div>
            </div>
          </div>
        </div>
      </section>`;
})();
