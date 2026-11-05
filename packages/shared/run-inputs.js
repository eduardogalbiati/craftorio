// #735, #785: what a run's inputs take and from where, the one rule of the engine and the screens: the
// run itself (packages/engine/domains/project/project-run-defaults.js), a plan's groups (packages/engine/
// domains/po/po-chosen-inputs.js), the forms and the Product Owner's card (packages/ui-kit/workflow-inputs.js,
// fronts/build/views/backlog/backlog-po-options.js). `project`: the project's run defaults.
// - blank(v): nothing, or a blank string; what an item saved counts as not saved then;
// - fits(def, v): the value is in the input's enum (a `multiple` input: each of its comma-separated
//   values), compared as text, so a YAML number or boolean and its word are one value;
// - sameValue(a, b): one value: a list and its comma-separated text, a boolean and its word;
// - projectValue(k, def, project): the project's value of an input, when it has one the input takes
//   (release.yaml's own names take theirs: unit_command ← test_command, e2e_suite ← e2e_tests);
// - shownDefault(k, def, project): what an input shows with nothing saved or typed: that, else the workflow's;
// - resolveRunInputs({ typed, roadmap, project, workflow }) → { values, sources }: per input of the
//   workflow, what the owner typed > the item's saved inputs > the project's > the workflow's default;
//   `sources[key]` says which one; what the item or the owner set for a key the workflow lacks stays;
// - chosen(inputs, defs, project): the inputs worth saving on an item: never a blank one, never one equal
//   to what is shown anyway; an input the workflow does not declare stays;
// - withAliases(defaults): the defaults with release.yaml's names added, for the run dialog's fields.
// Browser: window.RunInputs; Node: module.exports.
(function (root) {
  // release.yaml names some inputs its own way
  const ALIASES = {
    unit_command: (d) => d.test_command,
    e2e_suite: (d) => (d.e2e_tests == null ? undefined : d.e2e_tests === 'off' ? 'skip' : 'run'),
  };

  const given = (v) => v !== undefined && v !== null;
  const blank = (v) => !given(v) || (typeof v === 'string' && !v.trim());
  const text = (v) => (Array.isArray(v) ? v.join(',') : String(v ?? ''));
  const sameValue = (a, b) => text(a) === text(b);

  function fits(def, v) {
    if (!Array.isArray(def?.enum)) return true;
    const known = def.enum.map(String);
    return (def.multiple ? String(v).split(',') : [v]).every((x) => known.includes(String(x).trim()));
  }

  function projectValue(k, def, project) {
    const v = Object.prototype.hasOwnProperty.call(project || {}, k) ? project[k] : ALIASES[k]?.(project || {});
    return given(v) && fits(def, v) ? v : undefined;
  }

  const shownDefault = (k, def, project) => projectValue(k, def, project) ?? def?.default;

  /** The run's inputs from the four sources, highest first (see the header). */
  function resolveRunInputs({ typed = {}, roadmap = {}, project = {}, workflow = {} } = {}) {
    const values = {};
    const sources = {};
    for (const [k, def] of Object.entries(workflow?.inputs || {})) {
      const picks = [
        ['typed', typed?.[k]],
        ['roadmap', blank(roadmap?.[k]) ? undefined : roadmap[k]],
        ['project', projectValue(k, def, project)],
        ['workflow', def?.default],
      ];
      const found = picks.find(([, v]) => given(v));
      if (!found) continue;
      values[k] = found[1];
      sources[k] = found[0];
    }
    for (const src of [roadmap, typed]) for (const [k, v] of Object.entries(src || {})) if (!(k in values) && (src === typed ? given(v) : !blank(v))) { values[k] = v; sources[k] = src === typed ? 'typed' : 'roadmap'; }
    return { values, sources };
  }

  /** The inputs worth saving (see the header). `defs`: the workflow's inputs; `project`: its run defaults, or null. */
  function chosen(inputs, defs = {}, project = null) {
    const out = {};
    for (const [k, v] of Object.entries(inputs || {})) {
      if (blank(v)) continue;
      if (defs?.[k] && sameValue(v, shownDefault(k, defs[k], project))) continue;
      out[k] = v;
    }
    return out;
  }

  function withAliases(defaults) {
    if (!defaults) return defaults;
    const out = { ...defaults };
    for (const [k, of] of Object.entries(ALIASES)) if (!(k in out) && of(out) !== undefined) out[k] = of(out);
    return out;
  }

  const api = {
    blank,
    chosen,
    fits,
    projectValue,
    resolveRunInputs,
    sameValue,
    shownDefault,
    withAliases,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunInputs = api;
})(typeof window !== 'undefined' ? window : globalThis);
