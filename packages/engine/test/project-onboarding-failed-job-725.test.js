// #725: a failed paid job of the onboarding (packages/engine/service/areas/project-onboarding.js) is a
// state, not "not started", says why in a short reason, and analyzing again never pays twice. Acceptance
// tests, written before the code, on createOnboarding with the fake git, CLI check and analyses of
// project-onboarding.test.js: no network, no model.
//
// Spec (the interface these tests assume):
// - a paid job that fails (projectMap, ranking) no longer puts the onboarding back to status 'ready': once its
//   chain ended the status is neither 'ready' nor 'analyzing' (e.g. 'analyzed' with the failed job, or a
//   status of its own); jobs.<id>.status stays 'failed', the jobs done stay 'done';
// - a failed job's state: { status: 'failed', error: <the full error, for the tooltip>, code, reason }, with
//   code / reason mapped from the known failures:
//     'cli-missing'     "The Product Owner needs claude, which is not installed." (refactor-priority.js) — also
//                       cli: 'claude' (the missing command, so the wizard can word it in its language);
//     'invalid-ranking' "The Product Owner's ranking could not be read: ..." / "... is not valid: ...";
//     'no-folder'       "The project has no folder on this machine: ...";
//     'refused'         the job answered { refused: { reason, text } } (a budget, a run already going);
//     'timeout'         "Timed out after 900s" (providers.js runTurn);
//   reason: a short readable sentence (non-empty, at most 160 characters);
// - analyze(projectId) or retry(projectId) after a failed job runs again only the jobs that failed or never
//   ran: a done project map is not run again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createOnboarding } = require('../service/areas/project-onboarding');

const GITHUB = 'https://github.com/acme/widgets.git';
const JOBS = ['clone', 'facts', 'profile', 'projectMap', 'ranking'];

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'onboarding-725-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

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

const cloneOk = (args) => { fs.mkdirSync(path.join(args[2], '.git'), { recursive: true }); return ''; };
const git = async (args) => {
  if (args[0] === 'ls-remote') return 'abc123\tHEAD\n';
  if (args[0] === 'clone') return cloneOk(args);
  return '';
};

// fake analyses (the system boundary): behave[name]() is the job's answer (throw to fail), changeable mid-test
function fakeJobs(behave = {}) {
  const calls = { facts: 0, profile: 0, projectMap: 0, ranking: 0 };
  const defaults = {
    facts: () => ({ commits: 3 }),
    profile: () => ({ profile: { mode: 'remote', ci: 'release', tests: 'unit' } }),
    projectMap: () => ({ findings: [] }),
    ranking: () => ({ list: [] }),
  };
  const jobs = Object.fromEntries(Object.keys(defaults).map((name) => [name, async () => {
    calls[name] += 1;
    return (behave[name] || defaults[name])();
  }]));
  return { calls, jobs, behave };
}

function setup(t, fake) {
  const root = tmp(t);
  return createOnboarding({
    projectsDir: path.join(root, 'projects'),
    reposDir: path.join(root, 'repos'),
    git,
    cli: async () => ({ installed: true, signedIn: true }),
    jobs: fake.jobs,
    slotsDir: path.join(root, 'locks'),
  });
}

// the chain ended: no job running or waiting, and not analyzing
const ended = (s) => !['cloning', 'analyzing'].includes(s.status)
  && JOBS.every((j) => !['running', 'waiting'].includes(s.jobs?.[j]?.status));

// a project imported and analyzed, its chain ended
async function analyzed(t, fake) {
  const ob = setup(t, fake);
  const s = await ob.start({ name: 'Widgets', repo: GITHUB });
  await until(ob, s.projectId, (x) => x.status === 'ready' && x.jobs.profile.status !== 'running' && x.jobs.profile.status !== 'waiting', 'the clone ends ready');
  await ob.analyze(s.projectId);
  const end = await until(ob, s.projectId, ended, 'the analysis ends');
  return { ob, id: s.projectId, end };
}

const fail = (message) => () => { throw new Error(message); };
const CLI_MISSING = 'The Product Owner needs claude, which is not installed.';

// ---- 6. a failed job is a state ------------------------------------------------------------------

test('#725 a failed ranking after a done project map does not send the onboarding back to ready', async (t) => {
  const { end } = await analyzed(t, fakeJobs({ ranking: fail(CLI_MISSING) }));
  assert.equal(end.jobs.projectMap.status, 'done');
  assert.equal(end.jobs.ranking.status, 'failed');
  assert.notEqual(end.status, 'ready', `the status after a failed paid job: ${end.status}`);
});

test('#725 a failed project map (ranking skipped) does not send the onboarding back to ready either', async (t) => {
  const { end } = await analyzed(t, fakeJobs({ projectMap: fail('Timed out after 900s') }));
  assert.equal(end.jobs.projectMap.status, 'failed');
  assert.notEqual(end.status, 'ready', `the status after a failed paid job: ${end.status}`);
});

// ---- 8. a failed job says why --------------------------------------------------------------------

const CASES = [
  { code: 'cli-missing', behave: fail(CLI_MISSING), error: CLI_MISSING, cli: 'claude', words: /claude/ },
  { code: 'invalid-ranking', behave: fail("The Product Owner's ranking could not be read: ranking: must be array; Unexpected token } in JSON at position 4512 while parsing the answer of the turn"), error: 'could not be read' },
  { code: 'invalid-ranking', behave: fail("The Product Owner's ranking is not valid: ranking[0].id: unknown proposal r-77"), error: 'is not valid' },
  { code: 'no-folder', behave: fail('The project has no folder on this machine: the Product Owner reads its code there.'), error: 'no folder' },
  { code: 'refused', behave: () => ({ refused: { reason: 'daily-budget', text: "The Oracle's daily budget ($5.00) is spent: it starts again tomorrow." } }), error: 'daily budget' },
  { code: 'timeout', behave: fail('Timed out after 900s'), error: 'Timed out' },
];

for (const c of CASES) {
  test(`#725 a ranking failed with "${c.error}" carries code ${c.code}, a short reason and the full error`, async (t) => {
    const { end } = await analyzed(t, fakeJobs({ ranking: c.behave }));
    const job = end.jobs.ranking;
    assert.equal(job.status, 'failed');
    assert.equal(job.code, c.code, `jobs.ranking.code for: ${job.error}`);
    assert.equal(typeof job.reason, 'string', 'jobs.ranking.reason');
    assert.equal(job.reason.trim().length > 0 && job.reason.length <= 160, true, `a short reason: "${job.reason}"`);
    assert.equal(String(job.error || '').includes(c.error), true, `the full error stays in jobs.ranking.error: "${job.error}"`);
    if (c.cli) assert.equal(job.cli, c.cli, 'the missing command');
    if (c.words) assert.match(job.reason, c.words);
  });
}

// ---- 7. no paying twice --------------------------------------------------------------------------

test('#725 analyze again after a failed ranking runs only the ranking: the done project map is not run again', async (t) => {
  const fake = fakeJobs({ ranking: fail(CLI_MISSING) });
  const { ob, id } = await analyzed(t, fake);
  delete fake.behave.ranking; // claude installed
  await ob.analyze(id);
  const end = await until(ob, id, (x) => ended(x) && x.jobs.ranking.status === 'done', 'the second analysis ends with the ranking done');
  assert.equal(fake.calls.projectMap, 1, 'the project map ran once overall');
  assert.equal(fake.calls.ranking, 2, 'the ranking ran again');
  assert.equal(end.jobs.projectMap.status, 'done');
  assert.equal(end.status, 'analyzed');
});

test('#725 Retry after a failed ranking runs only the ranking: the done project map is not run again', async (t) => {
  const fake = fakeJobs({ ranking: fail(CLI_MISSING) });
  const { ob, id } = await analyzed(t, fake);
  delete fake.behave.ranking;
  await ob.retry(id);
  const end = await until(ob, id, (x) => ended(x) && x.jobs.ranking.status === 'done', 'the retry ends with the ranking done');
  assert.equal(fake.calls.projectMap, 1, 'the project map ran once overall');
  assert.equal(fake.calls.ranking, 2, 'the ranking ran again');
  assert.equal(end.status, 'analyzed');
});

test('#725 analyze again after a failed project map runs the map and the ranking once more, and the free jobs not again', async (t) => {
  const fake = fakeJobs({ projectMap: fail('Timed out after 900s') });
  const { ob, id } = await analyzed(t, fake);
  delete fake.behave.projectMap;
  await ob.analyze(id);
  const end = await until(ob, id, (x) => ended(x) && x.jobs.ranking.status === 'done', 'the second analysis ends with the ranking done');
  assert.equal(fake.calls.projectMap, 2);
  assert.equal(fake.calls.ranking, 1, 'the ranking ran once (skipped the first time)');
  assert.equal(fake.calls.facts, 1, 'the facts were not read again');
  assert.equal(fake.calls.profile, 1, 'the profile was not asked again');
  assert.equal(end.status, 'analyzed');
});
