// #735: which steps and agents of a workflow can't run with a run's inputs, so the run screen and its
// plan show them dimmed ("Doesn't apply: no UI in this project") instead of reading as frontend work
// on a backend project. A rule per UI step, on the inputs the workflow's own conditions read:
// - no UI folders (`ui_folders` empty): developer_screenshots, testid_check and the code review's
//   ui_reviewer never start (their `when` / `agent_when` look for a change under them);
// - `screenshots: off`: developer_screenshots; `e2e_tests: off` (or not write_and_run): e2e;
//   `e2e_tests: off`: testid_check.
// `stepsThatDontApply(workflow, inputs)` → [{ id, reason }], `reason` an i18n key:
// run.doesnt_apply_no_ui when the project has no UI folders, run.doesnt_apply_off when an input
// turned the step off. Only ids the workflow has (steps, or agents of a step: its agent_when or the
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
      ['developer_screenshots', noUi || screenshotsOff],
      ['testid_check', noUi || e2e === 'off'],
      ['e2e', e2e != null && e2e !== 'write_and_run'],
      ['ui_reviewer', noUi],
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
