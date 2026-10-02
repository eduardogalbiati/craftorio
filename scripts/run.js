// Runs a workflow from the terminal (without Electron).
//
//   node scripts/run.js --task "..." [--repo <path>] [--file <yaml>] [--mock] [--auto-approve] [--input key=value]
//                       [--attach key=<image file>]
//
// --attach: an image attached to an input (#129; repeat it for several), e.g. --attach task=C:/shots/bug.png.
// --file: an absolute path is used as is; a name or relative path is looked up in <workspace>/workflows
// first, then in the workflows bundled with the app (workflows/ in this repository).
// --auto-approve approves every human gate (use with care outside mock mode).
// Exits with code 0 if the workflow succeeds, 1 otherwise.

const path = require('path');
const { WorkflowRun } = require('../src/engine/workflow');
const { Recorder } = require('../src/engine/recorder');
const { resolveWorkspace, setupWorkspace, readSettings } = require('../src/workspace');
const usage = require('../src/usage');
const { resolveCommand } = require('../src/engine/providers');
const { BUNDLED_WORKFLOWS_DIR, seedWorkflows, resolveWorkflow } = require('../src/workflows');
const { seedSkills } = require('../src/skills');

const root = path.join(__dirname, '..');

function parseArgs(argv) {
  const a = { inputs: {}, attachments: {}, mock: false, autoApprove: false, file: 'software-development.yaml' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const next = () => argv[++i];
    if (k === '--mock') a.mock = true;
    else if (k === '--auto-approve') a.autoApprove = true;
    else if (k === '--file') a.file = next();
    else if (k === '--task') a.inputs.task = next();
    else if (k === '--repo') a.inputs.repo_path = next();
    else if (k === '--input') { const [key, ...v] = next().split('='); a.inputs[key] = v.join('='); }
    else if (k === '--attach') { const [key, ...v] = next().split('='); (a.attachments[key] ??= []).push(v.join('=')); }
    else throw new Error(`Unknown argument: ${k}`);
  }
  a.inputs.repo_path ??= root;
  return a;
}

const args = parseArgs(process.argv.slice(2));
// Same workspace as the app (MULTIAGENT_WORKSPACE > registered path > ~/multiagent-workspace).
// With no interactive terminal, creates the default folder if none exists. An agent's check
// (MULTIAGENT_SIMULATION_ONLY=1) gets its run's scratch workspace or a temporary one, never the owner's (#120).
const found = resolveWorkspace();
const ws = setupWorkspace(found.dir || found.fallback, { persist: found.source !== 'env' && found.source !== 'simulation' });
// Same defaults as the app: bundled skills and workflows are seeded into the workspace.
seedSkills(path.join(root, 'skills'), ws.skills);
seedWorkflows(BUNDLED_WORKFLOWS_DIR, ws.workflows);
const wfFile = resolveWorkflow(args.file, [ws.workflows, BUNDLED_WORKFLOWS_DIR]);
if (wfFile.fallback) console.warn(`workflow ${args.file} is not in ${ws.workflows}; using the bundled copy ${wfFile.file}`);
const settings = readSettings(ws);
const needsLocal = Object.values(settings.budgets || {}).some((b) => b?.countOutside);
const budget = usage.budgetBaseline({ runsDir: ws.runs, settings, local: needsLocal ? require('../src/local-usage').readLocalUsage() : null });
const run = new WorkflowRun({
  file: wfFile.file,
  inputs: args.inputs,
  attachments: args.attachments,
  mock: args.mock,
  runsDir: ws.runs,
  skillsDirs: [ws.skills],
  budget,
  prices: settings.prices,
  // orchestrator.worktree: one git worktree per run in <workspace>/worktrees (never in simulation)
  worktreesDir: args.mock ? null : ws.worktrees,
});
if (!args.mock) {
  const problems = usage.preflight(run.wf, budget, resolveCommand, run.inputs);
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
}
const rec = new Recorder(run.runDir, run.wf.observability?.capture?.redact);

const t = () => new Date().toLocaleTimeString('en-US');
const short = (s, n = 160) => String(s ?? '').replace(/\s+/g, ' ').slice(0, n);

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
        // with choices, picks the first option
        const answer = ev.choices ? ev.choices[0].id : true;
        console.log(`${t()}     → ${ev.choices ? `chose "${answer}"` : 'approved'} automatically (--auto-approve)`);
        setTimeout(() => run.resolveApproval(ev.approval_id, answer), 200);
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
      break;
  }
});

process.on('SIGINT', () => run.stop());
run.start();
