// The default development workflow (#195): the one used wherever a workflow is not picked by hand
// (the Product Owner's plans and its heuristic plan, Split + roadmap, Create + roadmap, the Assign
// dialog with nothing remembered). #790: it comes from the project, never from a global setting:
// projectDefault(project, manifestDefault) is the one order everywhere (the project's own
// `defaultWorkflow`, the repository manifest's `default`, the first build workflow of the project's
// set, `feature`); the engine's projects.projectDefaultWorkflow reads the manifest for it.
// - resolve(given, files): { file, missing } (missing: the given file that no longer exists; the
//   fallback is the local workflow when `files` has it, else the first);
// - mergeOf(wf): how a workflow's work lands: 'local' (merged into the local base, no push),
//   'remote' (pushed: a branch and a PR/MR) or 'none' (no worktree, or it never merges);
// - #792 ending(wf, inputs): how a run of a workflow (engine shape or workflows:list summary) ends:
//   'pr', 'local', 'fork' or null (it neither merges nor opens a PR): the `mode` input of a workflow
//   that has local | remote | fork (feature, fix), else mergeOf;
// - #792 runEnding(wf, resolved, alias): ending for a run's RunInputs.resolveRunInputs result, in the
//   engine's order (backlog.runInputs, then aliasInputs): a value only the workflow gives stays out, so
//   an old name's `alias` goes under what the item or the project chose;
// - current(): the renderer's default: the header project's (state.projects) through projectDefault,
//   among state.workflows (app.js globals), with its `merge`, the `inputs` of the project's Feature
//   entry and the `ending` they give it;
// - firstBuild(set): a project's default without a given one (#486, packages/engine/domains/project/projects.js and the Overview);
// - projectFirst(list): the pickers' workflows with the header project's set first (#486).
// - #791 KINDS (feature, fix, refactor: the kinds of work the Product Owner tells apart) and
//   kindEntry(project, manifest, kind) → { name, inputs }: the project's workflow of a kind, the rule
//   the engine's projects.workflowForKind and the screens share (the project's own `workflowKinds`
//   entry; for Feature its `defaultWorkflow`; the manifest's `kinds`; for Feature the manifest's
//   `default`; the wizard's pick of that name with its variant's mode; last `feature` / `fix` in the
//   project's way of working: the picks' mode, a fork, a repository (remote), else local);
//   entryKind(kind): the kind whose entry serves it (a refactor uses the Feature entry);
//   modeOfVariant(variant) / modeOfPicks(workflows): the local | remote | fork a wizard pick names
//   (also project-run-defaults.js); variantTestOrder(variant): the test order it runs (code_first |
//   e2e_first | null, project-run-defaults.js and the project's Workflows cards); installedFile(name, files): a workflow name's file, an old name's
//   through its alias; kindTarget(entry, files) → { file, inputs }: what a kind's entry runs;
//   KIND_ENTRIES (feature, fix): the kinds with an entry of their own, the map's keys;
//   projectWorkflows(list, project, kinds): the workflows the Product Owner is offered: of `list`
//   those that take a task and are not Plan & Design, in the project's set or named by its kinds or
//   default; nothing of the project's known: every one of them.
// - On the screens a project's manifest is the record's `manifest` ({ default, kinds }, added by
//   projects:list, projects.withManifest): the same order as the engine's.
// - #630: ALIASES / aliasOf(file): the old bundled names (software-development, the local heroes,
//   multi-model-review, e2e-release) now mean feature.yaml or release.yaml with the inputs of the old
//   variant; a saved setting, manifest or roadmap naming one still runs (workflows.js resolveWorkflow);
//   VALIDATION / oldValidation(given) / aliasInputs(alias, given): an old `mode: auto | validated` is
//   feature's `validation` (the engine's resolveInputs, the run starts, the renderer's toggle).
// - #631: project-map and refactor-proposals now mean analyze-project.yaml (refactor-proposals is
//   its `since` mode), test-batch means test-backfill.yaml, run-retrospective retrospective.yaml.
// - #648: writer-reviewer and ai-arena now mean write-doc.yaml (ai-arena is its "Several writers"
//   Arena mode, `writers`), issue-tracker means issue.yaml; namesOf(file) lists a file's own and old names.
// Browser: window.DefaultWorkflow; Node: module.exports (packages/engine/domains/po/product-owner.js).
(function (root) {
  const LOCAL = 'feature.yaml';
  const REMOTE = 'feature.yaml';

  // #630, #631, #648: old file name -> { file, inputs } (the inputs go under the run's own inputs)
  const ALIASES = {
    'ai-arena.yaml': { file: 'write-doc.yaml', inputs: {} },
    'ai-development-local-hero.yaml': { file: 'feature.yaml', inputs: { mode: 'local' } },
    'e2e-release.yaml': { file: 'release.yaml', inputs: {} },
    'issue-tracker.yaml': { file: 'issue.yaml', inputs: {} },
    'multi-model-review.yaml': { file: 'feature.yaml', inputs: { review: 'multi_model' } },
    'project-map.yaml': { file: 'analyze-project.yaml', inputs: {} },
    'refactor-proposals.yaml': { file: 'analyze-project.yaml', inputs: {} },
    'run-retrospective.yaml': { file: 'retrospective.yaml', inputs: {} },
    'software-development-local-hero.yaml': { file: 'feature.yaml', inputs: { mode: 'local' } },
    'software-development.yaml': { file: 'feature.yaml', inputs: { mode: 'remote' } },
    'test-batch.yaml': { file: 'test-backfill.yaml', inputs: {} },
    'writer-reviewer.yaml': { file: 'write-doc.yaml', inputs: {} },
  };

  /** #630: the alias of an old workflow name (with or without .yaml), or null. */
  function aliasOf(file) {
    const name = String(file || '').replace(/^.*[\\/]/, '');
    const hit = ALIASES[name] || ALIASES[`${name}.yaml`];
    return hit ? { file: hit.file, inputs: { ...hit.inputs } } : null;
  }

  /** #648: the names (without .yaml) that mean `file`: its own and its old ones ('issue.yaml' → ['issue', 'issue-tracker']). */
  function namesOf(file) {
    const own = label(String(file || '').replace(/^.*[\\/]/, ''));
    const old = Object.keys(ALIASES).filter((k) => label(ALIASES[k].file) === own).map(label);
    return [own, ...old];
  }

  // #630: feature's old `mode: auto | validated` (the PO's plans, saved roadmaps and runs) is now
  // `validation`; `mode` names local | remote
  const VALIDATION = ['auto', 'validated'];
  /** #630: `given` inputs with an old `mode: auto | validated` moved to `validation` (mode dropped). */
  function oldValidation(given) {
    if (!VALIDATION.includes(given?.mode)) return given;
    const { mode, ...rest } = given;
    return { ...rest, validation: rest.validation || mode };
  }
  /** #630: an alias's inputs under the run's own; an old validation mode moves first, so the alias's mode wins. */
  const aliasInputs = (alias, given) => (alias?.inputs ? { ...alias.inputs, ...oldValidation(given || {}) } : given);

  /** The default among `files` (workflow file names): the setting when it exists, else the fallback. */
  function resolve(setting, files = []) {
    const list = (files || []).map(String);
    const saved = setting ? String(setting) : '';
    if (saved && list.includes(saved)) return { file: saved, missing: null };
    const aliased = aliasOf(saved)?.file;
    if (aliased && list.includes(aliased)) return { file: aliased, missing: null };
    const file = [LOCAL, REMOTE].find((f) => list.includes(f)) || list[0] || LOCAL;
    return { file, missing: saved || null };
  }

  /** How a loaded workflow (engine shape: orchestrator, steps with transitions) merges its work. */
  function mergeOf(wf) {
    const tree = wf?.orchestrator?.worktree;
    if (!tree) return 'none';
    if (tree.remote === false || (wf.steps || []).some((s) => (s.transitions || []).some((t) => t.merge === 'local'))) return 'local';
    return wf.metadata?.merges === false ? 'none' : 'remote';
  }

  // #792: what each value of a workflow's local | remote | fork `mode` ends in
  const MODE_ENDINGS = { fork: 'fork', local: 'local', remote: 'pr' };
  /** #792: how a run ends (see the header). feature's own `merge` is always local: its mode decides; an old `mode: auto | validated` is no mode of its. */
  function ending(wf, inputs) {
    const merge = wf?.merge ?? mergeOf(wf);
    if (merge === 'none') return null;
    const modes = wf.inputs?.mode;
    if (!modes?.enum?.includes('local')) return merge === 'remote' ? 'pr' : 'local';
    return MODE_ENDINGS[oldValidation(inputs)?.mode ?? modes.default] || 'local';
  }
  /** #792: how a run with these resolved inputs ({ values, sources }) ends (see the header). */
  const runEnding = (wf, { values, sources }, alias = null) => ending(wf, aliasInputs(alias, sources.mode && sources.mode !== 'workflow' ? { mode: values.mode } : {}));

  // #486: the categories of a development workflow (the manifest's solo/team, the bundled ones' build;
  // #630: a composed set's feature)
  const BUILD = ['solo', 'team', 'build', 'feature'];
  /** #486: a project's default without a given one: the first development workflow of its set ([{ name, category }]). */
  const firstBuild = (workflows) => (workflows || []).find((w) => BUILD.includes(w?.category))?.name || null;

  /** #790: a project's default workflow, a name without .yaml (the one order, see the header); `manifestDefault`: the manifest's `default`. */
  function projectDefault(project, manifestDefault = null) {
    return label(project?.defaultWorkflow) || label(manifestDefault) || firstBuild(project?.workflows) || 'feature';
  }

  // #791: the kinds of work (one per run) and the workflow a project gives each one
  const KINDS = Object.freeze([
    'feature',
    'fix',
    'refactor',
  ]);
  // the Workflows screen's Plan & Design section: never a development default
  const PLANNING = ['plan'];
  /** The mode of a wizard variant (local-code, remote-e2e, fork-code, #738), or null. */
  const modeOfVariant = (v) => (String(v || '').match(/^(local|remote|fork)\b/) || [])[1] || null;
  /** The mode the wizard picked for a project's workflows ([{ variant }]): the first variant that names one, or null. */
  const modeOfPicks = (picks) => (picks || []).map((w) => modeOfVariant(w?.variant)).find(Boolean) || null;
  /** #785/#22: the test order a wizard variant runs ('*-code' → code_first, '*-e2e' → e2e_first), or null. */
  const variantTestOrder = (v) => (/-code$/.test(v || '') ? 'code_first' : /-e2e$/.test(v || '') ? 'e2e_first' : null);
  // #22/#29: the i18n key of each described workflow's description per test order; only feature.yaml takes a
  // test_order: fix.yaml has no test writer, its own description stays
  const ORDER_DESCRIPTIONS = {
    feature: { code_first: 'projects.workflows_desc_feature_code_first', e2e_first: 'projects.workflows_desc_feature_e2e_first' },
  };
  /** #22/#29: the i18n key that describes workflow `name` run in this test order, or null (no such description). */
  const orderDescriptionKey = (name, order) => (Object.hasOwn(ORDER_DESCRIPTIONS, name) && order ? ORDER_DESCRIPTIONS[name][order] || null : null);
  /** #791: the kind whose entry serves `kind`: a refactor uses the Feature entry. */
  const entryKind = (kind) => (kind === 'refactor' ? 'feature' : kind);
  // #791: the kinds with an entry of their own: the only keys of a project's or a manifest's map
  const KIND_ENTRIES = Object.freeze(KINDS.filter((kind) => entryKind(kind) === kind));
  const entry =(name, inputs) => ({ name: label(name), inputs: { ...(inputs || {}) } });

  /** #791: the project's workflow of `kind` → { name, inputs } (the order in the header); `manifest`: { default, kinds } or null. */
  function kindEntry(project, manifest, kind) {
    const k = entryKind(kind);
    const own = project?.workflowKinds?.[k];
    if (label(own?.name)) return entry(own.name, own.inputs);
    const picks = project?.workflows || [];
    const pickOf = (name) => picks.find((w) => label(w?.name) === name) || null;
    const withPick = (name) => { const mode = modeOfVariant(pickOf(name)?.variant); return entry(name, mode ? { mode } : {}); };
    if (k === 'feature' && label(project?.defaultWorkflow)) return withPick(label(project.defaultWorkflow));
    const declared = manifest?.kinds?.[k];
    if (label(declared?.name)) return entry(declared.name, declared.inputs);
    if (k === 'feature' && label(manifest?.default)) return entry(manifest.default, {});
    if (pickOf(k)) return withPick(k);
    const mode = modeOfPicks(picks) || (project?.fork?.url ? 'fork' : project?.repo ? 'remote' : 'local');
    return entry(k, { mode });
  }

  const fileName = (file) => String(file || '').replace(/^.*[\\/]/, '');
  /** #791: the installed file of a workflow's name among `files`: `<name>.yaml`, else a repository copy of that name, else the file an old name means (ALIASES), else null. */
  function installedFile(name, files) {
    const own = label(name);
    if (!own) return null;
    const list = (files || []).map(String);
    const alias = aliasOf(own)?.file;
    return list.find((f) => f === `${own}.yaml`) || list.find((f) => label(fileName(f)) === own) || (alias && list.includes(alias) ? alias : null);
  }

  /** #791: what a kind's entry ({ name, inputs }) runs among `files` → { file, inputs }: an old name reached through its alias adds the alias's inputs under the entry's; a copy of that very name (a repository's) runs as it is. */
  function kindTarget(given, files) {
    const file = installedFile(given?.name, files);
    const aliased = file && label(fileName(file)) !== label(given.name);
    return { file, inputs: { ...(aliased ? aliasInputs(aliasOf(given.name), given.inputs) : given?.inputs) } };
  }

  const planning = (w) => PLANNING.includes(w?.category) || PLANNING.includes(w?.metadata?.category);
  /** #791: the workflows the Product Owner is offered (see the header); `kinds`: the project's resolved kinds, by default its record's over its manifest's. */
  function projectWorkflows(list, project, kinds = { ...project?.manifest?.kinds, ...project?.workflowKinds }) {
    const usable = (list || []).filter((w) => !w.error && w.inputs?.task && !planning(w));
    const names = new Set([
      ...(project?.workflows || []).map((w) => label(w?.name)),
      ...Object.values(kinds || {}).map((e) => label(e?.name)),
      label(project?.defaultWorkflow),
      label(project?.manifest?.default),
    ].filter(Boolean).flatMap((n) => [n, label(aliasOf(n)?.file)].filter(Boolean)));
    if (!names.size) return usable;
    const own = usable.filter((w) => names.has(label(fileName(w.file))));
    return own.length ? own : usable;
  }

  // #486: the header's project record (window.CurrentProject, state.projects), null in Node
  function headerProject(g) {
    const id = root.CurrentProject?.get?.();
    return id ? (g.projects || []).find((p) => p.id === id) || null : null;
  }

  // The renderer's default: the workflows listed by api.listWorkflows (state.workflows, no pipelines).
  // #486, #790: the header project's default (projectDefault, with its manifest's: the `manifest` that
  // projects:list adds to the record), else `feature`; never a setting.
  function current() {
    const g = typeof state !== 'undefined' ? state : {};
    const list = (g.workflows || []).filter((w) => !w.error);
    const files = list.map((w) => w.file);
    const project = headerProject(g);
    const named = `${projectDefault(project, project?.manifest?.default)}.yaml`;
    const own = !files.includes(named) ? aliasOf(named)?.file || named : named;
    const out = resolve(own, files);
    const wf = list.find((w) => w.file === out.file);
    const target = kindTarget(kindEntry(project, project?.manifest, 'feature'), files);
    const inputs = target.file === out.file ? target.inputs : {};
    return { ...out, name: wf?.name || out.file, merge: wf?.merge || null, inputs, ending: wf ? ending(wf, inputs) : null };
  }

  /** #486: `list` (workflows with a file) with the header project's set first, each part in its order. */
  function projectFirst(list) {
    const g = typeof state !== 'undefined' ? state : {};
    const set = new Set((headerProject(g)?.workflows || []).map((w) => label(w.name)));
    if (!set.size) return list;
    const own = (w) => set.has(label(w.file));
    return [...list.filter(own), ...list.filter((w) => !own(w))];
  }

  /** "software-development-local-hero" for a button's tooltip. */
  const label = (file) => String(file || '').replace(/\.ya?ml$/i, '');

  const api = {
    aliasInputs,
    aliasOf,
    ALIASES,
    BUILD,
    KIND_ENTRIES,
    KINDS,
    LOCAL,
    REMOTE,
    VALIDATION,
    current,
    ending,
    entryKind,
    firstBuild,
    installedFile,
    kindEntry,
    kindTarget,
    label,
    mergeOf,
    modeOfPicks,
    modeOfVariant,
    namesOf,
    oldValidation,
    orderDescriptionKey,
    projectDefault,
    projectFirst,
    projectWorkflows,
    resolve,
    runEnding,
    variantTestOrder,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DefaultWorkflow = api;
})(typeof window !== 'undefined' ? window : globalThis);
