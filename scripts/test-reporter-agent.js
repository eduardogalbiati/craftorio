// The failures-only JSON reporter for `node --test` (#219): one JSON line at the end with the counts
// and, per failure, the test, file, line, the error's first 3 lines and the assertion's expected /
// actual; no passing tests, no colours. scripts/test.js uses it in agent mode; by hand:
//   node --test --test-reporter=./scripts/test-reporter-agent.js test/a.test.js
// The format and the agent-mode detection live in packages/engine/engine/agent-test-report.js.

module.exports = require('@multiagent/engine/engine/agent-test-report').reporter;
