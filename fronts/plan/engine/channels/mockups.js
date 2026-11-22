// Project mockups (#625, Plan & Design › Mockups, fronts/plan/engine/domains/mockups.js): the only way the
// Mockups screen and the editor window reach a project's mockups in <workspace>/mockups/<projectId>/.
// - mockups:list / mockups:screen / mockups:kit / mockups:versions / mockups:chat-history: read;
// - mockups:estimate: the D15 estimate of an action (shown before every real action);
// - mockups:build-kit: the deterministic machine step (CSS custom properties and fonts of the project's
//   stylesheets → kit/tokens.css, free), then, real only, the ui-kit-map workflow for the components (D2);
// - mockups:create-screen: from a prompt (or a Discovery card's text); simulated (CRAFTORIO_SIMULATION_ONLY)
//   the simulated designer writes MockupModel.draftScreen at once, real a mockup-generate run writes it;
// - mockups:chat: one designer turn (MockupModel.buildChatMessage: selection, refs, message) in the screen's
//   persistent designer session (D8, ../domains/mockup-designer.js, no workflow run), kept in
//   chat/<slug>.jsonl; → { commit, problems, reply, costUsd, totalUsd } (one commit per turn, D10);
// - mockups:save-turn / mockups:restore / mockups:save-ref: a turn's html, a version back, a pasted image;
// - mockups:open-editor: the editor window (ctx.host.openMockupEditor, desktop only; { opened: false } in a browser).
// #835 (phase 2): mockups:kit-map (a ui-kit-map answer applied: components.css/html, kit.json; the run's own
// step.finished goes the same way), mockups:promote (Promote to kit), mockups:compare (two versions and the
// changed data-mids), mockups:variants / create-variant / switch-variant / keep-variant (the repository's
// branches), mockups:flows / flow / save-flow (flows/<name>.json), mockups:export (the static .zip, base64)
// and mockups:attach (a frozen version for a Discovery card: { projectId, slug, commit, title, thumbnail }).
// #836 (phase 3, the handoff): mockups:freeze (a version frozen for a dev run's `mockup` input),
// mockups:crops (the selected regions as cropped images for the #258 commit dialog; the host captures them,
// a placeholder without one), mockups:review (Review this screen, on demand, the estimate shown first) and
// mockups:recreate (a screen of the running app, refused without Run App / Local preview).
// #837 (phase 4): mockups:storybook (does the project have Storybook: a new screen then records
// components 'storybook', otherwise 'static-kit', D4), mockups:export-repo (the kit and chosen screens to the
// repository's design/mockups/ by a mockups-export.yaml PR run; simulated, the plan and no run),
// mockups:figma-import (a Figma file's fill styles and frames into kit.json; the token from the keychain,
// `figma:token`) and mockups:live-link (a read-only share link, ../areas/mockup-live-links.js; the server
// route stays blocked until the security review #466–#470).
// The designer never writes to the project's repository: its runs' outputs are written here, into the
// mockup folder. The project's repository is only read (the machine step of the kit).

const fs = require('fs');
const path = require('path');
const designer = require('../domains/mockup-designer');
const mockups = require('../domains/mockups');
const MockupModel = require('@craftorio/shared/mockup-model');
const localPreview = require('@craftorio/engine/domains/local/local-preview');
const projects = require('@craftorio/engine/domains/project/projects');
const simulation = require('@craftorio/engine/engine/simulation');
const { clientError } = require('@craftorio/engine/service/common');
const schemas = require('@craftorio/engine/service/schemas');

const { args, listOf, nullable, OBJECT, PROJECT_ID, shape, STRING, text } = schemas;

const WORKFLOW = 'mockup-generate';
const KIT_WORKFLOW = 'ui-kit-map.yaml';
const EXPORT_WORKFLOW = 'mockups-export.yaml';
const FIGMA_TOKEN_KEY = 'figma:token';
const SLUG = text(100);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', 'vendor', '.next']);
const STYLE_FILE = /\.(css|scss|less)$|^tailwind\.config\.[cm]?[jt]s$|^theme\.[cm]?[jt]s$/i;
const MAX_FILES = 200;
const MAX_BYTES = 512 * 1024;
// #836 a crop no host captured (a browser, simulation): a 1×1 grey PNG
const PLACEHOLDER_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const onScreen = (properties = {}, required = []) => args({ projectId: PROJECT_ID, slug: SLUG, ...properties }, ['projectId', 'slug', ...required]);
// a domain refusal of the client's input (a bad name, sha, mid or link) answered as a client error
const userError = (fn) => {
  try { return fn(); } catch (e) { throw clientError(e.message); }
};

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
      mockups.applyKitMap(ctx.ws.root, r.inputs.project_id, ev.output);
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

  // a new screen: the draft written at once, then the simulated designer's chat line or a designer run
  // (create-screen and recreate); `simulated` and `inputs` take the screen's name
  async function newScreen({ projectId, name, prompt, source, simulated, inputs }) {
    const draft = MockupModel.draftScreen({ title: name, prompt });
    // #837 the project's real components when it has Storybook, the static kit otherwise (D4)
    const components = mockups.detectStorybook(projectOf(projectId)?.folder).available ? 'storybook' : 'static-kit';
    const { slug, commit } = mockups.createScreen(wsRoot(), projectId, { title: name, html: draft, source, components });
    if (simulation.simulationOnly()) {
      mockups.appendChat(wsRoot(), projectId, slug, { role: 'assistant', text: simulated });
      return { slug, commit, runId: null };
    }
    const started = await startDesigner(projectId, slug, { title: name, ...inputs });
    return { slug, commit, runId: started?.runId || null };
  }
  const titleOf = (title) => {
    const name = String(title || '').trim();
    if (!name) throw clientError('Give the mockup a title.');
    return name;
  };

  async function createScreen({ projectId, title, prompt = '', source = null }) {
    const name = titleOf(title);
    const origin = source && typeof source === 'object' ? source : { kind: 'prompt' };
    return newScreen({
      projectId,
      name,
      prompt,
      source: { ...origin, prompt: String(prompt || '') },
      simulated: `Simulated designer: drew "${name}" from the prompt.`,
      inputs: { mode: 'generate', prompt: String(prompt || ''), message: `Generate ${name}` },
    });
  }

  // one designer turn in its persistent session (D8, ../domains/mockup-designer.js), no workflow run
  async function chat({ projectId, slug, message, selection = [], refs = [], area = null, frame = null }) {
    const versions = mockups.listVersions(wsRoot(), projectId, slug);
    let payload;
    try {
      payload = MockupModel.buildChatMessage({ mockup: slug, version: versions[0]?.commit?.slice(0, 7) || '', frame, selection, area, refs, message });
    } catch (e) { throw clientError(e.message); }
    return designer.designerTurn({
      workspace: wsRoot(),
      projectId,
      slug,
      payload,
      projectFolder: projectOf(projectId)?.folder || null,
      skillsDirs: [ctx.ws?.skills, ctx.BUNDLED_SKILLS_DIR],
      simulated: simulation.simulationOnly(),
    });
  }

  // #836 the selected regions as cropped images: a region without `data` is captured by the host
  // (ctx.host.captureMockupRegion, desktop: the editor window's pixels inside `box`, window coordinates) or,
  // without one or when it fails (a browser, a region off screen), a placeholder image
  async function crops({ projectId, slug, commit, regions = [] }) {
    const capture = ctx.host?.captureMockupRegion;
    const captured = async (r) => {
      if (typeof capture !== 'function') return null;
      try { return await capture({ projectId, slug, commit, mid: r?.mid, box: r?.box || null }); } catch { return null; }
    };
    const filled = [];
    for (const r of Array.isArray(regions) ? regions : []) {
      const data = r?.data || (await captured(r)) || PLACEHOLDER_PNG;
      filled.push({ mid: r?.mid, data });
    }
    return userError(() => mockups.saveCrops(wsRoot(), projectId, { slug, commit, regions: filled }));
  }

  // #836 Review this screen, on demand only (the editor shows the estimate first): simulated, the free
  // findings at $0; real, one read-only Sonnet turn (../domains/mockup-designer.js reviewTurn), no run
  async function review({ projectId, slug, axe = [] }) {
    userError(() => mockups.screenHtml(wsRoot(), projectId, slug)); // an unknown screen is refused
    return designer.reviewTurn({
      workspace: wsRoot(),
      projectId,
      slug,
      axe: Array.isArray(axe) ? axe : [],
      projectFolder: projectOf(projectId)?.folder || null,
      simulated: simulation.simulationOnly(),
    });
  }

  // #836 a screen of the running app recreated with the project's kit: needs Run App / Local preview (the
  // project's localPreview, else the repository's .craftorio/local-preview.yaml); simulated, a draft at
  // once; real, a mockup-generate run in mode 'recreate' with the app's url
  async function recreate({ projectId, title, url = '' }) {
    const name = titleOf(title);
    const project = projectOf(projectId);
    const repo = project?.folder ? localPreview.readRepoConfig(project.folder) : null;
    const config = localPreview.resolveConfig(project, null, repo?.error ? null : repo);
    if (!config) throw clientError('Set Run App (Projects › Local preview or .craftorio/local-preview.yaml) to recreate a screen of the running app.');
    const appUrl = String(url || '').trim() || String(config.url || '');
    return newScreen({
      projectId,
      name,
      prompt: `Recreated from the running app${appUrl ? ` (${appUrl})` : ''}.`,
      source: { kind: 'running-app', url: appUrl },
      simulated: `Simulated designer: recreated "${name}" from ${appUrl || 'the running app'}.`,
      inputs: { mode: 'recreate', app_url: appUrl, message: `Recreate ${name} from the running app` },
    });
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

  // #837 the kit and the chosen screens to the repository by a PR run; simulated, the plan and no run
  async function exportRepo({ projectId, slugs, kitOfficial = false }) {
    const project = projectOf(projectId);
    if (!project) throw clientError(`Unknown project: ${projectId}`);
    const plan = userError(() => mockups.exportPlan(wsRoot(), projectId, { slugs, kitOfficial }));
    if (simulation.simulationOnly()) return { plan, runId: null };
    const started = await ctx.startWorkflowRun({
      file: EXPORT_WORKFLOW,
      mock: false,
      projectId,
      inputs: {
        project_path: project.folder || '',
        project_id: projectId,
        mockup_dir: mockups.projectDir(wsRoot(), projectId),
        slugs: [...new Set(slugs)].join(','),
        kit_official: plan.kitOfficial,
      },
    });
    return { plan, runId: started?.runId || null };
  }

  // #837 a Figma file (its REST answer, or downloaded by its key with the keychain's token, real only)
  async function figmaImport({ projectId, file = null, fileKey = null }) {
    let token = null;
    if (fileKey && !file && typeof ctx.host?.secrets?.get === 'function') {
      try { token = await ctx.host.secrets.get(FIGMA_TOKEN_KEY); } catch { token = null; }
    }
    try {
      return await mockups.importFigma(wsRoot(), projectId, { file, fileKey, token });
    } catch (e) {
      throw clientError(e.message);
    }
  }

  // #837 a read-only share link to one screen (the screen must exist)
  function liveLink({ projectId, slug, ttlMs }) {
    userError(() => mockups.screenHtml(wsRoot(), projectId, slug));
    if (typeof ctx.createMockupLiveLink !== 'function') throw clientError('Live links are not available in this engine.');
    return ctx.createMockupLiveLink({ projectId, slug, ttlMs });
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
      schema: { params: args({ action: { type: 'string', enum: MockupModel.ACTIONS } }, ['action']), result: shape({ model: nullable(STRING), min: { type: 'number' }, max: { type: 'number' } }, ['min', 'max']) },
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
    // #835 a ui-kit-map answer (components.css, components with their file:line source, inferences), one commit
    {
      channel: 'mockups:kit-map',
      method: 'applyMockupKitMap',
      params: ['projectId', 'components_css', 'components', 'inferences'],
      schema: { params: args({ projectId: PROJECT_ID, components_css: text(2000000), components: listOf(OBJECT), inferences: listOf(STRING) }, ['projectId']), result: OBJECT },
      fn: ({ projectId, ...map }) => mockups.applyKitMap(wsRoot(), projectId, map),
    },
    // Promote to kit: the selected element becomes a kit component, its colours tokens
    {
      channel: 'mockups:promote',
      method: 'promoteMockupToKit',
      params: ['projectId', 'slug', 'mid', 'name'],
      schema: { params: onScreen({ mid: text(32), name: text(80) }, ['mid', 'name']), result: OBJECT },
      fn: ({ projectId, slug, mid, name }) => userError(() => mockups.promoteToKit(wsRoot(), projectId, { slug, mid, name })),
    },
    // two versions of a screen side by side and the changed data-mids
    {
      channel: 'mockups:compare',
      method: 'compareMockupVersions',
      params: ['projectId', 'slug', 'from', 'to'],
      schema: { params: onScreen({ from: text(64), to: text(64) }, ['from', 'to']), result: shape({ before: STRING, after: STRING, changed: listOf(STRING) }, ['before', 'after', 'changed']) },
      fn: ({ projectId, slug, from, to }) => userError(() => mockups.compareVersions(wsRoot(), projectId, { slug, from, to })),
    },
    // the variants (branches) of the project's mockups and the current one
    {
      channel: 'mockups:variants',
      method: 'listMockupVariants',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: OBJECT },
      fn: ({ projectId }) => mockups.listVariants(wsRoot(), projectId),
    },
    {
      channel: 'mockups:create-variant',
      method: 'createMockupVariant',
      params: ['projectId', 'name'],
      schema: { params: args({ projectId: PROJECT_ID, name: text(80) }, ['projectId', 'name']), result: OBJECT },
      fn: ({ projectId, name }) => userError(() => mockups.createVariant(wsRoot(), projectId, { name })),
    },
    {
      channel: 'mockups:switch-variant',
      method: 'switchMockupVariant',
      params: ['projectId', 'name'],
      schema: { params: args({ projectId: PROJECT_ID, name: text(80) }, ['projectId', 'name']), result: OBJECT },
      fn: ({ projectId, name }) => userError(() => mockups.switchVariant(wsRoot(), projectId, { name })),
    },
    // keep one variant: it becomes main, the other branches are deleted
    {
      channel: 'mockups:keep-variant',
      method: 'keepMockupVariant',
      params: ['projectId', 'name'],
      schema: { params: args({ projectId: PROJECT_ID, name: text(80) }, ['projectId', 'name']), result: OBJECT },
      fn: ({ projectId, name }) => userError(() => mockups.keepVariant(wsRoot(), projectId, { name })),
    },
    // the project's flows [{ name }], one flow, a flow saved (flows/<name>.json, one commit)
    {
      channel: 'mockups:flows',
      method: 'listMockupFlows',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: listOf(OBJECT) },
      fn: ({ projectId }) => mockups.listFlows(wsRoot(), projectId),
    },
    {
      channel: 'mockups:flow',
      method: 'readMockupFlow',
      params: ['projectId', 'name'],
      schema: { params: args({ projectId: PROJECT_ID, name: text(80) }, ['projectId', 'name']), result: OBJECT },
      fn: ({ projectId, name }) => userError(() => mockups.readFlow(wsRoot(), projectId, name)),
    },
    {
      channel: 'mockups:save-flow',
      method: 'saveMockupFlow',
      params: ['projectId', 'name', 'links'],
      schema: { params: args({ projectId: PROJECT_ID, name: text(80), links: listOf(OBJECT) }, ['projectId', 'name']), result: OBJECT },
      fn: ({ projectId, name, links }) => userError(() => mockups.saveFlow(wsRoot(), projectId, { name, links: links || [] })),
    },
    // the static .zip export (screens, kit, flows, an index.html), base64: the renderer saves it as a file
    {
      channel: 'mockups:export',
      method: 'exportMockupsZip',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: STRING },
      fn: ({ projectId }) => mockups.exportZip(wsRoot(), projectId).toString('base64'),
    },
    // a frozen version for a Discovery card: { projectId, slug, commit (full sha), title, thumbnail }
    {
      channel: 'mockups:attach',
      method: 'mockupAttachment',
      params: ['projectId', 'slug', 'commit'],
      schema: { params: onScreen({ commit: text(64) }, ['commit']), result: OBJECT },
      fn: ({ projectId, slug, commit }) => userError(() => mockups.attachment(wsRoot(), projectId, { slug, commit })),
    },
    // #836 a version frozen for a dev run's `mockup` input: { ref, slug, commit (full sha), dir }
    {
      channel: 'mockups:freeze',
      method: 'freezeMockupVersion',
      params: ['projectId', 'slug', 'commit'],
      schema: { params: onScreen({ commit: text(64) }, ['commit']), result: OBJECT },
      fn: ({ projectId, slug, commit }) => userError(() => mockups.freezeVersion(wsRoot(), projectId, { slug, commit })),
    },
    // #836 the selected regions as cropped images [{ mid, file, name }] (the #258 commit dialog's issues)
    {
      channel: 'mockups:crops',
      method: 'saveMockupCrops',
      params: ['projectId', 'slug', 'commit', 'regions'],
      schema: { params: onScreen({ commit: text(64), regions: listOf(OBJECT) }, ['commit', 'regions']), result: listOf(OBJECT) },
      fn: crops,
    },
    // #836 Review this screen (on demand): { findings: [{ kind: kit | axe | layout, rule, mid?, message }], costUsd, model }
    {
      channel: 'mockups:review',
      method: 'reviewMockupScreen',
      params: ['projectId', 'slug', 'axe'],
      schema: { params: onScreen({ axe: listOf(OBJECT) }), result: OBJECT },
      fn: review,
    },
    // #836 a new screen recreated from the running app (Run App / Local preview): { slug, commit, runId }
    {
      channel: 'mockups:recreate',
      method: 'recreateMockupFromApp',
      params: ['projectId', 'title', 'url'],
      schema: { params: args({ projectId: PROJECT_ID, title: text(200), url: text(2000) }, ['projectId', 'title']), result: OBJECT },
      fn: recreate,
    },
    // #837 does the project have Storybook: { available, configDir }
    {
      channel: 'mockups:storybook',
      method: 'detectMockupStorybook',
      params: ['projectId'],
      schema: { params: args({ projectId: PROJECT_ID }, ['projectId']), result: OBJECT },
      fn: ({ projectId }) => mockups.detectStorybook(projectOf(projectId)?.folder),
    },
    // #837 export the kit and the chosen screens to the repository by PR: { plan, runId }
    {
      channel: 'mockups:export-repo',
      method: 'exportMockupsToRepo',
      params: ['projectId', 'slugs', 'kitOfficial'],
      schema: { params: args({ projectId: PROJECT_ID, slugs: listOf(SLUG), kitOfficial: { type: 'boolean' } }, ['projectId', 'slugs']), result: OBJECT },
      fn: exportRepo,
    },
    // #837 a Figma file into the kit: { commit, tokens, references }
    {
      channel: 'mockups:figma-import',
      method: 'importMockupFigma',
      params: ['projectId', 'file', 'fileKey'],
      schema: { params: args({ projectId: PROJECT_ID, file: nullable(OBJECT), fileKey: nullable(text(200)) }, ['projectId']), result: OBJECT },
      fn: figmaImport,
    },
    // #837 a read-only live link to a screen: { token, path, expiresAt }
    {
      channel: 'mockups:live-link',
      method: 'createMockupLiveLink',
      params: ['projectId', 'slug', 'ttlMs'],
      schema: { params: onScreen({ ttlMs: { type: 'integer', minimum: 1 } }), result: OBJECT },
      fn: liveLink,
    },
  ];
};
