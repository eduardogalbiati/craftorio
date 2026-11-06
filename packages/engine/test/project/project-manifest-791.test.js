// #791: a repository's manifest maps each kind of work to a workflow and its inputs. Acceptance tests,
// written before the code.
// Seam: packages/engine/domains/project/project-manifest.js parseManifest / readManifest, which also
// return `kinds`: { feature?: { name, inputs }, fix?: { name, inputs } }, every key of an entry but
// `name` in `inputs`; absent: {}. A kind naming a workflow not in the manifest's `workflows` is an error
// naming it and that kind is missing. What happens to `workflows` in that case is left open on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/project/project-manifest');

const WORKFLOWS = `version: 1
workflows:
  - name: hero
    category: solo
  - name: fix
    category: fix
`;
const MAP = `${WORKFLOWS}kinds:
  feature: { name: hero }
  fix: { name: fix, mode: remote }
`;

test('#791 a manifest\'s kinds map each kind to its workflow and inputs', () => {
  const out = load().parseManifest(MAP);
  assert.deepEqual([out.kinds, out.errors], [{ feature: { name: 'hero', inputs: {} }, fix: { name: 'fix', inputs: { mode: 'remote' } } }, []]);
});

test('#791 every key of a kind but its name goes to the inputs', () => {
  const out = load().parseManifest(`${WORKFLOWS}kinds:\n  fix: { name: fix, mode: remote, hotfix: true, review: multi_model }\n`);
  assert.deepEqual(out.kinds.fix, { name: 'fix', inputs: { mode: 'remote', hotfix: true, review: 'multi_model' } });
});

test('#791 a manifest may map only one kind', () => {
  assert.deepEqual(Object.keys(load().parseManifest(`${WORKFLOWS}kinds:\n  fix: { name: fix }\n`).kinds), ['fix']);
});

test('#791 a manifest without kinds reads an empty map', () => {
  assert.deepEqual(load().parseManifest(WORKFLOWS).kinds, {});
});

test('#791 a kind naming a workflow not in the manifest is left out', () => {
  const { kinds } = load().parseManifest(`${WORKFLOWS}kinds:\n  feature: { name: hero }\n  fix: { name: ghost, mode: remote }\n`);
  assert.equal(kinds.fix, undefined);
});

test('#791 a kind naming a workflow not in the manifest is an error naming it', () => {
  const { errors } = load().parseManifest(`${WORKFLOWS}kinds:\n  fix: { name: ghost }\n`);
  assert.equal(errors.some((e) => e.includes('ghost')), true, `errors: ${JSON.stringify(errors)}`);
});

test('#791 readManifest gives the folder\'s kinds', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-791-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, '.multiagent'));
  fs.writeFileSync(path.join(dir, '.multiagent', 'project.yaml'), MAP);
  assert.deepEqual(load().readManifest(dir).kinds.fix, { name: 'fix', inputs: { mode: 'remote' } });
});

test('#791 a folder without a manifest reads an empty map', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-791-none-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(load().readManifest(dir).kinds, {});
});
