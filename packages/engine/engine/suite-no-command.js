// A suite step with no command to run (#71, suite-step.js runSuite): none given and none found from the
// project's files. A project with no test file either has nothing to run: `not_run`, not a failure.
// Test files with no command (#81: a plain HTML site, a Markdown-only repository, where the test writer
// still wrote tests): `not_run` with `no_command: true`, never `blocked`: nothing can run them, so the
// workflow goes on (recorded as `tested: "no test command"`) instead of stopping at a gate for a known
// gap. A folder git cannot list stays `blocked`.
// Only a step whose transitions name `not_run` gets that status (`routedStatus`): any other workflow
// (the owner's copies, a composed one, release) keeps routing it as `blocked`.
// The reasons, and the message of a suite that did not run, read in the interface language (#70): the
// gates show them.

const I18n = require('@craftorio/shared/i18n');
const { folderHasTests } = require('./test-paths');

const LOOKED_IN = 'package.json, go.mod, pom.xml, build.gradle, *.csproj, pyproject.toml';

const noTests = () => ({ status: 'not_run', reason: I18n.t('engine.suite_no_tests') });

// #81: test files, but no runner the project declares
const noTestCommand = () => ({ status: 'not_run', no_command: true, reason: I18n.t('engine.suite_no_test_command', { files: LOOKED_IN }) });

// the message of a round that ran no suite (`not_run` or `blocked`)
function notRunMessage({ status, reason }) {
  return I18n.t(status === 'not_run' ? 'engine.suite_not_run' : 'engine.suite_could_not_run', { reason });
}

// cwd: the folder the suite would run in; patterns: the workflow's tests_paths (default TESTS_PATHS).
// log: null, nothing ran, so the round wrote no log file
async function suiteWithoutCommand(cwd, patterns) {
  const tests = await folderHasTests(cwd, patterns);
  if (tests === false) return { ...noTests(), log: null };
  if (tests) return { ...noTestCommand(), log: null };
  return { status: 'blocked', reason: I18n.t('engine.suite_no_command_none_found', { files: LOOKED_IN }), log: null };
}

// the round's output as the step's transitions can route it
function routedStatus(output, step) {
  if (output.status !== 'not_run' || (step.transitions || []).some((t) => /\bnot_run\b/.test(String(t.when || '')))) return output;
  // #81: a no_command round keeps its own short reason, not the not_run sentence inside the wrapper
  const reason = output.no_command
    ? I18n.t('engine.suite_no_command_tests', { files: LOOKED_IN })
    : I18n.t('engine.suite_no_command_reason', { reason: output.reason });
  return { ...output, status: 'blocked', reason, message: notRunMessage({ status: 'blocked', reason }) };
}

module.exports = {
  noTests,
  notRunMessage,
  routedStatus,
  suiteWithoutCommand,
};
