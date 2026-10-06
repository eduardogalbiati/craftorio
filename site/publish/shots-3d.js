// The full page's two 3D stills (site/img/flow-3d.png, supervisor-3d.png): one simulated
// software-development run whose verify_change step fails three times (the supervisor is called),
// cut at two moments and captured in the run's 3D view as if it were live then.
// Usage: node site/publish/shots-3d.js [<out dir>]   (default site/img; needs `npm run build:3d`)
// Steps: scripts/run.js --mock with the scenario (a simulation-only scratch workspace, never the
// owner's), then each copy of the run keeps the events up to its moment with their times stretched
// (x20: a two-minute simulation reads as the better part of an hour), and scripts/screenshot.js
// --view run-chat --run <copy> --click "#rc-3d" captures it (a copy without summary.json shows live).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const out = path.resolve(process.argv[2] || path.join(root, 'site', 'img'));
const TASK = 'Add a /health endpoint to the API server that reports the version and the database status';
const FACTOR = 20;

function sh(cmd, args, env = {}) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', env: { ...process.env, ...env }, windowsHide: true });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed:\n${(r.stderr || r.stdout || '').slice(-800)}`);
  return r.stdout;
}

// the simulated run (its folder is printed at the end)
const log = sh(process.execPath, ['scripts/run.js', '--mock', '--auto-approve', '--file', 'software-development.yaml', '--task', TASK,
  '--mock-sequences', JSON.stringify({ invalid_answers: { verify_change: 3 } })], { MULTIAGENT_SIMULATION_ONLY: '1' });
const run = (log.match(/run saved to (.+)/) || [])[1]?.trim();
if (!run) throw new Error('the simulated run did not report its folder');
const events = fs.readFileSync(path.join(run, 'events.jsonl'), 'utf8').split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const indexOf = (pred) => { const i = events.findIndex(pred); if (i < 0) throw new Error('moment not found'); return i; };
const after = (type, stepId) => events.find((e) => e.type === type && e.step_id === stepId)?.seq ?? Infinity;
const supervisorSession = events.find((e) => e.type === 'session.opened' && e.seq > after('supervisor.started', 'verify_change'))?.session_id;
const moments = {
  // the evidence agent at work, its first tool result in
  'flow-3d': { cut: indexOf((e) => e.seq > after('step.started', 'evidence') && e.type === 'session.stream' && e.item?.kind === 'tool_result'), clicks: ['#rc-3d'] },
  // the supervisor over verify_change, its first tool result in; the Events tab's newest row selects it
  'supervisor-3d': { cut: indexOf((e) => e.session_id === supervisorSession && e.type === 'session.stream' && e.item?.kind === 'tool_result'), clicks: ['#rc-3d', '.r3d-tabs button:nth-child(3)', '.r3d-scroll .r3d-ev:first-child'] },
};
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'site-3d-'));
try {
  for (const [name, { cut, clicks }] of Object.entries(moments)) {
    const kept = events.slice(0, cut + 1);
    const now = Date.now(), tCut = Date.parse(kept[kept.length - 1].ts);
    const dir = path.join(scratch, name, path.basename(run));
    fs.cpSync(run, dir, { recursive: true });
    fs.rmSync(path.join(dir, 'summary.json'), { force: true });
    fs.writeFileSync(path.join(dir, 'events.jsonl'), `${kept.map((e) => JSON.stringify({ ...e, ts: new Date(now - (tCut - Date.parse(e.ts)) * FACTOR).toISOString() })).join('\n')}\n`);
    const shot = sh(require('electron'), ['scripts/screenshot.js', '--view', 'run-chat', '--run', dir, ...clicks.flatMap((c) => ['--click', c]), '--wait', '9000', '--out', out, '--name', name]);
    console.log(shot.trim().split('\n').pop());
  }
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}
