# The engine's modules by area (#250)

Which file owns which part of a run: `packages/engine/engine/workflow.js` keeps the run loop, one module per area in `packages/engine/engine/run/` holds the rest, so an engine change touches one module.

- `WorkflowRun` (packages/engine/engine/workflow.js) keeps only the run loop: the constructor (run state, inputs,
  agents, template context), `start` and `finish`, `runStep` (one visit of a step, by type), `runAgentStep`
  (prompt, turn, schema retries, `save_as`), `runFanOut`, `startChildRun`, `stop`, `emitEvent`, the
  chaining `then`. Everything else lives in `packages/engine/engine/run/<area>.js` and is mixed into the prototype
  at the end of workflow.js (`mixin(...)`): a module exports `methods`, an object of methods written
  like class methods (`this` is the run), plus the helpers other modules or the public API need;
  `templates.js` and `load.js` export helpers only (no methods, not in `mixin(...)`).
- The public API does not change with the split: `new WorkflowRun(...)`, `loadWorkflow`, `evalExpr`,
  `render` and the helpers `module.exports` lists are re-exported from the modules; the events are the
  same, in the same order (test/slow/engine-run-split-250.slow.test.js compares a mock run of
  ai-development-local-hero with the recorded baseline).
- Where to make a change (the module's header comment lists its methods):
  - `templates.js`: `render`, `evalExpr`, the nunjucks filters, `testsPlan`.
  - `load.js`: `loadWorkflow` and the YAML validators; the vocabularies (`END_STATUSES`,
    `SESSION_MODES`, `MACHINE_STEP_TYPES`, `GATE_KINDS`, `isLooping`) and value parsers
    (`parseDuration`, `parseTokens`, `parseRequests`, `toBoolean`, `renderFileList`).
  - `setup.js`: inputs and defaults, input attachments, agent overrides, disabled agents, personas,
    display names.
  - `transitions.js`: `finishStep` (transitions, actions, precheck, merge, ship, the merge queue),
    counters and `on_exhausted`, /loop waits and blocked iterations, `wait:` probe polling, `merge: local`.
  - `gates.js`: `type: human_approval` (`openGate`, `requestApproval`, `resolveApproval`,
    `withdrawApproval`, `pendingGates`).
  - `sessions.js`: session records and their events, `sendToAgent`, `agentTurn` (modes, rotation,
    the test-file and protected-file guards, cuts), handoff notes, skills.
  - `turns.js`: `invokeTurn` (the provider call, retries, quota errors and fallback chains, idle and
    memory watches, tokens and cost), `turnTimeout`, `countStoppedAttempt`, `workingDir`.
  - `costs.js`: `checkLimits`, `modelLimits`, `checkBudget`, `contextGate`, the children's and the
    supervisor's spend, timing and context metrics, `childRunCost`.
  - `outputs.js`: `extractJson`, `validateSchema`, `parseTestRequest`, `takeHandoff`, the repeat keys
    the stall check compares; `computeOutputs`, `saveOutput`, `preexisting_failures`, the decision log.
  - `supervision.js`: `superviseFailure` and the supervisor on call (stalls, escalation gates, failed
    actions, exhausted loops, idle agents).
  - `checkout.js`: the run's worktree, dependencies, base worktree, scratch workspace, leftover processes.
  - `machine-steps.js`: `type: screenshots`, `suite`, `test_ids`, `check` (#404), `workflow` (child runs), evidence.
  - `test-requests.js`: ```run-tests requests, the test map, affected tests, leftover test commits, the
    refused test/protected edits prompts.
  - `resume.js`: what a resumed run reuses (`seedResume`, `replayConfirmedGate`, `resumeSession`,
    `previousChildren`, `resumableSteps`).
- Rules for the modules: a module requires engine files and the helpers of other run modules (mostly
  the leaf modules `templates`, `load`, `outputs`; `turns` and `costs` lend `gib`, `DENIAL_WARN` and
  `kTokens`), never `../workflow` and never in a cycle (destructured requires bind at load time);
  modules call each other's methods through `this`, never by importing them. `mixin` throws when two
  modules define the same method. The provider call goes through `providers.runTurn` at call time
  (tests fake it on the module's exports). Each module stays under 800 lines and workflow.js under
  1,000 (test/engine-run-split-250.test.js); a new area gets its own file, listed in `mixin(...)`.
