// #725 review: the onboarding's Retry (packages/engine/service/areas/project-onboarding.js retry) runs each
// part on its own: a failed profile runs again while the paid part still runs (the wizard's column Retry
// during the analysis), and a profile job without a profile is a failed job ('no-profile') Retry can rerun.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createOnboarding } = require('../service/areas/project-onboarding');

const GITHUB = 'https://github.com/acme/widgets.git';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(ob, id, pred, what) {
  let last;
  for (let i = 0; i < 300; i++) {
    last = await ob.status(id);
    if (pred(last)) return last;
    await pause(10);
  }
  assert.fail(`${what}: still ${JSON.stringify(last)}`);
}

const git = async (args) => {
  if (args[0] === 'ls-remote') return 'abc123\tHEAD\n';
  if (args[0] === 'clone') fs.mkdirSync(path.join(args[2], '.git'), { recursive: true });
  return '';
};

function setup(t, jobs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-retry-725-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return createOnboarding({
    projectsDir: path.join(root, 'projects'),
    reposDir: path.join(root, 'repos'),
    git,
    cli: async () => ({ installed: true, signedIn: true }),
    jobs,
    slotsDir: path.join(root, 'locks'),
  });
}

test('#725 Retry reruns a failed profile while the project map still runs', async (t) => {
  const calls = { profile: 0, projectMap: 0 };
  let release;
  const held = new Promise((r) => { release = r; });
  t.after(() => release());
  const ob = setup(t, {
    facts: async () => ({ commits: 3 }),
    profile: async () => { calls.profile += 1; if (calls.profile === 1) throw new Error('boom'); return { profile: { mode: 'local', ci: 'none', tests: 'unit' } }; },
    projectMap: async () => { calls.projectMap += 1; await held; return { findings: [] }; },
    ranking: async () => ({ list: [] }),
  });
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await ob.analyze(s.projectId);
  await until(ob, s.projectId, (x) => x.jobs.profile.status === 'failed' && x.jobs.projectMap.status === 'running', 'the profile fails, the map runs');
  await ob.retry(s.projectId);
  await until(ob, s.projectId, (x) => x.jobs.profile.status === 'done', 'the retry runs the profile again');
  assert.equal(calls.profile, 2);
  release();
  const end = await until(ob, s.projectId, (x) => x.status === 'analyzed', 'the analysis ends');
  assert.equal(end.jobs.ranking.status, 'done');
  assert.equal(calls.projectMap, 1, 'the map was not run again');
});

test('#725 a profile job without a profile fails with the code no-profile, and Retry runs it again', async (t) => {
  let n = 0;
  const ob = setup(t, {
    facts: async () => ({ commits: 3 }),
    profile: async () => { n += 1; return n === 1 ? {} : { profile: { mode: 'local', ci: 'none', tests: 'unit' } }; },
    projectMap: async () => ({ findings: [] }),
    ranking: async () => ({ list: [] }),
  });
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  const failed = await until(ob, s.projectId, (x) => x.jobs.profile.status === 'failed', 'the profile fails');
  assert.equal(failed.jobs.profile.code, 'no-profile');
  await ob.retry(s.projectId);
  await until(ob, s.projectId, (x) => x.jobs.profile.status === 'done', 'the retry runs the profile again');
  assert.equal(n, 2);
});

test('#725 Retry runs again a profile job done without a valid profile', async (t) => {
  let n = 0;
  const ob = setup(t, {
    facts: async () => ({ commits: 3 }),
    profile: async () => { n += 1; return { profile: n === 1 ? { merge: 'local' } : { mode: 'local', ci: 'none', tests: 'unit' } }; },
    projectMap: async () => ({ findings: [] }),
    ranking: async () => ({ list: [] }),
  });
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, (x) => x.jobs.profile.status === 'done', 'the profile ends');
  await pause(20);
  await ob.retry(s.projectId);
  await until(ob, s.projectId, (x) => x.jobs.profile.profile?.mode === 'local', 'the retry runs the profile again');
  assert.equal(n, 2);
});
