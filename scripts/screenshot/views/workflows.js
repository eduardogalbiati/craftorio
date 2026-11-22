// Screenshot seed of Workflows (--view workflows): its tabs (one menu entry each), the demo roadmap's
// runs (views/roadmap.js), a parent run with its child runs (demoChildRuns, #174), a long run history
// (demoRunHistory, #200; both also on Project), edited and custom workflows and pipelines (#137) and a
// simulated run.

const fs = require('fs');
const path = require('path');
const { gitRepo } = require('../helpers');
const { demoRoadmap } = require('./roadmap');

// Workflows › Definitions (#137): declared outputs on an edited default (modified, Restore
// default), two custom workflows (one in Monitor & Improve, one with an unknown category: Other)
// and three saved pipelines, connected with their mappings and conditions.
function demoPipelines(ws, appDir) {
  // seeded now (the app would at start) so the edited default counts as modified, not custom
  require(path.join(appDir, 'packages', 'engine', 'domains', 'workflow', 'workflows')).seedWorkflows(path.join(appDir, 'workflows'), ws.workflows);
  const wf = (f) => path.join(ws.workflows, f);
  const tracker = fs.readFileSync(wf('issue.yaml'), 'utf8');
  fs.writeFileSync(wf('issue.yaml'), tracker.replace('description: "The issues created:', 'description: "The filed issues:'));
  // the retrospective declares `findings` (#134): the copies rename it instead of adding a second `outputs:`
  const retro = fs.readFileSync(wf('retrospective.yaml'), 'utf8');
  fs.writeFileSync(wf('weekly-digest.yaml'), retro.replace('name: retrospective', 'name: weekly-digest').replace(/description: .*/, 'description: Summarizes the week\'s retrospectives into one digest of what to change first.').replace('\n  findings:\n', '\n  digest:\n'));
  fs.writeFileSync(wf('release-notes.yaml'), retro.replace('name: retrospective', 'name: release-notes').replace('category: monitor', 'category: ops').replace(/description: .*/, 'description: Drafts the release notes of the merged pull requests since the last tag.').replace('\n  findings:\n', '\n  notes:\n'));
  // the bundled pipelines (#135), one of them edited (modified: Restore default), plus two of the
  // owner's: a valid one and one whose mapping names an output its workflow doesn't declare (refused)
  const dir = path.join(ws.root, 'pipelines');
  require(path.join(appDir, 'packages', 'engine', 'domains', 'workflow', 'pipelines')).seedPipelines(path.join(appDir, 'pipelines'), dir);
  const spec = path.join(dir, 'spec-to-issues.yaml');
  if (fs.existsSync(spec)) fs.writeFileSync(spec, fs.readFileSync(spec, 'utf8').replace('description: Write doc writes the spec', 'description: Write doc writes our quarterly spec'));
  fs.writeFileSync(path.join(dir, 'ship-and-learn.yaml'), [
    'name: Ship and learn',
    'description: Develops a task, then runs a retrospective on that run.',
    'stages:',
    '  - workflow: software-development.yaml',
    '  - workflow: run-retrospective.yaml',
    '    on: success',
    '    map: { run_id: "@run" }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'weekly-review.yaml'), [
    'name: Weekly review',
    'description: The latest retrospective feeds the weekly digest.',
    'category: monitor',
    'stages:',
    '  - workflow: run-retrospective.yaml',
    '  - workflow: weekly-digest.yaml',
    '    map: { focus: findings }',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(dir, 'issue-to-merge.yaml'), [
    'name: Issue to merge',
    'description: Files a triaged issue, then develops it up to the merge.',
    'category: build',
    'stages:',
    '  - workflow: issue.yaml',
    '  - workflow: software-development.yaml',
    '    map: { task: findings }',
    '',
  ].join('\n'));
}

// A `type: workflow` step's runs (#174): a delivery run whose step ran software-development for three
// issues, two at a time (two succeeded, one failed), so the run lists show the children under it.
function demoChildRuns(ws, projectId) {
  const at = Date.now() - 2 * 36e5;
  const parentId = `${new Date(at).toISOString().slice(0, 10).replace(/-/g, '')}-100000-demopar0`;
  const items = [['#201', 'Add a /health endpoint', 'success'], ['#202', 'Rate-limit the login form with a very long title that is cut', 'failed'], ['#203', 'Show the build version in the footer', 'success']];
  const kids = items.map(([n, title, status], i) => ({ run_id: `${parentId.slice(0, 9)}10${i}000-demokid${i}`, step_id: 'develop', visit: 1, index: i, workflow: 'software-development', status, n, title }));
  const write = (runId, summary) => {
    fs.mkdirSync(path.join(ws.runs, runId), { recursive: true });
    fs.writeFileSync(path.join(ws.runs, runId, 'summary.json'), JSON.stringify({ run_id: runId, project_id: projectId, mock: false, sessions: [], ...summary }, null, 2));
  };
  write(parentId, {
    workflow: 'backlog-delivery', status: 'failed', started_at: new Date(at).toISOString(), finished_at: new Date(at + 54e5).toISOString(), duration_ms: 54e5,
    inputs: { task: 'Deliver the planned issues #201, #202 and #203' },
    child_runs: kids.map(({ n, title, ...k }) => k),
  });
  kids.forEach((k, i) => write(k.run_id, {
    workflow: 'software-development', status: k.status, started_at: new Date(at + (i + 1) * 6e4).toISOString(), finished_at: new Date(at + (i + 1) * 6e4 + 18e5).toISOString(), duration_ms: 18e5,
    inputs: { task: `${k.n} ${k.title}` },
    parent_run: { run_id: parentId, workflow: 'backlog-delivery', step_id: 'develop', index: i, depth: 1 },
  }));
}

// A long run history (#200): 40 finished runs, so the run lists load in pages (the "Loading more…" row
// at the end); the newest (id ending in -demohist00) saved 72 files over four steps, so its open row
// shows its artifacts grouped by step and "Show more" (--click '[data-run$="-demohist00"] .pr-row').
function demoRunHistory(ws, projectId) {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const statuses = ['success', 'success', 'failed', 'success', 'cancelled'];
  for (let i = 0; i < 40; i++) {
    const started = new Date(Date.now() - (i ? i * 0.7 * 864e5 : 36e5));
    const runId = `${started.toISOString().slice(0, 10).replace(/-/g, '')}-0900${String(i).padStart(2, '0')}-demohist${String(i).padStart(2, '0')}`;
    const dir = path.join(ws.runs, runId);
    fs.mkdirSync(dir, { recursive: true });
    const task = ['Add pagination to the API', 'Fix the flaky login test', 'Export the run report as PDF', 'Dark theme for the Backlog'][i % 4];
    const events = [{ seq: 1, ts: started.toISOString(), type: 'workflow.started', run_id: runId, workflow: 'software-development', project_id: projectId, inputs: { task } }];
    const files = !i ? [
      ...Array.from({ length: 12 }, (_, k) => [`handoffs/developer-${k + 1}.md`, 'develop', 'developer']),
      ...Array.from({ length: 8 }, (_, k) => [`reviews/review-${k + 1}.md`, 'review', 'reviewer']),
      ...Array.from({ length: 48 }, (_, k) => [`evidence/round-1/screen-${String(k + 1).padStart(2, '0')}.png`, 'evidence', 'tester']),
      ['documents/plan.md', 'plan', 'planner'], ['documents/test-report.md', 'test', 'tester'], ['decisions.tsv', null, null], ['notes.txt', null, null],
    ] : [['documents/summary.md', 'develop', 'developer']];
    for (const [rel, step, agent] of files) {
      const file = path.join(dir, ...rel.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, rel.endsWith('.png') ? png : `# ${path.basename(rel)}\n`);
      if (step) events.push({ seq: events.length + 1, ts: started.toISOString(), type: 'file.saved', run_id: runId, step_id: step, agent, path: file });
    }
    fs.writeFileSync(path.join(dir, 'events.jsonl'), events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
      run_id: runId, workflow: 'software-development', project_id: projectId, status: statuses[i % statuses.length], mock: false,
      started_at: started.toISOString(), finished_at: new Date(started.getTime() + 27e5).toISOString(), duration_ms: 27e5, inputs: { task }, sessions: [],
    }, null, 2));
  }
}

// Repository workflows (#485): the project's folder is a git repository whose committed
// .craftorio/project.yaml names a bundled flow (team) and its own copy of the retrospective
// (intake), not accepted yet, so Workflows › Definitions shows "repository @ <sha>" with Accept.
function demoRepositoryWorkflows(project, appDir) {
  if (!project.folder) return;
  const git = gitRepo(project.folder);
  const dir = path.join(project.folder, '.multiagent', 'workflows');
  fs.mkdirSync(dir, { recursive: true });
  const retro = fs.readFileSync(path.join(appDir, 'workflows', 'retrospective.yaml'), 'utf8');
  fs.writeFileSync(path.join(dir, 'issue-intake.yaml'), retro.replace('name: retrospective', 'name: issue-intake').replace(/description: .*/, 'description: Turns the week\'s findings into triaged issues for this repository.'));
  fs.writeFileSync(path.join(project.folder, '.multiagent', 'project.yaml'), [
    'version: 1',
    'workflows:',
    '  - name: software-development',
    '    category: team',
    '  - name: issue-intake',
    '    file: workflows/issue-intake.yaml',
    '    category: intake',
    '',
  ].join('\n'));
  git(['init', '-q', '-b', 'main']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'Declare the repository workflows']);
}

function seed({ appDir, args, ws, project }) {
  demoRoadmap(ws, project.id, args.live, args.budget, args.roadmap);
  demoChildRuns(ws, project.id);
  demoRunHistory(ws, project.id);
  demoPipelines(ws, appDir);
  demoRepositoryWorkflows(project, appDir);
}

// #254: one menu entry per tab
const open = ({ args, click }) => click(`.nav-item[data-view="workflows"][data-tab="${args.tab || 'runs'}"]`);

module.exports = {
  demoChildRuns,
  demoRunHistory,
  open,
  run: true,
  seed,
  tabs: ['runs', 'definitions', 'builder', 'pipelines'],
};
