// Service area (#487): the Ways of working interview of a project. workflowInterview runs the
// ways-of-working analysis seed (seeds/ways-of-working/seed.md, one read-only Oracle turn through
// src/service/seed-runs.js, the same run the Architecture tab's seeds:run makes: saved under
// <workspace>/architecture/, so seeds:estimate, seeds:list and seeds:history see it, and refused as
// busy while that seed already runs on the project) and answers its profile, the evidence behind each
// field and the questions the profile leaves open (src/domains/workflow/workflow-compose.js openQuestions). Under
// MULTIAGENT_SIMULATION_ONLY no model is called: the profile is read from the project's git history
// (authors, merges) and files (test and check commands, languages) and the release style is left open.
// workflowCompose builds the workflow set from the last profile and the owner's answers, its manifest
// merged into the repository's .multiagent/project.yaml; only with write: true are the files written to
// the project's .multiagent/ (never committed: the owner commits) and the project's set updated.

const fs = require('fs');
const os = require('os');
const path = require('path');
const builder = require('../../domains/workflow/workflow-builder');
const compose = require('../../domains/workflow/workflow-compose');
const oracleSeeds = require('../../domains/oracle/oracle-seeds');
const projects = require('../../domains/project/projects');
const seedRuns = require('../seed-runs');
const seeds = require('../../domains/seed/seeds');
const simulation = require('../../engine/simulation');
const { checkCommand } = require('../../engine/check-step');
const { detectLanguage } = require('../../domains/project/project-inputs');
const { detectTestCommand } = require('../../engine/suite-step');
const { firstBuild } = require('@multiagent/shared/default-workflow');
const { loadWorkflow } = require('../../engine/workflow');
const { MANIFEST_FILE, readManifest } = require('../../domains/project/project-manifest');
const { clientError } = require('../common');

const SEED_ID = 'ways-of-working';
const { git } = seedRuns;
const count = (out) => (out == null ? 0 : out.split('\n').filter((l) => l.trim()).length);

// The profile of a simulated analysis: what git and the project's files tell without a model; no release style
async function simulatedProfile(project) {
  const folder = project.folder;
  const [authors, merges, commits, tags, head] = await Promise.all([
    git(folder, ['shortlog', '-sne', 'HEAD']),
    git(folder, ['rev-list', '--merges', '--count', 'HEAD']),
    git(folder, ['rev-list', '--count', 'HEAD']),
    git(folder, ['tag', '--list']),
    git(folder, ['rev-parse', '--short', 'HEAD']),
  ]);
  const ci = fs.existsSync(path.join(folder, '.github', 'workflows')) ? 'github-actions' : fs.existsSync(path.join(folder, '.gitlab-ci.yml')) ? 'gitlab-ci' : null;
  const nAuthors = count(authors);
  const nMerges = Number(merges) || 0;
  const shas = head ? [head] : [];
  return {
    profile: {
      team: nAuthors > 1 ? 'team' : 'solo',
      merge: nMerges > 0 ? 'pr' : 'local',
      release: null,
      testCommand: detectTestCommand(folder),
      checkCommand: checkCommand(folder),
      ci,
      languages: (detectLanguage(folder) || '').split(',').filter(Boolean),
    },
    evidence: {
      team: { numbers: { authors: nAuthors, commits: Number(commits) || 0 }, commits: shas },
      merge: { numbers: { mergeCommits: nMerges }, commits: shas },
      release: { numbers: { tags: count(tags) }, commits: [] },
    },
    simulated: true,
  };
}

module.exports = (ctx) => {
  const root = () => seedRuns.seedsRoot(ctx);
  const projectOf = (projectId) => seedRuns.projectOf(ctx, projectId);

  // the last ways-of-working run's { profile, evidence }, or null
  async function lastProfile(p) {
    const last = oracleSeeds.listSeedRuns(root(), p.id, SEED_ID)[0];
    if (!last) return null;
    const saved = oracleSeeds.readSeedRun(root(), p.id, SEED_ID, last.date);
    const model = saved?.model || {};
    if (model.profile && typeof model.profile === 'object') return { profile: model.profile, evidence: model.evidence || {}, simulated: false };
    return model.simulated ? simulatedProfile(p) : null;
  }

  /** Runs the analysis → { profile, evidence, questions, simulated }, or { refused } (busy, or the Oracle's budget). */
  async function workflowInterview({ projectId }) {
    const p = projectOf(projectId);
    const seed = seeds.readSeed(ctx.ws.seeds, SEED_ID);
    if (!seed) throw clientError(`The analysis seed ${SEED_ID} is missing from the workspace.`);
    const out = await seedRuns.runSeed(ctx, { project: p, seed, mock: simulation.simulationOnly() });
    if (out.refused) return { refused: out.refused };
    const found = await lastProfile(p);
    if (!found) throw new Error(`The ${SEED_ID} analysis answered no profile.`);
    return { ...found, questions: compose.openQuestions(found.profile) };
  }

  // a composed workflow as the Builder edits it: { mode, spec } (checked by the engine's loader)
  function builderSpec(text) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wow-487-'));
    try {
      const file = path.join(dir, 'workflow.yaml');
      fs.writeFileSync(file, text);
      const doc = loadWorkflow(file);
      const drawn = builder.fromWorkflow(doc);
      return drawn.problems.length ? { mode: 'fixed', spec: builder.describeWorkflow(doc) } : { mode: 'full', spec: drawn.spec };
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  /**
   * The workflow set of the project's last profile under the answers: { workflows: [{ name, category,
   * path, yaml, mode, spec }], manifest: { path, yaml }, written }. The manifest keeps the repository's
   * other entries, version and requires (a manifest with errors is refused: the owner fixes it first).
   * write: the files go to the project's folder (uncommitted) and into the project's workflow set.
   */
  async function workflowCompose({ projectId, answers, write = false }) {
    const p = projectOf(projectId);
    const found = await lastProfile(p);
    if (!found) throw clientError('Run the Ways of working analysis first.');
    const existing = readManifest(p.folder);
    if (existing.errors.length) throw clientError(`Fix ${MANIFEST_FILE} first: ${existing.errors.join(' ')}`);
    const set = compose.composeWorkflowSet({ profile: found.profile, answers: answers || {}, existing });
    const workflows = set.workflows.map((w) => ({ ...w, ...builderSpec(w.yaml) }));
    if (!write) return { workflows, manifest: set.manifest, written: false };
    for (const f of [...set.workflows, set.manifest]) {
      const file = path.join(p.folder, ...f.path.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, f.yaml);
    }
    // the project's set: the composed workflows replace the ones of the same name
    const names = new Set(set.workflows.map((w) => w.name));
    const next = [...(p.workflows || []).filter((w) => !names.has(w.name)), ...set.workflows.map((w) => ({ name: w.name, origin: 'manifest', category: w.category }))];
    const project = projects.updateProject(ctx.ws.projects, p.id, { workflows: next, ...(p.defaultWorkflow ? {} : { defaultWorkflow: firstBuild(next) }) });
    return { workflows, manifest: set.manifest, written: true, project };
  }

  return {
    workflowCompose,
    workflowInterview,
  };
};
