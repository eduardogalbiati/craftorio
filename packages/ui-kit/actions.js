// The actions registry (phase 3 of docs/reorganisation-study-2026-10.md, #579): what a screen offers
// to the rest of the page without the caller naming the front that provides it. A front registers an
// action as its screen loads (the way it calls registerView); the kit and the other fronts call it by
// name and go on without it when no shipped front registered it (a composition of one front builds
// and runs that front alone: a project card without the project's page, a run's artifact link
// without the Artifacts screen, do nothing instead of throwing).
// load: early (Actions exists before app.js and the views)
//   Actions.register(name, fn)     a screen offers an action (a second registration replaces the first)
//   Actions.has(name)              whether a shipped front registered it (to hide a button, to fall back)
//   Actions.call(name, ...args)    calls it and answers what it returned; undefined when nobody offers it
//   Actions.reset()                for tests: forgets every action
// The actions the fronts offer today: openProject(id, { tab, nextSteps }) (the project's page), showProjects()
// (the Projects screen), showWorkflowDefinition(file) (Workflows › Definitions at a file),
// openArtifactsAt({ projectId, runId, path, mock }) (the Artifacts screen at a file), agentCard(agent,
// opts) (an agent's card markup). Browser: window.Actions; Node: module.exports (tested without a DOM).
(function (root) {
  const actions = new Map();

  function register(name, fn) {
    if (typeof name !== 'string' || !name) throw new Error('Actions.register: an action needs a name');
    if (typeof fn !== 'function') throw new Error(`Actions.register: ${name} needs a function`);
    actions.set(name, fn);
    return fn;
  }
  const has = (name) => actions.has(name);
  const call = (name, ...args) => (actions.has(name) ? actions.get(name)(...args) : undefined);
  const reset = () => { actions.clear(); };

  const api = { call, has, register, reset };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Actions = api;
})(typeof window !== 'undefined' ? window : globalThis);
