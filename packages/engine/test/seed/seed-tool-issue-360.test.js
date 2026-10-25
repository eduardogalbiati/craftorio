// #360 packages/engine/domains/seed/seed-tool-issue.js: "Make it a tool" files an issue asking to turn a seed into a
// deterministic tool (preview without filing, or one issue create command through exec).
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../domains/seed/seed-tool-issue');

const SEED = {
  id: 'churn-complexity',
  meta: { name: 'churn-complexity', summary: 'Churn x complexity hotspots', needs: ['git'], produces: ['html'], cost: 'one Oracle turn' },
  body: '# Churn\n\n## VERIFY\n\nRe-check.\n\nTell me:\n- the hotspots\n',
};
const PROJECT = { id: 'p1', folder: 'C:/repo' };
const URL = 'https://github.com/example/repo/issues/42';

function fakeExec() {
  const calls = [];
  const exec = async (cli, args) => {
    calls.push({ cli, args });
    if (args.includes('label') || args.includes('list')) return '[]';
    return `${URL}\n`;
  };
  return { calls, exec };
}

test('#360 a preview files nothing and returns the title and body', async () => {
  const { calls, exec } = fakeExec();
  const out = await load().fileToolIssue({ project: PROJECT, seed: SEED, platform: 'github', repo: 'example/repo', exec, preview: true });
  assert.equal(calls.length, 0);
  assert.equal(out.preview, true);
  assert.equal(out.url, null);
  assert.ok(out.title.includes('churn-complexity'), out.title);
  assert.equal(typeof out.body, 'string');
});

test('#360 the issue body asks for a pure core, a cache, sorted keys, a golden test and VERIFY', async () => {
  const { exec } = fakeExec();
  const out = await load().fileToolIssue({ project: PROJECT, seed: SEED, platform: 'github', repo: 'example/repo', exec, preview: true });
  for (const re of [/pure core/i, /cache/i, /sorted keys/i, /golden test/i, /VERIFY/i]) assert.match(out.body, re);
});

test('#360 on github it runs issue create and returns the printed URL', async () => {
  const { calls, exec } = fakeExec();
  const out = await load().fileToolIssue({ project: PROJECT, seed: SEED, platform: 'github', repo: 'example/repo', exec, preview: false });
  const create = calls.find((c) => c.args.includes('issue') && c.args.includes('create'));
  assert.ok(create, 'an issue create command');
  assert.equal(out.preview, false);
  assert.equal(out.url, URL);
});
