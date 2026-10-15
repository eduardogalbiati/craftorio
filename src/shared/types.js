// @ts-check
// The core shapes as JSDoc types (#346), for the files that opt in to the checker (`// @ts-check`,
// scripts/typecheck.js): `/** @param {import('./shared/types').RoadmapItem} item */`. Each matches
// what the code writes today: a field that can be missing is optional, a field always written (even
// as null) is required. Types, plus RUN_EVENT_TYPES (the union's `type` values) so the module loads
// like every src/shared/ module (#345).
//   - RunSummary: runs/<id>/summary.json (WorkflowRun.finish, src/engine/workflow.js), upgraded on
//     read by src/shared/run-record.js;
//   - RunEvent: a line of runs/<id>/events.jsonl (emitEvent), a union by `type`;
//   - Roadmap, RoadmapStage, RoadmapItem: backlog/<project>.roadmap.json (src/roadmap.js);
//   - Workflow, WorkflowStep: a loaded workflow YAML (src/engine/run/load.js, FIELD_RULES);
//   - SessionRecord: a session's snapshot (src/engine/run/sessions.js) in session.* events and
//     summary.sessions.

/**
 * Tokens of a turn, a session or a run.
 * @typedef {{ input: number, output: number, cache_read: number, cache_write: number, reasoning: number }} Tokens
 */

/**
 * @typedef {object} SessionRecord
 * @property {string} id 'orchestrator' or `s<n>`
 * @property {string} agent
 * @property {string} provider
 * @property {string} model
 * @property {string | null} effort
 * @property {string | null} parent_id
 * @property {string | null} step_id
 * @property {string} opened_at
 * @property {string | null} closed_at
 * @property {number} duration_ms
 * @property {number} active_ms
 * @property {number} idle_ms
 * @property {number} turns
 * @property {Tokens} tokens
 * @property {number} cost_usd
 * @property {string} status idle, active, waiting, error, success, failed, cancelled
 * @property {string | null} provider_session_id
 * @property {string | null} cwd
 * @property {string | null} mode
 * @property {number} [estimated_cost_usd]
 * @property {true} [cost_not_recorded]
 * @property {number} [cli_total_cost_usd]
 * @property {string} [simulates]
 * @property {{ from: string, reason: string }} [fallback_from]
 * @property {string | null} [last_turn_at] the cache state (#320): not on the orchestrator's session
 * @property {number | null} [context_tokens]
 * @property {number | null} [start_context_tokens]
 * @property {number | null} [fresh_after_idle_ms]
 * @property {boolean} [has_note]
 * @property {number} [cache_lifetime_ms]
 * @property {number} [cold_resume_usd]
 * @property {true} [rotate_pending]
 * @property {{ kind: 'new' | 'fresh' | 'resume' | 'warm' | 'cold', until?: string, since?: string } | null} [next_turn]
 */

/**
 * The run's worktree in its summary: `{ dir: null, work_dir }` without a git worktree.
 * @typedef {object} RunWorktree
 * @property {string | null} dir
 * @property {string} work_dir
 * @property {string} [repo]
 * @property {string} [base]
 * @property {string} [ref]
 * @property {string} [commit]
 * @property {string | null} [branch]
 * @property {boolean} [removed]
 * @property {boolean} [branch_deleted]
 */

/**
 * @typedef {object} RunSummary
 * @property {string} run_id
 * @property {string} [workflow] the workflow's metadata.name
 * @property {string | null} project_id
 * @property {'success' | 'failed' | 'cancelled' | 'paused'} status
 * @property {{ step: string, next: string | null, at: string }} [paused] where a paused run stopped, Resume continues there (issue 368)
 * @property {string} started_at
 * @property {string} finished_at
 * @property {number} duration_ms
 * @property {Record<string, any>} inputs
 * @property {boolean} mock
 * @property {RunWorktree | null} worktree
 * @property {{ branch: string, base: string, commit: string } | null} local_merge
 * @property {Tokens} tokens
 * @property {number} cost_usd
 * @property {'per_turn'} cost_accounting
 * @property {'max_result'} turn_cost
 * @property {{ agents: Record<string, object>, waste_tokens: number }} context
 * @property {{ steps: Record<string, object>, duration_ms: number, active_ms: number, waiting_ms: number, stalled_ms: number, gates: Record<string, { waits: number, wait_ms: number }>, gate_wait_ms: number }} timing
 * @property {Record<string, { visits: number, output: any }>} steps
 * @property {object[]} [groups] the workflow's groups
 * @property {object[]} progress
 * @property {SessionRecord[]} sessions
 * @property {{ number: number, url: string, title: string }[]} [issues]
 * @property {{ tag: string, base: string, commit: string, pushed: boolean, issues: object[], simulated?: boolean }} [release]
 * @property {Record<string, { polls: number, agent_calls: number, completed: boolean, errors: number }>} [probes]
 * @property {{ step: string, test: string, file: string, reason: string }[]} [preexisting_failures]
 * @property {object[]} [tests_plan]
 * @property {{ engine: number, agents: number }} [suite_runs]
 * @property {{ step_id: string, files: string[], commit: string }[]} [tests_autocommitted]
 * @property {number} [tool_timeouts]
 * @property {Record<string, any>} [outputs]
 * @property {object} [then]
 * @property {{ run_id: string, workflow?: string, pipeline?: string }} [from]
 * @property {{ run_id: string, workflow?: string, step_id?: string, index?: number, depth: number }} [parent_run]
 * @property {{ run_id: string, step_id: string, visit: number, index?: number, label?: string, workflow: string, status: string, resumed_from?: string, reused?: boolean, cost_usd?: number }[]} [child_runs]
 * @property {number} [children_cost_usd] written with child_runs
 */

/**
 * What every event carries: emitEvent adds seq and run_id; the worktree cleanup's worktree.removed
 * and the session.attempt_stopped the run record's upgrade rebuilds have only ts and type.
 * @typedef {{ seq?: number, ts: string, run_id?: string }} EventEnvelope
 */

/**
 * @typedef {EventEnvelope & { type: 'workflow.started', workflow: string, version: any, project_id: string | null, file: string, inputs: Record<string, any>, mock: boolean, run_dir: string, cost_accounting: 'per_turn', agent_names: object, agents: Record<string, { provider: string, model: string, effort: string | null }>, display: object, steps: { id: string, type: string, agent: string | null }[], groups: any, issues?: object[], tests_plan?: object[], attachments?: object[], resumed_from?: { run_id: string, step: string }, then?: object, from?: object, parent_run?: object, personas?: object, agent_overrides?: object }} WorkflowStartedEvent
 * @typedef {EventEnvelope & { type: 'workflow.finished', status: RunSummary['status'], error: string | null, summary: RunSummary, outputs?: Record<string, any>, then?: object }} WorkflowFinishedEvent
 * @typedef {EventEnvelope & { type: 'run.then', then: object, by: string }} RunThenEvent
 * @typedef {EventEnvelope & { type: 'log', level: string, message: string, kind?: string, step_id?: string, agent?: string, [field: string]: any }} LogEvent
 * @typedef {EventEnvelope & { type: 'step.started', step_id: string, visit: number, iteration: number, step_type: string, agent: string | null }} StepStartedEvent
 * @typedef {EventEnvelope & { type: 'step.finished', step_id: string, visit: number, iteration: number, output: any, duration_ms: number, error?: true, probe?: object }} StepFinishedEvent
 * @typedef {EventEnvelope & { type: 'step.transition', from: string, to: string, when: string, status?: string }} StepTransitionEvent
 * @typedef {EventEnvelope & { type: 'step.goal', step_id: string, goal: string, met: boolean, iteration: number }} StepGoalEvent
 * @typedef {EventEnvelope & { type: 'step.probe', step_id: string, probe: string, target: string, state: string, detail: string, action: string, iteration?: number, polls?: number }} StepProbeEvent
 * @typedef {EventEnvelope & { type: 'step.waiting', step_id: string, until: string, interval_ms: number }} StepWaitingEvent
 * @typedef {EventEnvelope & { type: 'action.executed', command: string, output: string, skipped?: true, exit_code?: number }} ActionExecutedEvent
 * @typedef {EventEnvelope & { type: 'release.shipped', tag: string, base: string, commit: string, pushed: boolean, commits: number, issues: object[] }} ReleaseShippedEvent
 * @typedef {EventEnvelope & { type: 'worktree.merged', branch: string, base: string, commit: string, checkout: any, rebased: boolean, base_commit: string }} WorktreeMergedEvent
 * @typedef {EventEnvelope & { type: 'worktree.ready', dir: string, work_dir: string, repo: string, base: string, ref: string, commit: string, reused: boolean, recreated: boolean }} WorktreeReadyEvent
 * @typedef {EventEnvelope & { type: 'deps.ready', for: string, dir: string, after: any, status: string, hit: boolean, lockfile: any, manager: any, key: any, entry: any, seconds: number, waited: any, reason: any }} DepsReadyEvent
 * @typedef {EventEnvelope & { type: 'worktree.removed', dir: string, removed: boolean, branch: string | null, branch_deleted: boolean, wip_commit?: string, by?: 'cleanup' }} WorktreeRemovedEvent
 * @typedef {EventEnvelope & { type: 'worktree.kept', dir: string, branch: string | null }} WorktreeKeptEvent
 * @typedef {EventEnvelope & { type: 'worktree.processes_stopped', dir: string, after: any, processes: { pid: number, exe: string, cwd: string, reason: string, stopped: boolean, error: any }[] }} WorktreeProcessesStoppedEvent
 * @typedef {EventEnvelope & { type: 'limit.exceeded', limit: string, value: number, current?: number, children?: number, paused?: boolean }} LimitExceededEvent
 * @typedef {EventEnvelope & { type: 'limits.expanded', day: string, limits: object }} LimitsExpandedEvent
 * @typedef {EventEnvelope & { type: 'budget.exceeded', provider: string, usd: number, tokens: number, limit_usd: number | null, limit_tokens: number | null, blocked: boolean }} BudgetExceededEvent
 * @typedef {EventEnvelope & { type: 'approval.requested', approval_id: string, step_id: string, message: string, choices: object[] | null, feedback: object | null, brief: any, approve?: { label: string, help: string }, reject?: { label: string, help: string }, report?: string, work_dir?: string, run_app?: true, local_preview?: object, diff_base?: string, supervisor?: object, save_to_issue?: { choice: string, issue: object } }} ApprovalRequestedEvent
 * @typedef {EventEnvelope & { type: 'approval.resolved', approval_id: string, step_id?: string, approved?: boolean, choice?: string, by: string, wait_ms?: number, withdrawn?: true, reason?: string, intent?: string, answered_by?: string, via?: string, device?: string, commit?: string, feedback?: string, attachments?: object[], confirmed_at_resume?: true, note?: string }} ApprovalResolvedEvent
 * @typedef {EventEnvelope & { type: 'file.saved', step_id: string, path: string, agent?: string }} FileSavedEvent
 * @typedef {EventEnvelope & { type: 'decision.logged', agent: string, step_id: string, count: number, path: string }} DecisionLoggedEvent
 * @typedef {EventEnvelope & { type: 'screenshots.waiting', step_id: string, holder_pid: number | null, holder: string | null }} ScreenshotsWaitingEvent
 * @typedef {EventEnvelope & { type: 'memory.hold', step_id: string, waited_ms: number, recovered: boolean, free_bytes: number, floor_bytes: number }} MemoryHoldEvent
 * @typedef {EventEnvelope & { type: 'workflow.child_started', step_id: string, child_run_id: string, workflow: string, index?: number, label?: string, resumed_from?: string, reused?: boolean }} ChildStartedEvent
 * @typedef {EventEnvelope & { type: 'workflow.child_finished', step_id: string, child_run_id: string, workflow: string, status: string, error: string | null, cost_usd: number, index?: number, label?: string }} ChildFinishedEvent
 * @typedef {EventEnvelope & { type: 'session.opened', session_id: string, session: SessionRecord }} SessionOpenedEvent
 * @typedef {EventEnvelope & { type: 'session.status', session_id: string, status: string }} SessionStatusEvent
 * @typedef {EventEnvelope & { type: 'session.closed', session_id: string, status: string, session: SessionRecord }} SessionClosedEvent
 * @typedef {EventEnvelope & { type: 'session.updated', session_id: string, session: SessionRecord }} SessionUpdatedEvent
 * @typedef {EventEnvelope & { type: 'session.message_sent', session_id: string, turn: number, step_id: string | null, prompt: string, timeout_ms: number, attachments?: object[] }} MessageSentEvent
 * @typedef {EventEnvelope & { type: 'session.stream', session_id: string, turn: number, item: object }} SessionStreamEvent
 * @typedef {EventEnvelope & { type: 'session.message_received', session_id: string, turn: number, step_id: string | null, text: string, usage: object, cost_usd: number, duration_ms: number, active_ms: number, waiting_ms: number, stalled_ms: number, session: SessionRecord, context: { start: number | null, peak: number | null }, usage_main?: object, subagents?: object, model_calls?: object[], handoff?: string, subagent_calls?: number, cut?: true, requests?: number }} MessageReceivedEvent
 * @typedef {EventEnvelope & { type: 'session.attempt_stopped', session_id?: string | null, turn?: number, step_id?: string | null, attempt?: number, error?: string, usage?: object | null, model_calls?: object[], cost_usd: number | null, estimated?: boolean, session?: SessionRecord, cost_not_recorded?: true, agent?: string }} AttemptStoppedEvent
 * @typedef {EventEnvelope & { type: 'process.killed', step_id: string | null, session: string | null, pid: number, command_line: string, bytes: number, limit_bytes: number, message: string, notify?: true }} ProcessKilledEvent
 * @typedef {EventEnvelope & { type: 'tests.refused', agent: string, step_id: string, files: string[], attempt: number, protected?: true }} TestsRefusedEvent
 * @typedef {EventEnvelope & { type: 'tests.autocommitted', step_id: string, agent: string, files: string[], commit: string }} TestsAutocommittedEvent
 * @typedef {EventEnvelope & { type: 'agent.fallback', agent: string, step_id: string, from: string, to: string, reason: string }} AgentFallbackEvent
 * @typedef {EventEnvelope & { type: 'handoff.saved', agent: string, step_id: string, visit: number, session_id: string, path: string, note: string, fallback?: any }} HandoffSavedEvent
 * @typedef {EventEnvelope & { type: 'supervisor.started', step_id: string, error: string, kind?: string }} SupervisorStartedEvent
 * @typedef {EventEnvelope & { type: 'supervisor.decision', step_id: string, action: string, explanation: string, instruction: string | null, kind?: string, goto?: string | null, cause_class?: string | null, record?: any, route?: any, recommendation?: string, user_action?: string, command?: string, note?: string }} SupervisorDecisionEvent
 * @typedef {EventEnvelope & { type: 'local_preview.started', step_id: string, approval_id: string, command: string, dir: string, url: string | null, terminal: any, workspace: any, installed: any, start_view?: string }} LocalPreviewStartedEvent
 * @typedef {EventEnvelope & { type: 'local_preview.stopped', step_id: string, approval_id: string, exit_code?: number | null, reason?: string }} LocalPreviewStoppedEvent
 */

/**
 * A line of events.jsonl: one of the event types above, told apart by `type`.
 * @typedef {WorkflowStartedEvent | WorkflowFinishedEvent | RunThenEvent | LogEvent | StepStartedEvent
 *   | StepFinishedEvent | StepTransitionEvent | StepGoalEvent | StepProbeEvent | StepWaitingEvent
 *   | ActionExecutedEvent | ReleaseShippedEvent | WorktreeMergedEvent | WorktreeReadyEvent | DepsReadyEvent
 *   | WorktreeRemovedEvent | WorktreeKeptEvent | WorktreeProcessesStoppedEvent | LimitExceededEvent
 *   | LimitsExpandedEvent | BudgetExceededEvent | ApprovalRequestedEvent | ApprovalResolvedEvent
 *   | FileSavedEvent | DecisionLoggedEvent | ScreenshotsWaitingEvent | MemoryHoldEvent | ChildStartedEvent
 *   | ChildFinishedEvent | SessionOpenedEvent | SessionStatusEvent | SessionClosedEvent | SessionUpdatedEvent
 *   | MessageSentEvent | SessionStreamEvent | MessageReceivedEvent | AttemptStoppedEvent | ProcessKilledEvent
 *   | TestsRefusedEvent | TestsAutocommittedEvent | AgentFallbackEvent | HandoffSavedEvent
 *   | SupervisorStartedEvent | SupervisorDecisionEvent | LocalPreviewStartedEvent | LocalPreviewStoppedEvent} RunEvent
 */

/**
 * An issue of a roadmap item, as the synced backlog gave it when the item was planned.
 * @typedef {object} RoadmapIssue
 * @property {number} number
 * @property {string} [url]
 * @property {string} [title]
 * @property {string} [body]
 * @property {string[]} [labels]
 * @property {string} [updatedAt]
 * @property {object[]} [knownPullRequests]
 */

/**
 * A roadmap item (cleanItem): its first issue's fields are copied onto it too.
 * @typedef {object} RoadmapItem
 * @property {string} id
 * @property {string} workflow
 * @property {string} workflowName
 * @property {Record<string, any>} inputs
 * @property {boolean} mock
 * @property {RoadmapIssue[]} issues
 * @property {import('./roadmap-model').RoadmapItemStatus} status
 * @property {string | null} runId
 * @property {string[]} runs
 * @property {string | null} error
 * @property {number} [number]
 * @property {string} [url]
 * @property {string} [title]
 * @property {string} [body]
 * @property {string[]} [labels]
 * @property {string} [updatedAt]
 * @property {object[]} [knownPullRequests]
 * @property {string} [reason]
 * @property {string} [modeReason]
 * @property {string} [origin]
 * @property {object} [then]
 * @property {object} [cost]
 * @property {object} [agentOverrides]
 * @property {boolean} [waiting] in memory only, never stored
 * @property {object} [run] in memory only, never stored
 */

/**
 * A stage's cut line (#260): `status`, `runId` and `shippedAt` come from its release run.
 * @typedef {{ name: string, status?: 'running' | 'held' | 'failed' | 'shipped', runId?: string, shippedAt?: string }} RoadmapRelease
 */

/**
 * @typedef {object} RoadmapStage
 * @property {string} id
 * @property {string} name '' is shown as "Stage <n>"
 * @property {string} note
 * @property {RoadmapItem[]} items
 * @property {true} [disabled]
 * @property {RoadmapRelease} [release]
 */

/**
 * backlog/<project>.roadmap.json
 * @typedef {object} Roadmap
 * @property {'done' | 'paused' | 'planned' | 'running'} state
 * @property {boolean} simulated
 * @property {string | null} error
 * @property {string | null} pausedBy
 * @property {{ stage: string, pauseAfter?: boolean } | null} scope (#141 a stage run on its own; #391 pauseAfter: the bar's "Pause after this stage")
 * @property {RoadmapStage[]} stages
 * @property {string | null} updatedAt set by every write (null: no file yet)
 * @property {boolean} [live]
 * @property {string} [liveSince]
 * @property {string} [liveBy]
 * @property {{ status: 'added' | 'budget' | 'empty' | 'failed' | 'off' | 'refilling', at: string, added: number, costUsd: number, message: string } | null} [liveRefill]
 * @property {{ at: string, costUsd: number }[]} [liveRefills]
 * @property {{ period: string, spentUsd: number, limitUsd: number, nextUsd: number, stageUsd: number, at: string } | null} [budget]
 * @property {string} [budgetWaived]
 * @property {string | null} [releaseHold]
 */

/**
 * A transition of a step.
 * @typedef {object} WorkflowTransition
 * @property {string} [when]
 * @property {string} [goto]
 * @property {string} [action]
 * @property {{ agent: string, prompt?: string }} [delegate]
 * @property {{ name?: string, max_iterations?: number, on_exhausted?: string }} [loop]
 * @property {number} [max_visits]
 * @property {string} [on_exhausted]
 * @property {string} [on_error]
 * @property {string[]} [recover]
 * @property {any} [precheck]
 * @property {Record<string, any>} [set]
 * @property {string} [status]
 * @property {any} [merge]
 * @property {{ tag?: string }} [ship]
 */

/**
 * A step of a loaded workflow; the fields a step type reads are in FIELD_RULES
 * (docs/agents/engine/field-reference.md).
 * @typedef {object} WorkflowStep
 * @property {string} id
 * @property {'agent' | 'human_approval' | 'project_map' | 'release_version' | 'screenshots' | 'suite' | 'test_ids' | 'workflow'} [type] agent when missing
 * @property {string} [agent]
 * @property {string[]} [agents]
 * @property {string} [prompt]
 * @property {object} [output_schema]
 * @property {string | (string | { path: string, content?: string })[] | { path: string, content?: string }} [save_as]
 * @property {string[]} [skills]
 * @property {object} [capabilities]
 * @property {string} [message] a gate's
 * @property {boolean} [raw]
 * @property {string} [report]
 * @property {{ id: string, label: string, help?: string, feedback_required?: boolean, then?: object }[]} [choices]
 * @property {boolean | { label?: string, placeholder?: string }} [feedback]
 * @property {string} [kind] 'escalation' on a gate the supervisor on call may try first
 * @property {{ probe?: string, target?: string, on_fail?: string, recover?: string[] }} [check]
 * @property {string | number} [timeout]
 * @property {string} [command] a suite step's
 * @property {string} [from] a screenshots step's
 * @property {string} [workflow] a workflow step's
 * @property {WorkflowTransition[]} [transitions]
 * @property {string} [on_error]
 */

/**
 * A loaded workflow YAML (loadWorkflow): `steps` and `agents` are required.
 * @typedef {object} Workflow
 * @property {WorkflowStep[]} steps
 * @property {Record<string, object>} agents
 * @property {{ name?: string, version?: any, description?: string, category?: string, tags?: string[], merges?: any }} [metadata]
 * @property {Record<string, object>} [providers]
 * @property {object} [defaults]
 * @property {Record<string, object>} [inputs]
 * @property {Record<string, { timeout_factor?: number, max_total_cost_usd?: number }>} [models]
 * @property {string[]} [tests_paths]
 * @property {Record<string, object>} [mcp_servers]
 * @property {{ name: string, steps: string[] }[]} [groups]
 * @property {Record<string, { type?: string, description?: string, value: string }>} [outputs]
 * @property {object} [orchestrator]
 * @property {object} [observability]
 */

// The one value of this module: every `type` of RunEvent, sorted (test/types-346.test.js keeps it
// equal to the union). Browser: window.CoreTypes; Node: module.exports.
(function (root) {
  /** @type {RunEvent['type'][]} */
  const RUN_EVENT_TYPES = [
    'action.executed',
    'agent.fallback',
    'approval.requested',
    'approval.resolved',
    'budget.exceeded',
    'decision.logged',
    'deps.ready',
    'file.saved',
    'handoff.saved',
    'limit.exceeded',
    'limits.expanded',
    'local_preview.started',
    'local_preview.stopped',
    'log',
    'memory.hold',
    'process.killed',
    'release.shipped',
    'run.then',
    'screenshots.waiting',
    'session.attempt_stopped',
    'session.closed',
    'session.message_received',
    'session.message_sent',
    'session.opened',
    'session.status',
    'session.stream',
    'session.updated',
    'step.finished',
    'step.goal',
    'step.probe',
    'step.started',
    'step.transition',
    'step.waiting',
    'supervisor.decision',
    'supervisor.started',
    'tests.autocommitted',
    'tests.refused',
    'workflow.child_finished',
    'workflow.child_started',
    'workflow.finished',
    'workflow.started',
    'worktree.kept',
    'worktree.merged',
    'worktree.processes_stopped',
    'worktree.ready',
    'worktree.removed',
  ];
  const api = { RUN_EVENT_TYPES };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CoreTypes = api;
  // (globalThis is the window in a browser: no `window` name, which a file checked alone would not know)
})(/** @type {any} */ (globalThis));
