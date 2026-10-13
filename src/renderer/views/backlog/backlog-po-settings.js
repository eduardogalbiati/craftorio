// Backlog › Product Owner › settings (#189): the drawer's settings button (next to Clear, "Calibrate
// the Product Owner") opens a panel over the conversation (#po-settings, kept underneath; the back
// arrow or Esc returns to it) with the Speed ↔ Quality slider (window.PoCalibration) and the model
// and effort: the same saved setting as Agents › Product Owner (api.saveAgent, agents/product-owner.json),
// and the Economy ↔ Generous Cost slider under it (#205, PoCalibration.cost, saved as `cost`).
// Each change saves at once and applies to the next answer.
// The header's calibration chip (#po-calib-chip) shows the step the next plan question uses: the
// saved one, or another picked for that question only (window.BacklogPoSettings.override, sent by
// backlog-po.js's ask and cleared once sent). Hidden in Register an issue (no planning there).
// The Cost chip (#po-cost-chip, #205) works the same way for the Cost step (costOverride).
// Uses app.js globals (esc, errMsg) and window.ChatModels (chat-models.js).
// load: after views/backlog/backlog.js (the drawer's markup; the slider, src/shared/po-calibration.js, loads first)
/* global api, PoCalibration */
(() => {
  const PRODUCT_OWNER = 'product-owner';
  const $s = (sel) => document.querySelector(sel);
  // override: a step for the next question only (null: the saved one)
  const st = { open: false, override: null, costOverride: null, saving: false };
  const agent = () => window.productOwnerAgent || null;
  const saved = () => PoCalibration.clamp(agent()?.calibration);
  const savedCost = () => PoCalibration.cost.clamp(agent()?.cost);

  function renderChip({ busy = false, issueMode = false } = {}) {
    const chip = $s('#po-calib-chip');
    if (st.override === saved()) st.override = null;
    const now = st.override ?? saved();
    // short labels (a small chip): the saved step is marked by a check, an override by the chip's colour
    chip.innerHTML = PoCalibration.STEPS.map((s) => `<option value="${s.level}"${s.level === now ? ' selected' : ''}>${s.level === saved() ? '✓ ' : ''}${esc(s.name)}</option>`).join('');
    chip.classList.toggle('override', st.override != null);
    chip.classList.toggle('hidden', issueMode);
    chip.disabled = busy;
    chip.title = `${st.override != null ? 'For the next question only (the saved calibration is unchanged). ' : 'The saved calibration; pick another step for the next question only. '}${PoCalibration.tooltip(now)}`;
    renderCostChip({ busy, issueMode });
  }

  // #205: the Cost step of the next question, the same way
  function renderCostChip({ busy = false, issueMode = false } = {}) {
    const chip = $s('#po-cost-chip');
    if (st.costOverride === savedCost()) st.costOverride = null;
    const now = st.costOverride ?? savedCost();
    chip.innerHTML = PoCalibration.cost.STEPS.map((s) => `<option value="${s.level}"${s.level === now ? ' selected' : ''}>${s.level === savedCost() ? '✓ ' : ''}${esc(s.name)}</option>`).join('');
    chip.classList.toggle('override', st.costOverride != null);
    chip.classList.toggle('hidden', issueMode);
    chip.disabled = busy;
    chip.title = `${st.costOverride != null ? 'For the next question only (the saved cost is unchanged). ' : 'The saved cost; pick another step for the next question only. '}${PoCalibration.cost.tooltip(now)}`;
  }

  function renderEffort(effort) {
    $s('#po-set-effort').innerHTML = ['default', ...(window.ChatModels?.EFFORTS || ['low', 'medium', 'high', 'xhigh'])]
      .map((e) => `<button type="button" data-effort="${e}" class="${e === effort ? 'active' : ''}"${st.saving ? ' disabled' : ''}>${e}</button>`).join('');
  }

  function status(text, error = false) {
    const el = $s('#po-set-status');
    el.textContent = text;
    el.classList.toggle('error', error);
    el.classList.toggle('muted', !error);
  }

  async function openSettings() {
    st.open = true;
    $s('#po-settings').classList.remove('hidden');
    status('Loading…');
    try {
      const list = await api.listAgents();
      window.productOwnerAgent = list.find((a) => a.id === PRODUCT_OWNER) || window.productOwnerAgent;
    } catch (e) { status(errMsg(e), true); }
    const a = agent() || {};
    $s('#po-set-calibration-box').innerHTML = PoCalibration.sliderHtml({ id: 'po-set-calibration', value: saved() });
    $s('#po-set-cost-box').innerHTML = PoCalibration.cost.sliderHtml({ id: 'po-set-cost', value: savedCost() });
    $s('#po-set-model').value = a.model || '';
    $s('#po-set-model-list').innerHTML = (window.ChatModels?.PROVIDERS['claude-code']?.models || []).map((m) => `<option value="${esc(m)}"></option>`).join('');
    renderEffort(a.effort || 'high');
    if (agent()) status('Applies to the next answer.');
    $s('#po-set-calibration')?.focus({ preventScroll: true });
  }

  function closeSettings() {
    st.open = false;
    $s('#po-settings').classList.add('hidden');
    $s('#btn-po-settings').focus({ preventScroll: true });
  }

  // Saves the whole agent (its look too: the save rewrites agents/product-owner.json) with `patch`.
  async function save(patch) {
    const a = agent();
    if (!a) return;
    st.saving = true;
    status('Saving…');
    try {
      const out = await api.saveAgent(PRODUCT_OWNER, { appearance: a.appearance, model: a.model, effort: a.effort, calibration: saved(), cost: savedCost(), ...patch });
      window.productOwnerAgent = { ...a, ...out };
      status(`Saved. Applies to the next answer${patch.calibration ? ` (${PoCalibration.label(out.calibration)})` : patch.cost ? ` (${PoCalibration.cost.label(out.cost)})` : ''}.`);
    } catch (e) {
      status(errMsg(e), true);
    } finally {
      st.saving = false;
      renderEffort(agent().effort);
      // the header's chip and model line follow the saved setting
      document.dispatchEvent(new CustomEvent('po:settings'));
    }
  }

  $s('#btn-po-settings').onclick = openSettings;
  $s('#btn-po-settings-back').onclick = closeSettings;
  PoCalibration.bindSlider($s('#po-set-calibration-box'), (v, committed) => { if (committed && v !== saved()) save({ calibration: v }); });
  PoCalibration.cost.bindSlider($s('#po-set-cost-box'), (v, committed) => { if (committed && v !== savedCost()) save({ cost: v }); });
  $s('#po-set-model').addEventListener('change', (e) => { const m = e.target.value.trim(); if (m && m !== agent()?.model) save({ model: m }); });
  $s('#po-set-effort').onclick = (e) => { const b = e.target.closest('[data-effort]'); if (b && !st.saving && b.dataset.effort !== agent()?.effort) save({ effort: b.dataset.effort }); };
  $s('#po-calib-chip').onchange = (e) => {
    const v = PoCalibration.clamp(e.target.value);
    st.override = v === saved() ? null : v;
    renderChip();
  };
  $s('#po-cost-chip').onchange = (e) => {
    const v = PoCalibration.cost.clamp(e.target.value);
    st.costOverride = v === savedCost() ? null : v;
    renderCostChip();
  };
  window.BacklogPoSettings = {
    // the step for the next plan question only, or null (the saved one)
    override: () => st.override,
    // #205: the Cost step for the next plan question only, or null (the saved one)
    costOverride: () => st.costOverride,
    // the question was sent: the next one uses the saved step again
    clearOverride: () => { st.override = null; st.costOverride = null; },
    renderChip,
    // back to the conversation (backlog-po.js: Esc, closing the drawer); true when the panel was open
    close: () => { if (!st.open) return false; closeSettings(); return true; },
  };
})();
