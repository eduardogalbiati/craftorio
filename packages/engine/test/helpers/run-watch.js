// #737: fail fast for the integration tests. `runUntilStall(run, { stallMs })` starts a WorkflowRun
// and resolves when it ends; when no event comes for stallMs it stops the run and rejects naming the
// step it stopped at (run.stepRunning), instead of waiting for the test's 60-90 s timeout.
// Only reads the run's events: the engine is unchanged. Registers no test.

function runUntilStall(run, { stallMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    let timer = null;
    let settled = false;
    const events = [];
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.off('event', onEvent);
      fn(value);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const step = run.stepRunning || '(none)';
        try { run.stop(); } catch { /* already ended */ }
        done(reject, new Error(`run stalled at step "${step}" (no event for ${stallMs} ms)`));
      }, stallMs);
    };
    function onEvent(ev) {
      events.push(ev);
      arm();
    }
    run.on('event', onEvent);
    arm();
    Promise.resolve()
      .then(() => run.start())
      .then(() => done(resolve, { events, finished: events.find((e) => e.type === 'workflow.finished') || null }),
        (err) => done(reject, err));
  });
}

module.exports = {
  runUntilStall,
};
