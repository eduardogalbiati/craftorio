// @ts-check
// Run setup (#250, from packages/engine/engine/workflow.js): the inputs with their defaults and types
// (`resolveInputs`, an input's `was:` old name #631, `resolveRunInput` for `type: run`), the images attached to inputs (#129:
// `checkInputAttachments`, `copyAttachments`, `stepAttachments`), the per-run agent overrides
// (`applyAgentOverrides`, #262), disabled agents (`dropDisabledAgents`), `persona: random`
// (`pickPersonas`) and the agents' names for the screens (`agentNames`, `displayNames` #245).

'use strict';

const fs = require('fs');
const path = require('path');
const { checkAttachments, storeAttachments } = require('../providers');
const { resolveSkill } = require('../../domains/agents/skills');
const { displayName } = require('@multiagent/shared/display-name');
const DefaultWorkflow = require('@multiagent/shared/default-workflow');
const { render } = require('./templates');
const { MACHINE_STEP_TYPES, toBoolean } = require('./load');

// #630: a workflow with `validation` (feature) reads an old `mode: auto | validated` as it
function oldValidation(inputs, given) {
  if (!inputs.validation || inputs.mode?.enum?.includes(given.mode)) return given;
  return DefaultWorkflow.oldValidation(given);
}

const methods = {
  resolveInputs(raw) {
    const out = {};
    const given = oldValidation(this.wf.inputs || {}, raw);
    for (const [k, def] of Object.entries(this.wf.inputs || {})) {
      let v = given[k];
      // #631: `was: <old name>`, the input's name before a rename (an old run's or a saved pipeline's inputs)
      if ((v === undefined || v === '') && def.was) v = given[def.was];
      if (v === undefined || v === '') v = def.default;
      if (def.required && (v === undefined || v === '')) throw new Error(`Required input not provided: ${k}`);
      // a yes/no: a boolean, or its text from a form, the CLI or inputs saved before it was one ("true"/"false")
      if (def.type === 'boolean' && v !== undefined) v = toBoolean(k, v);
      // `multiple: true` (#340, e.g. language "js,rust"): one or more enum values, comma-separated, main one first
      if (def.enum && def.multiple && v !== undefined) {
        const items = [...new Set(String(v).split(',').map((x) => x.trim()).filter(Boolean))];
        if (!items.length || items.some((x) => !def.enum.includes(x))) throw new Error(`Input "${k}" must be one or more of ${def.enum.join(', ')}, comma-separated`);
        v = items.join(',');
      } else if (def.enum && v !== undefined && !def.enum.includes(v)) throw new Error(`Input "${k}" must be one of ${def.enum.join(', ')}`);
      if (def.type === 'run') v = this.resolveRunInput(k, v);
      // a list typed in a form arrives as text: one item per line or comma
      if (def.type === 'array' && typeof v === 'string') v = v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);
      out[k] = v;
    }
    // `required_unless: <other input>` (#648, issue's request or spec): one of the two must be given
    const blank = (v) => v === undefined || v === null || String(v).trim() === '';
    for (const [k, def] of Object.entries(this.wf.inputs || {})) {
      const other = def.required_unless;
      if (other && blank(out[k]) && blank(out[other])) throw new Error(`Required input not provided: ${k} (or ${other})`);
    }
    return out;
  },

  // The images attached to inputs (constructor's `attachments`): only the workflow's inputs, each
  // image within the limits (checkAttachments), and no more images in all than one turn may carry.
  checkInputAttachments(given) {
    const out = {};
    for (const [k, list] of Object.entries(given)) {
      if (!Array.isArray(list) || !list.length) continue;
      if (!this.wf.inputs?.[k]) throw new Error(`Images are attached to "${k}", which is not an input of this workflow.`);
      out[k] = checkAttachments(list);
    }
    checkAttachments(Object.values(out).flat());
    return out;
  },

  // Copies images into <run_dir>/attachments/<folder>/ (storeAttachments): the run keeps them whatever
  // happens to the originals. Returns [{ name, path }] of the copies.
  copyAttachments(files, folder) {
    return storeAttachments(files, path.join(this.runDir, 'attachments', String(folder).replace(/[^A-Za-z0-9_.-]+/g, '-')));
  },

  storeInputAttachments() {
    for (const [k, files] of Object.entries(this.inputImages)) this.attachments[k] = this.copyAttachments(files, k);
  },

  // The input images a prompt template gets: those of every input it uses ({{ inputs.<name> }}).
  stepAttachments(template) {
    const used = new Set([...String(template || '').matchAll(/\binputs\.([A-Za-z0-9_]+)/g)].map((m) => m[1]));
    return Object.entries(this.attachments).filter(([k]) => used.has(k)).flatMap(([, files]) => files);
  },

  // #262: this run's provider / model / effort of an agent (the constructor's agentOverrides), over the
  // workflow's resolved values; this.wf is this run's own copy, so the file and the next runs keep theirs.
  // Names are looked up as own keys only: "__proto__" or "constructor" must not reach Object.prototype.
  applyAgentOverrides(overrides) {
    this.agentOverrides = {};
    for (const [name, o] of Object.entries(overrides || {})) {
      if (!Object.hasOwn(this.wf.agents, name)) throw new Error(`Agent override: the workflow has no agent "${name}".`);
      const a = this.wf.agents[name];
      const clean = {};
      if (o?.provider) {
        if (!Object.hasOwn(this.wf.providers || {}, o.provider)) throw new Error(`Agent override of "${name}": provider "${o.provider}" is not defined in the workflow.`);
        clean.provider = String(o.provider);
      }
      if (o?.model) {
        clean.model = String(o.model).trim();
        if (!clean.model) throw new Error(`Agent override of "${name}": the model must be a model id, not blank.`);
      }
      if (o && 'effort' in o && o.effort !== undefined) clean.effort = o.effort ? String(o.effort) : '';
      const changed = Object.entries(clean).filter(([k, v]) => (a[k] || '') !== v);
      if (!changed.length) continue;
      Object.assign(a, clean);
      this.agentOverrides[name] = Object.fromEntries(changed);
    }
  },

  // #554: the owner's per-agent provider / model / effort of their workspace copy (ownerCopy), over the
  // repository copy's; the providers that copy defines come with them (it ran with them), never over one
  // the workflow defines. Agents the workflow lacks are skipped; this run's choice (#262) goes on top.
  applyOwnerCopy(owner) {
    this.ownerAgents = {};
    const providers = owner?.providers || {};
    for (const [name, o] of Object.entries(owner?.agents || {})) {
      if (!Object.hasOwn(this.wf.agents, name)) continue;
      const p = o?.provider;
      if (p && Object.hasOwn(providers, p) && !Object.hasOwn(this.wf.providers || {}, p)) this.wf.providers = { ...this.wf.providers, [p]: providers[p] };
      Object.assign(this.wf.agents[name], Object.fromEntries(['provider', 'model', 'effort'].filter((k) => o?.[k]).map((k) => [k, String(o[k])])));
      this.ownerAgents[name] = true;
    }
  },

  // `agents.<name>.enabled` (a boolean or a template over the inputs) leaves an agent out of
  // the run, e.g. the contender slots of ai-arena the user did not fill. Fan-out steps run
  // without it (`min_success` is capped at the agents left); a single-agent step can't.
  dropDisabledAgents() {
    const off = (v) => ['', 'false', '0', 'no', 'off', 'none'].includes(String(v).trim().toLowerCase());
    for (const [name, a] of Object.entries(this.wf.agents)) {
      if (a.enabled === undefined) continue;
      const enabled = typeof a.enabled === 'string' ? !off(render(a.enabled, { inputs: this.inputs })) : !!a.enabled;
      if (!enabled) delete this.wf.agents[name];
    }
    for (const s of this.wf.steps) {
      if (MACHINE_STEP_TYPES.includes(s.type)) continue;
      if (!s.agents) {
        if (!this.wf.agents[s.agent]) throw new Error(`Step "${s.id}" uses agent "${s.agent}", which is disabled for this run.`);
        continue;
      }
      s.agents = s.agents.filter((n) => this.wf.agents[n]);
      if (!s.agents.length) throw new Error(`Step "${s.id}": every agent of the fan-out is disabled for this run.`);
      if (s.min_success > s.agents.length) s.min_success = s.agents.length;
    }
  },

  // `persona: random` (the builder's "random agent" desk): the agent becomes one of the user's
  // agents, picked when the run starts; its prompt goes before the agent's own system prompt and its
  // skills are added. A resumed run keeps the previous pick. Recorded as `personas` in
  // workflow.started: { <agent>: { id, name } }.
  pickPersonas(personas, previous) {
    this.personas = {};
    for (const [name, a] of Object.entries(this.wf.agents)) {
      if (a.persona !== 'random') continue;
      const pool = personas.filter((p) => p && p.prompt);
      const p = pool.find((x) => x.id === previous?.[name]?.id) || pool[Math.floor(Math.random() * pool.length)];
      if (!p) {
        this.notices.push({ level: 'warn', message: `${name}: no agent in the Agents menu to pick at random; it runs with its own prompt.` });
        continue;
      }
      a.system_prompt = [p.prompt, a.system_prompt].filter(Boolean).join('\n\n');
      // an agent may list skills that no longer exist (the Agents screen keeps them): left out here
      const found = (p.skills || []).filter((k) => { try { return !!resolveSkill(this.skillsDirs, k); } catch { return false; } });
      const missing = (p.skills || []).filter((k) => !found.includes(k));
      if (missing.length) this.notices.push({ level: 'warn', message: `${name}: skills of "${p.name}" not found, left out: ${missing.join(', ')}.` });
      a.skills = [...new Set([...(a.skills || []), ...found])];
      this.personas[name] = { id: p.id, name: p.name };
      this.notices.push({ level: 'info', message: `${name}: random agent "${p.name}".` });
    }
  },

  // `type: run` inputs name another run by its id (its folder in runs/). Empty or "latest" picks
  // the most recent run of another workflow (so a retrospective that failed is not analyzed by the
  // next one); an id with no run folder is refused before this run starts.
  resolveRunInput(key, value) {
    const runsDir = path.dirname(this.runDir);
    const hasEvents = (id) => fs.existsSync(path.join(runsDir, id, 'events.jsonl'));
    const v = String(value ?? '').trim();
    if (!v || /^(latest|last)$/i.test(v)) {
      const workflowOf = (id) => {
        try {
          const first = fs.readFileSync(path.join(runsDir, id, 'events.jsonl'), 'utf8').split('\n', 1)[0];
          return JSON.parse(first).workflow || null;
        } catch { return null; }
      };
      const ids = fs.existsSync(runsDir) ? fs.readdirSync(runsDir).filter((id) => id !== this.runId && hasEvents(id)).sort().reverse() : [];
      const latest = ids.find((id) => workflowOf(id) !== this.wf.metadata?.name);
      if (!latest) throw new Error(`Input "${key}": there is no run to use as "latest" in ${runsDir}.`);
      return latest;
    }
    const id = path.basename(v);
    if (id !== v || !hasEvents(id)) {
      throw new Error(`Input "${key}": "${v}" is not a run id. Use the id of a run (its folder name in ${runsDir}, shown in the run view) or "latest".`);
    }
    return id;
  },

  // The name of an agent imported from the Agents menu (or picked by `persona: random`), for
  // the UI; an agent written in the YAML has none and shows its key.
  agentNames() {
    const looks = this.wf['x-builder']?.agents || {};
    const names = {};
    for (const k of Object.keys(this.wf.agents)) {
      const name = this.personas[k]?.name || looks[k]?.agent_name;
      if (name) names[k] = String(name);
    }
    return Object.keys(names).length ? names : undefined;
  },

  // #245: what the screens call each agent and step (the YAML's `display`, else the readable id),
  // recorded in workflow.started so a past run keeps its own version's names
  displayNames() {
    const named = (id, x) => (typeof x?.display === 'string' && x.display.trim()) || displayName(id);
    return {
      agents: Object.fromEntries(Object.entries(this.wf.agents).map(([k, a]) => [k, named(k, a)])),
      steps: Object.fromEntries(this.wf.steps.map((s) => [s.id, named(s.id, s)])),
    };
  },
};

module.exports = {
  methods,
};
