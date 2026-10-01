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

const fs = require('fs');
const path = require('path');
const { slugify } = require('./projects');

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

/** The supervisor first, then the Product Owner, then the user's agents by name. */
function listAgents(dir) {
  const custom = isDir(dir)
    ? fs.readdirSync(dir)
      .filter((f) => f.endsWith('.json') && !isSystem(f.slice(0, -5)))
      .map((f) => {
        const id = f.slice(0, -5);
        try { return readAgent(dir, id); } catch (e) { return { id, name: id, system: false, error: e.message, skills: [], appearance: normalizeAppearance(null) }; }
      })
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    : [];
  return [supervisorAgent(dir), productOwnerAgent(dir), ...custom];
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
function saveAgent(dir, id, data) {
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
  listAgents,
  normalizeAppearance,
  PRODUCT_OWNER_APPEARANCE,
  PRODUCT_OWNER_ID,
  readAgent,
  saveAgent,
  SUPERVISOR_ID,
};
