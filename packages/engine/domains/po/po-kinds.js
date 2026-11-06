// #791: the kind of work of each issue of a plan (DefaultWorkflow.KINDS: feature, fix, refactor), split out
// of product-owner.js (its size cap). kindOf: the model's `issue_kinds` first, else the labels (`bug` a
// fix, `refactor` a refactor), with a one-line reason. kindGroups (normalizeAnswer's groups): a group of
// the model becomes one group per kind (`kind`, `kindReason`), each on that kind's workflow and inputs
// from the project's `workflowKinds` (the service's projects.workflowForKind; refactor uses the Feature
// entry; the owner's chosen workflow still wins), suggesting no issue of another kind. kindsSection:
// what a plan turn's prompt says of them. The workflows offered are only the project's
// (DefaultWorkflow.projectWorkflows, #790).

const path = require('path');
const DefaultWorkflow = require('@multiagent/shared/default-workflow');
const poChosen = require('./po-chosen-inputs');

// what a label says of an issue's kind, with the one-line reason the plan shows
const LABEL_KINDS = [
  ['fix', /^bug$/i, 'Label `bug`: the current behaviour is wrong.'],
  ['refactor', /^refactor(ing)?$/i, 'Label `refactor`: the code changes, not what it does.'],
];
const labelNames = (issue) => (issue?.labels || []).map((l) => String(l?.name ?? l));

/**
 * The kind of work an issue is (DefaultWorkflow.KINDS) → { kind, reason }: the model's classification
 * (`given`, a group's `issue_kinds`) when it names a known kind, else the labels (`bug` a fix,
 * `refactor` a refactor), else a feature; the reason is one line.
 */
function kindOf(issue, given = []) {
  const model = (Array.isArray(given) ? given : []).find((k) => Number(k?.issue) === Number(issue?.number) && DefaultWorkflow.KINDS.includes(k?.kind));
  if (model) return { kind: model.kind, reason: String(model.reason || '').split('\n')[0].trim() || 'Classified by the Product Owner from the issue.' };
  for (const [kind, re, reason] of LABEL_KINDS) if (labelNames(issue).some((n) => re.test(n))) return { kind, reason };
  return { kind: 'feature', reason: 'No bug or refactor label: new or changed behaviour.' };
}

const entryOf = (kind, workflowKinds) => workflowKinds?.[kind === 'refactor' ? 'feature' : kind] || null;

// a kind's workflow among the installed files (its own name, or a repository copy of it)
function kindFile(kind, { files, workflowKinds }) {
  const name = DefaultWorkflow.label(entryOf(kind, workflowKinds)?.name);
  return name ? files.find((f) => f === `${name}.yaml`) || files.find((f) => DefaultWorkflow.label(path.basename(f)) === name) || null : null;
}

// the issues that could join a kind's group: open, not in the model's group, of the same kind, once each
function suggestedOf(g, kind, nums, plan) {
  const { attached, byNumber, isOpen } = plan;
  const moved = attached.size ? plan.keep(g.issues).filter((x) => !attached.has(x)).map((issue) => ({ issue, reason: 'Named by the Product Owner for this group.' })) : [];
  const suggested = [];
  for (const s of [...(g.suggested || []), ...moved]) {
    const x = Number(s?.issue);
    if (!isOpen(x) || attached.has(x) || nums.includes(x) || suggested.some((y) => y.issue === x)) continue;
    if (kindOf(byNumber.get(x), g.issue_kinds).kind !== kind) continue; // never an issue of another kind
    suggested.push({ issue: x, reason: String(s.reason || '') });
  }
  return suggested;
}

// a simulated answer's applied state (#148), for the issues of this part
function simulatedField(g, part, { keep, mock }) {
  const covered = mock && g.simulated ? keep(g.simulated.covered).filter((x) => part.includes(x)) : [];
  if (!covered.length) return {};
  return { simulated: { covered, stage: Number.isInteger(g.simulated.stage) && g.simulated.stage > 0 ? g.simulated.stage : 1 } };
}

// the workflow of a kind's group and its inputs: the kind's only when the group runs on the kind's workflow
function workflowOf(g, kind, plan) {
  const { chosen, chosenInputs, fallback, files, inputsOf, runDefaults, workflowKinds } = plan;
  const own = kindFile(kind, plan);
  const file = chosen || own || (files.includes(g.workflow) ? g.workflow : fallback);
  const given = g.inputs && typeof g.inputs === 'object' && !Array.isArray(g.inputs) ? g.inputs : {};
  const fromKind = file && own === file ? entryOf(kind, workflowKinds)?.inputs : null;
  return { workflow: file, inputs: poChosen.groupInputs({ ...fromKind, ...given }, chosenInputs, inputsOf(file), runDefaults) };
}

/**
 * A group of the model as one group per kind, in KINDS order; the parts share the stage. `plan`:
 * normalizeAnswer's { attached, byNumber, chosen, chosenInputs, fallback, files, inputsOf, isOpen, keep,
 * mock, runDefaults, sizeOf, workflowKinds }. With a selection, a group keeps only the open attached
 * issues; another one it names becomes a suggestion.
 */
function kindGroups(g, n, plan) {
  const { attached, byNumber, isOpen, keep, sizeOf } = plan;
  const named = keep(g.issues);
  const nums = attached.size ? named.filter((x) => attached.has(x) && isOpen(x)) : named;
  const kindsOf = new Map(nums.map((x) => [x, kindOf(byNumber.get(x), g.issue_kinds)]));
  const parts = DefaultWorkflow.KINDS.map((kind) => ({ kind, part: nums.filter((x) => kindsOf.get(x).kind === kind) })).filter((p) => p.part.length);
  return parts.map(({ kind, part }) => {
    const suggested = suggestedOf(g, kind, nums, plan);
    const size = sizeOf(part);
    return {
      name: String(g.name || `Group ${n + 1}`),
      issues: part,
      kind,
      kindReason: part.map((x) => kindsOf.get(x).reason).find(Boolean) || '',
      ...workflowOf(g, kind, plan),
      reason: String(g.reason || ''),
      ...(g.mode_reason ? { modeReason: String(g.mode_reason) } : {}),
      ...poChosen.reasonsField(g.input_reasons),
      files: (g.files || []).map(String).slice(0, 20),
      stage: Number.isInteger(g.stage) && g.stage > 0 ? g.stage : n + 1,
      ...size,
      warnings: [...new Set([...size.warnings, ...(g.warnings || []).map(String)])],
      ...(suggested.length ? { suggested } : {}),
      ...simulatedField(g, part, plan),
    };
  });
}

// a plan turn's prompt section on the project's workflow of each kind of issue, and the one-kind-per-group rule
function kindsSection(workflowKinds, planMode) {
  if (!planMode) return '';
  const line = (kind) => {
    const e = workflowKinds?.[kind];
    if (!e?.name) return `- ${kind}: the default workflow`;
    const inputs = Object.entries(e.inputs || {}).map(([k, v]) => `${k}: ${v}`).join(', ');
    return `- ${kind}: ${DefaultWorkflow.label(e.name)}.yaml${inputs ? ` (${inputs})` : ''}`;
  };
  return [
    '## The project\'s workflow of each kind of issue',
    'Classify every issue of a group in `issue_kinds` ({ issue, kind, reason }: `feature`, `fix` or `refactor`, the reason one line). A `bug` label suggests fix and a `refactor` label suggests refactor, but the issue\'s content decides when a label is missing or wrong. A group holds issues of one kind only (a Fix and a Feature never share a run; groups of different kinds may share a stage), and runs on that kind\'s workflow and inputs, which the orchestrator sets from these:',
    line('feature'),
    line('fix'),
    '- refactor: the Feature workflow',
  ].join('\n');
}

module.exports = {
  kindGroups,
  kindOf,
  kindsSection,
};
