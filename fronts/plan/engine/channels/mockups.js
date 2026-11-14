// Project mockups (#625, Plan & Design › Mockups, fronts/plan/engine/domains/mockups.js): the only way the
// Mockups screen and the editor window reach a project's mockups in <workspace>/mockups/<projectId>/.
// - mockups:list / mockups:screen / mockups:kit / mockups:versions / mockups:chat-history: read;
// - mockups:estimate: the D15 estimate of an action (shown before every real action);
// - mockups:build-kit: the deterministic machine step (CSS custom properties and fonts of the project's
//   stylesheets → kit/tokens.css, free), then, real only, the ui-kit-map workflow for the components (D2);
// - mockups:create-screen: from a prompt (or a Discovery card's text); simulated (MULTIAGENT_SIMULATION_ONLY)
//   the simulated designer writes MockupModel.draftScreen at once, real a mockup-generate run writes it;
// - mockups:chat: one designer turn (MockupModel.buildChatMessage: selection, refs, message), kept in
//   chat/<slug>.jsonl; simulated the designer answers and commits a turn at once, real a mockup-generate
//   run (mode edit) answers and its html becomes the turn's commit (one commit per turn, D10);
// - mockups:save-turn / mockups:restore / mockups:save-ref: a turn's html, a version back, a pasted image;
// - mockups:open-editor: the editor window (ctx.host.openMockupEditor, desktop only; { opened: false } in a browser).
// The designer never writes to the project's repository: its runs' outputs are written here, into the
// mockup folder. The project's repository is only read (the machine step of the kit).

const fs = require('fs');
const path = require('path');
const mockups = require('../domains/mockups');
const MockupModel = require('@multiagent/shared/mockup-model');
const projects = require('@multiagent/engine/domains/project/projects');
const simulation = require('@multiagent/engine/engine/simulation');
const { clientError } = require('@multiagent/engine/service/common');
const schemas = require('@multiagent/engine/service/schemas');

const { args, listOf, nullable, OBJECT, PROJECT_ID, shape, STRING, text } = schemas;

const WORKFLOW = 'mockup-generate';
const KIT_WORKFLOW = 'ui-kit-map.yaml';
const SLUG = text(100);
const ACTIONS = ['build-kit', 'generate-screen', 'chat-edit', 'review-screen', 'lint'];
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '.next']);
const STYLE_FILE = /\.(css|scss|less)$|^tailwind\.config\.[cm]?[jt]s$|^theme\.[cm]?[jt]s$/i;
const MAX_FILES = 200;
const MAX_BYTES = 512 * 1024;
const onScreen = (properties = {}, required = []) => args({ projectId: PROJECT_ID, slug: SLUG, ...properties }, ['projectId', 'slug', ...required]);

// the project's stylesheets and theme files (relative paths), at most MAX_FILES, read-only
function styleFiles(folder) {
  const found = [];
  const walk = (dir) => {
    if (found.length >= MAX_FILES) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (found.length >= MAX_FILES) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(full); continue; }
      if (!STYLE_FILE.test(e.name)) continue;
      try {
        if (fs.statSync(full).size > MAX_BYTES) continue;
        found.push({ file: path.relative(folder, full).split(path.sep).join('/'), text: fs.readFileSync(full, 'utf8') });
      } catch { /* unreadable: skipped */ }
    }
  };
  walk(folder);
  return found;
}

module.exports = (ctx) => {
  const wsRoot = () => {
    if (!ctx.ws?.root) throw clientError('No workspace is open.');
    return ctx.ws.root;
  };
  const projectOf = (projectId) => {
    try { return projects.readProject(ctx.ws.projects, projectId); } catch { return null; }
  };
  const isMockupRun = (r) => r?.wf?.metadata?.name === WORKFLOW;
  const isKitRun = (r) => r?.wf?.metadata?.name === 'ui-kit-map';
  // the components a ui-kit-map run answered, added to the machine step's tokens (kit/components.css, kit.json)
  function onKitEvent(ev) {
    const r = ev?.type === 'step.finished' && typeof ev.output?.components_css === 'string' ? ctx.liveRun?.(ev.run_id) : null;
    if (!isKitRun(r) || !r.inputs?.project_id || !ctx.ws?.root) return;
    try {
      const current = mockups.readKit(ctx.ws.root, r.inputs.project_id) || { tokensCss: '', kit: {} };
      const list = (v) => (Array.isArray(v) ? v : []);
      mockups.writeKit(ctx.ws.root, r.inputs.project_id, {
        tokensCss: current.tokensCss,
        componentsCss: ev.output.components_css,
        kit: { ...current.kit, components: list(ev.output.components), inferences: list(ev.output.inferences) },
      });
    } catch (e) { console.error('Mockups kit:', e.message); }
  }
  ctx.events?.on?.('run:event', onKitEvent);
  // the html a mockup-generate run answered, written where it belongs (a new screen or a turn)
  function onRunEvent(ev) {
    const r = ev?.type === 'step.finished' && typeof ev.output?.html === 'string' ? ctx.liveRun?.(ev.run_id) : null;
    if (!isMockupRun(r) || !r.inputs?.mockup_slug || !ctx.ws?.root) return;
    const { project_id: projectId, mockup_slug: slug } = r.inputs;
    try {
      mockups.saveTurn(ctx.ws.root, projectId, { slug, html: ev.output.html, message: r.inputs.message || `Designer run ${ev.run_id}` });
      if (ev.output.reply) mockups.appendChat(ctx.ws.root, projectId, slug, { role: 'assistant', text: String(ev.output.reply), runId: ev.run_id });
    } catch (e) { console.error('Mockups:', e.message); }
  }
  ctx.events?.on?.('run:event', onRunEvent);

  // a designer run (real only): `mode` generate (a new screen's first version) or edit (a chat turn)
  async function startDesigner(projectId, slug, inputs) {
    const project = projectOf(projectId);
    return ctx.startWorkflowRun({
      file: `${WORKFLOW}.yaml`,
      mock: false,
      projectId,
      inputs: {
        project_path: project?.folder || '',
        project_id: projectId,
        mockup_dir: mockups.projectDir(wsRoot(), projectId),
        mockup_slug: slug,
        ...inputs,
      },
    });
  }

  async function createScreen({ projectId, title, prompt = '', source = null }) {
    const name = String(title || '').trim();
    if (!name) throw clientError('Give the mockup a title.');
    const origin = source && typeof source === 'object' ? source : { kind: 'prompt' };
    const draft = MockupModel.draftScreen({ title: name, prompt });
    const { slug, commit } = mockups.createScreen(wsRoot(), projectId, { title: name, html: draft, source: { ...origin, prompt: String(prompt || '') } });
    if (simulation.simulationOnly()) {
      mockups.appendChat(wsRoot(), projectId, slug, { role: 'assistant', text: `Simulated designer: drew "${name}" from the prompt.` });
      return { slug, commit, runId: null };
    }
    const started = await startDesigner(projectId, slug, { mode: 'generate', title: name, prompt: String(prompt || ''), message: `Generate ${name}` });
    return { slug, commit, runId: started?.runId || null };
  }

  async function chat({ projectId, slug, message, selection = [], refs = [], area = null, frame = null }) {
    const versions = mockups.listVersions(wsRoot(), projectId, slug);
    let payload;
    try {
      payload = MockupModel.buildChatMessage({ mockup: slug, version: versions[0]?.commit?.slice(0, 7) || '', frame, selection, area, refs, message });
    } catch (e) { throw clientError(e.message); }
    mockups.appendChat(wsRoot(), projectId, slug, { role: 'user', text: payload.message, payload });
    if (simulation.simulationOnly()) {
      // the simulated designer: a marked turn, so each message is one commit (D10), no model call
      const html = mockups.screenHtml(wsRoot(), projectId, slug).replace(/(<\/body>|$)/i, `<!-- designer: ${payload.message.replace(/--/g, '- -')} -->$1`);
      const turn = mockups.saveTurn(wsRoot(), projectId, { slug, html, message: payload.message });
      const reply = `Simulated designer: noted "${payload.message}"${payload.selection.length ? ` for ${payload.selection.map((s) => s.mid).join(', ')}` : ''}.`;
      mockups.appendChat(wsRoot(), projectId, slug, { role: 'assistant', text: reply });
      return { ...turn, reply, runId: null };
    }
    const started = await startDesigner(projectId, slug, { mode: 'edit', title: slug, prompt: JSON.stringify(payload), message: payload.message });
    return { commit: null, problems: [], reply: null, runId: started?.runId || null };
  }

  async function buildKit({ projectId }) {
    const project = projectOf(projectId);
    if (!project) throw clientError(`Unknown project: ${projectId}`);
    const files = project.folder ? styleFiles(project.folder) : [];
    const { tokens, fonts } = MockupModel.extractTokens(files);
    const kit = { sources: [...new Set(tokens.map((t) => t.file))], tokens, fonts, components: [], inferences: [] };
    const { commit } = mockups.writeKit(wsRoot(), projectId, { tokensCss: MockupModel.tokensCss(tokens), componentsCss: '', kit });
    if (simulation.simulationOnly()) return { commit, tokens: tokens.length, runId: null };
    const started = await ctx.startWorkflowRun({ file: KIT_WORKFLOW, mock: false, projectId, inputs: { project_path: project.folder || '', project_id: projectId, mockup_dir: mockups.projectDir(wsRoot(), projectId) } });
    return { commit, tokens: tokens.length, runId: started?.runId || null };
  }

  return [
    // the project's screens [{ slug, title, source, createdAt }] by slug, [] before the first one
    {
      channel: 'mockups:list',
      method: 'listMockups',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: listOf(OBJECT) },
      fn: ({ projectId }) => mockups.listScreens(wsRoot(), projectId),
    },
    // one screen's html (data-mid on every element)
    {
      channel: 'mockups:screen',
      method: 'readMockupScreen',
      params: ['projectId', 'slug'],
      schema: { params: onScreen(), result: STRING },
      fn: ({ projectId, slug }) => mockups.screenHtml(wsRoot(), projectId, slug),
    },
    // the visual kit (tokens.css, components.css, kit.json), null before it is built
    {
      channel: 'mockups:kit',
      method: 'readMockupKit',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: nullable(OBJECT) },
      fn: ({ projectId }) => mockups.readKit(wsRoot(), projectId),
    },
    // D15: { model, min, max } (USD) of an action, before it runs
    {
      channel: 'mockups:estimate',
      method: 'estimateMockupCost',
      params: ['action'],
      schema: { params: args({ action: { type: 'string', enum: ACTIONS } }, ['action']), result: shape({ model: nullable(STRING), min: { type: 'number' }, max: { type: 'number' } }, ['min', 'max']) },
      fn: ({ action }) => MockupModel.estimateCost(action),
    },
    // the kit's machine step (free) and, real only, the ui-kit-map run for the components
    {
      channel: 'mockups:build-kit',
      method: 'buildMockupKit',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: OBJECT },
      fn: buildKit,
    },
    // a new screen from a prompt or a Discovery card ({ kind: 'discovery', card })
    {
      channel: 'mockups:create-screen',
      method: 'createMockupScreen',
      params: ['projectId', 'title', 'prompt', 'source'],
      schema: { params: args({ projectId: PROJECT_ID, title: text(200), prompt: text(20000), source: nullable(OBJECT) }, ['projectId', 'title']), result: OBJECT },
      fn: createScreen,
    },
    // a turn's html, one commit whose message has the request; { commit, problems } (the kit lint)
    {
      channel: 'mockups:save-turn',
      method: 'saveMockupTurn',
      params: ['projectId', 'slug', 'html', 'message'],
      schema: { params: onScreen({ html: text(2000000), message: text(20000) }, ['html']), result: OBJECT },
      fn: ({ projectId, slug, html, message }) => mockups.saveTurn(wsRoot(), projectId, { slug, html, message }),
    },
    // the screen's versions, newest first
    {
      channel: 'mockups:versions',
      method: 'listMockupVersions',
      params: ['projectId', 'slug'],
      schema: { params: onScreen(), result: listOf(OBJECT) },
      fn: ({ projectId, slug }) => mockups.listVersions(wsRoot(), projectId, slug),
    },
    // a version back, as a new commit
    {
      channel: 'mockups:restore',
      method: 'restoreMockupVersion',
      params: ['projectId', 'slug', 'commit'],
      schema: { params: onScreen({ commit: text(64) }, ['commit']), result: OBJECT },
      fn: ({ projectId, slug, commit }) => mockups.restoreVersion(wsRoot(), projectId, { slug, commit }),
    },
    // one designer chat message (the selection chips, the pasted references and the text)
    {
      channel: 'mockups:chat',
      method: 'sendMockupChat',
      params: ['projectId', 'slug', 'message', 'selection', 'refs', 'area', 'frame'],
      schema: { params: onScreen({ message: text(20000), selection: listOf(OBJECT), refs: listOf(STRING), area: nullable(OBJECT), frame: nullable(STRING) }, ['message']), result: OBJECT },
      fn: chat,
    },
    // the designer chat of a screen, oldest first
    {
      channel: 'mockups:chat-history',
      method: 'readMockupChat',
      params: ['projectId', 'slug'],
      schema: { params: onScreen(), result: listOf(OBJECT) },
      fn: ({ projectId, slug }) => mockups.readChat(wsRoot(), projectId, slug),
    },
    // a pasted reference image (a data URL or base64) → 'refs/<sha256>.<ext>'
    {
      channel: 'mockups:save-ref',
      method: 'saveMockupRef',
      params: ['projectId', 'data', 'ext'],
      schema: { params: args({ projectId: PROJECT_ID, data: text(20000000), ext: text(8) }, ['projectId', 'data']), result: STRING },
      fn: ({ projectId, data, ext }) => mockups.saveRef(wsRoot(), projectId, { data, ext: ext || 'png' }),
    },
    // the editor window (desktop); a browser has none
    {
      channel: 'mockups:open-editor',
      method: 'openMockupEditor',
      params: ['projectId', 'slug'],
      schema: { params: onScreen(), result: shape({ opened: { type: 'boolean' } }, ['opened']) },
      fn: ({ projectId, slug }) => {
        mockups.screenHtml(wsRoot(), projectId, slug); // an unknown screen is refused
        const open = ctx.host?.openMockupEditor;
        return { opened: typeof open === 'function' ? !!open({ projectId, slug }) : false };
      },
    },
  ];
};
