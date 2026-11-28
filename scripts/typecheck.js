// Type checking ratchet (issue #346): TypeScript's checker on JavaScript with JSDoc types, file by
// file. jsconfig.json keeps checkJs off; a file opts in with `// @ts-check` in its leading comments
// and imports the shared shapes from packages/shared/types.js. jsconfig.pages.json is the same for the
// page scripts (ui-kit, fronts, renderers), with the browser's types and the page globals (#52). test/typecheck-346.test.js runs the
// checker (so `npm test` runs it on every OS) and the ratchet:
//   - CHECKED lists the files that opted in: a file that opted in is recorded here and can't opt out;
//   - NEXT is the owner's list of files to check next: a file leaves it when it opts in;
//   - UNCHECKED lists the other files older than the rule for new files (issue #52): a source file in
//     none of the three lists is new (a moved file too) and starts with `// @ts-check`. Generated and
//     vendored files (a generated/ or vendor/ folder) and tests are out. A deleted file leaves NEXT and UNCHECKED;
//   - SILENCED counts the lines of each opted-in file that silence the checker (`@ts-ignore`,
//     `@ts-expect-error`, `@ts-nocheck`, a cast to `any` or `*`), each with its reason on the line: the
//     count only goes down.
// `--next` ranks the files to opt in next: the commits of the last 60 days that fixed them (a subject
// that starts with "Fix"), then those that changed them, with the errors tsc would report on each.
// `npm run check` runs the ratchet, the silenced lines and the checker (scripts/check.js).
//
//   npm run typecheck                   the plain checker (tsc --noEmit -p jsconfig.json, then the pages)
//   node scripts/typecheck.js           the checker and the ratchets, exit 1 on any problem; the coverage
//   node scripts/typecheck.js --next    the files to check next, most valuable first

const fs = require('fs');
const path = require('path');
const { readHistory } = require('./code-health');
const { sourceFiles } = require('./source-tree');
const { countCommits } = require('@craftorio/shared/architecture-model');

const ROOT = path.join(__dirname, '..');
const CONFIGS = ['jsconfig.json', 'jsconfig.pages.json'];

// files that opted in with // @ts-check (sorted, one per line)
const CHECKED = [
  'fronts/ai/views/oracle/oracle.js',
  'fronts/build/views/backlog/backlog-roadmap-meters.js',
  'fronts/build/views/backlog/backlog-roadmap.js',
  'fronts/build/views/projects/project-wizard-folder.js',
  'fronts/build/views/projects/project-wizard-repos.js',
  'fronts/build/views/projects/project-wizard.js',
  'fronts/build/views/run/run-header.js',
  'fronts/build/views/supervisor/supervisor.js',
  'packages/contract/node-globals.js',
  'packages/contract/page-globals.js',
  'packages/engine/domains/backlog/issue-author.js',
  'packages/engine/domains/chat/speech.js',
  'packages/engine/domains/cli/cli-models-cache.js',
  'packages/engine/domains/po/po-mock-epics.js',
  'packages/engine/domains/po/po-outside.js',
  'packages/engine/domains/project/folder-import.js',
  'packages/engine/domains/project/project-map.js',
  'packages/engine/domains/roadmap/roadmap-status.js',
  'packages/engine/domains/roadmap/roadmap.js',
  'packages/engine/domains/run/run-costs.js',
  'packages/engine/domains/supervisor/supervisor-tools.js',
  'packages/engine/domains/usage/cost-estimate.js',
  'packages/engine/domains/workflow/workflow-compose.js',
  'packages/engine/engine/check-findings.js',
  'packages/engine/engine/check-tools.js',
  'packages/engine/engine/expected-files.js',
  'packages/engine/engine/output-lines.js',
  'packages/engine/engine/package-script.js',
  'packages/engine/engine/project-instructions.js',
  'packages/engine/engine/project-version.js',
  'packages/engine/engine/providers.js',
  'packages/engine/engine/push-access.js',
  'packages/engine/engine/run/accounts.js',
  'packages/engine/engine/run/checkout.js',
  'packages/engine/engine/run/costs.js',
  'packages/engine/engine/run/field-rules.js',
  'packages/engine/engine/run/gates.js',
  'packages/engine/engine/run/load.js',
  'packages/engine/engine/run/machine-steps.js',
  'packages/engine/engine/run/orchestrator-choice.js',
  'packages/engine/engine/run/outputs.js',
  'packages/engine/engine/run/pr-fix.js',
  'packages/engine/engine/run/project-map-steps.js',
  'packages/engine/engine/run/refactor-proposals-steps.js',
  'packages/engine/engine/run/release-steps.js',
  'packages/engine/engine/run/resume.js',
  'packages/engine/engine/run/secret-scan-step.js',
  'packages/engine/engine/run/sessions.js',
  'packages/engine/engine/run/setup.js',
  'packages/engine/engine/run/supervision.js',
  'packages/engine/engine/run/templates.js',
  'packages/engine/engine/run/test-requests.js',
  'packages/engine/engine/run/transitions.js',
  'packages/engine/engine/run/turns.js',
  'packages/engine/engine/secret-scan.js',
  'packages/engine/engine/suite-counts.js',
  'packages/engine/engine/suite-failures.js',
  'packages/engine/engine/workflow.js',
  'packages/engine/service/areas/oracle.js',
  'packages/engine/service/areas/project-onboarding.js',
  'packages/engine/service/areas/roadmap.js',
  'packages/engine/service/areas/runs.js',
  'packages/engine/service/channels/nightwatch.js',
  'packages/engine/service/channels/roadmap.js',
  'packages/shared/onboarding-model.js',
  'packages/shared/orchestrator-models.js',
  'packages/shared/platforms/github.js',
  'packages/shared/platforms/gitlab.js',
  'packages/shared/roadmap-model.js',
  'packages/shared/types.js',
  'packages/shared/ui-files.js',
];

// files the owner wants checked next (sorted, one per line); a file leaves this list when it opts in
const NEXT = [
  'packages/engine/domains/roadmap/live-roadmap.js',
  'packages/engine/domains/run/runs.js',
  'packages/engine/domains/usage/budget.js',
  'packages/shared/run-record.js',
];

// source files older than the rule for new files that did not opt in yet and are not in NEXT (sorted,
// one per line); a file leaves this list when it opts in, and no file enters it
const UNCHECKED = [
  'apps/desktop/composition.js',
  'apps/desktop/host/agents-window.js',
  'apps/desktop/host/engine-connection-preload.js',
  'apps/desktop/host/engine-connection-window.js',
  'apps/desktop/host/engine-connection.js',
  'apps/desktop/host/external-terminal.js',
  'apps/desktop/host/ipc-guard.js',
  'apps/desktop/host/keep-awake.js',
  'apps/desktop/host/legacy-user-data.js',
  'apps/desktop/host/main.js',
  'apps/desktop/host/mockups-window.js',
  'apps/desktop/host/open-guard.js',
  'apps/desktop/host/permissions.js',
  'apps/desktop/host/preload.js',
  'apps/desktop/host/remote-window-preload.js',
  'apps/desktop/host/secrets.js',
  'apps/desktop/host/side-window.js',
  'apps/desktop/host/window-guards.js',
  'apps/desktop/renderer/connection/connection.js',
  'apps/desktop/scripts/package.js',
  'apps/web/composition.js',
  'apps/web/renderer/api-http.js',
  'fronts/ai/ai-home.js',
  'fronts/ai/views/agents/agents.js',
  'fronts/ai/views/errors/errors.js',
  'fronts/ai/views/nightwatch/nightwatch.js',
  'fronts/ai/views/oracle/oracle-chat-model.js',
  'fronts/ai/views/skills/skills.js',
  'fronts/ai/views/usage/usage.js',
  'fronts/analyser/city3d/geometry.js',
  'fronts/analyser/city3d/props.js',
  'fronts/analyser/city3d/store.js',
  'fronts/analyser/city3d/theme.js',
  'fronts/analyser/views/analytics/analytics-agents.js',
  'fronts/analyser/views/analytics/analytics-occupancy.js',
  'fronts/analyser/views/analytics/analytics-run.js',
  'fronts/analyser/views/analytics/analytics.js',
  'fronts/analyser/views/project/project-architecture.js',
  'fronts/analyser/views/project/project-city-agents.js',
  'fronts/analyser/views/project/project-city-cards.js',
  'fronts/analyser/views/project/project-city-connections.js',
  'fronts/analyser/views/project/project-city-impact.js',
  'fronts/analyser/views/project/project-city-modal.js',
  'fronts/analyser/views/project/project-city-modes.js',
  'fronts/analyser/views/project/project-city-notes.js',
  'fronts/analyser/views/project/project-city-panels.js',
  'fronts/analyser/views/project/project-city-release.js',
  'fronts/analyser/views/project/project-city.js',
  'fronts/analyser/views/project/project-conflict-map.js',
  'fronts/analyser/views/project/project-health.js',
  'fronts/analyser/views/project/project-seeds.js',
  'fronts/analyser/views/project/project-settings.js',
  'fronts/analyser/views/project/project-ways-of-working.js',
  'fronts/analyser/views/project/project.js',
  'fronts/build/build-home.js',
  'fronts/build/views/artifacts/artifacts.js',
  'fronts/build/views/backlog/backlog-epics.js',
  'fronts/build/views/backlog/backlog-labels.js',
  'fronts/build/views/backlog/backlog-live.js',
  'fronts/build/views/backlog/backlog-outside.js',
  'fronts/build/views/backlog/backlog-po-confirm.js',
  'fronts/build/views/backlog/backlog-po-kinds.js',
  'fronts/build/views/backlog/backlog-po-options.js',
  'fronts/build/views/backlog/backlog-po-proposals.js',
  'fronts/build/views/backlog/backlog-po-settings-panel.js',
  'fronts/build/views/backlog/backlog-po-settings.js',
  'fronts/build/views/backlog/backlog-po.js',
  'fronts/build/views/backlog/backlog-roadmap-base.js',
  'fronts/build/views/backlog/backlog-roadmap-merge-wait.js',
  'fronts/build/views/backlog/backlog-roadmap-pr-card.js',
  'fronts/build/views/backlog/backlog-roadmap-test-stage.js',
  'fronts/build/views/backlog/backlog.js',
  'fronts/build/views/projects/project-remove.js',
  'fronts/build/views/projects/project-triggers.js',
  'fronts/build/views/projects/project-wizard-activity.js',
  'fronts/build/views/projects/project-wizard-cli.js',
  'fronts/build/views/projects/project-wizard-costs.js',
  'fronts/build/views/projects/project-wizard-resume.js',
  'fronts/build/views/projects/project-wizard-review.js',
  'fronts/build/views/projects/project-wizard-tray.js',
  'fronts/build/views/projects/project-wizard-work-model.js',
  'fronts/build/views/projects/project-wizard-workflows.js',
  'fronts/build/views/projects/project-workflows.js',
  'fronts/build/views/projects/projects.js',
  'fronts/build/views/pulls/pulls.js',
  'fronts/build/views/releases/releases.js',
  'fronts/build/views/run/run.js',
  'fronts/build/views/runchat/pr-monitor-card.js',
  'fronts/build/views/runchat/run-chat-model.js',
  'fronts/build/views/runchat/runchat.js',
  'fronts/build/views/sessions/sessions.js',
  'fronts/build/views/workflows/builder.js',
  'fronts/build/views/workflows/workflow-import.js',
  'fronts/build/views/workflows/workflows.js',
  'fronts/plan/plan-home.js',
  'fronts/plan/views/arena/arena-shuffle.js',
  'fronts/plan/views/arena/arena.js',
  'fronts/plan/views/discovery/discovery-commit.js',
  'fronts/plan/views/discovery/discovery.js',
  'fronts/plan/views/docs/docs-diff.js',
  'fronts/plan/views/docs/docs-list.js',
  'fronts/plan/views/docs/docs-page.js',
  'fronts/plan/views/docs/docs-panels.js',
  'fronts/plan/views/docs/docs.js',
  'fronts/plan/views/duo/duo-issue.js',
  'fronts/plan/views/duo/duo.js',
  'fronts/plan/views/inbox/inbox.js',
  'fronts/plan/views/mockups/mockup-editor.js',
  'fronts/plan/views/mockups/mockup-inspector.js',
  'fronts/plan/views/mockups/mockups.js',
  'packages/contract/index.js',
  'packages/engine/bin/craftorio-engine.js',
  'packages/engine/control/allowlist.js',
  'packages/engine/control/index.js',
  'packages/engine/domains/account/auth-config.js',
  'packages/engine/domains/account/auth.js',
  'packages/engine/domains/agents/agent-inbox.js',
  'packages/engine/domains/agents/agents-usage.js',
  'packages/engine/domains/agents/agents.js',
  'packages/engine/domains/agents/skills.js',
  'packages/engine/domains/analytics/analytics-demo.js',
  'packages/engine/domains/analytics/analytics.js',
  'packages/engine/domains/analytics/time-zone.js',
  'packages/engine/domains/backlog/backlog-refresh.js',
  'packages/engine/domains/backlog/backlog.js',
  'packages/engine/domains/backlog/epics.js',
  'packages/engine/domains/backlog/issues.js',
  'packages/engine/domains/backlog/local-backlog.js',
  'packages/engine/domains/chat/chat-progress.js',
  'packages/engine/domains/chat/mic-permission.js',
  'packages/engine/domains/chat/pasted-images.js',
  'packages/engine/domains/cli/claude-auth.js',
  'packages/engine/domains/cli/cli-config-dirs.js',
  'packages/engine/domains/cli/cli-sessions.js',
  'packages/engine/domains/cli/cli-trust.js',
  'packages/engine/domains/cli/provider-accounts.js',
  'packages/engine/domains/cli/token-check.js',
  'packages/engine/domains/discovery/clarity.js',
  'packages/engine/domains/discovery/discovery-commit.js',
  'packages/engine/domains/discovery/discovery.js',
  'packages/engine/domains/discovery/intents.js',
  'packages/engine/domains/evidence/artifact-categories.js',
  'packages/engine/domains/evidence/coverage-summary.js',
  'packages/engine/domains/evidence/evidence.js',
  'packages/engine/domains/evidence/findings.js',
  'packages/engine/domains/evidence/result-summary.js',
  'packages/engine/domains/evidence/ui-review-checks.js',
  'packages/engine/domains/local/local-preview.js',
  'packages/engine/domains/local/local-push.js',
  'packages/engine/domains/local/local-usage-worker.js',
  'packages/engine/domains/local/local-usage.js',
  'packages/engine/domains/machine/install-commands.js',
  'packages/engine/domains/machine/machine-profile.js',
  'packages/engine/domains/machine/native-bin.js',
  'packages/engine/domains/machine/platform-paths.js',
  'packages/engine/domains/machine/shell.js',
  'packages/engine/domains/machine/simulated-clis.js',
  'packages/engine/domains/machine/terminals.js',
  'packages/engine/domains/machine/tool-worker.js',
  'packages/engine/domains/monitor/connectors.js',
  'packages/engine/domains/monitor/grouping.js',
  'packages/engine/domains/monitor/monitor-store.js',
  'packages/engine/domains/night/night-limits.js',
  'packages/engine/domains/night/night-watch-demo.js',
  'packages/engine/domains/night/night-watch.js',
  'packages/engine/domains/oracle/oracle-actions.js',
  'packages/engine/domains/oracle/oracle-architecture.js',
  'packages/engine/domains/oracle/oracle-check.js',
  'packages/engine/domains/oracle/oracle-knowledge.js',
  'packages/engine/domains/oracle/oracle-platform.js',
  'packages/engine/domains/oracle/oracle-run-analysis.js',
  'packages/engine/domains/oracle/oracle-run-focus.js',
  'packages/engine/domains/oracle/oracle-seeds.js',
  'packages/engine/domains/oracle/oracle-tools.js',
  'packages/engine/domains/oracle/oracle-wake.js',
  'packages/engine/domains/oracle/oracle.js',
  'packages/engine/domains/po/po-chosen-inputs.js',
  'packages/engine/domains/po/po-draft-command.js',
  'packages/engine/domains/po/po-file-issues.js',
  'packages/engine/domains/po/po-hot-files.js',
  'packages/engine/domains/po/po-kinds.js',
  'packages/engine/domains/po/po-mockups.js',
  'packages/engine/domains/po/po-split.js',
  'packages/engine/domains/po/product-owner.js',
  'packages/engine/domains/project/architecture-facts.js',
  'packages/engine/domains/project/base-health.js',
  'packages/engine/domains/project/conflict-map.js',
  'packages/engine/domains/project/project-inputs.js',
  'packages/engine/domains/project/project-manifest.js',
  'packages/engine/domains/project/project-run-defaults.js',
  'packages/engine/domains/project/projects.js',
  'packages/engine/domains/project/repo-performance.js',
  'packages/engine/domains/refactor/refactor-cadence.js',
  'packages/engine/domains/refactor/refactor-issues.js',
  'packages/engine/domains/refactor/refactor-priority.js',
  'packages/engine/domains/refactor/refactor-proposals-run.js',
  'packages/engine/domains/refactor/refactor-proposals.js',
  'packages/engine/domains/releases/release-city.js',
  'packages/engine/domains/releases/releases.js',
  'packages/engine/domains/releases/semver.js',
  'packages/engine/domains/roadmap/roadmap-dependency.js',
  'packages/engine/domains/roadmap/roadmap-history.js',
  'packages/engine/domains/roadmap/roadmap-merge.js',
  'packages/engine/domains/roadmap/roadmap-stack.js',
  'packages/engine/domains/roadmap/roadmap-undo.js',
  'packages/engine/domains/run/occupancy.js',
  'packages/engine/domains/run/run-analysis.js',
  'packages/engine/domains/run/run-artifacts.js',
  'packages/engine/domains/run/run-owner.js',
  'packages/engine/domains/run/run-pr.js',
  'packages/engine/domains/run/run-record.js',
  'packages/engine/domains/run/step-regressions.js',
  'packages/engine/domains/seed/seed.js',
  'packages/engine/domains/seed/seeds.js',
  'packages/engine/domains/session/app-sessions.js',
  'packages/engine/domains/session/session-cache.js',
  'packages/engine/domains/session/session-tail.js',
  'packages/engine/domains/supervisor/supervisor-bridge.js',
  'packages/engine/domains/supervisor/supervisor-chat.js',
  'packages/engine/domains/supervisor/supervisor-mcp.js',
  'packages/engine/domains/supervisor/supervisor.js',
  'packages/engine/domains/triggers/platform-events.js',
  'packages/engine/domains/triggers/triggers.js',
  'packages/engine/domains/usage/actions-usage.js',
  'packages/engine/domains/usage/usage.js',
  'packages/engine/domains/workflow/pipelines.js',
  'packages/engine/domains/workflow/workflow-builder.js',
  'packages/engine/domains/workflow/workflow-categories.js',
  'packages/engine/domains/workflow/workflow-requirements.js',
  'packages/engine/domains/workflow/workflows.js',
  'packages/engine/domains/workspace/app-root.js',
  'packages/engine/domains/workspace/app-update.js',
  'packages/engine/domains/workspace/code-version.js',
  'packages/engine/domains/workspace/json-schema.js',
  'packages/engine/domains/workspace/legacy-env.js',
  'packages/engine/domains/workspace/main-log.js',
  'packages/engine/domains/workspace/mobile-gates-client.js',
  'packages/engine/domains/workspace/mobile-gates-page.js',
  'packages/engine/domains/workspace/mobile-gates-progress.js',
  'packages/engine/domains/workspace/mobile-gates.js',
  'packages/engine/domains/workspace/notifications.js',
  'packages/engine/domains/workspace/settings.js',
  'packages/engine/domains/workspace/state-file.js',
  'packages/engine/domains/workspace/store.js',
  'packages/engine/domains/workspace/worker-client.js',
  'packages/engine/domains/workspace/workspace-instructions.js',
  'packages/engine/domains/workspace/workspace.js',
  'packages/engine/engine/affected-tests.js',
  'packages/engine/engine/agent-test-report.js',
  'packages/engine/engine/base-health-store.js',
  'packages/engine/engine/capabilities.js',
  'packages/engine/engine/check-step.js',
  'packages/engine/engine/child-env.js',
  'packages/engine/engine/command-missing.js',
  'packages/engine/engine/deps-cache.js',
  'packages/engine/engine/gate-summary.js',
  'packages/engine/engine/idle.js',
  'packages/engine/engine/language-skills.js',
  'packages/engine/engine/machine-actions.js',
  'packages/engine/engine/machine-slot.js',
  'packages/engine/engine/memory-guard.js',
  'packages/engine/engine/merge-queue.js',
  'packages/engine/engine/preview-capture.js',
  'packages/engine/engine/probes.js',
  'packages/engine/engine/processes.js',
  'packages/engine/engine/record-docs-step.js',
  'packages/engine/engine/recorder.js',
  'packages/engine/engine/redact-baseline.js',
  'packages/engine/engine/run-settings.js',
  'packages/engine/engine/scenarios.js',
  'packages/engine/engine/screenshot-step.js',
  'packages/engine/engine/server-commands.js',
  'packages/engine/engine/simulation.js',
  'packages/engine/engine/source-text.js',
  'packages/engine/engine/suite-command-line.js',
  'packages/engine/engine/suite-last-green.js',
  'packages/engine/engine/suite-no-command.js',
  'packages/engine/engine/suite-slot.js',
  'packages/engine/engine/suite-step.js',
  'packages/engine/engine/test-ids.js',
  'packages/engine/engine/test-paths.js',
  'packages/engine/engine/test-reads.js',
  'packages/engine/engine/test-timeouts.js',
  'packages/engine/engine/ui-review-checks.js',
  'packages/engine/engine/visual-baselines.js',
  'packages/engine/engine/workflow-step.js',
  'packages/engine/engine/worktree.js',
  'packages/engine/fronts/ai/areas/monitor.js',
  'packages/engine/fronts/ai/channels/monitor.js',
  'packages/engine/fronts/ai/channels/oracle.js',
  'packages/engine/fronts/analyser/areas/diff.js',
  'packages/engine/fronts/analyser/channels/architecture.js',
  'packages/engine/fronts/analyser/channels/diff.js',
  'packages/engine/fronts/analyser/channels/refactor.js',
  'packages/engine/fronts/analyser/channels/seeds.js',
  'packages/engine/fronts/analyser/domains/refactor-outcome.js',
  'packages/engine/fronts/analyser/domains/seed-tool-issue.js',
  'packages/engine/fronts/build/areas/local-preview.js',
  'packages/engine/fronts/build/channels/local-preview.js',
  'packages/engine/fronts/build/channels/supervisor.js',
  'packages/engine/fronts/build/domains/supervisor-watch.js',
  'packages/engine/fronts/plan/areas/discovery-automations.js',
  'packages/engine/fronts/plan/areas/docs-maintain.js',
  'packages/engine/fronts/plan/areas/mockup-live-links.js',
  'packages/engine/fronts/plan/channels/discovery.js',
  'packages/engine/fronts/plan/channels/docs.js',
  'packages/engine/fronts/plan/channels/mockups.js',
  'packages/engine/fronts/plan/domains/discovery-import.js',
  'packages/engine/fronts/plan/domains/docs.js',
  'packages/engine/fronts/plan/domains/mockup-designer.js',
  'packages/engine/fronts/plan/domains/mockups.js',
  'packages/engine/server/index.js',
  'packages/engine/server/listen-host.js',
  'packages/engine/service/areas/app-update.js',
  'packages/engine/service/areas/artifacts.js',
  'packages/engine/service/areas/backlog-watch.js',
  'packages/engine/service/areas/backlog.js',
  'packages/engine/service/areas/base-health.js',
  'packages/engine/service/areas/budget.js',
  'packages/engine/service/areas/chain.js',
  'packages/engine/service/areas/chat-turns.js',
  'packages/engine/service/areas/cli-setup.js',
  'packages/engine/service/areas/conflict-map.js',
  'packages/engine/service/areas/findings.js',
  'packages/engine/service/areas/gates.js',
  'packages/engine/service/areas/index-db.js',
  'packages/engine/service/areas/insights.js',
  'packages/engine/service/areas/interface-language.js',
  'packages/engine/service/areas/keep-awake.js',
  'packages/engine/service/areas/live-roadmap.js',
  'packages/engine/service/areas/local-push.js',
  'packages/engine/service/areas/notifications.js',
  'packages/engine/service/areas/phone-gates.js',
  'packages/engine/service/areas/pipelines.js',
  'packages/engine/service/areas/project-remove.js',
  'packages/engine/service/areas/pulls.js',
  'packages/engine/service/areas/recover.js',
  'packages/engine/service/areas/releases.js',
  'packages/engine/service/areas/repository-workflows.js',
  'packages/engine/service/areas/resume.js',
  'packages/engine/service/areas/run-lists.js',
  'packages/engine/service/areas/run-meta.js',
  'packages/engine/service/areas/sessions.js',
  'packages/engine/service/areas/settings.js',
  'packages/engine/service/areas/terminals.js',
  'packages/engine/service/areas/triggers.js',
  'packages/engine/service/areas/usage.js',
  'packages/engine/service/areas/workflow-interview.js',
  'packages/engine/service/areas/workflows.js',
  'packages/engine/service/areas/workspace.js',
  'packages/engine/service/channels/agents.js',
  'packages/engine/service/channels/analytics.js',
  'packages/engine/service/channels/app-update.js',
  'packages/engine/service/channels/app.js',
  'packages/engine/service/channels/artifacts.js',
  'packages/engine/service/channels/backlog.js',
  'packages/engine/service/channels/chain.js',
  'packages/engine/service/channels/chat.js',
  'packages/engine/service/channels/cli-setup.js',
  'packages/engine/service/channels/findings.js',
  'packages/engine/service/channels/notify.js',
  'packages/engine/service/channels/onboarding.js',
  'packages/engine/service/channels/pasted-images.js',
  'packages/engine/service/channels/phonegates.js',
  'packages/engine/service/channels/pipelines.js',
  'packages/engine/service/channels/product-owner.js',
  'packages/engine/service/channels/projects.js',
  'packages/engine/service/channels/pulls.js',
  'packages/engine/service/channels/releases.js',
  'packages/engine/service/channels/runs.js',
  'packages/engine/service/channels/sessions.js',
  'packages/engine/service/channels/skills.js',
  'packages/engine/service/channels/storage.js',
  'packages/engine/service/channels/triggers.js',
  'packages/engine/service/channels/usage.js',
  'packages/engine/service/channels/voice.js',
  'packages/engine/service/channels/workflows.js',
  'packages/engine/service/common.js',
  'packages/engine/service/contract.js',
  'packages/engine/service/fronts.js',
  'packages/engine/service/index.js',
  'packages/engine/service/manifest.js',
  'packages/engine/service/schemas.js',
  'packages/engine/service/seed-runs.js',
  'packages/shared/architecture-facts-view.js',
  'packages/shared/architecture-model.js',
  'packages/shared/architecture-report.js',
  'packages/shared/backlog-archive.js',
  'packages/shared/chain-model.js',
  'packages/shared/city-agents.js',
  'packages/shared/city-buildings.js',
  'packages/shared/city-connections.js',
  'packages/shared/city-impact.js',
  'packages/shared/city-layout.js',
  'packages/shared/city-model.js',
  'packages/shared/city-release.js',
  'packages/shared/code-complexity.js',
  'packages/shared/default-workflow.js',
  'packages/shared/display-name.js',
  'packages/shared/doc-model.js',
  'packages/shared/findings-model.js',
  'packages/shared/globs.js',
  'packages/shared/i18n.js',
  'packages/shared/json-schema.js',
  'packages/shared/language.js',
  'packages/shared/legacy-storage.js',
  'packages/shared/mockup-model.js',
  'packages/shared/platforms/index.js',
  'packages/shared/po-calibration.js',
  'packages/shared/pr-card.js',
  'packages/shared/project-dir.js',
  'packages/shared/providers/claude.js',
  'packages/shared/providers/codex.js',
  'packages/shared/providers/grok.js',
  'packages/shared/providers/index.js',
  'packages/shared/providers/mock.js',
  'packages/shared/providers/quota-reset.js',
  'packages/shared/providers/usage.js',
  'packages/shared/release-version.js',
  'packages/shared/roadmap-summary.js',
  'packages/shared/run-inputs.js',
  'packages/shared/run-log-path.js',
  'packages/shared/run-plan.js',
  'packages/shared/run-progress-model.js',
  'packages/shared/session-cache.js',
  'packages/shared/session-cost.js',
  'packages/shared/setup-model.js',
  'packages/shared/time-zone.js',
  'packages/shared/workflow-compose.js',
  'packages/ui-kit/account.js',
  'packages/ui-kit/actions.js',
  'packages/ui-kit/activity-line.js',
  'packages/ui-kit/agent-chat.js',
  'packages/ui-kit/agent-colors.js',
  'packages/ui-kit/agent-overrides.js',
  'packages/ui-kit/agent-request.js',
  'packages/ui-kit/agents-window.js',
  'packages/ui-kit/alerts.js',
  'packages/ui-kit/app.js',
  'packages/ui-kit/artifact-menu.js',
  'packages/ui-kit/artifact-render.js',
  'packages/ui-kit/artifacts-panel.js',
  'packages/ui-kit/chain-picker.js',
  'packages/ui-kit/chat-models.js',
  'packages/ui-kit/code-banner.js',
  'packages/ui-kit/command-hint.js',
  'packages/ui-kit/current-project.js',
  'packages/ui-kit/date-range.js',
  'packages/ui-kit/diff-viewer-model.js',
  'packages/ui-kit/diff-viewer.js',
  'packages/ui-kit/estimates.js',
  'packages/ui-kit/findings.js',
  'packages/ui-kit/gate-oracle.js',
  'packages/ui-kit/gate-panel.js',
  'packages/ui-kit/home-cards.js',
  'packages/ui-kit/image-sequence.js',
  'packages/ui-kit/image-viewer-model.js',
  'packages/ui-kit/image-viewer.js',
  'packages/ui-kit/interface-language.js',
  'packages/ui-kit/keep-awake.js',
  'packages/ui-kit/kept-work-dialog.js',
  'packages/ui-kit/live-turn.js',
  'packages/ui-kit/menu.js',
  'packages/ui-kit/nav-groups.js',
  'packages/ui-kit/notification-center.js',
  'packages/ui-kit/occupancy-chip.js',
  'packages/ui-kit/paste-image.js',
  'packages/ui-kit/release-name.js',
  'packages/ui-kit/resume-dialog.js',
  'packages/ui-kit/robots.js',
  'packages/ui-kit/run-badges.js',
  'packages/ui-kit/run-controls.js',
  'packages/ui-kit/run-list.js',
  'packages/ui-kit/run-meta.js',
  'packages/ui-kit/run3d-model.js',
  'packages/ui-kit/run3d-replay.js',
  'packages/ui-kit/run3d-theme.js',
  'packages/ui-kit/run3d.js',
  'packages/ui-kit/run3d/view.js',
  'packages/ui-kit/select-search.js',
  'packages/ui-kit/select.js',
  'packages/ui-kit/setup.js',
  'packages/ui-kit/start-drawer.js',
  'packages/ui-kit/status-pill.js',
  'packages/ui-kit/supervisor-drawer.js',
  'packages/ui-kit/term-dock.js',
  'packages/ui-kit/toast.js',
  'packages/ui-kit/usage-widget.js',
  'packages/ui-kit/view-registry.js',
  'packages/ui-kit/views/dashboard/dashboard.js',
  'packages/ui-kit/views/settings/settings-accounts.js',
  'packages/ui-kit/views/settings/settings-clis.js',
  'packages/ui-kit/views/settings/settings-engine.js',
  'packages/ui-kit/views/settings/settings-language.js',
  'packages/ui-kit/views/settings/settings-markup.js',
  'packages/ui-kit/views/settings/settings-phone.js',
  'packages/ui-kit/views/settings/settings.js',
  'packages/ui-kit/voice.js',
  'packages/ui-kit/workflow-inputs.js',
  'packages/ui-kit/workflows-acceptance.js',
];

// opted-in file -> its lines that silence the checker, each with its reason on the line; only lower it
const SILENCED = {
  'packages/shared/types.js': 1,
};

const TS_CHECK = /^\/\/\s*@ts-check\b/;
const NOT_CHECKED = /(^|\/)(generated|vendor)\//;
const NEXT_WINDOW = '60.days';
const FIX = /^Fix(es|ed)?\b/i;

const readSource = (root, rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8');
// the files the checker is for: the sources but the generated and vendored ones
const checkable = (root) => sourceFiles(root).filter((rel) => !NOT_CHECKED.test(rel));

// true when `// @ts-check` is among the comments before the first line of code
function optsIn(text) {
  let block = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (block) {
      if (line.includes('*/')) block = false;
      continue;
    }
    if (!line || line.startsWith('#!')) continue;
    if (TS_CHECK.test(line)) return true;
    if (line.startsWith('//')) continue;
    if (line.startsWith('/*')) {
      block = !line.includes('*/');
      continue;
    }
    return false;
  }
  return false;
}

// sorted source paths (scripts/source-tree.js) of the files that carry // @ts-check
function findOptedIn({ root = ROOT } = {}) {
  return sourceFiles(root)
    .filter((rel) => optsIn(readSource(root, rel)))
    .sort();
}

// { checked, total }: the files that opted in, of those the checker is for
function coverage({ root = ROOT } = {}) {
  const files = checkable(root);
  const optedIn = new Set(findOptedIn({ root }));
  return { checked: files.filter((f) => optedIn.has(f)).length, total: files.length };
}

// [{ file, kind: 'opted-out' | 'unlisted' | 'leave-list' | 'new-file', message }]; UNCHECKED holds on any
// checkout, but a file of it that another root does not have is no problem there (unless it is given)
function checkRatchet({ root = ROOT, checked = CHECKED, next = NEXT, unchecked = UNCHECKED } = {}) {
  const mustExist = { NEXT: next, UNCHECKED: root !== ROOT && unchecked === UNCHECKED ? [] : unchecked };
  const optedIn = new Set(findOptedIn({ root }));
  const problems = [];
  for (const file of checked) {
    if (!optedIn.has(file)) problems.push({ file, kind: 'opted-out', message: `${file} is in CHECKED but lost its // @ts-check: a file that opted in cannot opt out` });
  }
  for (const file of optedIn) {
    if (!checked.includes(file)) problems.push({ file, kind: 'unlisted', message: `${file} opted in with // @ts-check: add it to CHECKED in scripts/typecheck.js` });
    if (next.includes(file)) problems.push({ file, kind: 'leave-list', message: `${file} opted in with // @ts-check: remove it from NEXT in scripts/typecheck.js` });
    if (unchecked.includes(file)) problems.push({ file, kind: 'leave-list', message: `${file} opted in with // @ts-check: remove it from UNCHECKED in scripts/typecheck.js` });
  }
  for (const [name, list] of Object.entries(mustExist)) {
    for (const file of list) {
      if (!fs.existsSync(path.join(root, ...file.split('/')))) problems.push({ file, kind: 'leave-list', message: `${file} does not exist any more: remove it from ${name} in scripts/typecheck.js` });
    }
  }
  const known = new Set([...checked, ...next, ...unchecked]);
  for (const file of checkable(root)) {
    if (!optedIn.has(file) && !known.has(file)) problems.push({ file, kind: 'new-file', message: `${file} is a new source file without // @ts-check: start it with // @ts-check and add it to CHECKED in scripts/typecheck.js` });
  }
  return problems;
}

// What silences the checker on a line: a comment that is a @ts-ignore, @ts-expect-error or @ts-nocheck
// directive, or a cast to any (`*` is any too). The reason is the text after the directive, or a // comment after the cast.
const DIRECTIVE = /(?:^|\s|\*)(?:\/\/+|\/\*+|\*)\s*@ts-(?:ignore|expect-error|nocheck)\b(.*)$/;
const ANY_CAST = /\/\*\*\s*@type\s*\{\s*(?:any|\*)\s*\}\s*\*\/\s*\(/g;

// { line, reason } of each silencing line of a text (line is 1-based)
function silencedLines(text) {
  return text.split(/\r?\n/).flatMap((source, i) => {
    const directive = DIRECTIVE.exec(source);
    if (directive) return [{ line: i + 1, reason: /\w/.test(directive[1].replace(/\*\/.*$/, '')) }];
    const casts = [...source.matchAll(ANY_CAST)];
    if (!casts.length) return [];
    const last = casts[casts.length - 1];
    return [{ line: i + 1, reason: /\s\/\/.*\w/.test(source.slice(last.index + last[0].length)) }];
  });
}

// [{ file, line?, kind: 'no-reason' | 'more' | 'fewer', message }] for the opted-in files
function checkSilenced({ root = ROOT, recorded = SILENCED } = {}) {
  const problems = [];
  const found = new Map(findOptedIn({ root }).map((file) => [file, silencedLines(readSource(root, file))]));
  for (const [file, lines] of found) {
    for (const { line } of lines.filter((l) => !l.reason)) problems.push({ file, line, kind: 'no-reason', message: `${file}:${line} silences the type checker without its reason: say why on the line, or fix the type` });
    const listed = recorded[file] || 0;
    if (lines.length > listed) problems.push({ file, kind: 'more', message: `${file} has ${lines.length} line(s) that silence the type checker, ${listed} recorded: fix the types (the count in SILENCED of scripts/typecheck.js only goes down)` });
  }
  for (const [file, listed] of Object.entries(recorded)) {
    const count = (found.get(file) || []).length;
    if (count < listed) problems.push({ file, kind: 'fewer', message: `${file} has ${count} line(s) that silence the type checker, fewer than the ${listed} recorded: lower it in SILENCED in scripts/typecheck.js` });
  }
  return problems;
}

// [{ file, line, column, message }] from the checker on one jsconfig of root (line and column are 1-based)
function typecheckConfig(configPath, checkJs) {
  const ts = require('typescript');
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  if (!parsed) return [{ file: configPath, line: 0, column: 0, message: `${path.basename(configPath)} cannot be read` }];
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: { ...parsed.options, checkJs }, projectReferences: parsed.projectReferences });
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  return diagnostics
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => {
      const message = ts.flattenDiagnosticMessageText(d.messageText, '\n');
      if (!d.file) return { file: configPath, line: 0, column: 0, message };
      const { line, character } = d.file.getLineAndCharacterOfPosition(d.start || 0);
      return { file: d.file.fileName, line: line + 1, column: character + 1, message };
    });
}

// the errors of the jsconfigs of root, each once (a module both check is in both); `checkJs` true
// checks every file, opted in or not
function typecheck({ root = ROOT, checkJs = false } = {}) {
  const [main, ...others] = CONFIGS.map((name) => path.join(root, name));
  const errors = [main, ...others.filter((file) => fs.existsSync(file))].flatMap((file) => typecheckConfig(file, checkJs));
  return Promise.resolve([...new Map(errors.map((e) => [`${e.file}:${e.line}:${e.column} ${e.message}`, e])).values()]);
}

const relative = (root, file) => path.relative(root, file).replace(/\\/g, '/');

// [{ file, fixes, changes, errors }] of the files that have not opted in, most valuable first: the
// commits of the last 60 days (null when git cannot say) and what tsc would report on each
async function nextFiles({ root = ROOT } = {}) {
  const optedIn = new Set(findOptedIn({ root }));
  const files = checkable(root).filter((f) => !optedIn.has(f));
  const { walked } = readHistory(root, files, { since: NEXT_WINDOW });
  const count = (keep) => (walked ? countCommits(walked, files, keep).commits : {});
  const changes = count((c) => !c.ignored);
  const fixes = count((c) => !c.ignored && FIX.test(c.subject));
  const errors = {};
  for (const e of await typecheck({ root, checkJs: true })) {
    const file = relative(root, e.file);
    errors[file] = (errors[file] || 0) + 1;
  }
  return files
    .map((file) => ({ file, fixes: fixes[file] ?? null, changes: changes[file] ?? null, errors: errors[file] || 0 }))
    .sort((a, b) => b.fixes - a.fixes || b.changes - a.changes || (a.file < b.file ? -1 : 1));
}

async function printNext() {
  console.log('fixes changes errors file (commits of the last 60 days, - when git cannot say; the errors with // @ts-check)');
  const cell = (value, width) => String(value ?? '-').padStart(width);
  for (const r of await nextFiles()) console.log(`${cell(r.fixes, 5)} ${cell(r.changes, 7)} ${cell(r.errors, 6)} ${r.file}`);
}

async function main() {
  const errors = await typecheck();
  const problems = [...checkRatchet(), ...checkSilenced()];
  for (const e of errors) console.error(`${relative(ROOT, e.file)}:${e.line} ${e.message}`);
  for (const p of problems) console.error(p.message);
  const { checked, total } = coverage();
  console.log(`${checked} of ${total} files checked, ${NEXT.length} next; ${errors.length} type errors, ${problems.length} ratchet problems`);
  process.exitCode = errors.length || problems.length ? 1 : 0;
}

if (require.main === module) (process.argv.includes('--next') ? printNext : main)();

module.exports = {
  CHECKED,
  checkRatchet,
  checkSilenced,
  coverage,
  findOptedIn,
  NEXT,
  nextFiles,
  SILENCED,
  typecheck,
  UNCHECKED,
};
