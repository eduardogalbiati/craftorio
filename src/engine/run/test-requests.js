// Tests around an agent's turn (#250, from src/engine/workflow.js): the ```run-tests requests a turn
// ends with (`serveTestRequests`, `runTestRequest`, #212) and the follow-up prompt with their result,
// the code → tests map written for the agents (`writeTestMap`, #219), the affected test files of a
// `scope: affected` suite step (`affectedSelection`), the leftover test files a step commits
// (`commitLeftoverTests`, #209), and the prompts that send back a turn that edited test files or
// protected files (`testsRefusedPrompt`, `protectedRefusedPrompt`, #220).

'use strict';

const fs = require('fs');
const path = require('path');
const { git } = require('../worktree');
const capabilities = require('../capabilities');
const { testMap, testMapMarkdown } = require('../affected-tests');
const testPaths = require('../test-paths');
const { render } = require('./templates');
const {
  extractJson,
  MAX_TEST_REQUESTS,
  parseTestRequest,
  validateSchema,
} = require('./outputs');

const methods = {
  // The test files the run's change can break (#212, src/engine/affected-tests.js), plus the files
  // that failed in an earlier round (`this.suiteFailedFiles`): { mode, files, reasons, why, ... }.
  // Simulation: two simulated files. A run without a worktree or a base: the whole suite (the
  // machine adapter's affectedTests, src/engine/machine-actions.js).
  affectedSelection() {
    const base = this.worktree?.base || render(this.wf.orchestrator?.worktree?.base || '', this.ctx).trim();
    return this.machine.affectedTests({ root: this.ctx.worktree_dir, base, failed: this.suiteFailedFiles });
  },

  // `commit_tests: true` on the test writer's step (#209): the run never goes on (build, evidence,
  // verify, the local merge) with its files uncommitted. Only the run's own worktree is touched.
  // Leftovers that are all test files (tests_paths) are committed by the engine, without a model
  // call; other changed files (production code, generated files) are never committed: the step goes
  // back to its agent once with the list, then a gate asks the owner.
  async commitLeftoverTests(step, st, output) {
    const dir = this.worktree?.workDir;
    if (!dir) return output;
    const agentName = step.agent;
    if (output?.committed === false) {
      this.emitEvent('log', { level: 'warn', kind: 'tests_uncommitted', step_id: step.id, agent: agentName, message: `[${agentName}] answered committed: false in ${step.id}; the orchestrator checks the worktree for files left uncommitted.` });
    }
    const isTest = testPaths.testMatcher(this.wf.tests_paths);
    const leftovers = async () => {
      const root = await git(['rev-parse', '--show-toplevel'], dir);
      const files = (await testPaths.localChanges(root)).sort();
      return { root, tests: files.filter(isTest), others: files.filter((f) => !isTest(f)) };
    };
    const commit = async ({ root, tests }) => {
      const nums = (this.issues || []).map((i) => i?.number ?? (/(\d+)\/?$/.exec(String(i?.url ?? i)) || [])[1]).filter(Boolean);
      await git(['add', '-A', '--', ...tests], root);
      await git(['commit', '-m', `Tests${nums.length ? ` for ${nums.map((n) => `#${n}`).join(', ')}` : ''} (committed by the orchestrator)`], root);
      const hash = await git(['rev-parse', 'HEAD'], root);
      this.testsAutocommitted.push({ step_id: step.id, files: tests, commit: hash });
      this.emitEvent('tests.autocommitted', { step_id: step.id, agent: agentName, files: tests, commit: hash });
      this.emitEvent('log', { level: 'warn', kind: 'tests_autocommitted', step_id: step.id, agent: agentName, files: tests, commit: hash, message: `Tests committed by the orchestrator (${tests.length} file${tests.length === 1 ? '' : 's'}, ${hash.slice(0, 8)}): ${agentName} left them uncommitted in ${step.id}.` });
      return { ...output, committed: true, autocommitted: { files: tests, commit: hash } };
    };
    let left = await leftovers();
    if (!left.others.length) return left.tests.length ? commit(left) : output;

    const list = (files) => files.map((f) => `- ${f}`).join('\n');
    this.emitEvent('log', { level: 'warn', kind: 'tests_uncommitted', step_id: step.id, agent: agentName, files: left.others, message: `[${agentName}] left files that are not tests uncommitted in ${step.id}: ${left.others.join(', ')}; the step goes back to it once.` });
    const fix = `The orchestrator found uncommitted changes in the worktree after your turn. Files that are not tests (tests_paths), which you may not leave changed:\n${list(left.others)}\n`
      + `${left.tests.length ? `Test files, still to commit:\n${list(left.tests)}\n` : ''}`
      + 'Commit your test files; revert the others (`git checkout -- <file>`, or delete a new generated file) or, when a change of production code is needed, revert it and report it in your answer. '
      + 'Then answer again in full, in the format you were asked for, with `committed: true`.';
    const hint = { stepId: step.id, visit: st.visits, schema: step.output_schema, agent: agentName, sequences: this.mockSequences };
    const res = await this.sendToAgent(agentName, fix, { stepId: step.id, hint, retry: true });
    st.lastAnswer = res.text;
    try {
      const out = extractJson(res.text);
      if (!step.output_schema || !validateSchema(out, step.output_schema).length) output = out;
    } catch { /* the first answer stays the step's output */ }

    left = await leftovers();
    if (left.others.length) {
      const gate = {
        id: step.id,
        raw: true,
        message: `${agentName} left files that are not tests uncommitted in ${step.id}, after being asked once to commit its tests and revert the others:\n${list(left.others)}\n\n`
          + `Worktree: ${left.root}. Commit or revert them there, then continue (test files still uncommitted are committed by the orchestrator); or stop the run.`,
        choices: [{ id: 'continue', label: 'Continue' }, { id: 'stop', label: 'Stop the run' }],
      };
      const { answer } = await this.requestApproval(gate);
      if (answer !== 'continue') throw new Error(`Stopped at ${step.id}: files that are not tests were left uncommitted (${left.others.join(', ')}).`);
      left = await leftovers();
    }
    return left.tests.length ? commit(left) : output;
  },

  // The code → tests map of an agent's checkout (#219, a step's `test_map: true`), written to
  // <run_dir>/test-map.md for each turn (the graph of src/engine/affected-tests.js) → its path.
  writeTestMap(agentName) {
    const agent = { ...(this.wf.defaults || {}), ...this.wf.agents[agentName] };
    const file = path.join(this.runDir, 'test-map.md');
    let map;
    try { map = testMap({ root: this.workingDir(agent) }); } catch (e) { map = { mode: 'none', why: e.message.split('\n')[0], sources: {} }; }
    fs.mkdirSync(this.runDir, { recursive: true });
    fs.writeFileSync(file, testMapMarkdown(map));
    return file;
  },

  // Agents ask, the orchestrator runs (#212): a turn that ends with a ```run-tests block (one test
  // file per line, or `affected` for the affected tests of the run's change) has them run by the
  // engine in the agent's working folder (suite-step.js runSuite with files, log
  // logs/tests-<step>-<n>.log), and the agent resumes in the same step with a summary only: the
  // passed / failed counts, each failure's test, file and first lines, and the log's path. At most
  // MAX_TEST_REQUESTS per turn; after that the last answer stands.
  async serveTestRequests(agentName, prompt, res, opts) {
    for (let n = 1; ; n++) {
      const request = parseTestRequest(res?.text);
      if (!request) return res;
      if (n > MAX_TEST_REQUESTS) {
        this.emitEvent('log', { level: 'warn', kind: 'test_request', agent: agentName, message: `[${agentName}] asked to run tests more than ${MAX_TEST_REQUESTS} times in ${opts.stepId || 'a delegated turn'}: its last answer stands` });
        return res;
      }
      const summary = await this.runTestRequest(agentName, opts.stepId, request);
      res = await this.agentTurn(agentName, this.testResultsPrompt(agentName, prompt, res.text, summary), { ...opts, retry: true });
    }
  },

  // Runs one request → the summary for the agent's prompt (never the output itself).
  async runTestRequest(agentName, stepId, request) {
    const agent = { ...(this.wf.defaults || {}), ...this.wf.agents[agentName] };
    const cwd = render(agent.working_dir || '', this.ctx).trim() || this.ctx.worktree_dir;
    this.testRequests = (this.testRequests || 0) + 1;
    const root = path.dirname(path.dirname(this.runDir));
    let files = this.machine.existingFiles(cwd, request.files);
    const missing = request.files.filter((f) => !files.includes(f));
    const reasons = Object.fromEntries(files.map((f) => [f, `asked by ${agentName}`]));
    let why = `asked by ${agentName}`;
    if (request.affected) {
      const sel = this.affectedSelection();
      if (sel.mode !== 'affected') {
        return `The orchestrator did not run the affected tests: ${sel.why}. The whole suite runs in the workflow's suite step, not in your turn; ask for given test files instead (one per line in the run-tests block).`;
      }
      for (const f of sel.files) if (!files.includes(f)) { files.push(f); reasons[f] = sel.reasons[f]; }
      why = sel.why;
    }
    if (!files.length) return `The orchestrator ran no test: ${missing.length ? `these files do not exist in ${cwd}: ${missing.join(', ')}` : 'no test file reaches your change'}.`;
    const name = `tests-${String(stepId || agentName).replace(/[^\w-]/g, '_')}-${this.testRequests}`;
    this.emitEvent('log', { level: 'info', kind: 'test_request', agent: agentName, step_id: stepId || null, message: `[${agentName}] asked to run ${files.length} test file(s): the orchestrator runs them (log logs/${name}.log)` });
    const output = await this.machine.runSuite({
      command: this.suiteCommand(), cwd, runDir: this.runDir, round: this.testRequests, logName: name,
      env: { ...process.env, ...capabilities.agentEnv() }, testWorkers: this.workers?.testWorkers, preexisting: this.preexisting, signal: this.abort.signal,
      base: () => this.suiteBase(), baseCacheDir: path.join(root, 'cache', 'base-tests'),
      files, selection: { mode: 'affected', files, reasons, why },
      log: (level, message) => this.emitEvent('log', { level, message }),
    }).catch((e) => ({ status: 'blocked', reason: e.message, failures: [], preexisting: [] }));
    if (output.log) this.emitEvent('file.saved', { step_id: stepId || null, path: path.join(this.runDir, output.log) });
    this.suiteRuns.requests = (this.suiteRuns.requests || 0) + 1;
    if (output.status === 'blocked') return `The orchestrator could not run the tests: ${output.reason}`;
    const lines = [
      `The orchestrator ran ${files.length} test file(s) for you (\`${output.command}\`): ${output.status === 'pass' ? 'they passed' : 'they failed'}.`,
      `Passed: ${output.passed ?? '?'}, failed: ${output.failed ?? '?'}${output.timed_out ? ' (timed out)' : ''}. Log: ${path.join(this.runDir, output.log)} (read only the lines you need).`,
    ];
    if (missing.length) lines.push(`Not found, not run: ${missing.join(', ')}.`);
    if (output.failures.length) lines.push('Failures:', ...output.failures.map((f) => `- ${f.test}${f.file ? ` (${f.file})` : ''}${f.error ? `\n  ${String(f.error).split('\n').slice(0, 3).join('\n  ')}` : ''}`));
    if (output.preexisting?.length) lines.push('Also failing on the base (not yours, leave them):', ...output.preexisting.map((f) => `- ${f.test}${f.file ? ` (${f.file})` : ''}`));
    return lines.join('\n');
  },

  // The follow-up turn with a test request's summary. As in retryPrompt, a handoff or ephemeral
  // agent answers in a fresh session, so the task and its previous answer go along.
  testResultsPrompt(agentName, prompt, previous, summary) {
    const next = `${summary}\n\nGo on with your task from here. Answer in full, in the format you were asked for (another run-tests block only if you need another run).`;
    const def = { ...(this.wf.defaults || {}), ...this.wf.agents[agentName] };
    if ((def.session || 'persistent') === 'persistent') return next;
    return `${prompt}\n\n---\nYou already answered this task:\n<previous_answer>\n${String(previous).slice(-20000)}\n</previous_answer>\n\n${next}`;
  },

  // A turn refused because it changed test files. As in retryPrompt, a handoff or ephemeral agent
  // answers in a fresh session, so the task and its previous answer go along.
  testsRefusedPrompt(agentName, prompt, previous, files, head) {
    const fix = 'The orchestrator refused your last turn: it changed test files, and you never create, edit or delete tests'
      + ' (only the test writer does):\n' + files.map((f) => `- ${f}`).join('\n') + '\n'
      + `Put them back as they were before your turn (\`git checkout ${head} -- <file>\` for a changed or deleted file, \`git rm\` for a new one)`
      + ' and commit, keeping your production changes. Describe what should be tested in your answer instead (in `test_notes` when the answer has it).'
      + ' Then answer again in full, in the format you were asked for.';
    const def = { ...(this.wf.defaults || {}), ...this.wf.agents[agentName] };
    if ((def.session || 'persistent') === 'persistent') return fix;
    return `${prompt}\n\n---\nYou already answered this task:\n<previous_answer>\n${String(previous).slice(-20000)}\n</previous_answer>\n\n${fix}`;
  },

  // A turn refused because it changed protected files (#220, protect_files: e.g. the acceptance
  // tests written before the code). Same shape as testsRefusedPrompt.
  protectedRefusedPrompt(agentName, prompt, previous, files, head) {
    const fix = 'The orchestrator refused your last turn: it changed files you may not change (written before your'
      + ' turn, e.g. the acceptance tests your code must pass):\n' + files.map((f) => `- ${f}`).join('\n') + '\n'
      + `Put them back as they were before your turn (\`git checkout ${head} -- <file>\` for a changed or deleted file)`
      + ' and commit, keeping your other changes; make the code pass them instead. If one contradicts the task,'
      + ' say why in your answer (the reviewer decides). Then answer again in full, in the format you were asked for.';
    const def = { ...(this.wf.defaults || {}), ...this.wf.agents[agentName] };
    if ((def.session || 'persistent') === 'persistent') return fix;
    return `${prompt}\n\n---\nYou already answered this task:\n<previous_answer>\n${String(previous).slice(-20000)}\n</previous_answer>\n\n${fix}`;
  },
};

module.exports = {
  methods,
};
