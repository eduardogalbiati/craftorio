// Acceptance tests for #574: scripts/docs-usage.js, which docs and rules the coding agents use,
// counted from the run folders (<workspace>/runs/<id>/events.jsonl, sessions/<id>.jsonl,
// summary.json), with no model call.
//
// The public surface these tests fix:
//   require('../scripts/docs-usage.js').docsUsage({ workspace, root, project, since }) → { markdown, model }
//     (sync or async), where `root` is the repository whose docs/agents/*.md, skills/*/SKILL.md and
//     AGENTS.md are the docs that can be read, and the model is:
//     { runs: [{ run_id, issues, sessions: [{ session_id, agent, docs_read, files_edited, topics_skipped }],
//                rules_broken: { shared_list_edit, push_to_main, real_run_in_check } }],
//       reads: { <doc>: sessions that read it }, never_read: [<doc>],
//       skipped_by_topic: { <topic doc>: sessions that edited its folder without reading it },
//       rules_broken: { shared_list_edit, push_to_main, real_run_in_check }, not_measured: [<rule>] }
//     Paths are repository-relative with forward slashes, lists sorted.
//   node scripts/docs-usage.js --workspace <dir> --root <repo> --project <id> --since <YYYY-MM-DD> [--json]
//     prints the Markdown report, or the JSON model with --json; `npm run docs:usage` runs it.
// The module does not exist before the change: it is required inside each test.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const REPO = path.join(__dirname, '..');
const SCRIPT = path.join(REPO, 'scripts', 'docs-usage.js');
const load = () => require('../scripts/docs-usage.js');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};

// events.jsonl, sessions/<id>.jsonl (the recorder's copy of each session's events) and summary.json
function writeRun(runsDir, id, events, summary) {
  const dir = path.join(runsDir, id);
  fs.mkdirSync(path.join(dir, 'sessions'), { recursive: true });
  const lines = events.map((e, i) => ({ seq: i + 1, run_id: id, ...e }));
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${lines.map((e) => JSON.stringify(e)).join('\n')}\n`);
  const bySession = new Map();
  for (const e of lines) if (e.session_id) bySession.set(e.session_id, [...(bySession.get(e.session_id) || []), e]);
  for (const [sid, list] of bySession) fs.writeFileSync(path.join(dir, 'sessions', `${sid}.jsonl`), `${list.map((e) => JSON.stringify(e)).join('\n')}\n`);
  if (summary) fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2));
}

const at = (day, m = 0) => new Date(Date.parse(`${day}T10:00:00.000Z`) + m * 60e3).toISOString();
const wfStarted = (day, project, extra = {}) => ({ ts: at(day), type: 'workflow.started', workflow: 'AI Development', file: 'ai-development.yaml', project_id: project, mock: false, ...extra });
const wfFinished = (day) => ({ ts: at(day, 50), type: 'workflow.finished', status: 'success' });
const opened = (day, sid, agent, step, cwd) => ({ ts: at(day, 1), type: 'session.opened', session_id: sid, session: { id: sid, agent, provider: 'claude', model: 'claude-opus-5-5', step_id: step, cwd } });
let callId = 0;
const call = (day, m, sid, name, input) => ({ ts: at(day, m), type: 'session.stream', session_id: sid, turn: 1, item: { kind: 'tool_call', id: `c${++callId}`, name, input } });
const read = (day, m, sid, file) => call(day, m, sid, 'Read', { file_path: file });
const edit = (day, m, sid, file) => call(day, m, sid, 'Edit', { file_path: file, old_string: 'a', new_string: 'b' });
const writeTool = (day, m, sid, file) => call(day, m, sid, 'Write', { file_path: file, content: 'x' });
const bash = (day, m, sid, command) => call(day, m, sid, 'Bash', { command });

const PROJECT = 'multiagent-orchestrator';
const SINCE = '2026-10-01';

// A repository with three topic docs, AGENTS.md and two skills, and a workspace with:
// - run-a (this project): d1 read AGENTS.md and a skill, then edited packages/ui-kit/ (renderer's
//   folder) without reading docs/agents/renderer.md, edited AGENTS.md (a shared list) and pushed to
//   main; t1 read renderer.md before editing fronts/, started a real run (no --mock) and a mock one,
//   and pushed its own branch.
// - run-old (this project, older record shape: `issue`, no project_id nor sessions in summary.json):
//   o1 read renderer.md.
// - run-other (another project) and run-early (before --since) read storage.md and testing.md:
//   they are left out, so those docs stay never read.
function fixture(t) {
  const base = tmp(t, 'docs-usage-574-');
  const root = path.join(base, 'repo');
  for (const doc of ['docs/agents/renderer.md', 'docs/agents/storage.md', 'docs/agents/testing.md', 'AGENTS.md', 'skills/testing-principles/SKILL.md', 'skills/long-commands/SKILL.md']) {
    write(path.join(root, doc), `# ${doc}\n`);
  }
  const workspace = path.join(base, 'ws');
  const runs = path.join(workspace, 'runs');
  fs.mkdirSync(path.join(runs, 'po-multiagent-orchestrator-20261010'), { recursive: true });

  const A = '2026-10-10';
  const wtA = 'C:/w/worktrees/run-a';
  writeRun(runs, 'run-a', [
    wfStarted(A, PROJECT, { issues: [574] }),
    opened(A, 'd1', 'developer', 'develop', wtA),
    read(A, 2, 'd1', `${wtA}/AGENTS.md`),
    read(A, 3, 'd1', 'C:/w/skills/testing-principles/SKILL.md'),
    edit(A, 4, 'd1', 'C:\\w\\worktrees\\run-a\\packages\\ui-kit\\button.js'),
    edit(A, 5, 'd1', `${wtA}/AGENTS.md`),
    bash(A, 6, 'd1', 'git push origin main'),
    opened(A, 10, 't1', 'test_writer', 'test', wtA),
    read(A, 11, 't1', `${wtA}/docs/agents/renderer.md`),
    writeTool(A, 12, 't1', `${wtA}/fronts/web/app.js`),
    bash(A, 13, 't1', 'npm run run -- --file ai-arena.yaml --auto-approve --task "x"'),
    bash(A, 14, 't1', 'npm run run -- --file ai-arena.yaml --mock --auto-approve --task "y"'),
    bash(A, 15, 't1', 'git push -u origin docs-usage'),
    wfFinished(A),
  ], {
    run_id: 'run-a', workflow: 'AI Development', project_id: PROJECT, issues: [574], status: 'success',
    started_at: at(A), finished_at: at(A, 50), mock: false, cost_accounting: 'per_turn',
    worktree: { dir: wtA, work_dir: wtA, branch: 'docs-usage' },
    sessions: [{ id: 'd1', agent: 'developer', provider: 'claude' }, { id: 't1', agent: 'test_writer', provider: 'claude' }],
  });

  const O = '2026-10-12';
  const wtO = 'C:/w/worktrees/run-old';
  writeRun(runs, 'run-old', [
    wfStarted(O, PROJECT),
    opened(O, 'o1', 'reviewer', 'review', wtO),
    read(O, 2, 'o1', `${wtO}/docs/agents/renderer.md`),
    wfFinished(O),
  ], {
    run_id: 'run-old', workflow: 'AI Development', issue: 565, status: 'success',
    started_at: at(O), finished_at: at(O, 50), mock: false, worktree: { dir: wtO, work_dir: wtO },
  });

  const other = (id, day, project, doc) => {
    const wt = `C:/w/worktrees/${id}`;
    writeRun(runs, id, [wfStarted(day, project), opened(day, 'x1', 'developer', 'develop', wt), read(day, 2, 'x1', `${wt}/${doc}`), wfFinished(day)], {
      run_id: id, workflow: 'AI Development', project_id: project, status: 'success', started_at: at(day), finished_at: at(day, 50),
      mock: false, cost_accounting: 'per_turn', worktree: { dir: wt, work_dir: wt }, sessions: [{ id: 'x1', agent: 'developer' }],
    });
  };
  other('run-other', '2026-10-11', 'another-project', 'docs/agents/storage.md');
  other('run-early', '2026-09-01', PROJECT, 'docs/agents/testing.md');
  return { root, workspace };
}

async function analyse(t) {
  const { docsUsage } = load();
  const { root, workspace } = fixture(t);
  return docsUsage({ workspace, root, project: PROJECT, since: SINCE });
}

const sessionOf = (model, runId, sid) => model.runs.find((r) => r.run_id === runId).sessions.find((s) => s.session_id === sid);

test('keeps only the runs of the project since the date, an older record shape included (#350)', async (t) => {
  const { model } = await analyse(t);
  assert.deepEqual(model.runs.map((r) => r.run_id).sort(), ['run-a', 'run-old']);
  const old = model.runs.find((r) => r.run_id === 'run-old');
  assert.deepEqual(old.issues, [565]);
  assert.deepEqual(old.sessions.map((s) => [s.session_id, s.agent]), [['o1', 'reviewer']]);
  assert.deepEqual(old.sessions[0].docs_read, ['docs/agents/renderer.md']);
});

test('lists per session the docs and skills read and the files edited, relative to the repository', async (t) => {
  const { model } = await analyse(t);
  const d1 = sessionOf(model, 'run-a', 'd1');
  assert.equal(d1.agent, 'developer');
  assert.deepEqual(d1.docs_read, ['AGENTS.md', 'skills/testing-principles/SKILL.md']);
  assert.deepEqual(d1.files_edited, ['AGENTS.md', 'packages/ui-kit/button.js']);
  const t1 = sessionOf(model, 'run-a', 't1');
  assert.deepEqual(t1.docs_read, ['docs/agents/renderer.md']);
  assert.deepEqual(t1.files_edited, ['fronts/web/app.js']);
});

test('counts a session that edited a folder without reading its topic doc, per topic', async (t) => {
  const { model } = await analyse(t);
  assert.deepEqual(sessionOf(model, 'run-a', 'd1').topics_skipped, ['docs/agents/renderer.md']);
  assert.deepEqual(sessionOf(model, 'run-a', 't1').topics_skipped, []);
  assert.deepEqual(model.skipped_by_topic, { 'docs/agents/renderer.md': 1 });
});

test('counts the rules the data shows broken per run: a shared list edited, a push to main, a real run', async (t) => {
  const { model } = await analyse(t);
  const runA = model.runs.find((r) => r.run_id === 'run-a');
  assert.deepEqual(runA.rules_broken, { shared_list_edit: 1, push_to_main: 1, real_run_in_check: 1 });
  const runOld = model.runs.find((r) => r.run_id === 'run-old');
  assert.deepEqual(runOld.rules_broken, { shared_list_edit: 0, push_to_main: 0, real_run_in_check: 0 });
  assert.deepEqual(model.rules_broken, { shared_list_edit: 1, push_to_main: 1, real_run_in_check: 1 });
});

test('lists the rules it cannot measure instead of guessing them', async (t) => {
  const { model } = await analyse(t);
  assert.equal(Array.isArray(model.not_measured), true);
  assert.equal(model.not_measured.length > 0, true);
  assert.equal(model.not_measured.every((r) => typeof r === 'string' && r.length > 0), true);
});

test('counts the sessions that read each doc and lists the docs no session read in the period', async (t) => {
  const { model } = await analyse(t);
  assert.equal(model.reads['docs/agents/renderer.md'], 2);
  assert.equal(model.reads['AGENTS.md'], 1);
  assert.equal(model.reads['skills/testing-principles/SKILL.md'], 1);
  assert.equal(model.reads['docs/agents/storage.md'] || 0, 0);
  assert.deepEqual(model.never_read, ['docs/agents/storage.md', 'docs/agents/testing.md', 'skills/long-commands/SKILL.md']);
});

test('the Markdown report names the broken rules, the skipped and never-read docs and what is not measured', async (t) => {
  const { markdown } = await analyse(t);
  assert.equal(typeof markdown, 'string');
  for (const text of ['shared_list_edit', 'push_to_main', 'real_run_in_check', 'docs/agents/renderer.md', 'docs/agents/storage.md', 'skills/long-commands/SKILL.md']) {
    assert.equal(markdown.includes(text), true, `report mentions ${text}`);
  }
  assert.match(markdown, /not measured/i);
});

test('the CLI prints the JSON model with --json and the Markdown report without it', (t) => {
  const { root, workspace } = fixture(t);
  const args = [SCRIPT, '--workspace', workspace, '--root', root, '--project', PROJECT, '--since', SINCE];
  const json = JSON.parse(execFileSync(process.execPath, [...args, '--json'], { encoding: 'utf8' }));
  assert.deepEqual(json.runs.map((r) => r.run_id).sort(), ['run-a', 'run-old']);
  assert.deepEqual(json.never_read, ['docs/agents/storage.md', 'docs/agents/testing.md', 'skills/long-commands/SKILL.md']);
  const md = execFileSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(md.includes('docs/agents/storage.md'), true);
  assert.equal(md.trimStart().startsWith('{'), false);
});

// A repository with sub-docs (docs/agents/engine/*.md) and skill rules (skills/<s>/rules/*.md):
// e1 read one sub-doc and one rule (outside the worktree), then edited packages/engine/engine/
// without reading engine.md; e2 read engine.md before editing workflows/.
function nestedFixture(t) {
  const base = tmp(t, 'docs-usage-574-nested-');
  const root = path.join(base, 'repo');
  for (const doc of ['AGENTS.md', 'docs/agents/engine.md', 'docs/agents/engine/gates.md', 'docs/agents/engine/loops.md', 'skills/code-review/SKILL.md', 'skills/code-review/rules/spec.md', 'skills/code-review/rules/style.md']) {
    write(path.join(root, doc), `# ${doc}\n`);
  }
  const workspace = path.join(base, 'ws');
  const D = '2026-10-15';
  const wt = 'C:/w/worktrees/run-n';
  writeRun(path.join(workspace, 'runs'), 'run-n', [
    wfStarted(D, PROJECT),
    opened(D, 'e1', 'developer', 'develop', wt),
    read(D, 2, 'e1', `${wt}/docs/agents/engine/gates.md`),
    read(D, 3, 'e1', 'C:/ws/skills/code-review/rules/spec.md'),
    edit(D, 4, 'e1', `${wt}/packages/engine/engine/workflow.js`),
    opened(D, 10, 'e2', 'developer', 'develop', wt),
    read(D, 11, 'e2', `${wt}/docs/agents/engine.md`),
    edit(D, 12, 'e2', `${wt}/workflows/x.yaml`),
    wfFinished(D),
  ], {
    run_id: 'run-n', workflow: 'AI Development', project_id: PROJECT, status: 'success', started_at: at(D), finished_at: at(D, 50),
    mock: false, cost_accounting: 'per_turn', worktree: { dir: wt, work_dir: wt },
    sessions: [{ id: 'e1', agent: 'developer' }, { id: 'e2', agent: 'developer' }],
  });
  return { root, workspace };
}

test('counts the sub-docs under docs/agents and the rule files of a skill as docs', async (t) => {
  const { docsUsage } = load();
  const { root, workspace } = nestedFixture(t);
  const { model } = await docsUsage({ workspace, root, project: PROJECT, since: SINCE });
  assert.deepEqual(sessionOf(model, 'run-n', 'e1').docs_read, ['docs/agents/engine/gates.md', 'skills/code-review/rules/spec.md']);
  assert.equal(model.reads['docs/agents/engine/gates.md'], 1);
  assert.equal(model.reads['skills/code-review/rules/spec.md'], 1);
  assert.deepEqual(model.never_read, ['AGENTS.md', 'docs/agents/engine/loops.md', 'skills/code-review/SKILL.md', 'skills/code-review/rules/style.md']);
});

test('an edit under packages/engine/engine/ without engine.md read counts as engine.md skipped', async (t) => {
  const { docsUsage } = load();
  const { root, workspace } = nestedFixture(t);
  const { model } = await docsUsage({ workspace, root, project: PROJECT, since: SINCE });
  assert.deepEqual(sessionOf(model, 'run-n', 'e1').topics_skipped, ['docs/agents/engine.md']);
  assert.deepEqual(sessionOf(model, 'run-n', 'e2').topics_skipped, []);
  assert.deepEqual(model.skipped_by_topic, { 'docs/agents/engine.md': 1 });
});

test('the CLI warns on stderr when --since is not a date', (t) => {
  const { root, workspace } = fixture(t);
  const r = spawnSync(process.execPath, [SCRIPT, '--workspace', workspace, '--root', root, '--project', PROJECT, '--since', '10/01/2026', '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.match(r.stderr, /--since/);
});

test('npm run docs:usage runs the script', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(String(pkg.scripts['docs:usage'] || '').includes('scripts/docs-usage.js'), true);
});

test('the docs say how a script reads the session stream and where the baseline is', () => {
  const doc = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
  const topic = doc('docs/agents/testing.md') + doc('docs/agents/storage.md');
  assert.equal(topic.includes('docs-usage'), true, 'testing.md or storage.md names scripts/docs-usage.js');
  assert.equal(doc('docs/12-factor-agents/codebase-structure.md').includes('docs:usage'), true, 'codebase-structure.md gives the measurement command');
  assert.equal(/docs-usage|docs:usage/.test(doc('docs/agents/decisions.md')), true, 'decisions.md records whether the retrospective consumes the report');
});
