// Preloaded (node --require) into scripts/run.js by packages/engine/test/run-settings.test.js (#862):
// replaces the engine's WorkflowRun with a subclass that, once the CLI built its run, prints one JSON
// line (prefix RUN-SETTINGS-PROBE) with the options the CLI passed and the run's memory guard, then
// exits before anything runs. No model, no git, no step: only what the CLI hands to WorkflowRun.
const fs = require('fs');
const workflow = require('@craftorio/engine/engine/workflow');

const Original = workflow.WorkflowRun;

class ProbedRun extends Original {
  constructor(options = {}) {
    super(options);
    const guard = this.memoryGuard;
    const language = typeof options.language === 'function' ? options.language() : options.language;
    const report = {
      memoryGuard: guard === null || guard === undefined ? null : { limitBytes: guard.limitBytes, floorBytes: guard.floorBytes },
      idleWarnMs: options.idleWarnMs ?? null,
      models: options.models ?? null,
      fallbacks: options.fallbacks ?? null,
      accounts: options.accounts ?? null,
      accountCooldownMs: options.accountCooldownMs ?? null,
      language: language ?? null,
      testWorkers: options.testWorkers ?? null,
    };
    fs.writeSync(1, `RUN-SETTINGS-PROBE ${JSON.stringify(report)}\n`);
    process.exit(0);
  }
}

workflow.WorkflowRun = ProbedRun;
