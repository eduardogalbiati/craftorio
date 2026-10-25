// Preloaded into each test file's process by scripts/test.js (--require): once the file's tests and
// hooks end, a process that a leftover handle keeps alive exits after a short grace (#390), so it
// never holds the run's worktree. It replaces --test-force-exit, which calls process.exit() right
// after the last test: on Windows (Node 24) that races V8's background threads and aborts the process
// with `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c` after a fetch()
// (test/workspace/mobile-gates-answers.test.js, about 1 run in 40 under the suite's load). A file with nothing
// left running exits on its own, the normal way.
// Only a test file's process (NODE_TEST_CONTEXT) arms it, wherever --require loads it (scripts/test.js's
// run() execArgv, or a runner given --require by hand).
if (process.env.NODE_TEST_CONTEXT) {
  const { after } = require('node:test');
  const GRACE_MS = 5000;
  after(() => { setTimeout(() => process.exit(), GRACE_MS).unref(); });
}
