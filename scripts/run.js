// Runs a workflow from the terminal (without Electron).
//
//   node scripts/run.js --task "..." [--repo <path>] [--file <yaml>] [--mock] [--auto-approve] [--input key=value]
//                       [--attach key=<image file>]
//
// --attach: an image attached to an input (#129; repeat it for several), e.g. --attach task=C:/shots/bug.png.
// --file: an absolute path is used as is; a name or relative path is looked up in <workspace>/workflows
// first, then in the workflows bundled with the app (workflows/ in this repository).
// --auto-approve approves every human gate (use with care outside mock mode); an agent's question
// (#567) gets the agent's default.
// --mock-ask <step>: in mock mode, that ask_human step asks the owner once (mockSequences.needs_human).
// --project <id> (#735): the workspace project the run is for (else the one whose folder is --repo):
// its run defaults (packages/engine/domains/project/project-run-defaults.js) fill the inputs not given.
// Settings apply like in an app run (#862): memory guard, idle warning, models, fallbacks, accounts,
// language and test workers come from packages/engine/engine/run-settings.js, shared with the app.
// #7: the run owns its folder like an app run: runs/<id>/owner.json (pid, host, heartbeat), removed
// when it ends, so the app sees it as running and never resumes it (nor reuses its worktree) meanwhile.
// Exits with code 0 if the workflow succeeds, 1 otherwise.

require('@craftorio/engine/domains/workspace/legacy-env'); // MULTIAGENT_* → CRAFTORIO_* for scripts and shells written before the rename (T2b)
const path = require('path');
const { aliasInputs } = require('@craftorio/shared/default-workflow');
const { WorkflowRun } = require('@craftorio/engine/engine/workflow');
const { Recorder } = require('@craftorio/engine/engine/recorder');
const { runOptionsFromSettings } = require('@craftorio/engine/engine/run-settings');
const runOwner = require('@craftorio/engine/domains/run/run-owner');
const {
  readSettings,
  resolveWorkspace,
  setupWorkspace,
} = require('@craftorio/engine/domains/workspace/workspace');
const usage = require('@craftorio/engine/domains/usage/usage');
const { resolveCommand } = require('@craftorio/engine/engine/providers');
const {
  BUNDLED_WORKFLOWS_DIR,
  isBundledWorkflowFile,
  resolveWorkflow,
  seedWorkflows,
} = require('@craftorio/engine/domains/workflow/workflows');
const { seedSkills } = require('@craftorio/engine/domains/agents/skills');
const {
  listProjects,
  readProject,
} = require('@craftorio/engine/domains/project/projects');
const {
  resolveRunInputs,
  runDefaultsWith,
  savedProfile,
} = require('@craftorio/engine/domains/project/project-run-defaults');
const { seedsRoot } = require('@craftorio/engine/service/seed-runs');
const { loadWorkflow } = require('@craftorio/engine/engine/workflow');

const root = path.join(__dirname, '..');

function parseArgs(argv) {
  const a = { inputs: {}, attachments: {}, mock: false, autoApprove: false, file: 'feature.yaml' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--mock') a.mock = true;
    else if (k === '--auto-approve') a.autoApprove = true;
    else if (k === '--mock-ask') (a.mockAsks ??= {})[next()] = 1;
    else if (k === '--file') a.file = next();
    else if (k === '--task') a.inputs.task = next();
    else if (k === '--repo') a.inputs.repo_path = next();
    else if (k === '--project') a.project = next();
    else if (k === '--input') { const [key, ...v] = next().split('='); a.inputs[key] = v.join('='); }
    else if (k === '--attach') { const [key, ...v] = next().split('='); (a.attachments[key] ??= []).push(v.join('=')); }
    else throw new Error(`Unknown argument: ${k}`);
  }
  return a;
}

// #735: the workspace project of --project <id>, else the one whose folder is --repo; null: none
function projectFor(projectsDir, id, repoPath) {
  const same = (a, b) => !!a && !!b && (process.platform === 'win32' ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));
  if (id) return readProject(projectsDir, id);
  try { return listProjects(projectsDir).find((p) => same(p.folder, repoPath)) || null; } catch { return null; }
}

// #735: the project's run defaults fill the inputs the command line left out, before the workflow's
// own defaults (resolveRunInputs: typed > project > workflow; the engine fills the workflow's)
function withProjectDefaults(file, typed, project) {
  if (!project) return typed;
  const wf = loadWorkflow(file);
  const defaults = runDefaultsWith({ project, profile: savedProfile(seedsRoot({ ws }), project.id) });
  const { values, sources } = resolveRunInputs({ typed, project: defaults, workflow: wf });
  const inputs = { ...typed };
  for (const [k, v] of Object.entries(values)) if (sources[k] === 'project') inputs[k] = v;
  return inputs;
}

const args = parseArgs(process.argv.slice(2));
// Same workspace as the app (CRAFTORIO_WORKSPACE > registered path > ~/craftorio-workspace, or ~/multiagent-workspace from before the rename).
// With no interactive terminal, creates the default folder if none exists. An agent's check
// (CRAFTORIO_SIMULATION_ONLY=1) gets its run's scratch workspace or a temporary one, never the owner's (#120).
const found = resolveWorkspace();
const ws = setupWorkspace(found.dir || found.fallback, { persist: found.source !== 'env' && found.source !== 'simulation', check: false });
// Same defaults as the app: bundled skills and workflows are seeded into the workspace.
seedSkills(path.join(root, 'skills'), ws.skills);
seedWorkflows(BUNDLED_WORKFLOWS_DIR, ws.workflows);
const wfFile = resolveWorkflow(args.file, [ws.workflows, BUNDLED_WORKFLOWS_DIR]);
if (wfFile.fallback) console.warn(`workflow ${args.file} is not in ${ws.workflows}; using the bundled copy ${wfFile.file}`);
const project = projectFor(ws.projects, args.project, args.inputs.repo_path);
args.inputs.repo_path ??= project?.folder || root;
const settings = readSettings(ws);
const needsLocal = Object.values(settings.budgets || {}).some((b) => b?.countOutside);
const budget = usage.budgetBaseline({ runsDir: ws.runs, settings, local: needsLocal ? require('@craftorio/engine/domains/local/local-usage').readLocalUsage() : null });
const run = new WorkflowRun({
  file: wfFile.file,
  // #630: an old workflow name brings its variant's inputs, under the given ones (an old
  // `mode: validated` is the validation, so the alias's mode stays)
  // #735: then the project's run defaults
  inputs: withProjectDefaults(wfFile.file, aliasInputs(wfFile, args.inputs || {}), project),
  attachments: args.attachments,
  mock: args.mock,
  ...(args.mock && args.mockAsks ? { mockSequences: { needs_human: args.mockAsks } } : {}),
  runsDir: ws.runs,
  skillsDirs: [ws.skills],
  budget,
  prices: settings.prices,
  // #862: the options Settings give an app run too (memory guard, idle warning, models, fallbacks,
  // accounts, language, test workers)
  ...runOptionsFromSettings({ settings, ws, mock: args.mock }),
  // #97: a bundled default follows the chosen orchestrator AI (settings.orchestratorProvider)
  bundledWorkflow: isBundledWorkflowFile(wfFile.file, ws.workflows),
  // orchestrator.worktree: one git worktree per run in <workspace>/worktrees (never in simulation)
  worktreesDir: args.mock ? null : ws.worktrees,
});
if (!args.mock) {
  const problems = usage.preflight(run.wf, budget, resolveCommand, run.inputs);
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
}
const rec = new Recorder(run.runDir, run.wf.observability?.capture?.redact);
// #7: owner.json and its heartbeat, as the app's service/areas/runs.js claims a run; child runs are
// followed through the parent, like in the app
const owner = runOwner.claimRun(run.runDir);

const t = () => new Date().toLocaleTimeString('en-US');
const short = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);
// --auto-approve: with choices, the first option; an agent's question (#567), the agent's default
const autoAnswer = (ev) => (ev.choices ? (ev.by === 'agent' && ev.default) || ev.choices[0].id : true);

run.on('event', (ev) => {
  rec.write(ev);
  switch (ev.type) {
    case 'step.started': console.log(`${t()} ▶ ${ev.step_id} (visit ${ev.visit})`); break;
    case 'step.finished': console.log(`${t()}   ✓ ${ev.step_id}: ${short(JSON.stringify(ev.output), 300)}`); break;
    case 'step.transition': console.log(`${t()}   → ${ev.to}   [${ev.when}]`); break;
    case 'file.saved': console.log(`${t()}   💾 ${ev.step_id}${ev.agent ? ` (${ev.agent})` : ''} → ${ev.path}`); break;
    case 'supervisor.decision': console.log(`${t()}   ◆ supervisor on ${ev.step_id}: ${ev.action}${ev.goto ? ' → ' + ev.goto : ''} — ${short(ev.explanation, 300)}`); break;
    case 'decision.logged': console.log(`${t()}   📝 ${ev.agent}: ${ev.count} decision(s) → ${ev.path}`); break;
    case 'step.waiting': console.log(`${t()}   ⏳ /loop: next check in ${Math.round(ev.interval_ms / 1000)}s`); break;
    case 'step.probe': console.log(`${t()}   🔎 ${ev.step_id} check (${ev.probe}): ${short(ev.detail, 200)} → ${{ poll: 'no agent turn', output: 'step finished', agent: 'calling the agent' }[ev.action] || ev.action}`); break;
    case 'step.goal': console.log(`${t()}   🎯 /goal ${ev.met ? 'met' : 'not met yet'}: ${ev.goal} (iteration ${ev.iteration})`); break;
    case 'session.opened': console.log(`${t()}   + session ${ev.session_id} ${ev.session.agent} (${ev.session.provider}/${ev.session.model})`); break;
    case 'session.closed': console.log(`${t()}   - session ${ev.session_id} ${ev.status}`); break;
    case 'session.stream':
      if (ev.item.kind === 'tool_call') console.log(`${t()}     [${ev.session_id}] tool ${ev.item.name}: ${short(ev.item.input?.command ?? JSON.stringify(ev.item.input), 120)}`);
      break;
    case 'session.message_received':
      console.log(`${t()}     [${ev.session_id}] turn ${ev.turn} ok in ${Math.round(ev.duration_ms / 1000)}s · in ${ev.usage.input} · cache ${ev.usage.cache_read} · out ${ev.usage.output}${ev.cost_usd != null ? ` · US$ ${ev.cost_usd.toFixed(4)}` : ''}`);
      break;
    case 'action.executed': console.log(`${t()}   $ ${ev.command} → ${ev.skipped ? 'skipped (mock)' : 'exit ' + ev.exit_code}\n${short(ev.output, 400)}`); break;
    case 'approval.requested':
      console.log(`${t()}   ? ${short(ev.message, 200)}${ev.choices ? `  [${ev.choices.map((c) => c.id).join(' | ')}]` : ''}`);
      if (args.autoApprove) {
        const answer = autoAnswer(ev);
        console.log(`${t()}     → ${ev.choices ? `chose "${answer}"` : 'approved'} automatically (--auto-approve)`);
        // answered as 'auto': a `ship:` transition (#260) only follows the owner's own answer
        setTimeout(() => run.resolveApproval(ev.approval_id, answer, 'auto'), 200);
      } else {
        console.log('     waiting for approval: use the UI or run with --auto-approve');
      }
      break;
    case 'log': console.log(`${t()}   [${ev.level}] ${short(ev.message, 400)}`); break;
    case 'workflow.finished':
      console.log(`\n■ ${ev.status}${ev.error ? ': ' + ev.error : ''}`);
      console.log(`  duration: ${Math.round(ev.summary.duration_ms / 1000)}s · tokens: ${JSON.stringify(ev.summary.tokens)} · cost: US$ ${ev.summary.cost_usd}`);
      console.log(`  run saved to ${run.runDir}`);
      process.exitCode = ev.status === 'success' ? 0 : 1;
      owner.release();
      break;
  }
});

// child runs of a `type: workflow` step (#174): recorded in their own folder, their gates answered
// like the parent's (--auto-approve) or left waiting
run.on('child', function followChild(child) {
  const childRec = new Recorder(child.runDir, child.wf.observability?.capture?.redact);
  const tag = `[child ${child.runId}]`;
  child.on('child', followChild);
  child.on('event', (ev) => {
    childRec.write(ev);
    if (ev.type === 'step.started') console.log(`${t()}   ${tag} ▶ ${ev.step_id}`);
    if (ev.type === 'approval.requested') {
      console.log(`${t()}   ${tag} ? ${short(ev.message, 200)}`);
      if (args.autoApprove) setTimeout(() => child.resolveApproval(ev.approval_id, ev.choices ? ev.choices[0].id : true, 'auto'), 200);
      else console.log('     waiting for approval: use the UI or run with --auto-approve');
    }
    if (ev.type === 'workflow.finished') console.log(`${t()}   ${tag} ■ ${ev.status}${ev.error ? ': ' + ev.error : ''} (${child.runDir})`);
  });
});

process.on('SIGINT', () => run.stop());
run.start();
