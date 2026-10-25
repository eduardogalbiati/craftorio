// #327 / #328 review round: the turns the acceptance tests did not reach.
// - the Supervisor's run analysis (supervisor.analyzeRun, option `language`);
// - the Supervisor's watch (supervisor-watch createWatches, option `language()` read at each turn):
//   the [Language] line on the first and on a resumed turn, and a change applies from the next turn;
// - the Product Owner's refactor ranking (refactor-priority prioritize, option `language`);
// - a new epic's body with the platform aliases 'gh' / 'gl' (epics applyEpic, `issuesLanguage`).
// No CLI is started: the providers' runTurn is stubbed (the system boundary).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const providers = require('../engine/providers');
const supervisor = require('../domains/supervisor/supervisor');
const { createWatches } = require('../domains/supervisor/supervisor-watch');
const { prioritize } = require('../domains/refactor/refactor-priority');
const epics = require('../domains/backlog/epics');
const Language = require('@multiagent/shared/language');

const SKILLS = path.join(__dirname, '..', '..', '..', 'skills');
const WORKFLOWS = path.join(__dirname, '..', '..', '..', 'workflows');
const PT = { agents: 'pt-BR', issues: 'en' };

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-review-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// a simulated run's folder: the supervisor reads its events (workflow.started with mock)
function mockRunDir(t) {
  const dir = tmp(t);
  fs.writeFileSync(path.join(dir, 'events.jsonl'), `${JSON.stringify({ type: 'workflow.started', mock: true, file: 'software-development.yaml' })}\n`);
  return dir;
}

// runTurn stubbed: records each prompt and answers with `answer(prompt)`
function stubTurns(t, answer) {
  const prompts = [];
  const original = providers.runTurn;
  t.after(() => { providers.runTurn = original; });
  providers.runTurn = async ({ prompt }) => { prompts.push(prompt); return answer(prompt); };
  return prompts;
}
const count = (text, s) => text.split(s).length - 1;

// ---- the Supervisor's run analysis -------------------------------------------------------------

async function analysisPrompt(t, language) {
  const prompts = stubTurns(t, () => { throw new Error('stop after the prompt'); });
  await assert.rejects(supervisor.analyzeRun({ runDir: mockRunDir(t), question: 'Why?', workflowsDir: WORKFLOWS, skillsDirs: [SKILLS], resolveCommand: () => 'x', language }));
  assert.equal(prompts.length, 1);
  return prompts[0];
}

test('#327 the Supervisor\'s run analysis with agents in pt-BR carries the [Language] line and follows it', async (t) => {
  const prompt = await analysisPrompt(t, PT);
  assert.equal(count(prompt, Language.languageLine({ language: PT })), 1);
  assert.match(prompt, /in the language the Language line names/);
  assert.equal(prompt.includes('in English (the app\'s language)'), false);
});

test('#327 the Supervisor\'s run analysis without a language still writes in English', async (t) => {
  const prompt = await analysisPrompt(t, null);
  assert.match(prompt, /in English \(the app's language\)/);
});

// ---- the Supervisor's watch ---------------------------------------------------------------------

async function until(cond) {
  const deadline = Date.now() + 10000;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('timed out waiting for the watch');
    await new Promise((r) => setTimeout(r, 10));
  }
}

function watchOf(t, language) {
  const runDir = mockRunDir(t);
  const prompts = stubTurns(t, () => ({ text: 'All good.', providerSessionId: 'watch-1', costUsd: 0 }));
  const watches = createWatches({
    events: new EventEmitter(), liveRun: () => ({ mock: true, runDir, wf: { metadata: { name: 'W' } } }), runFolder: () => runDir,
    workflowDirs: () => WORKFLOWS, skillsDirs: () => [SKILLS], resolveCommand: () => 'x', batchMs: 60000, language,
  });
  t.after(() => watches.stop('r1'));
  return { watches, prompts };
}

test('#327 the Supervisor\'s watch carries the [Language] line on its first and on a resumed turn', async (t) => {
  const { watches, prompts } = watchOf(t, () => PT);
  watches.start('r1');
  await until(() => prompts.length === 1 && !watches.state('r1').busy);
  watches.ask('r1', 'Is it fine?');
  await until(() => prompts.length === 2);
  const line = Language.languageLine({ language: PT });
  assert.equal(count(prompts[0], line), 1, 'first turn');
  assert.equal(count(prompts[1], line), 1, 'resumed turn');
  assert.equal(count(prompts[1], '[Language]'), 1);
});

test('#327 the Supervisor\'s watch reads the setting at each turn: a change applies from the next one', async (t) => {
  let language = null;
  const { watches, prompts } = watchOf(t, () => language);
  watches.start('r1');
  await until(() => prompts.length === 1 && !watches.state('r1').busy);
  language = PT;
  watches.ask('r1', 'Is it fine?');
  await until(() => prompts.length === 2);
  assert.equal(prompts[0].includes(Language.languageLine({})), true, 'unset: the English line');
  assert.equal(prompts[1].includes(Language.languageLine({ language: PT })), true, 'after the change');
});

// ---- the Product Owner's refactor ranking -------------------------------------------------------

test('#327 the Product Owner\'s refactor ranking carries the [Language] line of the given language, once', async (t) => {
  const prompts = stubTurns(t, () => { throw new Error('stop after the prompt'); });
  await assert.rejects(prioritize({
    proposals: [], mock: false, backlogDir: tmp(t), projectId: 'p', folder: tmp(t), agent: { model: 'm' },
    skillsDirs: [SKILLS], resolveCommand: () => 'claude', budget: null, language: PT,
  }), /stop after the prompt/);
  assert.equal(prompts.length, 1);
  assert.equal(count(prompts[0], Language.languageLine({ language: PT })), 1);
  assert.equal(count(prompts[0], '[Language]'), 1);
});

// ---- a new epic's body with the platform aliases ------------------------------------------------

async function epicBody(t, platform, repo, issuesLanguage) {
  const calls = [];
  const dir = tmp(t);
  const exec = async (cli, args) => {
    calls.push(args);
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify([{ name: 'epic' }]);
    if (args[0] === 'issue' && args[1] === 'create') return `${repo}${repo.includes('gitlab') ? '/-' : ''}/issues/99\n`;
    return '';
  };
  await epics.applyEpic({ platform, repo, epic: { title: 'New epic', goal: 'Goal text' }, issues: [], epics: [], dir, preview: false, exec, issuesLanguage });
  const create = calls.find((a) => a[0] === 'issue' && a[1] === 'create');
  const flag = create.indexOf('--description');
  if (flag >= 0) return create[flag + 1];
  const file = fs.readdirSync(dir).find((f) => f.endsWith('.md'));
  return fs.readFileSync(path.join(dir, file), 'utf8');
}

test('#328 a new epic on "gh" in pt-BR has the same translated body as on "github"', async (t) => {
  const alias = await epicBody(t, 'gh', 'https://github.com/o/r', 'pt-BR');
  assert.equal(alias.includes('The members of this epic are its sub-issues.'), false, alias);
  assert.equal(alias, await epicBody(t, 'github', 'https://github.com/o/r', 'pt-BR'));
});

test('#328 a new epic on "gl" in pt-BR has the same translated body as on "gitlab"', async (t) => {
  const alias = await epicBody(t, 'gl', 'https://gitlab.com/o/r', 'pt-BR');
  assert.equal(alias.includes('Filed by the Product Owner (#138).'), false, alias);
  assert.equal(alias, await epicBody(t, 'gitlab', 'https://gitlab.com/o/r', 'pt-BR'));
});
