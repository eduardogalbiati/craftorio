// Service area: the workspace's workflows (Workflows screen). The list with each file's origin
// (default, modified or custom), its declared outputs and what the visual builder can draw (the
// saved pipelines are areas/pipelines.js's); the builder's load, save and
// clone; and restoring a bundled default over an edited copy (the copy goes to the trash), for a
// workflow or a skill. A custom workflow is code: `trusted` says whether the owner confirmed its text
// (#474, settings' trustedFiles). For a project, the list adds its repository workflows (#485,
// areas/repository-workflows.js), which the builder opens read-only and Clone copies as custom.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const workspace = require('../../domains/workspace/workspace');
const projects = require('../../domains/project/projects');
const {
  loadWorkflow,
  render,
} = require('../../engine/workflow');
const capabilities = require('../../engine/capabilities');
const workflows = require('../../domains/workflow/workflows');
const builder = require('../../domains/workflow/workflow-builder');
const skills = require('../../domains/agents/skills');
const { BUNDLED_WORKFLOWS_DIR } = require('../common');
const { bundleStatus, restoreBundled } = require('../../domains/seed/seed');
const { mergeOf } = require('@craftorio/shared/default-workflow');
const {
  MANIFEST_FILE,
  requiresProblem,
} = require('../../domains/project/project-manifest');
const compose = require('@craftorio/shared/workflow-compose');
const { workflowRequirements } = require('../../domains/workflow/workflow-requirements');

// #488: an import by url gives up after this long, and refuses a body larger than a workflow can be
const IMPORT_TIMEOUT_MS = 30000;
const IMPORT_MAX_BYTES = 1024 * 1024;

// #474: a workflow not bundled with the app is code; the owner confirms it once per file, remembered
// by the fingerprint of its text (like Run App's local preview confirmation, packages/engine/domains/local/local-preview.js)
const fingerprint = (text) => crypto.createHash('sha256').update(String(text)).digest('hex').slice(0, 16);
const trustKey = (file) => `workflows/${file}`;

module.exports = (ctx) => {
  const { host } = ctx;

  const trustedFiles = () => workspace.readSettings(ctx.ws).trustedFiles || {};
  function isTrusted(file, trusted = trustedFiles()) {
    const fp = trusted[trustKey(file)];
    try { return !!fp && fingerprint(fs.readFileSync(path.join(ctx.ws.workflows, file), 'utf8')) === fp; } catch { return false; }
  }
  const trustFile = (file, text) => workspace.writeSettings(ctx.ws, { trustedFiles: { ...trustedFiles(), [trustKey(file)]: fingerprint(text) } });

  // projectId (#485): also the project's repository workflows (areas/repository-workflows.js), with
  // their commit and acceptance, and an entry with `error` for a malformed manifest. repositoryOnly:
  // those alone, plus { name, category, origin: 'manifest' } per workflow the manifest names without
  // a file (the Workflows screen asks per project and lists the workspace's once)
  function listWorkflows({ projectId = null, repositoryOnly = false } = {}) {
    const { ws } = ctx;
    if (projectId && repositoryOnly) return repositoryList(projectId, (categories) => Object.entries(categories).map(([name, category]) => ({ name, category, origin: 'manifest', projectId })));
    if (!fs.existsSync(ws.workflows)) return [];
    const status = workflows.workflowStatus(BUNDLED_WORKFLOWS_DIR, ws.workflows);
    const bundledVersion = (file) => { try { return loadWorkflow(path.join(BUNDLED_WORKFLOWS_DIR, file)).metadata?.version || null; } catch { return null; } };
    const trusted = trustedFiles();
    const own = fs.readdirSync(ws.workflows)
      .filter(workflows.isWorkflowFile)
      .map((file) => {
        // origin: default (untouched bundled copy), modified (edited bundled copy) or custom (user-created)
        const st = status[file] || { origin: 'custom', updateAvailable: false, restorable: false };
        return describe(path.join(ws.workflows, file), file, {
          origin: st.origin, updateAvailable: st.updateAvailable, restorable: st.restorable, bundledVersion: st.updateAvailable ? bundledVersion(file) : null,
          // #474: false for a custom file whose text the owner never confirmed (the builder warns once)
          trusted: st.origin !== 'custom' || isTrusted(file, trusted),
        });
      });
    if (!projectId) return own;
    // a workflow the manifest names without a file sits in the manifest's category for this project;
    // #554: a workspace copy the repository also declares says which of the two this project's run uses
    return repositoryList(projectId, (categories, runs) => own.map((w) => ({
      ...w,
      ...(categories[w.name] ? { category: categories[w.name] } : {}),
      ...(runs[w.file] ? { runsCopy: runs[w.file].copy, runs: runs[w.file].copy === 'workspace' ? 'runs: workspace copy (your models)' : `does not run for this project: the repository copy @ ${runs[w.file].sha} runs` } : {}),
    })));
  }

  // #554: which copy of each repository workflow a run of the project uses ({ <file>: { copy, sha } }):
  // the owner's edited workspace copy of the entry's name or file (as runWorkflowFile finds it), unless
  // the project prefers the repository's
  function runsCopies(projectId, items) {
    let prefer = false;
    try { prefer = !!projects.readProject(ctx.ws.projects, projectId).preferRepositoryWorkflows; } catch { /* no project: the default */ }
    return Object.fromEntries(items.map((w) => [w.file, {
      copy: !prefer && workflows.editedWorkspaceCopy([w.entry?.name ? `${w.entry.name}.yaml` : '', w.file], ctx.workflowDirs()) ? 'workspace' : 'repository',
      sha: String(w.commit || '').slice(0, 7),
    }]));
  }

  // leading(categories, runs): what comes first, from the categories the manifest gives the workflows
  // it names without a file and which copy runs (runsCopies); then the manifest's error and the
  // repository's own workflows of a project
  function repositoryList(projectId, leading) {
    const repo = ctx.repositoryWorkflows(projectId);
    const runs = runsCopies(projectId, repo.items);
    const errors = repo.errors.length ? [{ file: 'project.yaml', name: MANIFEST_FILE, origin: 'repository', projectId, error: repo.errors.join('\n'), steps: [] }] : [];
    return [...leading(repo.categories, runs), ...errors, ...repo.items.map((w) => {
      const item = describe(w.path, w.file, {
        origin: 'repository', projectId, commit: w.commit, changedCommit: w.changedCommit, accepted: w.accepted, acceptedCommit: w.acceptedCommit, diff: w.diff,
        updateAvailable: false, restorable: false, bundledVersion: null, trusted: w.accepted,
      });
      const { copy, sha } = runs[w.file];
      return {
        ...item, ...(w.entry.category ? { category: w.entry.category } : {}), ...(w.entry.description ? { description: w.entry.description } : {}),
        runsCopy: copy, runs: copy === 'repository' ? `runs: repository @ ${sha}` : 'does not run for this project: the workspace copy (your models) runs',
      };
    })];
  }

  // One workflow file as the Workflows screen lists it; origin: where it comes from and its state
  function describe(src, file, origin) {
    try {
      const wf = loadWorkflow(src);
      // the visual builder opens it only when it draws everything the workflow uses
      const drawn = builder.fromWorkflow(wf).problems;
      // #262: an agent's provider / model / effort with the inputs' defaults (they can be templates over them)
      const defaults = Object.fromEntries(Object.entries(wf.inputs || {}).filter(([, d]) => d?.default !== undefined).map(([k, d]) => [k, d.default]));
      const resolve = (v) => {
        if (typeof v !== 'string' || !v.includes('{{')) return v ?? null;
        try { return render(v, { inputs: defaults }).trim(); } catch { return null; }
      };
      return {
        file,
        ...origin,
        builder: !drawn.length,
        builderProblems: drawn,
        name: wf.metadata?.name || file,
        version: wf.metadata?.version,
        description: wf.metadata?.description,
        category: wf.metadata?.category || 'build',
        tags: wf.metadata?.tags || [],
        // #286: what does not stop a run but does not work as written (an effort never passed)
        warnings: wf.warnings || [],
        inputs: wf.inputs || {},
        // the result contract a chain maps from (#134)
        outputs: wf.outputs || {},
        // how its work lands (#195): local (no push), remote (a branch and a PR/MR) or none
        merge: mergeOf(wf),
        // #319: the CLIs it needs with its default inputs ({ clis, forge }), for Setup and Start
        requirements: workflowRequirements(wf),
        // #282: the stations of the roadmap card's pipeline (RunProgress.workflowStations)
        groups: (wf.groups || []).map((g) => ({ name: g.name, steps: g.steps || [] })),
        agents: Object.fromEntries(Object.entries(wf.agents).map(([k, a]) => {
          const d = { ...(wf.defaults || {}), ...a };
          return [k, {
            provider: a.provider, model: a.model, session: d.session || 'persistent', max_context: d.max_context || null, skills: a.skills || [],
            capabilities: capabilities.describe(a.capabilities), isolated: d.isolation !== false,
            // #224: the agent's colour in the run chat and the runs list (wins over its role's)
            ...(a.color ? { color: String(a.color) } : {}),
            // #245: the name the screens show instead of its key
            ...(a.display ? { display: a.display } : {}),
            // #262: what it runs on by default (templates resolved with the inputs' defaults), the
            // Start drawer's Agents section; fallbacks: its own or `defaults`' chain
            runs_on: { provider: resolve(a.provider), model: resolve(a.model), effort: resolve(a.effort) || '' },
            ...(Array.isArray(d.fallbacks) ? { fallbacks: d.fallbacks } : {}),
          }];
        })),
        // #262: the providers an agent can be moved to for one run (name → CLI type)
        providers: Object.fromEntries(Object.entries(wf.providers || {}).map(([k, p]) => [k, p?.type || null])),
        steps: wf.steps.map((s) => ({
          id: s.id,
          ...(s.display ? { display: s.display } : {}), // #245
          type: s.type || 'agent',
          agent: s.agents ? s.agents.join(' · ') : s.agent || null,
          agents: s.agents || null,
          skills: s.skills || [],
          goal: !!s.goal,
          loop: !!s.loop,
          // `type: workflow` (#174): the child workflow, once or for each item
          ...(s.type === 'workflow' ? { workflow: s.workflow, foreach: s.foreach !== undefined, max_parallel: s.max_parallel ?? null } : {}),
          next: [...new Set((s.transitions || []).map((t) => t.goto).filter(Boolean))],
          // #282: which transitions a mode turns on (the pipeline's human gate station)
          transitions: (s.transitions || []).filter((t) => t.goto && /inputs\.mode\b/.test(String(t.when || ''))).map((t) => ({ goto: t.goto, when: String(t.when) })),
        })),
      };
    } catch (e) {
      return { file, ...origin, name: file, error: e.message, steps: [] };
    }
  }


  // Visual builder (Workflows > Builder): a workflow as the builder's spec, and back to YAML.
  // mode: 'full' (drawn by the builder: everything editable), 'fixed' (uses what the builder doesn't
  // draw: agents and prompts editable, the steps stay as they are) or 'readonly' (bundled with the
  // app: clone it to change it).
  const isBundled = (name) => (workflows.workflowStatus(BUNDLED_WORKFLOWS_DIR, ctx.ws.workflows)[name]?.origin || 'custom') !== 'custom';
  function loadBuilderWorkflow(file) {
    const name = path.basename(String(file || ''));
    const doc = loadWorkflow(path.join(ctx.ws.workflows, name));
    const drawn = builder.fromWorkflow(doc);
    const fixed = drawn.problems.length > 0;
    const mode = isBundled(name) ? 'readonly' : fixed ? 'fixed' : 'full';
    return { file: name, mode, problems: drawn.problems, spec: fixed ? builder.describeWorkflow(doc) : drawn.spec };
  }

  // A new workflow gets a file named after it (never overwriting one); an edited one keeps its file
  // and what the builder doesn't touch (providers, defaults, orchestrator, observability; for a
  // fixed spec, everything but the agents and the prompts).
  // trust (#474): the owner confirmed the builder's warning; a file created here, or whose text was
  // confirmed before, stays trusted with its new text.
  function saveBuilderWorkflow({ file, spec, trust = false }) {
    const { ws } = ctx;
    const name = file ? path.basename(String(file)) : builder.fileNameFor(spec?.name);
    if (!workflows.isWorkflowFile(name)) throw new Error(`Not a workflow file: ${name}`);
    const dest = path.join(ws.workflows, name);
    if (!file && fs.existsSync(dest)) throw new Error(`A workflow file named ${name} already exists: pick another name.`);
    if (file && isBundled(name)) throw new Error(`"${name}" is bundled with the app: clone it to change it.`);
    const exists = file && fs.existsSync(dest);
    const trusted = trust || !exists || isTrusted(name);
    const base = exists ? loadWorkflow(dest) : null;
    let text;
    if (spec?.fixed) {
      if (!base) throw new Error(`Workflow not found: ${name}`);
      text = builder.patchWorkflow(base, spec, builder.leadingComments(fs.readFileSync(dest, 'utf8')));
    } else {
      text = builder.toYaml(spec, base);
    }
    fs.mkdirSync(ws.workflows, { recursive: true });
    // checked by the engine's own loader before it replaces anything
    const tmp = `${dest}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, text);
    try { loadWorkflow(tmp); } catch (e) { fs.rmSync(tmp, { force: true }); throw e; }
    fs.renameSync(tmp, dest);
    if (trusted) trustFile(name, text);
    return { file: name };
  }

  // #485: a repository workflow (its committed text at the project's HEAD) in the builder, read-only:
  // Clone makes it the owner's own
  function repositoryWorkflowOf(projectId, file) {
    const w = ctx.repositoryWorkflow(projectId, file);
    if (!w?.path) throw new Error(`Repository workflow not found: ${path.basename(String(file || ''))}`);
    return w;
  }
  function loadRepositoryBuilderWorkflow({ projectId, file }) {
    const w = repositoryWorkflowOf(projectId, file);
    const doc = loadWorkflow(w.path);
    const drawn = builder.fromWorkflow(doc);
    return { file: w.file, mode: 'readonly', problems: drawn.problems, spec: drawn.problems.length ? builder.describeWorkflow(doc) : drawn.spec };
  }
  // a copy in the workspace, custom and not trusted until the owner confirms it (#474)
  const cloneRepositoryWorkflow = ({ projectId, file }) => cloneFrom(repositoryWorkflowOf(projectId, file).path, false);

  // A copy of any workflow as the user's own (custom): "<name>-copy", comments kept.
  function cloneBuilderWorkflow(file) {
    const name = path.basename(String(file || ''));
    // #474: a copy of a bundled or a confirmed workflow is as trusted as its source
    return cloneFrom(path.join(ctx.ws.workflows, name), isBundled(name) || isTrusted(name));
  }
  function cloneFrom(src, trusted) {
    const name = path.basename(src);
    const doc = loadWorkflow(src);
    const base = String(doc.metadata?.name || name.replace(/\.ya?ml$/i, ''));
    let n = 1, copyName, dest;
    do {
      copyName = `${base}-copy${n > 1 ? `-${n}` : ''}`;
      dest = path.join(ctx.ws.workflows, builder.fileNameFor(copyName));
      n++;
    } while (fs.existsSync(dest));
    const text = builder.cloneText(fs.readFileSync(src, 'utf8'), copyName);
    fs.writeFileSync(dest, text);
    try { loadWorkflow(dest); } catch (e) { fs.rmSync(dest, { force: true }); throw e; }
    if (trusted) trustFile(path.basename(dest), text);
    return { file: path.basename(dest) };
  }

  // #488: Download, a workflow's YAML as it is on disk (comments and spacing kept)
  function exportWorkflow(file) {
    const name = path.basename(String(file || ''));
    const src = path.join(ctx.ws.workflows, name);
    if (name !== String(file || '') || !workflows.isWorkflowFile(name) || !fs.existsSync(src)) throw new Error(`Workflow not found: ${name || '(none)'}`);
    return fs.readFileSync(src, 'utf8');
  }
  // a repository workflow's committed text (#485)
  const exportRepositoryWorkflow = ({ projectId, file }) => fs.readFileSync(repositoryWorkflowOf(projectId, file).path, 'utf8');

  // #488: a workflow written elsewhere (its text, or an https url), checked by the engine's loader and
  // the app's version (`requires`) before anything is written. preview: the summary the trust dialog
  // shows (packages/shared/workflow-compose.js), nothing written; else <workspace>/workflows/<name>.yaml as
  // custom, trusted (the owner confirmed the dialog, #474), never over an existing file without replace.
  // The preview returns the text's fingerprint; a confirmation that sends it back is refused when the
  // text it gets now differs (a url answering another text the second time), so the owner only ever
  // trusts the text the dialog showed.
  async function importWorkflow({ text, url, name, replace = false, preview = false, fingerprint: shown }) {
    const source = text != null ? String(text) : await fetchWorkflow(url);
    if (!preview && shown != null && fingerprint(source) !== shown) {
      throw new Error(`${url || 'The workflow'} changed since the preview: import it again to see what it does now.`);
    }
    fs.mkdirSync(ctx.ws.workflows, { recursive: true });
    const tmp = path.join(ctx.ws.workflows, `.import-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(tmp, source);
    try {
      const summary = compose.summarize(loadWorkflow(tmp));
      const problem = requiresProblem(host.appVersion, summary.requires);
      if (problem) throw new Error(`This workflow ${problem}`);
      if (preview) return { ok: true, summary, fingerprint: fingerprint(source) };
      const file = importFileName(name, replace);
      fs.renameSync(tmp, path.join(ctx.ws.workflows, file));
      trustFile(file, source);
      return { ok: true, file, summary };
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }
  // https only, checked before any request and kept through redirects; the body is read up to a cap
  // so a wrong url can't fill the memory
  async function fetchWorkflow(url) {
    if (url == null || url === '') throw new Error('Nothing to import: give the workflow\'s text or an https url.');
    let parsed;
    try { parsed = new URL(String(url)); } catch { throw new Error(`Not a url: ${url}`); }
    if (parsed.protocol !== 'https:') throw new Error(`Only an https url can be imported: ${url}`);
    const res = await globalThis.fetch(parsed.href, { redirect: 'error', signal: AbortSignal.timeout(IMPORT_TIMEOUT_MS) });
    if (res.url && new URL(res.url).protocol !== 'https:') throw new Error(`Only an https url can be imported: ${res.url}`);
    if (!res.ok) throw new Error(`Could not download ${url}: HTTP ${res.status}.`);
    const tooLarge = () => new Error(`${url} is too large for a workflow (over ${IMPORT_MAX_BYTES} bytes).`);
    if (Number(res.headers?.get?.('content-length')) > IMPORT_MAX_BYTES) throw tooLarge();
    if (!res.body?.getReader) return res.text();
    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > IMPORT_MAX_BYTES) { await reader.cancel().catch(() => {}); throw tooLarge(); }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
  // <name>.yaml right under the workspace's workflows, never over an existing one without replace
  function importFileName(name, replace) {
    const base = String(name ?? '').trim().replace(/\.ya?ml$/i, '');
    const file = `${base}.yaml`;
    if (!base || path.basename(base) !== base || /[<>:"/\\|?*]/.test(base) || !workflows.isWorkflowFile(file)) throw new Error(`Not a workflow name: ${name ?? '(none)'}`);
    if (!replace && fs.existsSync(path.join(ctx.ws.workflows, file))) throw new Error(`A workflow file named ${file} already exists: pick another name or replace it.`);
    return file;
  }

  // Replaces the user's edited copy of a bundled workflow with the default; the edited copy goes to
  // the trash (recoverable).
  async function restoreWorkflow(file) {
    const { ws } = ctx;
    const name = path.basename(String(file || ''));
    if (!workflows.workflowStatus(BUNDLED_WORKFLOWS_DIR, ws.workflows)[name]?.restorable) throw new Error(`"${name}" has no bundled default to restore.`);
    await host.trashItem(path.join(ws.workflows, name));
    workflows.restoreWorkflow(BUNDLED_WORKFLOWS_DIR, ws.workflows, name);
    return true;
  }

  // The same for a skill (the Oracle's action, #123): the edited copy goes to the trash.
  async function restoreSkill(id) {
    const { ws } = ctx;
    const name = path.basename(String(id || ''));
    if (!bundleStatus(ctx.BUNDLED_SKILLS_DIR, ws.skills, skills.SKILL_KIND)[name]?.restorable) throw new Error(`"${name}" has no bundled default to restore.`);
    await host.trashItem(path.join(ws.skills, name));
    restoreBundled(ctx.BUNDLED_SKILLS_DIR, ws.skills, skills.SKILL_KIND, name);
    return true;
  }

  return {
    cloneBuilderWorkflow,
    cloneRepositoryWorkflow,
    exportRepositoryWorkflow,
    exportWorkflow,
    importWorkflow,
    listWorkflows,
    loadBuilderWorkflow,
    loadRepositoryBuilderWorkflow,
    restoreSkill,
    restoreWorkflow,
    saveBuilderWorkflow,
  };
};
