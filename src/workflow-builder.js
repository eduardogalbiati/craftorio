// Visual workflow builder (Workflows > Builder): converts between the builder's spec and a regular
// workflow YAML, so the engine runs what the builder saves unchanged.
//
// A spec is a straight line of desks:
//   { name, description, category, steps: [step] }
//   agent desk: { id, kind: 'agent', brief, context, access: 'read'|'edit',
//                 agent: { source: 'custom'|'agent'|'random', agentId, name, appearance,
//                          provider: 'claude'|'codex'|'grok', model, effort, system_prompt, skills } }
//   gate:       { id, kind: 'gate', message, onReject: 'stop' | <id of an earlier agent desk> }
// `brief` is what the agent does in the step; with `context` the builder adds the run's task, the
// previous desk's output and the notes typed at the gates to its prompt. `persona: random` (the
// "random agent" desk) is resolved by the engine when the run starts. What the YAML carries only
// for the builder (briefs, the imported agent and its look) lives in `x-builder`.
//
// fromWorkflow() reads a workflow back and lists what the builder can't draw (loops, fan-outs,
// schemas...). Such a workflow still opens: describeWorkflow() gives a "fixed" spec (the steps as
// they are, plus `agents` by name) where only the agents and the prompts can change, and
// patchWorkflow() writes those changes into the YAML, keeping everything else.
// `effort: 'default'` leaves the effort out (the CLI's own default).

const yaml = require('js-yaml');
const registry = require('./shared/providers');
const { WORKFLOW_CATEGORIES } = require('./workflow-categories');

// The workflow provider definitions the builder writes, by CLI id: each adapter's `definition`.
const PROVIDERS = Object.fromEntries(registry.clis().map((a) => [a.id, a.definition]));
const EFFORTS = ['default', 'low', 'medium', 'high', 'xhigh'];
const CATEGORIES = WORKFLOW_CATEGORIES;
const SOURCES = ['custom', 'agent', 'random'];
const ACCESS = {
  read: { tools: ['read'], web: false },
  edit: { tools: ['read', 'edit', 'write', 'bash'], web: false },
};
const ID = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED = new Set(['end', 'fail']);
const UNATTENDED = 'Nobody can answer questions during the run: when something is unspecified, make a reasonable assumption and state it.';
const FEEDBACK_LABEL = 'Notes for the agents (optional)';

const INPUTS = {
  task: { type: 'string', required: true, description: 'What this run should achieve. Every desk gets it.' },
  project_path: { type: 'string', required: false, default: '', description: 'Optional project folder the agents work in (empty: the run folder).' },
};

const str = (v) => String(v ?? '').trim();
const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const REVIEWERS = ['human', 'ai'];
// What an AI gate answers: the engine checks it (schema retries, then the supervisor).
const AI_SCHEMA = {
  type: 'object',
  required: ['approved', 'notes'],
  properties: { approved: { type: 'boolean' }, notes: { type: 'string' } },
};
const isAiGate = (s) => s?.kind === 'gate' && s.reviewer === 'ai';

function validateAgent(a = {}, where, errs) {
  if (!PROVIDERS[a.provider]) errs.push(`${where}: pick the CLI (claude, codex or grok).`);
  if (!str(a.model)) errs.push(`${where}: pick the model.`);
  if (!EFFORTS.includes(a.effort || 'default')) errs.push(`${where}: pick the effort (${EFFORTS.join(', ')}).`);
  if (!SOURCES.includes(a.source || 'custom')) errs.push(`${where}: unknown agent source "${a.source}".`);
  if (a.source !== 'random' && !str(a.system_prompt)) errs.push(`${where}: write the agent's prompt (who it is), or import an agent.`);
}

/** Throws with every problem of a spec at once (the builder shows them together). */
// #245: a step's (or agent's) `display`, the name the screens show instead of its id; empty: none
const DISPLAY_MAX = 40;
const displayOf = (x) => (str(x?.display) ? { display: str(x.display) } : {});
function setDisplay(d, value, where) {
  const v = str(value);
  if (v.length > DISPLAY_MAX) throw new Error(`${where}: the display name must be at most ${DISPLAY_MAX} characters.`);
  if (v) d.display = v; else delete d.display;
}

function validateSpec(spec) {
  const errs = [];
  if (!spec || typeof spec !== 'object') throw new Error('Nothing to save.');
  if (!str(spec.name)) errs.push('Give the workflow a name.');
  const steps = Array.isArray(spec.steps) ? spec.steps : [];
  if (!steps.some((s) => s?.kind === 'agent')) errs.push('Add at least one desk with an agent.');
  const seen = new Set();
  steps.forEach((s, i) => {
    const where = `Desk ${i + 1}${s?.id ? ` ("${s.id}")` : ''}`;
    if (!ID.test(s?.id || '') || RESERVED.has(s.id)) errs.push(`${where}: the id must start with a letter and use only lowercase letters, digits and _ (not "end" or "fail").`);
    else if (seen.has(s.id)) errs.push(`${where}: another desk already uses this id.`);
    seen.add(s?.id);
    if (str(s?.display).length > DISPLAY_MAX) errs.push(`${where}: the display name must be at most ${DISPLAY_MAX} characters.`);
    if (s?.kind === 'gate') {
      if (!REVIEWERS.includes(s.reviewer || 'human')) errs.push(`${where}: who approves must be "human" or "ai".`);
      if (!str(s.message)) errs.push(isAiGate(s) ? `${where}: write what the agent checks.` : `${where}: write what the approver should check.`);
      const back = s.onReject || 'stop';
      if (back !== 'stop' && !steps.slice(0, i).some((x) => x.kind === 'agent' && x.id === back)) errs.push(`${where}: "if rejected" must be "stop" or an agent desk before this gate.`);
      if (isAiGate(s)) {
        validateAgent(s.agent, where, errs);
        const n = Number(s.maxRounds ?? 3);
        if (back !== 'stop' && !(Number.isInteger(n) && n >= 1 && n <= 20)) errs.push(`${where}: rounds must be a whole number from 1 to 20.`);
      }
      return;
    }
    if (s?.kind !== 'agent') { errs.push(`${where}: unknown kind "${s?.kind}".`); return; }
    if (!str(s.brief)) errs.push(`${where}: write what the agent does in this step.`);
    if (!ACCESS[s.access || 'read']) errs.push(`${where}: access must be "read" or "edit".`);
    validateAgent(s.agent, where, errs);
  });
  if (errs.length) throw new Error(errs.join('\n'));
}

// The prompt a desk sends: the brief, then (with `context`) the task, the previous agent desk's
// answer and the notes typed at the human gates. `aiBacks`: AI gates that can send the work back to
// this desk; their notes are always added when they did.
function stepPrompt(step, prevAgent, hasGates, aiBacks = []) {
  const parts = [str(step.brief)];
  if (step.context !== false) {
    parts.push('The task of this run:\n{{ inputs.task }}');
    if (prevAgent) parts.push(`What the previous desk ("${prevAgent.id}") answered:\n{{ steps.${prevAgent.id}.output.text }}`);
    if (hasGates) {
      parts.push('{% if feedback | length %}Notes from the user at the approval gates (they take precedence):\n'
        + '{% for f in feedback %}- {{ f.text }}\n{% endfor %}{% endif %}');
    }
  }
  for (const g of aiBacks) {
    parts.push(`{% if steps.${g}.output and not steps.${g}.output.approved %}The check "${g}" sent your previous answer back. Address its notes:\n`
      + `{{ steps.${g}.output.notes }}{% endif %}`);
  }
  return `${parts.join('\n\n')}\n`;
}

// The prompt of an AI gate: the criteria, the task and the previous desk's answer.
function checkPrompt(gate, prevAgent) {
  return `${[
    `You check the work before the run goes on. What to check:\n${str(gate.message)}`,
    'The task of this run:\n{{ inputs.task }}',
    ...(prevAgent ? [`What the previous desk ("${prevAgent.id}") answered:\n{{ steps.${prevAgent.id}.output.text }}`] : []),
    'Answer with `approved` (true only when every point above is met) and `notes` (what must change, most important first; empty when approved).',
  ].join('\n\n')}\n`;
}

function agentYaml(a, access) {
  const system = str(a.system_prompt);
  return {
    provider: a.provider,
    model: str(a.model),
    ...(a.effort && a.effort !== 'default' ? { effort: a.effort } : {}),
    ...(a.source === 'random' ? { persona: 'random' } : {}),
    session: 'persistent',
    capabilities: ACCESS[access || 'read'],
    working_dir: '{{ inputs.project_path }}',
    system_prompt: `${system ? `${system}\n\n` : ''}${UNATTENDED}\n`,
    ...(a.skills?.length ? { skills: [...new Set(a.skills.map(str).filter(Boolean))] } : {}),
  };
}
const agentMeta = (a) => ({
  source: a.source || 'custom',
  ...(a.source === 'agent' && a.agentId ? { agent_id: a.agentId, agent_name: str(a.name) || a.agentId } : {}),
  ...(a.appearance && a.source !== 'random' ? { appearance: a.appearance } : {}),
});

// The workflow document for a spec (see toYaml).
function buildDoc(spec, base = null) {
  validateSpec(spec);
  const steps = spec.steps;
  const hasGates = steps.some((s) => s.kind === 'gate' && !isAiGate(s));
  const agents = {};
  const out = [];
  const meta = {};
  let prevAgent = null;
  steps.forEach((s, i) => {
    const next = steps[i + 1]?.id || 'end';
    const back = s.onReject && s.onReject !== 'stop' ? s.onReject : null;
    if (isAiGate(s)) {
      agents[s.id] = agentYaml(s.agent, 'read');
      out.push({
        id: s.id,
        ...displayOf(s),
        agent: s.id,
        prompt: checkPrompt(s, prevAgent),
        output_schema: AI_SCHEMA,
        transitions: [
          { when: 'output.approved', goto: next },
          back
            ? { when: 'true', goto: back, loop: { name: `${s.id}_rounds`, max_iterations: Number(s.maxRounds ?? 3), on_exhausted: 'end' }, status: 'failed' }
            : { when: 'true', goto: 'end', status: 'failed' },
        ],
      });
      meta[s.id] = { kind: 'ai_gate', criteria: str(s.message), ...agentMeta(s.agent) };
      return;
    }
    if (s.kind === 'gate') {
      out.push({
        id: s.id,
        ...displayOf(s),
        type: 'human_approval',
        message: `${str(s.message)}\n`,
        feedback: { label: FEEDBACK_LABEL },
        transitions: [
          { when: 'approved', goto: next },
          back ? { when: 'true', goto: back } : { when: 'true', goto: 'end', status: 'cancelled' },
        ],
      });
      return;
    }
    agents[s.id] = agentYaml(s.agent, s.access);
    const aiBacks = steps.filter((g) => isAiGate(g) && g.onReject === s.id).map((g) => g.id);
    out.push({ id: s.id, ...displayOf(s), agent: s.id, prompt: stepPrompt(s, prevAgent, hasGates, aiBacks) });
    meta[s.id] = { brief: str(s.brief), context: s.context !== false, ...agentMeta(s.agent) };
    prevAgent = s;
  });

  const b = base && typeof base === 'object' ? base : {};
  return {
    apiVersion: 'multiagent/v1',
    kind: 'Workflow',
    metadata: {
      name: str(spec.name),
      version: b.metadata?.version || '0.1.0',
      description: str(spec.description),
      tags: b.metadata?.tags || ['builder'],
      category: CATEGORIES.includes(spec.category) ? spec.category : 'build',
    },
    inputs: INPUTS,
    providers: { ...PROVIDERS, ...(b.providers || {}) },
    defaults: b.defaults || { timeout: '30m', retry: { max_attempts: 2, backoff: 'exponential', initial_delay: '10s' } },
    orchestrator: b.orchestrator || {
      provider: 'claude',
      model: 'claude-opus-5-5',
      supervisor: { enabled: true, max_interventions: 2 },
      limits: { max_total_duration: '2h', max_total_cost_usd: 20 },
    },
    agents,
    steps: out,
    ...(b.observability ? { observability: b.observability } : {}),
    'x-builder': { version: 1, steps: meta },
  };
}

/**
 * Builds the workflow YAML for a spec. `base` is the workflow being edited (parsed): its providers,
 * defaults, orchestrator and observability are kept, so hand edits there survive the builder.
 */
function toYaml(spec, base = null) {
  const doc = buildDoc(spec, base);
  const header = '# Made with the visual builder (Workflows > Builder). You can edit it by hand; the builder\n'
    + '# opens it again as long as it only uses what the builder draws (desks in a line and approval gates).\n';
  return header + yaml.dump(doc, { lineWidth: -1, noRefs: true });
}

const STEP_KEYS = new Set(['id', 'display', 'agent', 'prompt']);
const CHECK_KEYS = new Set(['id', 'display', 'agent', 'prompt', 'output_schema', 'transitions']);
const GATE_KEYS = new Set(['id', 'display', 'type', 'message', 'feedback', 'transitions']);
const AGENT_KEYS = new Set(['provider', 'model', 'effort', 'persona', 'session', 'capabilities', 'working_dir', 'system_prompt', 'skills']);
const TOP_KEYS = new Set(['apiVersion', 'kind', 'metadata', 'inputs', 'providers', 'defaults', 'orchestrator', 'agents', 'steps', 'observability', 'x-builder', 'x-tools']);
const has = (o, k) => o[k] !== undefined;

/**
 * Reads a parsed workflow back into a spec. `problems` lists what the builder can't draw; when it
 * is not empty the spec is incomplete and the workflow should be edited as YAML.
 */
function fromWorkflow(doc) {
  const problems = [];
  const add = (p) => { if (!problems.includes(p)) problems.push(p); };
  if (!doc || typeof doc !== 'object') return { spec: null, problems: ['Not a workflow.'] };
  for (const k of Object.keys(doc)) if (!TOP_KEYS.has(k)) add(`top-level "${k}"`);
  for (const k of Object.keys(doc.inputs || {})) if (!INPUTS[k]) add(`input "${k}"`);
  const meta = doc['x-builder']?.steps || {};
  const docAgents = doc.agents || {};
  const used = new Map();
  const steps = [];

  // One agent of the workflow as the builder's agent (the desk's or the AI gate's).
  const readAgent = (s, m) => {
    if (used.has(s.agent)) add(`agent "${s.agent}" used by more than one step`);
    used.set(s.agent, s.id);
    const a = docAgents[s.agent] || {};
    for (const k of Object.keys(a)) if (!AGENT_KEYS.has(k)) add(`"${k}" on agent "${s.agent}"`);
    const provider = providerOf(doc, a.provider);
    if (!provider) add(`provider "${a.provider}" of agent "${s.agent}"`);
    for (const k of ['provider', 'model', 'effort']) if (String(a[k] ?? '').includes('{{')) add(`templated ${k} on agent "${s.agent}"`);
    if (has(a, 'session') && a.session !== 'persistent') add(`session "${a.session}" on agent "${s.agent}"`);
    if (has(a, 'persona') && a.persona !== 'random') add(`persona "${a.persona}" on agent "${s.agent}"`);
    const access = Object.keys(ACCESS).find((k) => sameJson(ACCESS[k], a.capabilities));
    if (!access) add(`capabilities of agent "${s.agent}"`);
    let system = str(a.system_prompt);
    if (system.endsWith(UNATTENDED)) system = system.slice(0, -UNATTENDED.length).trim();
    const source = a.persona === 'random' ? 'random' : m.source === 'agent' ? 'agent' : 'custom';
    return {
      access: access || 'read',
      agent: {
        source,
        agentId: source === 'agent' ? m.agent_id || null : null,
        name: source === 'agent' ? m.agent_name || m.agent_id || '' : '',
        appearance: m.appearance || null,
        provider: provider || 'claude',
        model: str(a.model),
        effort: EFFORTS.includes(a.effort) ? a.effort : 'default',
        system_prompt: system,
        skills: Array.isArray(a.skills) ? a.skills.map(String) : [],
      },
    };
  };

  for (const s of Array.isArray(doc.steps) ? doc.steps : []) {
    const m = meta[s.id] || {};
    if (s.type === 'human_approval') {
      for (const k of Object.keys(s)) if (!GATE_KEYS.has(k)) add(`"${k}" on gate "${s.id}"`);
      const ts = s.transitions || [];
      let onReject = 'stop';
      if (ts.length) {
        const [ok, no] = ts;
        const shape = ts.length === 2 && ok.when === 'approved' && no.when === 'true' && Object.keys(ok).every((k) => ['when', 'goto'].includes(k))
          && Object.keys(no).every((k) => ['when', 'goto', 'status'].includes(k));
        if (!shape) add(`transitions of gate "${s.id}"`);
        else if (no.goto !== 'end') onReject = no.goto;
      }
      steps.push({ id: s.id, ...displayOf(s), kind: 'gate', reviewer: 'human', message: str(s.message), onReject });
      continue;
    }
    if (m.kind === 'ai_gate') {
      for (const k of Object.keys(s)) if (!CHECK_KEYS.has(k)) add(`"${k}" on check "${s.id}"`);
      const no = (s.transitions || [])[1] || {};
      const { agent } = readAgent(s, m);
      steps.push({
        id: s.id, ...displayOf(s), kind: 'gate', reviewer: 'ai', message: str(m.criteria),
        onReject: no.goto && no.goto !== 'end' ? no.goto : 'stop',
        maxRounds: Number(no.loop?.max_iterations ?? 3),
        agent,
      });
      continue;
    }
    for (const k of Object.keys(s)) if (!STEP_KEYS.has(k)) add(k === 'agents' ? `parallel agents on "${s.id}"` : `"${k}" on step "${s.id}"`);
    if (s.type) add(`step type "${s.type}"`);
    const { access, agent } = readAgent(s, m);
    steps.push({
      id: s.id,
      ...displayOf(s),
      kind: 'agent',
      brief: m.brief !== undefined ? str(m.brief) : str(s.prompt),
      context: m.brief !== undefined ? m.context !== false : false,
      access,
      agent,
    });
  }
  const md = doc.metadata || {};
  const spec = { name: str(md.name), description: str(md.description), category: CATEGORIES.includes(md.category) ? md.category : 'build', steps };
  // hand edits: what the builder would write from this spec no longer matches the file
  if (!problems.length) {
    try {
      const expected = buildDoc(spec).steps;
      steps.forEach((s, i) => {
        const got = doc.steps[i], want = expected[i];
        if (!got.prompt && !want.prompt ? false : str(got.prompt) !== str(want.prompt)) add(`hand-edited prompt of "${s.id}"`);
        const rest = (x) => JSON.stringify({ ...x, prompt: undefined, message: x.message === undefined ? undefined : str(x.message) });
        if (rest(got) !== rest(want)) add(`hand-edited step "${s.id}"`);
      });
    } catch (e) {
      add(`not valid for the builder (${e.message.split('\n')[0]})`);
    }
  }
  return { spec, problems };
}

// The builder's CLI key ('claude', 'codex', 'grok') of an agent's provider in a workflow.
function providerOf(doc, key) {
  const type = doc.providers?.[key]?.type;
  const id = type ? registry.byType(type)?.id : key;
  return PROVIDERS[id] ? id : null;
}

/**
 * Any workflow as a "fixed" spec: its steps as they are (fan-outs, loops, schemas and branches are
 * shown as badges) and its agents by name. `templated` lists the agent fields set from the run's
 * inputs (e.g. model: "{{ inputs.writer_model }}"): they are shown, never changed.
 */
function describeWorkflow(doc) {
  const md = doc.metadata || {};
  const looks = doc['x-builder']?.agents || {};
  const agents = {};
  for (const [name, a0] of Object.entries(doc.agents || {})) {
    const a = a0 || {};
    const templated = {};
    for (const k of ['provider', 'model', 'effort']) if (String(a[k] ?? '').includes('{{')) templated[k] = String(a[k]);
    const look = looks[name] || {};
    agents[name] = {
      source: look.agent_id ? 'agent' : 'custom',
      agentId: look.agent_id || null,
      name: look.agent_name || '',
      display: str(a.display),
      appearance: look.appearance || null,
      provider: templated.provider ? null : providerOf(doc, a.provider),
      model: templated.model ? '' : str(a.model),
      effort: !templated.effort && EFFORTS.includes(a.effort) ? a.effort : 'default',
      system_prompt: str(a.system_prompt),
      skills: Array.isArray(a.skills) ? a.skills.map(String) : [],
      templated,
      optional: a.enabled !== undefined,
    };
  }
  const steps = (Array.isArray(doc.steps) ? doc.steps : []).map((st, i, all) => {
    const next = all[i + 1]?.id || 'end';
    const branches = [...new Set((st.transitions || []).map((t) => t.goto).filter((g) => g && g !== next))];
    const badges = [];
    if (st.agents) badges.push(`parallel ×${st.agents.length}`);
    if (st.goal) badges.push('/goal');
    if (st.loop || (st.transitions || []).some((t) => t.loop)) badges.push('/loop');
    if (st.output_schema) badges.push('schema');
    if (st.save_as) badges.push('saves files');
    if (st.choices) badges.push(`choices: ${st.choices.map((c) => c.id).join(' / ')}`);
    if (st.type && st.type !== 'human_approval') badges.push(st.type);
    const common = { id: st.id, display: str(st.display), badges, branches };
    if (st.type === 'human_approval') return { ...common, kind: 'gate', message: str(st.message), onReject: null };
    const names = st.agents || (st.agent ? [st.agent] : []);
    return { ...common, kind: names.length ? 'agent' : 'other', agentNames: names, brief: str(st.prompt) };
  });
  return { name: str(md.name), description: str(md.description), category: CATEGORIES.includes(md.category) ? md.category : 'build', steps, agents, fixed: true };
}

/**
 * Writes the changes of a fixed spec (describeWorkflow) into the workflow: name, description,
 * category, each agent's CLI/model/effort (unless templated), prompt and skills, each step's
 * prompt and each gate's message. Everything else stays as it is. `header` = the file's leading
 * comments (js-yaml drops comments).
 */
function patchWorkflow(doc, spec, header = '') {
  const out = structuredClone(doc);
  out.metadata = { ...(out.metadata || {}), name: str(spec.name) || out.metadata?.name, description: str(spec.description) };
  if (CATEGORIES.includes(spec.category)) out.metadata.category = spec.category;
  if (!out.metadata.name) throw new Error('Give the workflow a name.');
  const looks = {};
  for (const [name, a] of Object.entries(spec.agents || {})) {
    const d = out.agents?.[name];
    if (!d) continue;
    const t = a.templated || {};
    if (!t.provider && PROVIDERS[a.provider]) d.provider = providerKey(out, a.provider);
    if (!t.model && str(a.model)) d.model = str(a.model);
    if (!t.effort) {
      if (!EFFORTS.includes(a.effort || 'default')) throw new Error(`Agent "${name}": pick the effort (${EFFORTS.join(', ')}).`);
      if (!a.effort || a.effort === 'default') delete d.effort; else d.effort = a.effort;
    }
    if (str(a.system_prompt)) d.system_prompt = `${str(a.system_prompt)}\n`; else delete d.system_prompt;
    const skills = [...new Set((a.skills || []).map(str).filter(Boolean))];
    if (skills.length) d.skills = skills; else delete d.skills;
    if (a.display !== undefined) setDisplay(d, a.display, `Agent "${name}"`);
    if (a.appearance || a.agentId) looks[name] = { ...(a.agentId ? { agent_id: a.agentId, agent_name: str(a.name) || a.agentId } : {}), ...(a.appearance ? { appearance: a.appearance } : {}) };
  }
  for (const st of spec.steps || []) {
    const d = (out.steps || []).find((x) => x.id === st.id);
    if (!d) continue;
    if (st.display !== undefined) setDisplay(d, st.display, `Step "${st.id}"`);
    if (st.kind === 'agent' && str(st.brief) !== str(d.prompt)) {
      if (!str(st.brief)) throw new Error(`Step "${st.id}": the prompt can't be empty.`);
      d.prompt = `${str(st.brief)}\n`;
    }
    if (st.kind === 'gate' && str(st.message) !== str(d.message) && str(st.message)) d.message = `${str(st.message)}\n`;
  }
  if (Object.keys(looks).length) out['x-builder'] = { ...(out['x-builder'] || {}), agents: looks };
  else if (out['x-builder']) delete out['x-builder'].agents;
  return header + yaml.dump(out, { lineWidth: -1 });
}

// The key of a CLI in the workflow's providers: the one of that type, else the builder's (added).
function providerKey(doc, key) {
  doc.providers ||= {};
  const found = Object.keys(doc.providers).find((k) => doc.providers[k]?.type === PROVIDERS[key].type);
  if (found) return found;
  let k = key;
  while (doc.providers[k]) k = `${k}_cli`;
  doc.providers[k] = PROVIDERS[key];
  return k;
}

/** The comment lines at the top of a YAML file (kept when the builder rewrites it). */
function leadingComments(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const head = [];
  for (const l of lines) { if (/^\s*(#.*)?$/.test(l)) head.push(l); else break; }
  const t = head.join('\n').trim();
  return t ? `${t}\n\n` : '';
}

/** A copy of a workflow's YAML text under another `metadata.name` (comments kept). */
function cloneText(text, name) {
  const src = String(text || '');
  const out = src.replace(/(^metadata:[^\n]*\n(?:(?:[ \t]+[^\n]*|[ \t]*)\n)*?[ \t]+name:[ \t]*)[^\n\r]*/m, (_m, p) => p + name);
  if (yaml.load(out)?.metadata?.name === name) return out;
  const doc = yaml.load(src);
  doc.metadata = { ...(doc.metadata || {}), name };
  return leadingComments(src) + yaml.dump(doc, { lineWidth: -1 });
}

/** File name for a new workflow: its name as a slug. */
function fileNameFor(name) {
  const slug = str(name).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${slug || 'workflow'}.yaml`;
}

module.exports = {
  toYaml, buildDoc, fromWorkflow, describeWorkflow, patchWorkflow, cloneText, leadingComments, validateSpec, fileNameFor, stepPrompt,
  PROVIDERS, EFFORTS, ACCESS, UNATTENDED, AI_SCHEMA,
};
