// Screenshot seed of Analytics (--view analytics, a tab of Home, #255): its tabs, 30 days of finished
// runs with Claude, Codex and Grok sessions, and per tab: a git repository of three nights of merges
// and a marker (performance, #159), from src/analytics-demo.js one AI Development run in depth (run,
// #228), 30 days of runs and nights (occupancy, #188) and the agents' turns (agents, #280).

const fs = require('fs');
const path = require('path');
const { gitRepo, writeEvents } = require('../helpers');

// Finished (not simulated) runs over the last 30 days with Claude, Codex and Grok sessions, so the
// Analytics screen has tokens per day, provider, model and project (mock runs are left out of it).
function demoAnalyticsRuns(ws, projectId) {
  const models = { claude: ['claude-opus-5-5', 'claude-sonnet-5'], codex: ['gpt-6-luna'], grok: ['grok-5-build'] };
  const statuses = ['success', 'success', 'success', 'failed', 'success', 'cancelled'];
  for (let i = 0; i < 18; i++) {
    const started = new Date(Date.now() - (i * 1.6 + 0.3) * 864e5);
    const runId = `${started.toISOString().slice(0, 10).replace(/-/g, '')}-1200${String(i).padStart(2, '0')}-demo${String(i).padStart(4, '0')}`;
    const sessions = ['claude', 'claude', 'codex', i % 3 ? null : 'grok'].filter(Boolean).map((provider, k) => {
      const scale = 1 + ((i * 7 + k * 3) % 5);
      return {
        id: `s${k}`, agent: ['developer', 'reviewer', 'tester', 'researcher'][k], provider, model: models[provider][k % models[provider].length], step_id: 'implement',
        opened_at: started.toISOString(), closed_at: new Date(started.getTime() + 6e5 * scale).toISOString(),
        duration_ms: 6e5 * scale, active_ms: 4e5 * scale, idle_ms: 2e5 * scale, turns: 3 * scale,
        tokens: { input: 4000 * scale, output: 9000 * scale, cache_read: 180000 * scale, cache_write: 12000 * scale, reasoning: 0 },
        cost_usd: provider === 'codex' ? 0 : +(0.35 * scale).toFixed(2), status: 'success', provider_session_id: `demo-${i}-${k}`,
      };
    });
    fs.mkdirSync(path.join(ws.runs, runId), { recursive: true });
    fs.writeFileSync(path.join(ws.runs, runId, 'summary.json'), JSON.stringify({
      run_id: runId, workflow: i % 2 ? 'software-development' : 'ai-arena', project_id: i % 4 ? projectId : null, status: statuses[i % statuses.length], mock: false,
      started_at: started.toISOString(), finished_at: new Date(started.getTime() + 36e5).toISOString(), duration_ms: 36e5,
      timing: { waiting_ms: 6e5 }, inputs: {}, sessions,
    }, null, 2));
  }
}

// Analytics › Repository performance (#159): the project's folder becomes a git repository and three
// nights of four parallel runs merge into it locally (one PR run whose `gh pr merge` failed), some
// through resolve_merge with the files their conflict named; the last night edits the shared files less,
// so a marker on its date shows the before/after difference.
function demoPerformanceRuns(ws, folder, projectId) {
  const git = gitRepo(folder);
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(folder, file)), { recursive: true }); fs.writeFileSync(path.join(folder, file), text); };
  const lines = (n, what) => Array.from({ length: n }, (_, i) => `${what} ${i + 1}`).join('\n') + '\n';
  git(['init', '-q', '-b', 'main']);
  write('src/renderer/index.html', lines(320, '<div>line'));
  write('README.md', `# demo-app\n\n<!-- generated:skills -->\n${lines(40, '| skill')}<!-- /generated:skills -->\n`);
  write('src/renderer/style.css', lines(900, '.rule'));
  write('src/service/manifest.js', lines(120, '// channel'));
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'Initial commit'], new Date(Date.now() - 20 * 864e5).toISOString());
  const initial = git(['rev-parse', 'HEAD']);
  const titles = ['Export the run report as PDF', 'Rename crash on Windows paths', 'Keyboard shortcuts for gates', 'Dark theme for the Backlog', 'Retry a failed step', 'Search in artifacts', 'Queue pause and resume', 'Cost per issue in Usage', 'Roadmap stage notes', 'Supervisor chat history', 'Workflow YAML validation', 'Per-project budgets'];
  const runs = [];
  [9, 5, 2].forEach((ago, night) => {
    const day = new Date(Date.now() - ago * 864e5);
    day.setHours(22, 0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const n = night * 4 + k;
      const start = new Date(day.getTime() + k * 25 * 6e4);
      const finish = new Date(start.getTime() + (95 + k * 20) * 6e4);
      const shared = night < 2 ? ['src/renderer/index.html', 'README.md', ...(k % 2 ? ['src/renderer/style.css'] : [])] : (k === 0 ? ['src/renderer/style.css'] : []);
      runs.push({
        n, start, finish, title: titles[n], pr: night === 1 && k === 3,
        files: [...shared, `src/features/${titles[n].toLowerCase().replace(/[^a-z]+/g, '-')}.js`, ...(k === 1 ? ['src/service/manifest.js'] : [])],
        conflict: night === 0 && k >= 2 ? 'resolve_merge' : night === 1 && k === 2 ? 'resolve_merge' : null,
        stage: `Stage ${night + 1}`,
      });
    }
  });
  const merged = []; // [finish, tip]
  for (const r of [...runs].sort((a, b) => a.finish - b.finish)) {
    const before = merged.filter(([f]) => f < r.start).pop();
    r.base = before ? before[1] : initial;
    for (const f of r.files) {
      fs.mkdirSync(path.dirname(path.join(folder, f)), { recursive: true });
      fs.appendFileSync(path.join(folder, f), `// ${r.title}\n`);
    }
    git(['add', '-A']);
    const message = r.pr ? `${r.title} (#${40 + r.n})` : `${r.title}\n\nCloses #${40 + r.n}`;
    git(['commit', '-q', '-m', message], new Date(r.finish.getTime() - 5 * 6e4).toISOString());
    r.tip = git(['rev-parse', 'HEAD']);
    merged.push([r.finish, r.tip]);
  }
  for (const r of runs) {
    const runId = `${r.start.toISOString().slice(0, 10).replace(/-/g, '')}-22${String(r.n).padStart(2, '0')}00-perf${String(r.n).padStart(4, '0')}`;
    const dir = path.join(ws.runs, runId);
    fs.mkdirSync(dir, { recursive: true });
    const workflow = r.pr ? 'software-development' : 'software-development-local-hero';
    const ev = (ts, type, extra = {}) => ({ ts: new Date(ts).toISOString(), type, ...extra });
    const t = r.start.getTime();
    const conflictText = `local merge: run/${runId} conflicts with the local main in ${r.files.filter((f) => !f.startsWith('src/features/')).join(', ')}. The branch was left as it was; resolve the conflict on it and merge again.`;
    writeEvents(dir, runId, [
      ev(t, 'workflow.started', { workflow, project_id: projectId, inputs: { task: r.title } }),
      ev(t + 1e3, 'worktree.ready', { dir: path.join(folder, '..', runId), repo: folder, base: 'main', ref: 'main', commit: r.base, reused: false }),
      ev(t + 2e3, 'step.started', { step_id: 'implement' }),
      ...(r.conflict ? [ev(r.finish - 30 * 6e4, 'log', { level: 'warn', message: `merge failed: ${conflictText} → resolve_merge` }), ev(r.finish - 29 * 6e4, 'step.started', { step_id: 'resolve_merge' })] : []),
      ...(r.pr ? [ev(r.finish - 9e4, 'step.finished', { step_id: 'open_pr', output: { pr_number: 40 + r.n, pr_url: `https://github.com/demo/demo-app/pull/${40 + r.n}` } }), ev(r.finish - 6e4, 'action.executed', { command: `gh pr merge ${40 + r.n} --squash`, exit_code: 1, output: 'Pull request is not mergeable: the merge commit cannot be cleanly created (conflict in src/renderer/index.html).' }), ev(r.finish - 6e4 + 1, 'log', { level: 'error', message: 'gh pr merge failed: merge conflict in src/renderer/index.html' })] : []),
      ev(r.finish, 'workflow.finished', { status: 'success' }),
    ]);
    const cost = +(r.conflict ? 4.2 + r.n * 0.1 : 2.1 + r.n * 0.15).toFixed(2);
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: runId, workflow, project_id: projectId, status: 'success', mock: false, inputs: { task: r.title },
      started_at: r.start.toISOString(), finished_at: r.finish.toISOString(), duration_ms: r.finish - r.start, timing: { waiting_ms: 0 },
      worktree: { repo: folder, base: 'main', ref: 'main', commit: r.base, branch: `run/${runId}` },
      local_merge: r.pr ? null : { branch: `run/${runId}`, base: 'main', commit: r.tip },
      sessions: [{ id: 's0', agent: 'developer', provider: 'claude', model: 'claude-opus-5-5', step_id: 'implement', opened_at: r.start.toISOString(), closed_at: r.finish.toISOString(), duration_ms: r.finish - r.start, tokens: { input: 9000, output: 30000, cache_read: 900000, cache_write: 40000, reasoning: 0 }, cost_usd: cost, status: 'success' }],
    }, null, 2));
    r.runId = runId;
  }
  fs.mkdirSync(ws.backlog, { recursive: true });
  fs.writeFileSync(path.join(ws.backlog, `${projectId}.roadmap.json`), JSON.stringify({
    state: 'done', simulated: false, error: null, pausedBy: null, scope: null, updatedAt: new Date().toISOString(),
    stages: [0, 1, 2].map((s) => ({ id: `stage-${s + 1}`, name: `Night ${s + 1}`, items: runs.filter((r) => r.stage === `Stage ${s + 1}`).map((r) => ({ id: `item-${r.n}`, workflow: 'software-development-local-hero.yaml', status: 'done', number: 40 + r.n, title: r.title, issues: [{ number: 40 + r.n, title: r.title }], runId: r.runId, runs: [r.runId] })) })),
  }, null, 2));
  return new Date(Date.now() - 2 * 864e5).toISOString().slice(0, 10);
}

function seed({ args, ws, project, src }) {
  demoAnalyticsRuns(ws, project.id);
  if (args.tab === 'performance') demoPerformanceRuns(ws, project.folder, project.id);
  // the Run (#228), 24/7 (#188) and Agents (#280) tabs (an app before them: nothing)
  if (['run', 'occupancy', 'agents'].includes(args.tab)) {
    try {
      const demo = src('analytics-demo');
      if (args.tab === 'run') demo.writeDemoRunInDepth(ws, project.id);
      else if (args.tab === 'agents') demo.writeDemoAgents?.(ws, project.id);
      else demo.writeDemoOccupancy(ws, project.id);
    } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
  }
}

// no menu entry: a tab of Home
const open = ({ js }) => js('showView("analytics")');

async function afterOpen({ args, click, js, pause }) {
  if (args.tab) await click(`[data-an-tab="${args.tab}"]`);
  // the demo's last night started after this marker: the before/after table shows the difference
  if (args.tab === 'performance') {
    const d = new Date(Date.now() - 2 * 864e5);
    const marker = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await js(`const m = document.querySelector('#an-marker'); m.value = ${JSON.stringify(marker)}; m.dispatchEvent(new Event('change'));`);
    await pause(1500);
  }
}

module.exports = {
  afterOpen,
  demoPerformanceRuns,
  open,
  seed,
  tabs: ['usage', 'performance', 'run', 'occupancy', 'agents'],
};
