// A suite step with no command to run (#71, suite-step.js runSuite): none given and none found from the
// project's files. A project with no test file either has nothing to run: `not_run`, not a failure. Test
// files with no command (or a folder git cannot list) stay `blocked`: test_command is what is missing.
// Only a step whose transitions name `not_run` gets that status (`routedStatus`): any other workflow
// (the owner's copies, a composed one, release) keeps routing it as `blocked`.
// The reasons read in the interface language (#70): the gates show them.

const I18n = require('@craftorio/shared/i18n');
const { folderHasTests } = require('./test-paths');

const LOOKED_IN = 'package.json, go.mod, pom.xml, build.gradle, *.csproj, pyproject.toml';

// cwd: the folder the suite would run in; patterns: the workflow's tests_paths (default TESTS_PATHS).
// log: null, nothing ran, so the round wrote no log file
async function suiteWithoutCommand(cwd, patterns) {
  const tests = await folderHasTests(cwd, patterns);
  if (tests === false) return { status: 'not_run', reason: I18n.t('engine.suite_no_tests'), log: null };
  return { status: 'blocked', reason: I18n.t(tests ? 'engine.suite_no_command_tests' : 'engine.suite_no_command_none_found', { files: LOOKED_IN }), log: null };
}

// the round's output as the step's transitions can route it
function routedStatus(output, step) {
  if (output.status !== 'not_run' || (step.transitions || []).some((t) => /\bnot_run\b/.test(String(t.when || '')))) return output;
  const reason = I18n.t('engine.suite_no_command_reason', { reason: output.reason });
  return { ...output, status: 'blocked', reason, message: I18n.t('engine.suite_could_not_run', { reason }) };
}

module.exports = {
  routedStatus,
  suiteWithoutCommand,
};
