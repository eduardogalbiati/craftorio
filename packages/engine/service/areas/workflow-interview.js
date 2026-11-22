// Service area (#487): the Ways of working interview of a project. workflowInterview runs the
// ways-of-working analysis seed (seeds/ways-of-working/seed.md, one read-only Oracle turn through
// packages/engine/service/seed-runs.js, the same run the Architecture tab's seeds:run makes: saved under
// <workspace>/architecture/, so seeds:estimate, seeds:list and seeds:history see it, and refused as
// busy while that seed already runs on the project) and answers its profile, the evidence behind each
// field and the questions the profile leaves open (packages/engine/domains/workflow/workflow-compose.js openQuestions).
// #640: the free profile is always read first from the project's git history (authors, merges) and files
// (test and check commands, languages); the model only fills the fields it leaves null (the release
// style), and the fields git settles keep git's value. Under CRAFTORIO_SIMULATION_ONLY, or with no
// field left open, no model is called (the seed's simulated run is saved) and the open fields stay open.
// workflowCompose builds the workflow set from the last profile and the owner's answers, its manifest
// merged into the repository's .craftorio/project.yaml; only with write: true are the files written to
// the project's .craftorio/ (never committed: the owner commits) and the project's set updated.
// #733: workflowInterviewLast reads the last saved run (the onboarding's profile job is the same
// interview) without running anything; workflowInterviewState is the running seed's state (seed-runs.js
// runState) the drawer's loader polls.
// #781: workflowInterviewState also says the interview's phases, what the wizard's activity lines read:
// phases: { git: { status, found: { commits, merges, tags, authors } }, files: { status, found: { languages,
// testCommand, ci } }, oracle: { status, since, reading } }; status: pending | running | done | failed | not-needed
// (oracle only: no model turn). Kept in this engine until the next interview; absent before the first one.
// #844: the free profile tells the truth: authors are people (identities with one name or one e-mail merged),
// the mode is weighed by who merges (outside pull requests merged by an owner who pushes straight to main are a
// local flow), and a repository with no test command and no test file has tests 'none'.

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
const { detectE2eCommand, projectFacts } = require('../../domains/project/project-run-defaults');
const { detectTestCommand } = require('../../engine/suite-step');
const { firstBuild } = require('@craftorio/shared/default-workflow');
const { loadWorkflow } = require('../../engine/workflow');
const {
  MANIFEST_FILE,
  projectDirOf,
  readManifest,
} = require('../../domains/project/project-manifest');
const { inProjectDir } = require('@craftorio/shared/project-dir');
const { TESTS_PATHS, globMatcher } = require('@craftorio/shared/globs');
const { clientError } = require('../common');

const SEED_ID = 'ways-of-working';
const { git } = seedRuns;
const count = (out) => (out == null ? 0 : out.split('\n').filter((l) => l.trim()).length);

const readText = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

// #630: what the project's CI checks: none (no CI files), release (main or tags only), pr+release
// (pull or merge requests too)
function ciOf(folder) {
  const dir = path.join(folder, '.github', 'workflows');
  let text = readText(path.join(folder, '.gitlab-ci.yml'));
  let found = !!text;
  try { for (const f of fs.readdirSync(dir)) { found = true; text += readText(path.join(dir, f)); } } catch { /* no GitHub workflows */ }
  if (!found) return 'none';
  return /pull_request|merge_request/.test(text) ? 'pr+release' : 'release';
}

const str = (v) => (v == null ? '' : String(v).trim());
// `git shortlog -sne` lines ("  6\tName <e-mail>") → [{ identity, n }]
const shortlogOf = (out) => String(out || '').split('\n').map((l) => /^\s*(\d+)\s+(.*)$/.exec(l)).filter(Boolean).map((m) => ({ identity: str(m[2]), n: Number(m[1]) }));

// #844: the people behind git identities ("Name <e-mail>"): identities with the same name (any case) or the
// same e-mail are one person → { personOf: Map(identity → person id), count, identities }
function peopleOf(identities) {
  const list = [...new Set(identities)];
  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const seen = new Map(); // a name or an e-mail → its first identity
  list.forEach((identity, i) => {
    const m = /^(.*?)\s*<([^>]*)>$/.exec(identity) || [identity, identity, ''];
    for (const k of [`n:${str(m[1]).toLowerCase()}`, `e:${str(m[2]).toLowerCase()}`]) {
      if (k.length <= 2) continue;
      if (seen.has(k)) parent[find(i)] = find(seen.get(k)); else seen.set(k, i);
    }
  });
  const personOf = new Map(list.map((identity, i) => [identity, find(i)]));
  return { personOf, count: new Set(personOf.values()).size, identities: list.length };
}

// #844: how changes land, weighed by who merges: merges whose mergers also push straight to main (first-parent
// commits that are not merges, the root commit left out) at least as often as they merge are outside pull
// requests on a local flow, not the owner's pull requests
function landingOf({ merges, mergers, straight, root, personOf }) {
  if (!merges) return { mode: 'local', ownerStraightCommits: 0 };
  const mergedBy = new Set(mergers.map((x) => personOf.get(x.identity)));
  const own = straight.filter((x) => mergedBy.has(personOf.get(x.identity))).reduce((sum, x) => sum + x.n, 0)
    - (mergedBy.has(personOf.get(str(root))) ? 1 : 0);
  return { mode: own >= merges ? 'local' : 'remote', ownerStraightCommits: Math.max(0, own) };
}

// #844: any tracked file a test pattern matches (packages/shared/globs.js TESTS_PATHS)
const TEST_FILE = TESTS_PATHS.map(globMatcher);
const hasTestFiles = (files) => String(files || '').split('\n').some((f) => f && TEST_FILE.some((m) => m.test(f)));

// The profile of a simulated analysis: what git and the project's files tell without a model; no release style.
// #781: onGit({ commits, merges, tags, authors }) once git answered, before the files are read
async function simulatedProfile(project, onGit = null) {
  const folder = project.folder;
  const [authors, merges, commits, tags, head, mergers, straight, root, files] = await Promise.all([
    git(folder, ['shortlog', '-sne', 'HEAD']),
    git(folder, ['rev-list', '--merges', '--count', 'HEAD']),
    git(folder, ['rev-list', '--count', 'HEAD']),
    git(folder, ['tag', '--list']),
    git(folder, ['rev-parse', '--short', 'HEAD']),
    git(folder, ['shortlog', '-sne', '--merges', 'HEAD']),
    git(folder, ['shortlog', '-sne', '--first-parent', '--no-merges', 'HEAD']),
    git(folder, ['log', '-1', '--max-parents=0', '--format=%aN <%aE>', 'HEAD']),
    git(folder, ['ls-files']),
  ]);
  const authorList = shortlogOf(authors);
  const team = peopleOf(authorList.map((x) => x.identity));
  const nAuthors = team.count;
  const nMerges = Number(merges) || 0;
  const landing = landingOf({ merges: nMerges, mergers: shortlogOf(mergers), straight: shortlogOf(straight), root, personOf: team.personOf });
  const shas = head ? [head] : [];
  onGit?.({ commits: Number(commits) || 0, merges: nMerges, tags: count(tags), authors: nAuthors });
  const e2eCommand = detectE2eCommand(folder);
  const testCommand = detectTestCommand(folder);
  // #844: no test command and no test file: no tests, never an invented unit style
  // (a file list git could not give, null, is not taken as no test file)
  const noTests = !testCommand && !e2eCommand && files != null && !hasTestFiles(files);
  return {
    // #630: the ways of working the set is composed from (mode, ci, tests, e2eCommand); who works on it
    // and how it merged stay in the evidence (`team`, `merge`), as the seed says
    profile: {
      mode: landing.mode,
      release: null,
      testCommand,
      checkCommand: checkCommand(folder),
      ci: ciOf(folder),
      tests: e2eCommand ? 'unit+e2e' : noTests ? 'none' : 'unit',
      e2eCommand,
      languages: (detectLanguage(folder) || '').split(',').filter(Boolean),
      // #735: backend / frontend / full-stack, from the UI folders, web frameworks and servers found
      kind: projectFacts(folder).kind,
    },
    evidence: {
      // #844: authors are people, their git identities apart
      team: { numbers: { authors: nAuthors, identities: team.identities, commits: Number(commits) || 0 }, commits: shas },
      merge: { numbers: { mergeCommits: nMerges }, commits: shas },
      mode: { numbers: { authors: nAuthors, mergeCommits: nMerges, ownerStraightCommits: landing.ownerStraightCommits }, commits: shas },
      release: { numbers: { tags: count(tags) }, commits: [] },
    },
    simulated: true,
  };
}

// #640: a field git could not settle (null, or no language found)
const open = (v) => v == null || (Array.isArray(v) && !v.length);

// #630: evidence only, never a profile field (an older seed's answer may still give them)
const EVIDENCE_ONLY = ['merge', 'team'];

// #640: the free profile with the model's answer only in the fields the free one leaves open
function mergeProfile(free, model) {
  const profile = { ...free.profile };
  const evidence = { ...free.evidence };
  for (const k of new Set([...Object.keys(free.profile), ...Object.keys(model.profile)])) {
    if (EVIDENCE_ONLY.includes(k) || !open(free.profile[k]) || open(model.profile[k])) continue;
    profile[k] = model.profile[k];
    if (model.evidence?.[k]) evidence[k] = model.evidence[k];
  }
  return { profile, evidence, simulated: false };
}

module.exports = (ctx) => {
  const root = () => seedRuns.seedsRoot(ctx);
  const projectOf = (projectId) => seedRuns.projectOf(ctx, projectId);
  const phases = new Map(); // #781: project id → its last interview's phases

  // #781: a new interview's phases; one refused as busy leaves the running interview's alone
  function startPhases(p) {
    const at = { git: { status: 'running' }, files: { status: 'pending' }, oracle: { status: 'pending' } };
    if (!seedRuns.runState(ctx, p, SEED_ID).running) phases.set(p.id, at);
    return at;
  }

  // the last ways-of-working run's { profile, evidence } over the free profile (`free`: already read), or null
  async function lastProfile(p, free = null) {
    const last = oracleSeeds.listSeedRuns(root(), p.id, SEED_ID)[0];
    if (!last) return null;
    const saved = oracleSeeds.readSeedRun(root(), p.id, SEED_ID, last.date);
    const model = saved?.model || {};
    if (model.profile && typeof model.profile === 'object') return mergeProfile(free || await simulatedProfile(p), { profile: model.profile, evidence: model.evidence || {} });
    return model.simulated ? free || simulatedProfile(p) : null;
  }

  /** Runs the analysis → { profile, evidence, questions, simulated }, or { refused } (busy, or the Oracle's budget). */
  async function workflowInterview({ projectId }) {
    const p = projectOf(projectId);
    const seed = seeds.readSeed(ctx.ws.seeds, SEED_ID);
    if (!seed) throw clientError(`The analysis seed ${SEED_ID} is missing from the workspace.`);
    const at = startPhases(p);
    try {
      const free = await simulatedProfile(p, (found) => {
        at.git = { status: 'done', found };
        at.files = { status: 'running' };
      });
      const { languages, testCommand, ci } = free.profile;
      at.files = { status: 'done', found: { languages, testCommand, ci } };
      const ask = !simulation.simulationOnly() && Object.values(free.profile).some(open);
      at.oracle = { status: ask ? 'running' : 'not-needed' };
      const out = await seedRuns.runSeed(ctx, { project: p, seed, mock: !ask });
      if (out.refused) {
        at.oracle = { status: 'failed' };
        return { refused: out.refused };
      }
      const found = await lastProfile(p, free);
      if (!found) throw new Error(`The ${SEED_ID} analysis answered no profile.`);
      if (ask) at.oracle = { status: 'done' };
      return { ...found, questions: compose.openQuestions(found.profile) };
    } catch (e) {
      // the phase it stopped at: the first one not ended
      const stopped = ['git', 'files'].find((id) => at[id].status === 'running') || 'oracle';
      at[stopped] = { status: 'failed' };
      throw e;
    }
  }

  /** #733: the last saved run → { profile, evidence, questions, simulated, date, costUsd }, or null; runs nothing. */
  async function workflowInterviewLast({ projectId }) {
    const p = projectOf(projectId);
    const last = oracleSeeds.listSeedRuns(root(), p.id, SEED_ID)[0];
    if (!last) return null;
    const found = await lastProfile(p);
    if (!found) return null;
    return { ...found, questions: compose.openQuestions(found.profile), date: last.at || null, costUsd: last.costUsd ?? null };
  }

  /** #733: the interview in progress on the project → { running: { since, items, last } | null, error }; #781: and its phases, see the header. */
  async function workflowInterviewState({ projectId }) {
    const p = projectOf(projectId);
    const state = seedRuns.runState(ctx, p, SEED_ID);
    const at = phases.get(p.id);
    if (!at) return state;
    const { running } = state;
    const oracle = at.oracle.status === 'running' && running ? { status: 'running', since: running.since, reading: running.last } : at.oracle;
    return { ...state, phases: { ...at, oracle } };
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
    const dir = projectDirOf(p.folder);
    for (const f of [...set.workflows, set.manifest]) {
      const file = path.join(p.folder, ...inProjectDir(f.path, dir).split('/'));
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
    workflowInterviewLast,
    workflowInterviewState,
  };
};
