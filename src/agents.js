// Agents: reusable personas the user defines once, to be used across the platform later. One JSON
// file per agent in <workspace>/agents/<id>.json: name, description, prompt (the agent's context:
// what it is for), the skills it always gets and the look of its robot avatar (src/renderer/robots.js).
//
// The platform's supervisor is built in: always listed first, it can't be removed and its
// instructions (the run-supervisor skill) can't be changed here; only its look is saved
// (agents/supervisor.json).
// The Backlog's Product Owner (#105, src/product-owner.js) is built in the same way, listed second:
// its instructions are the backlog-product-owner skill; its look, model and effort are saved
// (agents/product-owner.json).
// The workflows' own agents (the `agents:` of each YAML in <workspace>/workflows/, #68) are listed
// after the user's agents, grouped by workflow, read-only: only their look is saved
// (agents/workflows/<file>/<agent>.json); the rest is changed in the workflow.

const fs = require('fs');
const path = require('path');
const capabilities = require('./engine/capabilities');
const { displayName } = require('./renderer/display-name');
const { loadWorkflow, render } = require('./engine/workflow');
const { slugify } = require('./projects');
const { isWorkflowFile } = require('./workflows');

const SUPERVISOR_ID = 'supervisor';
const PRODUCT_OWNER_ID = 'product-owner';
// Keep in sync with EYES and the generic emblems of src/renderer/robots.js.
const EYES = ['dots', 'bars', 'arcs', 'slits'];
const EMBLEMS = ['none', 'bolt', 'clipboard', 'heart', 'shield', 'leaf', 'gear', 'code', 'rocket', 'eye', 'crown', 'flask', 'star5'];
const COLORS = ['body', 'shell', 'visor', 'glow'];
const HEX = /^#[0-9a-f]{6}$/i;
const MAX_PROMPT = 20000;
const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh'];
const MODEL = /^[\w.:/@-]{1,80}$/;

// The supervisor's own look (the app's purple); also the starting point of a new agent.
const DEFAULT_APPEARANCE = Object.freeze({ body: '#7C5CFF', shell: '#F4F4F6', visor: '#15161A', glow: '#C9B8FF', eyes: 'dots', emblem: 'none' });
// The Product Owner's look: teal, with a clipboard (the product-owner variant of robots.js).
const PRODUCT_OWNER_APPEARANCE = Object.freeze({ body: '#0F9F8F', shell: '#F4F4F6', visor: '#15161A', glow: '#9FF5E6', eyes: 'arcs', emblem: 'clipboard' });

const SUPERVISOR = Object.freeze({
  id: SUPERVISOR_ID,
  name: 'Supervisor',
  system: true,
  description: 'The platform\'s own agent: steps in when a workflow step fails, explains runs and helps customize workflows and skills.',
  prompt: 'Built into the platform. It follows the run-supervisor skill and works on workflows only: it never changes the code of your repositories and never crosses a human approval gate.',
  skills: ['run-supervisor'],
});

const PRODUCT_OWNER = Object.freeze({
  id: PRODUCT_OWNER_ID,
  name: 'Product Owner',
  system: true,
  description: 'The Backlog\'s own agent: analyzes the issues and proposes which to run together, which not in parallel, in what order, and which to enrich first.',
  prompt: 'Built into the platform. It follows the backlog-product-owner skill and is read-only: it never edits issues, never starts runs and never answers a human approval gate. You apply its proposals with Assign or Add to roadmap.',
  skills: ['backlog-product-owner'],
  model: 'claude-opus-5-5',
  effort: 'high',
});

const SYSTEM = { [SUPERVISOR_ID]: SUPERVISOR, [PRODUCT_OWNER_ID]: PRODUCT_OWNER };
const isSystem = (id) => Object.hasOwn(SYSTEM, path.basename(String(id)));

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const agentFile = (dir, id) => path.join(dir, `${path.basename(String(id))}.json`);

/** Unknown or malformed fields fall back to `base` (never throws: a bad file still lists). */
function normalizeAppearance(a, base = DEFAULT_APPEARANCE) {
  const src = a && typeof a === 'object' ? a : {};
  const out = {};
  for (const k of COLORS) out[k] = HEX.test(src[k]) ? src[k].toUpperCase() : base[k];
  out.eyes = EYES.includes(src.eyes) ? src.eyes : base.eyes;
  out.emblem = EMBLEMS.includes(src.emblem) ? src.emblem : base.emblem;
  return out;
}

// Skill ids: plain folder names, no duplicates. Skills that don't exist (yet, or anymore) are kept:
// the UI marks them as missing.
function cleanSkills(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.map((s) => path.basename(String(s || '').trim())).filter(Boolean))];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
}

function supervisorAgent(dir) {
  let saved = {};
  try { saved = readJson(agentFile(dir, SUPERVISOR_ID)); } catch { saved = {}; }
  return { ...SUPERVISOR, skills: [...SUPERVISOR.skills], appearance: normalizeAppearance(saved.appearance), updatedAt: saved.updatedAt || null };
}

function productOwnerAgent(dir) {
  let saved = {};
  try { saved = readJson(agentFile(dir, PRODUCT_OWNER_ID)); } catch { saved = {}; }
  return {
    ...PRODUCT_OWNER,
    skills: [...PRODUCT_OWNER.skills],
    model: MODEL.test(saved.model || '') ? saved.model : PRODUCT_OWNER.model,
    effort: EFFORTS.includes(saved.effort) ? saved.effort : PRODUCT_OWNER.effort,
    appearance: normalizeAppearance(saved.appearance, PRODUCT_OWNER_APPEARANCE),
    updatedAt: saved.updatedAt || null,
  };
}

function readAgent(dir, id) {
  if (id === SUPERVISOR_ID) return supervisorAgent(dir);
  if (id === PRODUCT_OWNER_ID) return productOwnerAgent(dir);
  const a = readJson(agentFile(dir, id));
  return {
    id,
    name: String(a.name || id),
    system: false,
    description: String(a.description || ''),
    prompt: String(a.prompt || ''),
    skills: cleanSkills(a.skills),
    appearance: normalizeAppearance(a.appearance),
    createdAt: a.createdAt || null,
    updatedAt: a.updatedAt || null,
  };
}

// ---- workflow agents (#68) ----------------------------------------------------------------
// The agents defined inline in each workflow's YAML (`agents:`), read from the files on disk (the
// same source as Workflows › Definitions, so edited and custom workflows show what they define).
// Read-only here, like the supervisor: only their look is saved, in
// agents/workflows/<workflow file>/<agent>.json (a subfolder, so it never lists as a user agent).
// Their id is `workflow:<file>:<agent>`: names repeat across workflows (reviewer, verifier).
const WORKFLOW_ID = /^workflow:([^:/\\]+\.ya?ml):([\w-]+)$/i;
const workflowAgentId = (file, key) => `workflow:${file}:${key}`;
const isWorkflowAgent = (id) => WORKFLOW_ID.test(String(id));
const lookFile = (dir, file, key) => path.join(dir, 'workflows', path.basename(file), `${path.basename(key)}.json`);
const isTemplate = (v) => typeof v === 'string' && v.includes('{{');

/** `unit-test-writer-{{ inputs.language }}` → `unit-test-writer` (the family). */
function skillFamily(s) {
  const name = String(typeof s === 'object' && s ? s.name || s.id || '' : s || '');
  return name.replace(/[-_]?\{\{.*$/, '').trim();
}

/** The defaults of a workflow's inputs, to resolve `{{ inputs.x }}` for display. */
function inputDefaults(wf) {
  return Object.fromEntries(Object.entries(wf.inputs || {}).map(([k, d]) => [k, d && typeof d === 'object' ? d.default ?? '' : d ?? '']));
}

function savedLook(dir, file, key) {
  try { return readJson(lookFile(dir, file, key)); } catch { return {}; }
}

/**
 * The agents of one workflow file, or one entry with the error when the file doesn't load (shown
 * once, not per agent). `appearance` is null when the look was never customised: the screens then
 * draw the provider's robot.
 */
function agentsOfWorkflow(dir, workflowsDir, file) {
  let wf;
  try { wf = loadWorkflow(path.join(workflowsDir, file)); } catch (e) {
    return [{ id: `workflow:${file}`, name: file, workflowError: true, workflow: { file, name: file }, error: e.message, skills: [], appearance: null }];
  }
  const workflow = { file, name: String(wf.metadata?.name || file) };
  const scope = { inputs: inputDefaults(wf) };
  // a templated value shows the workflow's default and is marked as picked when the run starts
  const value = (v) => {
    if (!isTemplate(v)) return { value: v == null || v === '' ? null : String(v), picked: false };
    let out = '';
    try { out = render(v, scope).trim(); } catch { out = ''; }
    return { value: out || null, picked: true };
  };
  return Object.entries(wf.agents).map(([key, raw]) => {
    const a = { ...(wf.defaults || {}), ...(raw || {}) };
    const provider = value(a.provider);
    const model = value(a.model);
    const effort = value(a.effort);
    const saved = savedLook(dir, file, key);
    return {
      id: workflowAgentId(file, key),
      key,
      name: displayName(key),
      system: false,
      readOnly: true,
      workflow,
      description: String(a.description || `An agent of the ${workflow.name} workflow.`),
      prompt: String(a.system_prompt || ''),
      provider: provider.value,
      providerType: wf.providers?.[provider.value]?.type || null,
      model: model.value,
      effort: effort.value,
      // which of provider / model / effort the user picks when starting a run
      pickedAtStart: [['provider', provider], ['model', model], ['effort', effort]].filter(([, v]) => v.picked).map(([k]) => k),
      session: a.session || 'persistent',
      skills: [...new Set((Array.isArray(a.skills) ? a.skills : []).map(skillFamily).filter(Boolean))],
      capabilities: capabilities.describe(a.capabilities),
      steps: wf.steps.filter((s) => s.agent === key || (Array.isArray(s.agents) && s.agents.includes(key))).map((s) => s.id),
      appearance: saved.appearance ? normalizeAppearance(saved.appearance) : null,
      updatedAt: saved.updatedAt || null,
    };
  });
}

/** Every workflow's agents, grouped by workflow file (sorted), agents in the YAML's order. */
function listWorkflowAgents(dir, workflowsDir) {
  if (!workflowsDir || !isDir(workflowsDir)) return [];
  return fs.readdirSync(workflowsDir).filter(isWorkflowFile).sort().flatMap((file) => agentsOfWorkflow(dir, workflowsDir, file));
}

function readWorkflowAgent(dir, workflowsDir, id) {
  const [, file] = WORKFLOW_ID.exec(String(id)) || [];
  const a = file && isDir(workflowsDir || '') && fs.existsSync(path.join(workflowsDir, file))
    ? agentsOfWorkflow(dir, workflowsDir, file).find((x) => x.id === id && !x.workflowError)
    : null;
  if (!a) throw new Error(`Workflow agent not found: ${id}`);
  return a;
}

/**
 * Only the look of a workflow agent is saved (everything else belongs to the workflow's YAML);
 * `appearance: null` goes back to the provider's robot.
 */
function saveWorkflowAgent(dir, workflowsDir, id, data) {
  const a = readWorkflowAgent(dir, workflowsDir, id);
  const file = lookFile(dir, a.workflow.file, a.key);
  if (data?.appearance == null) fs.rmSync(file, { force: true });
  else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ appearance: normalizeAppearance(data.appearance), updatedAt: new Date().toISOString() }, null, 2)}\n`);
  }
  return readWorkflowAgent(dir, workflowsDir, id);
}

/**
 * The supervisor first, then the Product Owner, then the user's agents by name, then (with
 * `workflowsDir`) the workflows' agents grouped by workflow.
 */
function listAgents(dir, { workflowsDir } = {}) {
  const custom = isDir(dir)
    ? fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !isSystem(f.slice(0, -5)))
      .map((f) => {
        const id = f.slice(0, -5);
        try { return readAgent(dir, id); } catch (e) { return { id, name: id, system: false, error: e.message, skills: [], appearance: normalizeAppearance(null) }; }
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    : [];
  return [supervisorAgent(dir), productOwnerAgent(dir), ...custom, ...listWorkflowAgents(dir, workflowsDir)];
}

function fields(data) {
  const name = String(data?.name || '').trim();
  const prompt = String(data?.prompt || '').trim();
  if (!name) throw new Error('Enter the agent name.');
  if (!prompt) throw new Error('Enter the agent prompt: what the agent is for.');
  if (prompt.length > MAX_PROMPT) throw new Error(`The prompt is too long (max ${MAX_PROMPT} characters).`);
  return { name, description: String(data.description || '').trim(), prompt, skills: cleanSkills(data.skills), appearance: normalizeAppearance(data.appearance) };
}

function write(dir, id, agent) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(agentFile(dir, id), `${JSON.stringify(agent, null, 2)}\n`);
  return readAgent(dir, id);
}

function createAgent(dir, data) {
  const f = fields(data);
  // "supervisor" and "product-owner" are taken by the built-in agents
  // (slugify falls back to "project" for names with no letters or digits)
  const base = /[a-z0-9]/i.test(f.name.normalize('NFD')) ? slugify(f.name) : 'agent';
  let id = base;
  for (let i = 2; isSystem(id) || fs.existsSync(agentFile(dir, id)); i++) id = `${base}-${i}`;
  const now = new Date().toISOString();
  return write(dir, id, { ...f, createdAt: now, updatedAt: now });
}

/**
 * The supervisor only takes `appearance`, the Product Owner `appearance`, `model` and `effort`;
 * everything else about them is fixed.
 */
function saveAgent(dir, id, data, { workflowsDir } = {}) {
  if (isWorkflowAgent(id)) return saveWorkflowAgent(dir, workflowsDir, id, data);
  if (id === SUPERVISOR_ID) {
    return write(dir, SUPERVISOR_ID, { appearance: normalizeAppearance(data?.appearance), updatedAt: new Date().toISOString() });
  }
  if (id === PRODUCT_OWNER_ID) {
    const model = String(data?.model || '').trim();
    if (model && !MODEL.test(model)) throw new Error(`Not a model name: ${model}`);
    if (data?.effort && !EFFORTS.includes(data.effort)) throw new Error(`Pick the effort (${EFFORTS.join(', ')}).`);
    return write(dir, PRODUCT_OWNER_ID, {
      appearance: normalizeAppearance(data?.appearance, PRODUCT_OWNER_APPEARANCE),
      model: model || PRODUCT_OWNER.model,
      effort: data?.effort || PRODUCT_OWNER.effort,
      updatedAt: new Date().toISOString(),
    });
  }
  const cur = readAgent(dir, id);
  return write(dir, id, { ...fields(data), createdAt: cur.createdAt, updatedAt: new Date().toISOString() });
}

/** Path of the file to move to the trash; the built-in agents can't be removed. */
function agentPathForRemoval(dir, id) {
  if (String(id).startsWith('workflow:')) throw new Error('A workflow agent belongs to its workflow: change it in Workflows › Definitions.');
  if (isSystem(id)) throw new Error(`The ${SYSTEM[path.basename(String(id))].name} is part of the platform and can't be removed.`);
  const file = agentFile(dir, id);
  if (!fs.existsSync(file)) throw new Error(`Agent not found: ${id}`);
  return file;
}

module.exports = {
  agentPathForRemoval,
  createAgent,
  DEFAULT_APPEARANCE,
  EMBLEMS,
  EYES,
  isWorkflowAgent,
  listAgents,
  listWorkflowAgents,
  normalizeAppearance,
  PRODUCT_OWNER_APPEARANCE,
  PRODUCT_OWNER_ID,
  readAgent,
  saveAgent,
  SUPERVISOR_ID,
  workflowAgentId,
};
