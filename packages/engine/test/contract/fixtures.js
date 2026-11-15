// The HTTP contract suite's examples (#339): { [channel]: fixture }, one per request/reply channel
// with a schema (test/contract/harness.js coverage; the channels still without one are listed, with
// why, in test/contract/channels-without-fixture.js, a list that may only shrink).
//
// A fixture: { arg, status?, invalid?: { arg }, setup?, teardown? }
//   arg       the channel's argument, or (state) => argument when it needs what setup prepared
//   status    the HTTP status the call answers (default 200; its result is then checked against the
//             entry's schema.result)
//   invalid   an argument the channel's schema.params refuses: the engine must answer 400
//   setup     async (client) => state: the state the call needs (a project, a card, a simulated run),
//             made through the API itself so it works against any engine; client.call(channel, arg)
//             answers the result or throws
//   teardown  async (client, state, result): undoes what the call left running (a run is stopped)
// Each fixture prepares its own state under unique names: the suite runs in any order, and twice in
// a row against the same engine with the same result. Fixtures only touch what they create (or
// read), so they are safe against a scratch engine; never point ENGINE_URL at a workspace you use.

'use strict';

const crypto = require('crypto');

const unique = (prefix) => `${prefix} ${crypto.randomBytes(4).toString('hex')}`;

// ---- shared states -------------------------------------------------------------------------------

// a fresh project (no folder, no repository: an empty folder in the engine's workspace)
async function project(client) {
  const p = await client.call('projects:create', { name: unique('Contract project') });
  return { projectId: p.id };
}

// a project with one discovery card
async function card(client) {
  const { projectId } = await project(client);
  const c = await client.call('discovery:create', { projectId, title: unique('Contract card'), text: 'A card the contract suite reads.' });
  return { projectId, cardId: c.id };
}

// a simulated run (mock agents) of a bundled workflow, waiting at its first gate or still working
async function run(client) {
  const { runId } = await client.call('run:start', {
    file: 'writer-reviewer.yaml',
    mock: true,
    inputs: { prompt: 'A one-line release note.', goal: 'One clear line.' },
  });
  return { runId };
}
async function stopRun(client, { runId }) {
  await client.call('run:stop', { runId }).catch(() => {});
}
const onRun = (fixture) => ({ setup: run, teardown: stopRun, ...fixture });
// an archived card
async function archivedCard(client) {
  const state = await card(client);
  await client.call('discovery:archive', { ...state, reason: 'The contract suite archives it.' });
  return state;
}

// #640: an onboarding whose repository no git reaches (a missing local folder): failed, nothing cloned
const UNREACHABLE_REPO = require('path').join(__dirname, 'no-such-repository');
async function onboarding(client) {
  const s = await client.call('onboarding:start', { name: unique('Contract onboarding'), repo: UNREACHABLE_REPO });
  return { projectId: s.projectId };
}

// #740: a CLI setup job that runs nothing (claude's sign-in answers what to run on the server)
const CLI_SIGN_IN = { id: 'claude', action: 'login' };
async function cliSetupJob(client) {
  const job = await client.call('cli-setup:start', CLI_SIGN_IN);
  return { jobId: job.jobId };
}

const AGENT = { name: 'Contract agent', provider: 'claude', prompt: 'Checks the contract suite.' };
async function agent(client) {
  const a = await client.call('agents:create', { ...AGENT, name: unique('Contract agent') });
  return { id: a.id };
}

const SKILL = { description: 'A skill the contract suite creates.', body: 'Do the work.' };
async function skill(client) {
  const s = await client.call('skills:create', { ...SKILL, name: unique('contract skill') });
  return { id: s.id };
}

// a copy of a bundled workflow, and its spec as the builder edits it
// (#648: writer-reviewer.yaml left workflows/, the builder reads the file by its own name: write-doc.yaml)
const BUNDLED = 'write-doc.yaml';
async function workflowCopy(client) {
  const { file } = await client.call('builder:clone', BUNDLED);
  const { spec } = await client.call('builder:load', file);
  return { file, spec };
}

// #625: a project with one mockup screen (the simulated designer draws it at once; its first commit)
async function mockupScreen(client) {
  const { projectId } = await project(client);
  const { slug, commit } = await client.call('mockups:create-screen', { projectId, title: unique('Contract screen'), prompt: 'A screen the contract suite reads.' });
  return { projectId, slug, commit };
}
const onScreen = ({ projectId, slug }) => ({ projectId, slug });
// the same screen with a second version (a turn): its first version can be restored
async function editedMockupScreen(client) {
  const state = await mockupScreen(client);
  await client.call('mockups:save-turn', { ...onScreen(state), html: '<main><h1>Second version</h1></main>', message: 'A contract turn' });
  return state;
}
// #835: the screen with a saved flow (no link yet)
async function mockupFlow(client) {
  const state = await mockupScreen(client);
  await client.call('mockups:save-flow', { projectId: state.projectId, name: 'contract-flow', links: [] });
  return state;
}

// ---- invalid arguments the schemas refuse --------------------------------------------------------

const NOT_AN_OBJECT = { arg: 'not an object' };
const BAD_PROJECT = { arg: { projectId: 42 } };
const BAD_CARD = { arg: { projectId: 'p', cardId: 42 } };
const BAD_RUN = { arg: { runId: 42 } };
const BAD_FILE = { arg: '../outside.yaml' };
const BAD_SCREEN = { arg: { projectId: 'p', slug: 42 } };

module.exports = {
  'agents:create': { arg: AGENT, invalid: NOT_AN_OBJECT },
  'agents:list': { arg: null },
  'agents:remove': { setup: agent, arg: ({ id }) => id, invalid: { arg: '..' } },
  'agents:save': { setup: agent, arg: ({ id }) => ({ id, data: { ...AGENT, prompt: 'Checks the contract suite again.' } }), invalid: { arg: { id: 42 } } },
  'analytics:agents': { arg: null, invalid: { arg: 42 } },
  'analytics:analyze': { arg: { mock: true }, invalid: { arg: 42 } },
  'analytics:get': { arg: null, invalid: { arg: 42 } },
  'analytics:occupancy': { arg: null, invalid: { arg: 42 } },
  'analytics:performance': { arg: null, invalid: { arg: 42 } },
  'analytics:plan': { arg: { mock: true }, invalid: { arg: 42 } },
  'analytics:run': { arg: null, invalid: { arg: 42 } },
  'app-update:dismiss': { arg: null },
  'app-update:failed': { arg: null },
  'app-update:state': { arg: {}, invalid: { arg: { fresh: 'yes' } } },
  'app:codeVersion': { arg: null },
  'app:info': { arg: null },
  'app:version': { arg: null },
  // #356: a contract project is a plain folder: its facts are 'not-git', nothing to analyse (400)
  'architecture:analyze': { setup: project, arg: ({ projectId }) => ({ projectId, mock: true }), status: 400, invalid: BAD_PROJECT },
  // #371: a plain folder's city is 'not-git'; savePlan checks the plan's schema only
  'architecture:city': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  // #730: a fresh project has no report: no finding to file (400)
  'architecture:createIssue': { setup: project, arg: ({ projectId }) => ({ projectId, reportId: 'none', findingIndex: 0 }), status: 400, invalid: BAD_PROJECT },
  // #374: a contract project has no run in progress: no agent on its city
  'architecture:agents': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'architecture:savePlan': { setup: project, arg: ({ projectId }) => ({ projectId, plan: { version: 1, project: 'contract', summary: 'A contract plan.', ignore: [], zones: [{ id: 'core', name: 'Core', kind: 'civic', purpose: 'x' }], districts: [{ id: 'all', name: 'All', zone: 'core', purpose: 'x', include: ['**'], exclude: [] }], landmarks: [], ports: [], evidence: [] } }), invalid: { arg: { projectId: 'p', plan: 'not a plan' } } },
  'architecture:estimate': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  // #375: a fresh project has no plan and no hit rate yet (no record: the suite writes nothing)
  'architecture:impact': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  // #376: a plain folder has no tag and no commit: no release to draw
  'architecture:release': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'architecture:facts': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'architecture:report': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'architecture:reports': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'architecture:setExclude': { setup: project, arg: ({ projectId }) => ({ projectId, patterns: ['docs/**'] }), invalid: { arg: { projectId: 'p', patterns: 'docs/**' } } },
  'artifacts:evidence': onRun({ arg: ({ runId }) => ({ runId }), invalid: BAD_RUN }),
  'artifacts:list': { arg: {}, invalid: { arg: { limit: 'ten' } } },
  'audio:status': { arg: null },
  'backlog:auto-epic': { setup: project, arg: ({ projectId }) => ({ projectId, on: false }), invalid: BAD_PROJECT },
  'backlog:dismiss-refresh': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'backlog:get': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'backlog:local': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'backlog:progress': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'backlog:state': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'backlog:unpushed': { arg: null },
  'backlog:watching': { arg: null },
  'baseCheck:state': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'builder:clone': { arg: BUNDLED, invalid: BAD_FILE },
  'builder:load': { arg: BUNDLED, invalid: BAD_FILE },
  'builder:save': { setup: workflowCopy, arg: ({ file, spec }) => ({ file, spec }), invalid: { arg: { spec: 'name: x' } } },
  'chain:drop': onRun({ arg: ({ runId }) => ({ runId }), invalid: BAD_RUN }),
  'chain:estimate': { arg: { file: 'writer-reviewer.yaml' }, invalid: { arg: { file: 42 } } },
  'chain:get': onRun({ arg: ({ runId }) => ({ runId }), invalid: BAD_RUN }),
  'chain:set': onRun({ arg: ({ runId }) => ({ runId, then: null }), invalid: BAD_RUN }),
  'chat:cancel': { arg: { chat: 'oracle' }, invalid: { arg: { chat: 42 } } },
  // #740: claude's sign-in never runs on the engine (it needs a terminal): a 'manual' job, nothing spawned
  'cli-setup:start': { arg: CLI_SIGN_IN, invalid: { arg: { id: 42, action: 'login' } } },
  'cli-setup:status': { setup: cliSetupJob, arg: ({ jobId }) => ({ jobId }), invalid: { arg: { jobId: 42 } } },
  'cliSessions:list': { arg: null },
  'depsCache:info': { arg: null },
  'discovery:archive': { setup: card, arg: (s) => ({ ...s, reason: 'The contract suite archives it.' }), invalid: BAD_CARD },
  'discovery:merge': {
    setup: async (client) => {
      const s = await card(client);
      const into = await client.call('discovery:create', { projectId: s.projectId, title: unique('Contract card') });
      return { ...s, intoId: into.id };
    },
    arg: (s) => s,
    invalid: { arg: { projectId: 'p', cardId: 'c', intoId: 42 } },
  },
  'discovery:move': { setup: card, arg: (s) => ({ ...s, column: 'triage' }), invalid: { arg: { projectId: 'p', cardId: 'c', column: 42 } } },
  'discovery:move-anyway': { setup: card, arg: (s) => ({ ...s, reason: 'The contract suite moves it.' }), invalid: BAD_CARD },
  'discovery:record-result': { setup: card, arg: (s) => ({ ...s, source: 'write-review', text: 'A result the contract suite records.' }), invalid: BAD_CARD },
  'discovery:set-clarity-bar': { setup: project, arg: ({ projectId }) => ({ projectId, bar: 3 }), invalid: { arg: { projectId: 'p', bar: true } } },
  'discovery:restore': { setup: archivedCard, arg: (s) => s, invalid: BAD_CARD },
  'discovery:set-automation': { setup: project, arg: ({ projectId }) => ({ projectId, column: 'shape', mode: 'off' }), invalid: BAD_PROJECT },
  'discovery:set-wip': { setup: project, arg: ({ projectId }) => ({ projectId, column: 'shape', limit: 4 }), invalid: BAD_PROJECT },
  'discovery:board': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'discovery:conversation': { setup: card, arg: (s) => s, invalid: BAD_CARD },
  'discovery:create': { setup: project, arg: ({ projectId }) => ({ projectId, title: 'A contract card' }), invalid: BAD_PROJECT },
  'discovery:get': { setup: card, arg: (s) => s, invalid: BAD_CARD },
  'discovery:list': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'discovery:update': { setup: card, arg: (s) => ({ ...s, fields: { title: 'A renamed contract card' } }), invalid: BAD_CARD },
  'discovery:versions': { setup: card, arg: (s) => s, invalid: BAD_CARD },
  'discovery:waiting': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  // #650/#774: a fresh project has no docs/work yet, so no item has an intent (it only reads the folder)
  'docs:intents': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'env:check': { arg: null },
  'env:details': { arg: null },
  'findings:list': { arg: null },
  'gates:interrupted': { arg: null },
  'index:rebuild': { arg: null },
  'index:status': { arg: null },
  'localPreview:list': { arg: null },
  'memory:strays': { arg: null },
  // #634: the Monitor's channels, on a fresh project with no source and no error group
  'monitor:automation': { setup: project, arg: ({ projectId }) => ({ projectId, diagnose: 'ask', fix: 'off', dailyCap: 5 }), invalid: BAD_PROJECT },
  'monitor:diagnose': { setup: project, arg: ({ projectId }) => ({ projectId, fingerprint: 'no-such-group' }), invalid: BAD_PROJECT },
  'monitor:poll': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'monitor:propose-fix': { setup: project, arg: ({ projectId }) => ({ projectId, fingerprint: 'no-such-group' }), invalid: BAD_PROJECT },
  'monitor:save-source': { setup: project, arg: ({ projectId }) => ({ projectId, source: { type: 'log-file', label: 'contract log', path: UNREACHABLE_REPO } }), invalid: BAD_PROJECT },
  'monitor:state': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  // #625: Plan & Design › Mockups, simulated (the designer draws and answers at $0, no workflow run)
  // #835: a frozen version for a Discovery card
  'mockups:attach': { setup: mockupScreen, arg: (s) => ({ ...onScreen(s), commit: s.commit }), invalid: BAD_SCREEN },
  'mockups:build-kit': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'mockups:chat': { setup: mockupScreen, arg: (s) => ({ ...onScreen(s), message: 'Make the title bigger.', selection: [{ mid: 'm1', selector: 'main', text: 'Contract' }] }), invalid: BAD_SCREEN },
  'mockups:chat-history': { setup: mockupScreen, arg: onScreen, invalid: BAD_SCREEN },
  'mockups:compare': { setup: editedMockupScreen, arg: (s) => ({ ...onScreen(s), from: s.commit, to: s.commit }), invalid: BAD_SCREEN },
  'mockups:create-screen': { setup: project, arg: ({ projectId }) => ({ projectId, title: 'A contract screen', prompt: 'An orders list.' }), invalid: BAD_PROJECT },
  'mockups:create-variant': { setup: mockupScreen, arg: ({ projectId }) => ({ projectId, name: 'contract-variant' }), invalid: BAD_PROJECT },
  // #836 the simulated designer's draft: m1 is its <main>; no host: the region is drawn as a placeholder
  'mockups:crops': { setup: mockupScreen, arg: (s) => ({ ...onScreen(s), commit: s.commit, regions: [{ mid: 'm1', box: [0, 0, 100, 40] }] }), invalid: BAD_SCREEN },
  'mockups:estimate': { arg: { action: 'chat-edit' }, invalid: { arg: { action: 'fly' } } },
  'mockups:export': { setup: mockupScreen, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'mockups:flow': { setup: mockupFlow, arg: ({ projectId }) => ({ projectId, name: 'contract-flow' }), invalid: BAD_PROJECT },
  'mockups:flows': { setup: mockupScreen, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  // #836 a frozen version, the `mockup` input of a dev run
  'mockups:freeze': { setup: mockupScreen, arg: (s) => ({ ...onScreen(s), commit: s.commit }), invalid: BAD_SCREEN },
  'mockups:keep-variant': { setup: mockupScreen, arg: ({ projectId }) => ({ projectId, name: 'main' }), invalid: BAD_PROJECT },
  'mockups:kit': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'mockups:kit-map': { setup: project, arg: ({ projectId }) => ({ projectId, components_css: '.btn { padding: 4px; }\n', components: [{ name: 'Button', source: 'src/button.css:1' }], inferences: [] }), invalid: BAD_PROJECT },
  'mockups:list': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  // the engine server has no editor window: { opened: false }
  'mockups:open-editor': { setup: mockupScreen, arg: onScreen, invalid: BAD_SCREEN },
  // the simulated designer's draft: m1 is its <main>
  'mockups:promote': { setup: mockupScreen, arg: (s) => ({ ...onScreen(s), mid: 'm1', name: 'contract-page' }), invalid: BAD_SCREEN },
  // #836 a fresh project has no Run App / Local preview: the recreate is refused
  'mockups:recreate': { setup: project, arg: ({ projectId }) => ({ projectId, title: 'From the running app' }), status: 400, invalid: BAD_PROJECT },
  'mockups:restore': { setup: editedMockupScreen, arg: (s) => ({ ...onScreen(s), commit: s.commit }), invalid: BAD_SCREEN },
  // #836 the on-demand review, simulated ($0, the kit lint and the given axe violations)
  'mockups:review': { setup: mockupScreen, arg: (s) => ({ ...onScreen(s), axe: [] }), invalid: BAD_SCREEN },
  'mockups:save-flow': { setup: mockupScreen, arg: ({ projectId }) => ({ projectId, name: 'contract-flow', links: [] }), invalid: BAD_PROJECT },
  'mockups:save-ref': { setup: project, arg: ({ projectId }) => ({ projectId, data: 'data:image/png;base64,iVBORw0KGgo=', ext: 'png' }), invalid: BAD_PROJECT },
  'mockups:save-turn': { setup: mockupScreen, arg: (s) => ({ ...onScreen(s), html: '<main><h1>Saved by the contract suite</h1></main>', message: 'A contract turn' }), invalid: BAD_SCREEN },
  'mockups:screen': { setup: mockupScreen, arg: onScreen, invalid: BAD_SCREEN },
  'mockups:switch-variant': { setup: mockupScreen, arg: ({ projectId }) => ({ projectId, name: 'main' }), invalid: BAD_PROJECT },
  'mockups:variants': { setup: mockupScreen, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'mockups:versions': { setup: mockupScreen, arg: onScreen, invalid: BAD_SCREEN },
  'monitor:webhook': { setup: project, arg: ({ projectId }) => ({ projectId, enable: false }), invalid: BAD_PROJECT },
  'nightwatch:morning': { arg: null },
  'nightwatch:report': { arg: null },
  'nightwatch:state': { arg: null },
  'notifications:list': { arg: {}, invalid: { arg: { limit: 'ten' } } },
  'notifications:read': { arg: { ids: [] }, invalid: { arg: { ids: 'all' } } },
  // #640: a repository no git reaches: the onboarding ends failed (no-access) and nothing is cloned
  'onboarding:analyze': { setup: onboarding, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  // #632: a new project, git init only, no remote
  'onboarding:create': { arg: () => ({ name: unique('Contract create'), starts: 'empty', remote: null, answers: { mode: 'local', ci: 'release', release: 'milestone' } }), invalid: { arg: { name: 42 } } },
  // #738: a repository the owner can push to (here none reached) has no fork to create or decline: 400
  // #741: Finish marks the onboarding finished
  'onboarding:finish': { setup: onboarding, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'onboarding:fork': { setup: onboarding, arg: ({ projectId }) => ({ projectId }), status: 400, invalid: BAD_PROJECT },
  'onboarding:retry': { setup: onboarding, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  // #741: the wizard's step and picks saved with the project
  'onboarding:save-wizard': { setup: onboarding, arg: ({ projectId }) => ({ projectId, step: 'repository', picks: { name: 'Contract' } }), invalid: { arg: { projectId: 'p', step: 42 } } },
  'onboarding:start': { arg: () => ({ name: unique('Contract onboarding'), repo: UNREACHABLE_REPO }), invalid: { arg: { name: 'No repository' } } },
  'onboarding:status': { setup: onboarding, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'onboarding:work-locally': { setup: onboarding, arg: ({ projectId }) => ({ projectId }), status: 400, invalid: BAD_PROJECT },
  'oracle:history': { arg: null },
  'oracle:markRead': { arg: null, invalid: { arg: 42 } },
  'oracle:memory': { arg: null },
  'oracle:mute': onRun({ arg: ({ runId }) => ({ runId, on: false }), invalid: BAD_RUN }),
  'oracle:state': { arg: null },
  'oracle:tools': { arg: null },
  'oracle:wakeState': { arg: null },
  'phonegates:state': { arg: null },
  'po:clear': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'po:history': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'projects:create': { arg: () => ({ name: unique('Contract project') }), invalid: NOT_AN_OBJECT },
  'projects:inputHints': { setup: project, arg: ({ projectId }) => projectId, invalid: { arg: 42 } },
  'projects:list': { arg: null },
  // #486: a folder without .multiagent/project.yaml answers null; an object without url or folder is refused
  'projects:manifest': { arg: () => ({ folder: __dirname }), invalid: { arg: {} } },
  'projects:remove': { setup: project, arg: ({ projectId }) => projectId, invalid: { arg: '..' } },
  'projects:runs': { setup: project, arg: ({ projectId }) => ({ id: projectId }), invalid: { arg: { id: 42 } } },
  'projects:update': { setup: project, arg: ({ projectId }) => ({ id: projectId, patch: { name: 'A renamed contract project' } }), invalid: { arg: { id: 42 } } },
  // #812: the contract project has no remote, so its list is empty or says why, and no URL is one of its open PRs
  'pulls:close': { setup: project, arg: ({ projectId }) => ({ projectId, url: 'https://github.com/o/r/pull/1' }), status: 400, invalid: BAD_PROJECT },
  'pulls:list': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'pulls:merge': { setup: project, arg: ({ projectId }) => ({ projectId, url: 'https://github.com/o/r/pull/1' }), status: 400, invalid: BAD_PROJECT },
  // #357: an owner proposal, the cadence (off by default), a ranking of no proposal (simulated); the
  // proposal channels refuse an unknown proposal (dismiss, file and addToRoadmap write nothing then)
  'refactor:add': { setup: project, arg: ({ projectId }) => ({ projectId, target: 'src/a.js', improvement: 'Split a', evidence: 'Every fix touches it' }), invalid: BAD_PROJECT },
  'refactor:addToRoadmap': { setup: project, arg: ({ projectId }) => ({ projectId, id: 'none' }), status: 400, invalid: BAD_PROJECT },
  'refactor:cadence': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'refactor:dismiss': { setup: project, arg: ({ projectId }) => ({ projectId, id: 'none', reason: 'Not worth it' }), status: 400, invalid: BAD_PROJECT },
  'refactor:file': { setup: project, arg: ({ projectId }) => ({ projectId, id: 'none', preview: true }), status: 400, invalid: BAD_PROJECT },
  'refactor:prioritize': { setup: project, arg: ({ projectId }) => ({ projectId, mock: true }), invalid: BAD_PROJECT },
  'refactor:proposals': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'refactor:setCadence': { setup: project, arg: ({ projectId }) => ({ projectId, on: false, every: 10 }), invalid: BAD_PROJECT },
  // #489: a project without release candidates refuses a Hold and a promotion (nothing is tagged)
  'releases:hold': { setup: project, arg: ({ projectId }) => ({ projectId, tag: 'v1.0.0-rc.1' }), status: 400, invalid: BAD_PROJECT },
  'releases:list': { arg: {}, invalid: BAD_PROJECT },
  'releases:promote': { setup: project, arg: ({ projectId }) => ({ projectId, commit: 'ffffffff' }), status: 400, invalid: BAD_PROJECT },
  'releases:notes': { setup: project, arg: ({ projectId }) => ({ projectId, notes: 'Contract notes.' }), invalid: BAD_PROJECT },
  'roadmap:clear': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  // #391: a roadmap without a pending pause returns the backlog unchanged
  'roadmap:cancel-pause': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'roadmap:get': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'roadmap:live': { setup: project, arg: ({ projectId }) => ({ projectId, on: false }), invalid: BAD_PROJECT },
  // #395: a stage the roadmap does not have is refused
  'roadmap:park-stage': { setup: project, arg: ({ projectId }) => ({ projectId, stageId: 'stage-none' }), status: 400, invalid: BAD_PROJECT },
  'roadmap:pause': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  // #368: a stage the roadmap does not have is refused
  'roadmap:pause-stage': { setup: project, arg: ({ projectId }) => ({ projectId, stageId: 'stage-none' }), status: 400, invalid: BAD_PROJECT },
  'roadmap:save': { setup: project, arg: ({ projectId }) => ({ projectId, stages: [] }), invalid: { arg: { projectId: 'p', stages: 'none' } } },
  'roadmap:versions': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'runs:active': { arg: null },
  // #810: the contract run is not waiting in a PR monitor: refused (400)
  'runs:askFix': onRun({ arg: ({ runId }) => ({ runId, ids: ['t1'], note: 'Keep the public API.' }), status: 400, invalid: { arg: { runId: 'r', ids: 'not-a-list' } } }),
  'runs:closePr': onRun({ arg: ({ runId }) => ({ runId }), status: 400, invalid: BAD_RUN }),
  'runs:events': onRun({ arg: ({ runId }) => ({ runId }), invalid: BAD_RUN }),
  'runs:list': { arg: {}, invalid: { arg: { limit: 'ten' } } },
  // #795: the end of a step's log; a log not written yet is empty
  'runs:logTail': onRun({ arg: ({ runId }) => ({ runId, path: 'logs/suite-1.log' }), invalid: BAD_RUN }),
  'runs:mergePr': onRun({ arg: ({ runId }) => ({ runId }), status: 400, invalid: BAD_RUN }),
  'runs:prState': onRun({ arg: ({ runId }) => ({ runId }), invalid: BAD_RUN }),
  'runs:resumeOptions': onRun({ arg: ({ runId }) => ({ runId }), invalid: BAD_RUN }),
  'runs:scratch': onRun({ arg: ({ runId }) => ({ runId }), invalid: BAD_RUN }),
  'runs:setTitle': onRun({ arg: ({ runId }) => ({ runId, title: 'A contract run' }), invalid: { arg: { runId: 'r', title: 'x'.repeat(201) } } }),
  'run:start': {
    arg: { file: 'writer-reviewer.yaml', mock: true, inputs: { prompt: 'A one-line release note.', goal: 'One clear line.' } },
    invalid: { arg: { file: 42 } },
    teardown: (client, _state, result) => stopRun(client, result),
  },
  // #368: Cancel pause on a run that is not pausing answers false; Pause after current turn (the run ends paused)
  'run:cancel-pause': onRun({ arg: ({ runId }) => ({ runId }), invalid: BAD_RUN }),
  'run:pause': onRun({ arg: ({ runId }) => ({ runId }), invalid: BAD_RUN }),
  'run:stop': { setup: run, arg: ({ runId }) => ({ runId }), invalid: BAD_RUN },
  // #360: analysis seeds on the contract project (a plain folder, no git, no repository)
  'seeds:estimate': { setup: project, arg: ({ projectId }) => ({ projectId, seedId: 'churn-complexity' }), invalid: BAD_PROJECT },
  'seeds:history': { setup: project, arg: ({ projectId }) => ({ projectId, seedId: 'churn-complexity' }), invalid: BAD_PROJECT },
  'seeds:list': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'seeds:makeTool': { setup: project, arg: ({ projectId }) => ({ projectId, seedId: 'churn-complexity' }), invalid: BAD_PROJECT },
  'seeds:result': { setup: project, arg: ({ projectId }) => ({ projectId, seedId: 'churn-complexity', date: 'none' }), status: 400, invalid: BAD_PROJECT },
  'seeds:run': { setup: project, arg: ({ projectId }) => ({ projectId, seedId: 'churn-complexity', mock: true }), invalid: BAD_PROJECT },
  'seeds:setTool': { setup: project, arg: ({ projectId }) => ({ projectId, seedId: 'churn-complexity', command: null }), invalid: { arg: { projectId: 'p', seedId: 'churn-complexity', command: 42 } } },
  // #312: a folder that is not logged in (never created): only its files are read, no CLI is started
  'settings:accountStatus': { arg: { provider: 'claude', dir: 'contract-account-312-missing' }, invalid: { arg: { provider: 42, dir: 'x' } } },
  'settings:get': { arg: null },
  'settings:machineProfile': { arg: null },
  'settings:set': { arg: {}, invalid: { arg: 42 } },
  'skills:create': { arg: () => ({ ...SKILL, name: unique('contract skill') }), invalid: NOT_AN_OBJECT },
  'skills:list': { arg: null },
  'skills:remove': { setup: skill, arg: ({ id }) => id, invalid: { arg: 42 } },
  'skills:save': { setup: skill, arg: ({ id }) => ({ id, data: { ...SKILL, body: 'Do the work again.' } }), invalid: { arg: { id: 42 } } },
  'supervisor:chatHistory': { arg: null },
  'supervisor:tools': { arg: null },
  'supervisor:watchState': onRun({ arg: ({ runId }) => runId, invalid: { arg: 42 } }),
  'usage:actions': { arg: { force: false }, invalid: { arg: { force: 'yes' } } },
  'usage:get': { arg: {}, invalid: { arg: { scope: 42 } } },
  'voice:mic-access': { arg: null },
  // #487: ways of working on the contract project; compose without a previous analysis is a client error
  'workflows:compose': { setup: project, arg: ({ projectId }) => ({ projectId }), status: 400, invalid: BAD_PROJECT },
  'workflows:export': { arg: BUNDLED, invalid: BAD_FILE },
  'workflows:interview': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT },
  'workflows:interviewLast': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT }, // #733
  'workflows:interviewState': { setup: project, arg: ({ projectId }) => ({ projectId }), invalid: BAD_PROJECT }, // #733
  'workflows:list': { arg: null },
  'workflows:pipelines': { arg: null },
  'workspace:get': { arg: null },
};
