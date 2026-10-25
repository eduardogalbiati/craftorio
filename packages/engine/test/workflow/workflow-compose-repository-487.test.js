// #487 (developer's own test): the composed intake and release workflows live under .multiagent/workflows/
// too, so they must load as accepted repository workflows (no ship:, tools within the repository policy),
// for every release style.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { composeWorkflowSet } = require('../../domains/workflow/workflow-compose');
const { loadRepositoryWorkflow } = require('../../engine/run/load');

const profileOf = (over = {}) => ({ team: 'solo', merge: 'local', release: 'milestone', testCommand: 'npm test', ci: null, languages: ['javascript'], ...over });

for (const release of ['milestone', 'per-merge', 'train', 'rc-stable']) {
  test(`#487 the intake and the ${release} release load as accepted repository workflows`, (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfc-repo-487-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
    const out = composeWorkflowSet({ profile: profileOf({ release }), answers: {}, facts: { languages: ['javascript'], skills: [] } });
    for (const w of out.workflows) {
      const file = path.join(dir, ...w.path.split('/'));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, w.yaml);
    }
    const files = Object.fromEntries(out.workflows.map((w) => [w.category, path.join(dir, ...w.path.split('/'))]));
    for (const category of ['intake', 'release']) {
      assert.ok(files[category], `a ${category} workflow`);
      assert.doesNotThrow(() => loadRepositoryWorkflow(files[category], { accepted: true }), `${category} (${release})`);
    }
  });
}
