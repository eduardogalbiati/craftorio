// #731: project-map.js drawMap / planPrompt internals (the developer's tests): the new round's prompt carries
// the validator's report and the refused plan, never the Oracle's analysis prompt; an answer without a
// city_plan fails with a readable reason after the rounds; a refused budget fails as `refused`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const projectMap = require('../../domains/project/project-map');

const FACTS = { files: 3, manifests: ['package.json'], folders: { src: 2 }, patterns: { '*.js': 2 }, folder_city: { districts: [] }, current_plan: null };

test('#731 planPrompt: the first round has the facts; a new round the report and the previous plan', () => {
  const first = projectMap.planPrompt(FACTS, { skill: '' });
  assert.match(first, /tracked files: 3/);
  assert.match(first, /city_plan/);
  assert.doesNotMatch(first, /previous plan failed/);
  assert.doesNotMatch(first, /Architecture analysis of the project/);
  const next = projectMap.planPrompt(FACTS, { previous: { version: 1 }, report: 'coverage 30%', round: 1, skill: '' });
  assert.match(next, /previous plan failed the validation \(round 1\)/);
  assert.match(next, /coverage 30%/);
  assert.match(next, /"version":1/);
});

test('#731 planPrompt: names the project and its read-only tools, and carries the skill', () => {
  const text = projectMap.planPrompt(FACTS, { project: { id: 'ai-memory', name: 'AI Memory' }, skill: '<skill name="project-map">body</skill>' });
  assert.match(text, /"AI Memory" \(projectId "ai-memory"\)/);
  assert.match(text, /repo_read, repo_git with projectId "ai-memory"/);
  assert.doesNotMatch(text, /current folder/);
  assert.match(text, /<skill name="project-map">body<\/skill>/);
});

test('#731 drawMap: the skill comes from skillsDirs, the workspace copy first', async (t) => {
  const where = repo(t);
  const dirs = ['ws', 'bundled'].map((n) => {
    const d = path.join(where.folder, `.skills-${n}`, 'project-map');
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: project-map\ndescription: map\n---\nskill from ${n}\n`);
    return path.dirname(d);
  });
  let prompt = '';
  const oracle = { budgetRefusal: () => null, oneTurn: async (a) => { prompt = a.prompt; return { text: 'no plan' }; } };
  await assert.rejects(projectMap.drawMap({ ...where, projectId: 'p', mock: false, oracle, agent: {}, rounds: 1, skillsDirs: dirs }));
  assert.match(prompt, /skill from ws/);
  assert.doesNotMatch(prompt, /skill from bundled/);
});

function repo(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'map-draw-731-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }));
  const git = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', ...args], { cwd: dir, stdio: 'ignore' });
  git(['init', '-q']);
  fs.writeFileSync(path.join(dir, 'a.js'), '1\n');
  git(['add', '-A']);
  git(['commit', '-q', '--no-verify', '-m', 'first']);
  return { folder: dir, archRoot: path.join(dir, '.arch') };
}

test('#731 drawMap: an answer without a city_plan fails after the rounds, its cost counted per round', async (t) => {
  const where = repo(t);
  let turns = 0;
  const oracle = { budgetRefusal: () => null, oneTurn: async () => { turns += 1; return { text: 'no plan here', costUsd: 0.1 }; } };
  await assert.rejects(projectMap.drawMap({ ...where, projectId: 'p', mock: false, oracle, agent: {}, rounds: 2 }), /answered no city plan/);
  assert.equal(turns, 2);
});

test('#731 drawMap: a refused budget fails as refused, no turn', async (t) => {
  const where = repo(t);
  const oracle = { budgetRefusal: () => ({ text: 'over budget' }), oneTurn: async () => assert.fail('no turn') };
  await assert.rejects(projectMap.drawMap({ ...where, projectId: 'p', mock: false, oracle, agent: {} }), (e) => e.refused === true && /over budget/.test(e.message));
});

test('#731 drawMap: a simulation saves the simulated plan', async (t) => {
  const where = repo(t);
  const out = await projectMap.drawMap({ ...where, projectId: 'p', mock: true });
  assert.equal(out.simulated, true);
  assert.equal(out.cost_usd, null);
  assert.equal(require('../../domains/oracle/oracle-architecture').readPlan(where.archRoot, 'p').plan.districts[0].id, 'everything');
});
