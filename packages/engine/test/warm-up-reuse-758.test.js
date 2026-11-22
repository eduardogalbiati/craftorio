// #758 (acceptance tests, written before the code): the Warm Up (mapper, #301) also lists, per issue,
// the existing helpers, rules and mapping tables the change should reuse (`reuse` in its answer:
// name, path, line, one line on what it does). Develop's first turn shows the list as "reuse these,
// do not rewrite them", the code reviewer receives the same list for its reuse pass, and an empty
// list is left out of both prompts. A failed Warm Up still goes on to develop (on_error, as today).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow, render, validateSchema } = require('../engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

// every bundled workflow with a Warm Up step (feature.yaml and the two AI Development heroes)
const WORKFLOWS = [
  path.join(ROOT, 'workflows', 'feature.yaml'),
  path.join(ROOT, '.craftorio', 'workflows', 'ai-development-local-hero.yaml'),
  path.join(ROOT, '.craftorio', 'workflows', 'ai-development-remote-hero.yaml'),
].filter((f) => fs.existsSync(f) && /\bwarm_up\b/.test(fs.readFileSync(f, 'utf8')));

const REUSE = [
  { issue: 758, name: 'shQuote', path: 'src/external-terminal.js', line: 35, what: 'quotes one argument for a POSIX shell' },
  { issue: 758, name: 'PROVIDERS', path: 'providers/claude.js', line: 13, what: 'the table of provider ids and their CLIs' },
];

const warmOutput = (reuse) => ({
  map: '## Issue #758\n- workflows/feature.yaml:919 the warm_up step',
  files: ['workflows/feature.yaml'],
  ...(reuse === undefined ? {} : { reuse }),
});

const stepOf = (file, id) => loadWorkflow(file).steps.find((s) => s.id === id);
const nameOf = (file) => path.basename(file, '.yaml');

const baseInputs = { task: 'Warm Up lists the helpers to reuse', base_branch: 'main', issues: [], screenshots: 'all', mode: 'auto', repo_path: 'C:/repo' };
const acc = { branch: 'feat', tests_added: ['packages/engine/test/x.test.js'], committed: true, commit: 'abc1234', criteria: [], affected_tests: [] };

// develop's first turn, right after the Warm Up answered `warm`
function developPrompt(file, warm) {
  return render(stepOf(file, 'develop').prompt, {
    agent: 'developer', run_dir: 'C:/runs/r1', previous_step: 'warm_up', test_map: 'C:/runs/r1/test-map.md',
    inputs: baseInputs, vars: {},
    steps: {
      acceptance_tests: { output: acc },
      red_check: { output: { status: 'fail', message: 'The acceptance tests fail.', affected_tests: [] } },
      ...(warm === undefined ? {} : { warm_up: { output: warm } }),
    },
  });
}

// the code reviewer's prompt on the first review round
function reviewerPrompt(file, warm) {
  return render(stepOf(file, 'code_review').prompt, {
    agent: 'reviewer', run_dir: 'C:/runs/r1', previous_step: 'develop', test_map: 'C:/runs/r1/test-map.md',
    inputs: baseInputs, vars: {},
    steps: {
      acceptance_tests: { output: acc },
      ...(warm === undefined ? {} : { warm_up: { output: warm } }),
      develop: { output: { branch: 'feat', committed: true, commit: 'def5678', files_changed: ['src/x.js'], left_out: [], summary: 'Did it.' } },
    },
  });
}

const DEVELOP_PHRASE = /reuse these,? (and )?do not rewrite them/i;

function assertListsReuse(prompt) {
  for (const r of REUSE) {
    assert.ok(prompt.includes(r.name), `the prompt names ${r.name}`);
    assert.ok(prompt.includes(r.path), `the prompt gives the path ${r.path}`);
    assert.ok(prompt.includes(`${r.path}:${r.line}`) || new RegExp(`${r.path.replace(/[.]/g, '\\.')}[^\\n]{0,40}\\b${r.line}\\b`).test(prompt), `the prompt gives the line of ${r.name}`);
    assert.ok(prompt.includes(r.what), `the prompt says what ${r.name} does`);
  }
}

test('#758: at least one bundled workflow has a Warm Up step', () => {
  assert.ok(WORKFLOWS.length >= 1);
});

for (const file of WORKFLOWS) {
  const wf = nameOf(file);

  test(`#758 ${wf}: the Warm Up's output schema accepts a reuse list (name, path, line, what)`, () => {
    const warm = stepOf(file, 'warm_up');
    const reuse = warm.output_schema.properties.reuse;
    assert.ok(reuse, 'the schema declares reuse');
    assert.equal(reuse.type, 'array');
    assert.equal(reuse.items?.type, 'object');
    for (const k of ['name', 'path', 'line', 'what']) assert.ok(reuse.items.properties?.[k], `a reuse entry has ${k}`);
    assert.deepEqual(validateSchema(warmOutput(REUSE), warm.output_schema), []);
    assert.deepEqual(validateSchema(warmOutput([]), warm.output_schema), [], 'an empty reuse list is valid');
  });

  test(`#758 ${wf}: a reuse entry without its path is refused by the schema`, () => {
    const warm = stepOf(file, 'warm_up');
    const { path: _p, ...noPath } = REUSE[0];
    assert.ok(validateSchema(warmOutput([noPath]), warm.output_schema).length > 0);
  });

  test(`#758 ${wf}: the Warm Up's prompt asks for the reuse list`, () => {
    assert.match(stepOf(file, 'warm_up').prompt, /\breuse\b/i);
  });

  test(`#758 ${wf}: develop's first turn shows the Warm Up's reuse list as "reuse these, do not rewrite them"`, () => {
    const prompt = developPrompt(file, warmOutput(REUSE));
    assert.match(prompt, DEVELOP_PHRASE);
    assertListsReuse(prompt);
  });

  test(`#758 ${wf}: an empty or missing reuse list is left out of develop's prompt`, () => {
    for (const warm of [warmOutput([]), warmOutput(undefined)]) {
      const prompt = developPrompt(file, warm);
      assert.doesNotMatch(prompt, DEVELOP_PHRASE);
      assert.ok(prompt.includes('workflows/feature.yaml:919'), 'the map itself is still there');
    }
  });

  test(`#758 ${wf}: the code reviewer receives the same reuse list, to check the diff against it`, () => {
    const prompt = reviewerPrompt(file, warmOutput(REUSE));
    assertListsReuse(prompt);
    assert.match(prompt, /reuse/i);
  });

  test(`#758 ${wf}: an empty or missing reuse list is left out of the reviewer's prompt`, () => {
    const withList = reviewerPrompt(file, warmOutput(REUSE));
    for (const warm of [warmOutput([]), warmOutput(undefined), undefined]) {
      const prompt = reviewerPrompt(file, warm);
      assert.ok(!prompt.includes('shQuote'));
      assert.ok(prompt.length < withList.length, 'the reuse block is not rendered');
    }
  });

  test(`#758 ${wf}: a failed or timed-out Warm Up still goes on to develop, without a map or a reuse list`, () => {
    assert.equal(stepOf(file, 'warm_up').on_error, 'develop');
    const prompt = developPrompt(file, undefined);
    assert.doesNotMatch(prompt, DEVELOP_PHRASE);
    assert.match(prompt, /without a map/i);
  });
}

// ------------------------------------------------------------------ after review (test step)

// a run with several issues: each reuse entry belongs to one of them
const MULTI_REUSE = [
  { issue: 758, name: 'shQuote', path: 'src/external-terminal.js', line: 35, what: 'quotes one argument for a POSIX shell' },
  { issue: 801, name: 'PROVIDERS', path: 'providers/claude.js', line: 13, what: 'the table of provider ids and their CLIs' },
];
const MULTI_INPUTS = {
  ...baseInputs,
  issues: ['https://github.com/o/r/issues/758', 'https://github.com/o/r/issues/801'],
};
const lineWith = (prompt, s) => prompt.split('\n').find((l) => l.includes(s)) || '';

for (const file of WORKFLOWS) {
  const wf = nameOf(file);

  test(`#758 ${wf}: with several issues, develop's reuse list says which issue each entry is for`, () => {
    const prompt = render(stepOf(file, 'develop').prompt, {
      agent: 'developer', run_dir: 'C:/runs/r1', previous_step: 'warm_up', test_map: 'C:/runs/r1/test-map.md',
      inputs: MULTI_INPUTS, vars: {},
      steps: {
        acceptance_tests: { output: acc },
        red_check: { output: { status: 'fail', message: 'The acceptance tests fail.', affected_tests: [] } },
        warm_up: { output: warmOutput(MULTI_REUSE) },
      },
    });
    assert.match(prompt, DEVELOP_PHRASE);
    assert.match(lineWith(prompt, '`shQuote`'), /#?758\b/, 'the shQuote entry names issue 758');
    assert.match(lineWith(prompt, '`PROVIDERS`'), /#?801\b/, 'the PROVIDERS entry names issue 801');
  });

  test(`#758 ${wf}: with several issues, the reviewer's reuse list says which issue each entry is for`, () => {
    const prompt = render(stepOf(file, 'code_review').prompt, {
      agent: 'reviewer', run_dir: 'C:/runs/r1', previous_step: 'develop', test_map: 'C:/runs/r1/test-map.md',
      inputs: MULTI_INPUTS, vars: {},
      steps: {
        acceptance_tests: { output: acc },
        warm_up: { output: warmOutput(MULTI_REUSE) },
        develop: { output: { branch: 'feat', committed: true, commit: 'def5678', files_changed: ['src/x.js'], left_out: [], summary: 'Did it.' } },
      },
    });
    assert.match(lineWith(prompt, '`shQuote`'), /#?758\b/, 'the shQuote entry names issue 758');
    assert.match(lineWith(prompt, '`PROVIDERS`'), /#?801\b/, 'the PROVIDERS entry names issue 801');
  });

  test(`#758 ${wf}: the reviewer still receives the reuse list on a second review round`, () => {
    const prompt = render(stepOf(file, 'code_review').prompt, {
      agent: 'reviewer', run_dir: 'C:/runs/r1', previous_step: 'develop', test_map: 'C:/runs/r1/test-map.md',
      inputs: baseInputs, vars: {},
      steps: {
        acceptance_tests: { output: acc },
        warm_up: { output: warmOutput(REUSE) },
        code_review: { output: { verdict: 'changes_requested', findings: [{ severity: 'major', title: 'rewrote shQuote' }] } },
        develop: { output: { branch: 'feat', committed: true, commit: 'aaa9999', files_changed: ['src/x.js'], left_out: [], summary: 'Fixed the finding.' } },
      },
    });
    assertListsReuse(prompt);
  });

  test(`#758 ${wf}: the merge-resolution review and the UI reviewer do not get the reuse list`, () => {
    const scope = (agent, vars) => ({
      agent, run_dir: 'C:/runs/r1', previous_step: 'resolve_merge', test_map: 'C:/runs/r1/test-map.md',
      inputs: baseInputs, vars,
      steps: {
        acceptance_tests: { output: acc },
        warm_up: { output: warmOutput(REUSE) },
        resolve_merge: { output: { previous_head: 'aaa1111', head: 'bbb2222', summary: 'Rebased.' } },
        develop: { output: { branch: 'feat', committed: true, commit: 'def5678', files_changed: ['src/x.js'], left_out: [], summary: 'Did it.' } },
      },
    });
    const code = stepOf(file, 'code_review').prompt;
    assert.ok(!render(code, scope('reviewer', { recheck: 'resolution' })).includes('shQuote'), 'not in the resolution review');
    assert.ok(!render(code, scope('ui_reviewer', {})).includes('shQuote'), 'not for the UI reviewer');
  });

  test(`#758 ${wf}: a reuse entry may name its issue by number or by URL`, () => {
    const warm = stepOf(file, 'warm_up');
    const byUrl = [{ ...REUSE[0], issue: 'https://github.com/o/r/issues/758' }];
    assert.deepEqual(validateSchema(warmOutput(byUrl), warm.output_schema), []);
    assert.deepEqual(validateSchema(warmOutput(REUSE), warm.output_schema), []);
  });
}

test('#758: the code-mapping skill has a reuse section, per issue, that searches the issue, the mapped files and the shared modules, within ~30 lines', () => {
  const text = read('skills', 'code-mapping', 'SKILL.md');
  const m = text.match(/^##+ [^\n]*reuse[^\n]*$/im);
  assert.ok(m, 'a heading names the reuse list');
  const start = text.indexOf(m[0]);
  const next = text.slice(start + m[0].length).search(/\n##+ /);
  const section = next === -1 ? text.slice(start) : text.slice(start, start + m[0].length + next);
  assert.match(section, /per issue|each issue/i);
  assert.match(section, /line/i);
  assert.match(section, /packages\/shared/);
  assert.match(section, /packages\/ui-kit/);
  assert.match(section, /expected files/i);
  assert.match(section, /30 lines/);
  assert.match(text, /`reuse`/, 'the answer names the reuse field');
});
