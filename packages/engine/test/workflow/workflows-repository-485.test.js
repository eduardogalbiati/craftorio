// #485: resolving a workflow by name repository -> workspace -> bundled (packages/engine/domains/workflow/workflows.js).
// Acceptance tests, written before the code.
//
// Spec (the interface these tests assume):
//   resolveWorkflow(name, dirs, { repo }) (packages/engine/domains/workflow/workflows.js, existing, gains a third argument)
//     repo: a checkout of the project (the run's base checkout) whose .multiagent/project.yaml
//       declares repository workflows. A name matches a manifest entry with a `file` by its name,
//       its name + '.yaml', or its file's basename; that entry wins over the workspace and the
//       bundled defaults and resolves to <repo>/.multiagent/<file>, with origin: 'repository'.
//     A manifest entry without `file` (a bundled workflow by name) and a name the manifest does not
//       declare resolve as today (dirs in order: workspace, then bundled), with origin
//       'workspace' / 'bundled' (index 0 / later) when `repo` is given.
//     A malformed manifest is ignored by the resolution (the workspace and bundled ones still resolve).
//   Without the third argument, resolveWorkflow behaves as today.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempDir, makeRepo, repoFlow } = require('../repo-workflow-fixtures-485');

const load = () => require('../../domains/workflow/workflows');

const MANIFEST = `workflows:
  - name: mine
    file: workflows/mine.yaml
    category: solo
  - name: shared
    file: workflows/shared.yaml
    category: team
  - name: writer-reviewer
    category: team
`;

function setup(t, manifest = MANIFEST) {
  const repo = makeRepo(t, {
    '.multiagent/project.yaml': manifest,
    '.multiagent/workflows/mine.yaml': repoFlow('mine', 'mine'),
    '.multiagent/workflows/shared.yaml': repoFlow('repo_shared', 'shared'),
  });
  const ws = tempDir(t, 'resolve-ws-485-');
  const bundled = tempDir(t, 'resolve-bundled-485-');
  fs.writeFileSync(path.join(ws, 'shared.yaml'), repoFlow('ws_shared', 'shared'));
  fs.writeFileSync(path.join(ws, 'only-ws.yaml'), repoFlow('ws', 'only-ws'));
  fs.writeFileSync(path.join(bundled, 'only-bundled.yaml'), repoFlow('b', 'only-bundled'));
  fs.writeFileSync(path.join(bundled, 'writer-reviewer.yaml'), repoFlow('wr', 'writer-reviewer'));
  return { repo: repo.dir, ws, bundled };
}

const same = (a, b) => assert.equal(path.resolve(a).toLowerCase(), path.resolve(b).toLowerCase());

test('#485 resolveWorkflow: a repository workflow resolves by its manifest name to the checkout\'s .multiagent/<file>', (t) => {
  const { resolveWorkflow } = load();
  const { repo, ws, bundled } = setup(t);
  const r = resolveWorkflow('mine', [ws, bundled], { repo });
  same(r.file, path.join(repo, '.multiagent', 'workflows', 'mine.yaml'));
  assert.equal(r.origin, 'repository');
});

test('#485 resolveWorkflow: the repository wins over the workspace for the same name', (t) => {
  const { resolveWorkflow } = load();
  const { repo, ws, bundled } = setup(t);
  // #554: an edited (custom/modified) workspace copy wins; the repository wins over an untouched one
  fs.renameSync(path.join(ws, 'shared.yaml'), path.join(bundled, 'shared.yaml'));
  load().seedWorkflows(bundled, ws);
  for (const name of ['shared', 'shared.yaml']) {
    const r = resolveWorkflow(name, [ws, bundled], { repo });
    same(r.file, path.join(repo, '.multiagent', 'workflows', 'shared.yaml'));
    assert.equal(r.origin, 'repository', name);
  }
});

test('#485 resolveWorkflow: what the repository does not declare resolves workspace first, then bundled', (t) => {
  const { resolveWorkflow } = load();
  const { repo, ws, bundled } = setup(t);
  const w = resolveWorkflow('only-ws.yaml', [ws, bundled], { repo });
  same(w.file, path.join(ws, 'only-ws.yaml'));
  assert.equal(w.origin, 'workspace');
  const b = resolveWorkflow('only-bundled.yaml', [ws, bundled], { repo });
  same(b.file, path.join(bundled, 'only-bundled.yaml'));
  assert.equal(b.origin, 'bundled');
  // declared by name only (no file): the bundled workflow, not a repository file
  const byName = resolveWorkflow('writer-reviewer.yaml', [ws, bundled], { repo });
  same(byName.file, path.join(bundled, 'writer-reviewer.yaml'));
  assert.notEqual(byName.origin, 'repository');
});

test('#485 resolveWorkflow: a malformed manifest leaves the workspace and bundled workflows resolving as today', (t) => {
  const { resolveWorkflow } = load();
  const { repo, ws, bundled } = setup(t, 'workflows: [ { name: \n');
  same(resolveWorkflow('shared.yaml', [ws, bundled], { repo }).file, path.join(ws, 'shared.yaml'));
  assert.throws(() => resolveWorkflow('mine', [ws, bundled], { repo }), /mine/);
});

test('#485 resolveWorkflow without a repository behaves as before (guards existing behaviour)', (t) => {
  const { resolveWorkflow } = load();
  const { ws, bundled } = setup(t);
  const r = resolveWorkflow('shared.yaml', [ws, bundled]);
  same(r.file, path.join(ws, 'shared.yaml'));
  assert.equal(r.fallback, false);
  assert.equal(resolveWorkflow('only-bundled.yaml', [ws, bundled]).fallback, true);
});
