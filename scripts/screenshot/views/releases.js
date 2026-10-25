// Screenshot seed of the Releases screen (--view releases, #260) and of the release flow other screens
// show: a local-hero run that merged #11 into the local main, not pushed yet (demoLocalMerge: the
// Backlog's "Merged locally" column, Project's run list, Home; the E2E suite seeds it too), the
// project's release history (demoReleases: the Backlog's "Released" badges, Discovery's committed
// cards, Home) and the release run of the roadmap's cut line (demoReleaseRun, --release, #291).

const fs = require('fs');
const path = require('path');
const { DEMO_ISSUES, DEMO_REPO, writeEvents } = require('../helpers');

// A local-hero run that merged #11 into the local main, not pushed yet (the Backlog's "Merged
// locally" column and Push bar): its summary and the project's cached push status. It started while
// GitHub could not be read (#168): its issue came from the last sync (the run list's "issue from cache").
function demoLocalMerge(ws, projectId) {
  const runId = '20260118-120000-demo0011';
  const commit = 'b7e4c2a91f0d3e5a6c8b9d0e1f2a3b4c5d6e7f80';
  fs.mkdirSync(path.join(ws.runs, runId), { recursive: true });
  fs.writeFileSync(path.join(ws.runs, runId, 'summary.json'), JSON.stringify({
    run_id: runId, workflow: 'software-development-local-hero', project_id: projectId, status: 'success', mock: false,
    started_at: '2026-01-18T12:00:00.000Z', finished_at: '2026-01-18T12:40:00.000Z', duration_ms: 2400000,
    issues: [{
      number: 11, url: `${DEMO_REPO}/issues/11`, title: DEMO_ISSUES.find((x) => x.number === 11).title,
      updatedAt: '2026-01-18T09:30:00.000Z', fallback: 'cache', cachedAt: '2026-01-18T11:52:00.000Z',
    }], inputs: {}, sessions: [],
    local_merge: { branch: 'fix/workspace-rename', base: 'main', commit },
  }, null, 2));
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.local.json`), JSON.stringify({
    base: 'main', ahead: 2, behind: 0, fetchError: null, error: null, checkedAt: new Date().toISOString(), issues: [11],
    commits: [
      { sha: commit, subject: 'Survive a renamed workspace folder', issues: [11] },
      { sha: 'a1c3e5f7092b4d6f8a0c2e4f6b8d0f1a3c5e7b9d', subject: 'Test the rename with a scratch workspace', issues: [] },
    ],
  }, null, 2));
}

// The project's release history (#260, src/domains/releases/releases.js): two shipped releases of closed issues, each
// with its runs, cost, both suites' counts and notes (the last one fixed a regression before Ship);
// the next release is what demoLocalMerge merged locally (#11). The Backlog shows #8 as Released.
function demoReleases(ws, projectId) {
  const dir = path.join(ws.root, 'releases');
  fs.mkdirSync(dir, { recursive: true });
  const title = (n) => DEMO_ISSUES.find((x) => x.number === n).title;
  fs.writeFileSync(path.join(dir, `${projectId}.json`), JSON.stringify({
    releases: [
      {
        version: 'v0.8', tag: 'v0.8', date: '2025-12-19T17:30:00.000Z', commit: '4f2a9c1d7e3b5a6088c1d2e3f4a5b6c7d8e9f001', base: 'main',
        issues: [{ number: 7, title: title(7) }], runs: ['20251219-160000-demo0007', '20251219-171500-rel00008'], cost: 3.12,
        tests: { unit: { status: 'pass', passed: 388, failed: 0 }, e2e: { status: 'pass', passed: 31, failed: 0 } },
        notes: '# v0.8\n\n- #7 Splash screen with the workspace name on start\n\n2 runs, $3.12.', status: 'shipped',
      },
      {
        version: 'v0.9', tag: 'v0.9', date: '2026-01-10T18:00:00.000Z', commit: 'c9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f4a3b2c1d0', base: 'main',
        issues: [{ number: 8, title: title(8) }],
        runs: ['20260109-210000-demo0008', '20260110-170000-rel00009'], cost: 6.84,
        tests: { unit: { status: 'pass', passed: 412, failed: 0 }, e2e: { status: 'pass', passed: 37, failed: 0 } },
        notes: '# v0.9\n\n- #8 Document the workflow YAML\n\nThe release run found a regression in the workflow loader (the unit suite was red once the YAML examples merged) and fixed it before Ship.\n\n2 runs, $6.84.',
        status: 'shipped',
      },
    ],
    next: { notes: '' },
  }, null, 2));
  // #290: v0.9's release run needed a fix, so it wrote the release summary its row links
  const runDir = path.join(ws.runs, '20260110-170000-rel00009');
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'release-summary.md'), [
    'Both suites are green after 2 unit rounds, 1 E2E round and 1 fix, in 38 minutes for US$ 1.12.',
    '',
    '## Timeline',
    '',
    '| # | Step | Result | Time | Cost |',
    '| --- | --- | --- | --- | --- |',
    '| 1 | Unit tests | red: 3 failures in test/workflows.test.js | 4 min | |',
    '| 2 | Fix the regression | 7b1e0c4: the workflow loader | 21 min | US$ 1.12 |',
    '| 3 | Unit tests | green (412) | 4 min | |',
    '| 4 | E2E scenarios | green (37) | 9 min | |',
    '',
    '## The fixes',
    '',
    '- **7b1e0c4** (src/engine/workflow.js, +6 −2): the loader read the YAML examples before #8 moved them. A regression of #7 by #8.',
    '',
    '## Before you ship',
    '',
    '- The diff to read: 1 file, 8 lines. Ship merges the fix, pushes the local main and tags it `v0.9`.',
    '- The version matches the tags (v0.8 before it).',
    '',
    '## Follow-ups',
    '',
    '- A unit test for the loader without the examples folder (the fix\'s test_notes).',
    '',
    'Nothing found against shipping.',
    '',
  ].join('\n'));
}

// #291 (--release checking | waiting | held | shipped): the release v0.10 of the demo roadmap's cut
// line, checked by a release run (unit tests twice around a fix, then E2E, then Ship): still checking
// (in E2E), waiting at its Ship gate (both live in "another app", studio-pc), held at Ship, or shipped
// (recorded in the history with stage 1's and tonight's done runs). Runs after demoRoadmap and
// demoReleases: the line takes the run.
function demoReleaseRun(ws, projectId, state) {
  if (!['checking', 'waiting', 'held', 'shipped'].includes(state)) throw new Error('--release takes checking | waiting | held | shipped');
  const runId = '20260120-233000-rel00010';
  const dir = path.join(ws.runs, runId);
  fs.mkdirSync(dir, { recursive: true });
  const groups = [{ name: 'Regression', steps: ['unit', 'e2e', 'suite_blocked'] }, { name: 'Fix', steps: ['fix', 'regression_failed'] }, { name: 'Ship', steps: ['ship', 'ship_failed'] }];
  const start = Date.now() - 50 * 6e4;
  const ev = (m, type, extra = {}) => ({ ts: new Date(start + m * 6e4).toISOString(), type, ...extra });
  const lines = [ev(0, 'workflow.started', { run_id: runId, workflow: 'release', file: 'release.yaml', project_id: projectId, mock: false, groups, inputs: { task: 'Check the release v0.10 of demo', version: 'v0.10' } })];
  // [step, start minute, end minute (null: still there)]
  const path_ = [['unit', 0, 8], ['fix', 8, 22], ['unit', 22, 30], ['e2e', 30, state === 'checking' ? null : 44], ...(state === 'checking' ? [] : [['ship', 44, state === 'waiting' ? null : 49]])];
  for (const [step, from, to] of path_) {
    lines.push(ev(from, 'step.started', { step_id: step, step_type: step === 'ship' ? 'human_approval' : step === 'fix' ? 'agent' : 'suite', ...(step === 'fix' ? { agent: 'developer' } : {}) }));
    if (step === 'fix') lines.push(ev(from + 0.1, 'session.opened', { session_id: 's-fix', session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }));
    if (step === 'fix') lines.push(ev(to - 0.1, 'session.message_received', { session_id: 's-fix', step_id: 'fix', cost_usd: 2.46, session: { agent: 'developer', provider: 'claude', model: 'claude-opus-5-5' } }));
    if (step === 'ship' && to == null) lines.push(ev(from + 0.2, 'approval.requested', { step_id: 'ship', approval_id: 'ship-1', message: 'Ship v0.10?' }));
    if (to != null) lines.push(ev(to, 'step.finished', { step_id: step, duration_ms: (to - from) * 6e4 }));
  }
  const ended = state === 'held' || state === 'shipped';
  if (ended) lines.push(ev(50, 'workflow.finished', { status: state === 'held' ? 'cancelled' : 'success', summary: { cost_usd: 2.46, duration_ms: 50 * 6e4 } }));
  writeEvents(dir, runId, lines);
  if (ended) {
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: runId, workflow: 'release', project_id: projectId, mock: false, groups, status: state === 'held' ? 'cancelled' : 'success', started_at: new Date(start).toISOString(),
      finished_at: new Date(start + 50 * 6e4).toISOString(), duration_ms: 50 * 6e4, inputs: { version: 'v0.10' }, sessions: [{ id: 's-fix', agent: 'developer', cost_usd: 2.46 }],
    }, null, 2));
  } else {
    // alive in another app (studio-pc) while the screenshot is taken
    const owner = { pid: 4242, host: 'studio-pc', role: 'run', started_at: new Date(start).toISOString() };
    const beat = () => { try { fs.writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ ...owner, heartbeat_at: new Date().toISOString() })); } catch { clearInterval(timer); } };
    const timer = setInterval(beat, 5000);
    timer.unref?.();
    beat();
  }
  const file = path.join(ws.backlog, `${projectId}.roadmap.json`);
  const roadmap = JSON.parse(fs.readFileSync(file, 'utf8'));
  const line = roadmap.stages.find((s) => s.release?.name === 'v0.10');
  if (line) line.release = { name: 'v0.10', status: { checking: 'running', waiting: 'running' }[state] || state, runId };
  fs.writeFileSync(file, JSON.stringify(roadmap, null, 2));
  if (state !== 'shipped') return;
  const history = path.join(ws.root, 'releases', `${projectId}.json`);
  const h = JSON.parse(fs.readFileSync(history, 'utf8'));
  const done = roadmap.stages.flatMap((s) => s.items).filter((x) => x.status === 'done' && x.runId);
  h.releases.push({
    version: 'v0.10', tag: 'v0.10', date: new Date(start + 50 * 6e4).toISOString(), commit: '69a8158e2d4c6b8a0f1e3d5c7b9a1f3e5d7c9b0a', base: 'main',
    issues: done.map((x) => ({ number: x.number, title: x.title })), runs: [...done.map((x) => x.runId), '20260120-221500-demo0099', runId], cost: 41.37,
    tests: { unit: { status: 'pass', passed: 431, failed: 0 }, e2e: { status: 'pass', passed: 39, failed: 0 } }, notes: '# v0.10', status: 'shipped',
  });
  fs.writeFileSync(history, JSON.stringify(h, null, 2));
}

function seed({ ws, project }) {
  demoLocalMerge(ws, project.id);
  demoReleases(ws, project.id);
}

module.exports = {
  demoLocalMerge,
  demoReleaseRun,
  demoReleases,
  seed,
};
