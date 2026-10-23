// What a workflow does, in a few lists (#488): the import dialog of the Workflows screen shows it
// before a workflow written elsewhere is written to the workspace, since a workflow is code that runs
// on this machine (#474). Plain data in, plain data out: no engine, no Node, so a static public page
// (the Builder and a gallery of community workflows) can load it with a <script> tag too.
// - summarize(doc) → { name, steps: [id], agents: [{ name, tools }], tools, actions: [shell command],
//   ship: [{ step, tag, build }] | false, requires } from a parsed workflow (js-yaml's or the loader's).
// Browser: window.WorkflowCompose; Node: module.exports.
(function (root) {
  const node = typeof module === 'object' && module.exports;

  const list = (v) => (Array.isArray(v) ? v : []);
  const text = (v) => (v == null ? '' : String(v));

  // agents.<name>.capabilities.tools (e.g. read, bash:git), with `defaults`' when the agent has none
  function agentsOf(doc) {
    const fallback = list(doc?.defaults?.capabilities?.tools);
    return Object.entries(doc?.agents || {}).map(([name, a]) => {
      const tools = a?.capabilities?.tools;
      return { name, tools: (Array.isArray(tools) ? tools : fallback).map(text) };
    });
  }

  function summarize(doc) {
    const steps = list(doc?.steps);
    const transitions = steps.flatMap((s) => list(s?.transitions).map((t) => ({ step: text(s?.id), t: t || {} })));
    const ships = transitions.filter(({ t }) => t.ship !== undefined)
      .map(({ step, t }) => ({ step, tag: text(t.ship?.tag), build: t.ship?.build == null ? null : text(t.ship.build) }));
    const agents = agentsOf(doc);
    return {
      name: text(doc?.metadata?.name),
      steps: steps.map((s) => text(s?.id)),
      agents,
      tools: [...new Set(agents.flatMap((a) => a.tools))],
      // what runs in a shell: each transition's `action:` and each ship's build
      actions: [
        ...transitions.filter(({ t }) => t.action != null).map(({ t }) => text(t.action)),
        ...ships.filter((s) => s.build != null).map((s) => s.build),
      ],
      ship: ships.length ? ships : false,
      requires: doc?.requires == null ? null : text(doc.requires),
    };
  }

  const api = {
    summarize,
  };
  if (node) module.exports = api;
  else root.WorkflowCompose = api;
})(typeof window !== 'undefined' ? window : globalThis);
