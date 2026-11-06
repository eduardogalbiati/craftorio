// #790: a repository's manifest (.multiagent/project.yaml) names its default workflow. Acceptance tests,
// written before the code.
// Seam: packages/engine/domains/project/project-manifest.js parseManifest / readManifest, which also
// return `default` (a name, or null). A name not in the manifest's `workflows` is an error naming it,
// and that value is ignored. What happens to `workflows` in that case is left open on purpose.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const load = () => require('../../domains/project/project-manifest');

const WORKFLOWS = `version: 1
workflows:
  - name: feature
    category: solo
  - name: hero
    category: solo
`;

function folderWith(t, text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-790-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  if (text != null) {
    fs.mkdirSync(path.join(dir, '.multiagent'));
    fs.writeFileSync(path.join(dir, '.multiagent', 'project.yaml'), text);
  }
  return dir;
}

test('#790 a manifest\'s default naming one of its workflows is read, with no error', () => {
  const out = load().parseManifest(`${WORKFLOWS}default: hero\n`);
  assert.deepEqual([out.default, out.errors], ['hero', []]);
});

test('#790 a manifest without a default reads null', () => {
  assert.equal(load().parseManifest(WORKFLOWS).default, null);
});

test('#790 a default not in the manifest\'s workflows is ignored', () => {
  assert.equal(load().parseManifest(`${WORKFLOWS}default: ghost\n`).default, null);
});

test('#790 a default not in the manifest\'s workflows is an error naming it', () => {
  const { errors } = load().parseManifest(`${WORKFLOWS}default: ghost\n`);
  assert.equal(errors.some((e) => e.includes('ghost')), true, `errors: ${JSON.stringify(errors)}`);
});

test('#790 readManifest gives the folder\'s default', (t) => {
  assert.equal(load().readManifest(folderWith(t, `${WORKFLOWS}default: hero\n`)).default, 'hero');
});

test('#790 a folder without a manifest reads no default', (t) => {
  assert.equal(load().readManifest(folderWith(t, null)).default, null);
});
