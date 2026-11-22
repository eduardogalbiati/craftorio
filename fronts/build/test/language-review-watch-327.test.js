// #327 review round, the Supervisor's watch (packages/engine/fronts/build/domains/supervisor-watch.js createWatches,
// option `language()` read at each turn): the [Language] line on the first and on a resumed turn, and
// a change applies from the next turn. Split from packages/engine/test/language-review-327.test.js in
// phase 4 of the reorganisation (#590): the domain is the build front's. No CLI is started: the
// providers' runTurn is stubbed (the system boundary).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const providers = require('@craftorio/engine/engine/providers');
const { createWatches } = require('@craftorio/engine/fronts/build/domains/supervisor-watch');
const Language = require('@craftorio/shared/language');
const SKILLS = path.join(__dirname, '..', '..', '..', 'skills');
const WORKFLOWS = path.join(__dirname, '..', '..', '..', 'workflows');
const PT = { agents: 'pt-BR', issues: 'en' };

function tmp(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lang-review-watch-'));
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
