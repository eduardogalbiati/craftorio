// #735: which steps and agents of a workflow can't run with a run's inputs, so the run screen and its
// plan show them dimmed ("Doesn't apply: no UI in this project") instead of reading as frontend work
// on a backend project. A rule per UI step, on the inputs the workflow's own conditions read:
// - `screenshots: off`: developer_screenshots and the code review's ui_reviewer;
// - `e2e_tests: off` (or not write_and_run): e2e; `e2e_tests: off`: testid_check.
// #80: no UI folders (`ui_folders` empty) alone dims nothing: an empty project's first run that adds
// pages is a UI change (the `ui_files` filter matches UI files by their extension then).
// `stepsThatDontApply(workflow, inputs)` → [{ id, reason }], `reason` an i18n key:
// run.doesnt_apply_no_ui when an input turned the step off on a project without UI folders,
// run.doesnt_apply_off otherwise. Only ids the workflow has (steps, or agents of a step: its agent_when or the
// `agents` list the app's workflow description gives, `agentsOf`).
// Browser: window.RunPlan; Node: module.exports.
(function (root) {
  const NO_UI = 'run.doesnt_apply_no_ui';
  const OFF = 'run.doesnt_apply_off';

  const has = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);

  function idsOf(workflow) {
    const ids = new Set();
    for (const s of (workflow && workflow.steps) || []) {
      if (!s || !s.id) continue;
      ids.add(s.id);
      for (const a of agentsOf(s)) ids.add(a);
    }
    return ids;
  }

  // a step's agents: its agent_when's keys (the workflow file) or its `agents` (the app's describe())
  const agentsOf = (s) => [...new Set([...Object.keys((s && s.agent_when) || {}), ...((s && Array.isArray(s.agents) && s.agents) || [])])];

  function stepsThatDontApply(workflow, inputs) {
    const wf = workflow || {};
    const declared = wf.inputs || {};
    const value = (k) => (inputs && has(inputs, k) ? inputs[k] : declared[k] && declared[k].default);
    const ids = idsOf(wf);
    const noUi = has(declared, 'ui_folders') && Array.isArray(value('ui_folders')) && value('ui_folders').filter((f) => String(f || '').trim()).length === 0;
    const screenshotsOff = has(declared, 'screenshots') && value('screenshots') === 'off';
    const e2e = has(declared, 'e2e_tests') ? value('e2e_tests') : null;
    const rules = [
      ['developer_screenshots', screenshotsOff],
      ['testid_check', e2e === 'off'],
      ['e2e', e2e != null && e2e !== 'write_and_run'],
      ['ui_reviewer', screenshotsOff],
    ];
    return rules
      .filter(([id, off]) => off && ids.has(id))
      .map(([id]) => ({ id, reason: noUi ? NO_UI : OFF }));
  }

  const api = {
    agentsOf,
    stepsThatDontApply,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunPlan = api;
})(typeof window !== 'undefined' ? window : globalThis);
