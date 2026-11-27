// @ts-check
// Types only, no page loads this file: the globals the page scripts share without a module (#52), so
// a screen can opt in to the type checker. A `var` of a script is a global for the checker, also as
// `window.X`. A module of packages/shared has its own type; a kit's or a front's global has none yet
// (any) until its file opts in. Add a global here when a screen that opts in uses it. Only
// the page scripts see these names and the browser's: jsconfig.pages.json, not jsconfig.json.
/* eslint no-unused-vars: 0 */

// ---- packages/shared ----
/** @type {typeof import('../shared/architecture-facts-view')} */
var ArchitectureFactsView;
/** @type {typeof import('../shared/chain-model')} */
var ChainModel;
/** @type {typeof import('../shared/default-workflow')} */
var DefaultWorkflow;
/** @type {typeof import('../shared/display-name').displayName} */
var displayName;
/** @type {typeof import('../shared/i18n')} */
var I18n;
/** @type {typeof import('../shared/onboarding-model')} */
var OnboardingModel;
/** @type {typeof import('../shared/platforms/github')} */
var PlatformGitHub;
/** @type {typeof import('../shared/platforms/gitlab')} */
var PlatformGitLab;
/** @type {typeof import('../shared/platforms')} */
var Platforms;
/** @type {typeof import('../shared/roadmap-model')} */
var RoadmapModel;
/** @type {typeof import('../shared/roadmap-summary')} */
var RoadmapSummary;
/** @type {typeof import('../shared/run-progress-model')} */
var RunProgress;
/** @type {typeof import('../shared/i18n').t} */
var t;
/** @type {typeof import('../shared/time-zone')} */
var TimeZone;

// ---- the engine's channels (apps/desktop/host/preload.js, apps/web/renderer/api-http.js) ----
/** @type {Record<string, (...args: any[]) => any>} */
var api;

// ---- the UI kit and the fronts (no types of their own yet) ----
/** @typedef {Record<string, any>} PageObject */
/** @typedef {(...args: any[]) => any} PageFunction */
/** @type {PageObject} */ var Actions;
/** @type {PageObject} */ var AgentChat;
/** @type {PageObject} */ var AgentOverrides;
/** @type {PageObject} */ var AgentRequest;
/** @type {PageObject} */ var AgentsWindow;
/** @type {PageFunction} */ var analyticsContext;
/** @type {PageObject} */ var BacklogActions;
/** @type {PageObject} */ var BacklogLive;
/** @type {PageObject} */ var BacklogOutside;
/** @type {PageObject} */ var BacklogPO;
/** @type {PageObject} */ var BacklogRoadmap;
/** @type {PageFunction} */ var builderContext;
/** @type {PageObject} */ var ChainPicker;
/** @type {PageObject} */ var CurrentProject;
/** @type {PageObject} */ var Estimates;
/** @type {PageObject} */ var GateOracle;
/** @type {PageObject} */ var LiveTurn;
/** @type {PageObject} */ var Menu;
/** @type {PageFunction} */ var openSupervisorChat;
/** @type {PageObject} */ var OracleChat;
/** @type {PageObject} */ var OracleChatModel;
/** @type {PageObject} */ var PasteImage;
/** @type {PageObject} */ var ProjectCityImpact;
/** @type {PageObject} */ var ProjectConflictMap;
/** @type {PageObject} */ var ProjectsView;
/** @type {PageObject} */ var ProjectWizard;
/** @type {PageFunction} */ var ProjectWizardActivity;
/** @type {PageFunction} */ var ProjectWizardCli;
/** @type {PageFunction} */ var ProjectWizardColumn;
/** @type {PageFunction} */ var ProjectWizardCosts;
/** @type {PageFunction} */ var ProjectWizardReview;
/** @type {any} */ var SetupRows;
/** @type {PageFunction} */ var ProjectWizardResume;
/** @type {PageFunction} */ var ProjectWizardTray;
/** @type {PageFunction} */ var ProjectWizardWorkModel;
/** @type {PageObject} */ var ReleaseName;
/** @type {PageFunction} */ var renderSupervisorFab;
/** @type {PageObject} */ var RoadmapBaseNotice;
/** @type {PageObject} */ var RoadmapMergeWait;
/** @type {PageObject} */ var RoadmapPrCard;
/** @type {PageObject} */ var RoadmapTestStage;
/** @type {PageObject} */ var Robots;
/** @type {PageObject} */ var Select;
/** @type {PageObject} */ var SessionsView;
/** @type {PageObject} */ var StatusPill;
/** @type {PageFunction} */ var supervisorChatBusy;
/** @type {PageFunction} */ var supervisorScreenContext;
/** @type {PageObject} */ var ViewRegistry;
/** @type {PageObject} */ var WorkflowInputs;
