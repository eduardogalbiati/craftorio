// Backlog › Product Owner › settings (#189): the panel's markup (#po-settings, over the conversation),
// drawn inside the drawer by backlog.js (PO_DRAWER) and driven by backlog-po-settings.js: the Speed ↔
// Quality and Cost sliders' boxes, the model and the effort.
// Uses the catalog's t.
(() => {
  const html = () => `
  <div id="po-settings" class="po-settings hidden" role="region" aria-label="${t('backlog.calibrate_the_product_owner')}">
    <div class="po-settings-head">
      <button id="btn-po-settings-back" class="icon-btn" type="button" title="${t('backlog.back_to_the_conversation')}" aria-label="${t('backlog.back_to_the_conversation')}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <h2 class="drawer-title">${t('backlog.calibrate_the_product_owner')}</h2>
    </div>
    <div class="po-settings-body">
      <div class="field">
        <label for="po-set-calibration">${t('backlog.speed_quality')}</label>
        <div id="po-set-calibration-box"></div>
        <p class="hint">${t('backlog.what_this_changes_how_many_runs')}</p>
      </div>
      <div class="field">
        <label for="po-set-cost">${t('backlog.cost_economy_generous')}</label>
        <div id="po-set-cost-box"></div>
        <p class="hint">${t('backlog.what_this_changes_how_many_issues')}</p>
      </div>
      <div class="row">
        <div class="field">
          <label for="po-set-model">${t('backlog.model')} <span class="muted">${t('backlog.claude_code')}</span></label>
          <input type="text" id="po-set-model" list="po-set-model-list" maxlength="80" placeholder="${t('backlog.claude_opus_5_5')}" />
          <datalist id="po-set-model-list"></datalist>
        </div>
        <div class="field">
          <label>${t('backlog.effort')}</label>
          <div id="po-set-effort" class="seg sm" role="group" aria-label="${t('backlog.effort')}"></div>
        </div>
      </div>
      <p id="po-set-status" class="po-settings-status muted small">${t('backlog.applies_to_the_next_answer')}</p>
    </div>
  </div>
`;

  window.BacklogPoSettingsPanel = {
    html,
  };
})();
