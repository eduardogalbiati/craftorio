// A suite step with no command to run (#71, suite-step.js runSuite): none given and none found from the
// project's files. A project with no test file either has nothing to run: `not_run`, not a failure. Test
// files with no command (or a folder git cannot list) stay `blocked`: test_command is what is missing.
// Only a step whose transitions name `not_run` gets that status (`routedStatus`): any other workflow
// (the owner's copies, a composed one, release) keeps routing it as `blocked`.

const { folderHasTests } = require('./test-paths');

const NO_COMMAND = 'no test command: set the workflow\'s test_command input';
const LOOKED_IN = 'none found in package.json, go.mod, pom.xml, build.gradle, *.csproj, pyproject.toml';

// cwd: the folder the suite would run in; patterns: the workflow's tests_paths (default TESTS_PATHS)
async function suiteWithoutCommand(cwd, patterns) {
  const tests = await folderHasTests(cwd, patterns);
  if (tests === false) return { status: 'not_run', reason: 'the project has no tests' };
  return { status: 'blocked', reason: `${NO_COMMAND} (${tests ? 'the project has test files, but no command was ' : ''}${tests ? LOOKED_IN.replace('none ', '') : LOOKED_IN})` };
}

// the round's output as the step's transitions can route it
function routedStatus(output, step) {
  if (output.status !== 'not_run' || (step.transitions || []).some((t) => /\bnot_run\b/.test(String(t.when || '')))) return output;
  const reason = `${NO_COMMAND} (${output.reason})`;
  return { ...output, status: 'blocked', reason, message: `The suite could not run: ${reason}` };
}

module.exports = {
  routedStatus,
  suiteWithoutCommand,
};
