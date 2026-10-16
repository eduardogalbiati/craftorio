// #409: a run attached by a run card's Send to supervisor goes to the model as a [Run] line
// (src/supervisor-chat.js questionText), after the screen and before the question.
const test = require('node:test');
const assert = require('node:assert/strict');
const { questionText } = require('../src/supervisor-chat');

test('#409 questionText adds the attached run after the screen', () => {
  const run = { runId: 'run-1', workflow: 'software-development', status: 'failed', error: 'Tests are red.\nmore', issues: [{ number: 409 }, { number: 12 }] };
  assert.equal(
    questionText('Why?', 'Workflows, runs tab', null, run),
    '[Screen] Workflows, runs tab\n\n[Run] run-1 (software-development), failed, error: Tests are red., issues: #409, #12\n\nWhy?',
  );
});

test('#409 questionText without a run (or a run without an id) is unchanged', () => {
  assert.equal(questionText('Why?', 'Home'), '[Screen] Home\n\nWhy?');
  assert.equal(questionText('Why?', '', null, { workflow: 'x' }), 'Why?');
});
