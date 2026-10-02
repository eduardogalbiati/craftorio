// Service area: the workspace's workflows (Workflows screen). The list with each file's origin
// (default, modified or custom) and what the visual builder can draw; the builder's load, save and
// clone; and restoring a bundled default over an edited copy (the copy goes to the trash), for a
// workflow or a skill.

const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../../engine/workflow');
const capabilities = require('../../engine/capabilities');
const workflows = require('../../workflows');
const builder = require('../../workflow-builder');
const skills = require('../../skills');
const { BUNDLED_WORKFLOWS_DIR } = require('../common');
const { bundleStatus, restoreBundled } = require('../../seed');

module.exports = (ctx) => {
  const { host } = ctx;

  function listWorkflows() {
    const { ws } = ctx;
    if (!fs.existsSync(ws.workflows)) return [];
    const status = workflows.workflowStatus(BUNDLED_WORKFLOWS_DIR, ws.workflows);
    const bundledVersion = (file) => { try { return loadWorkflow(path.join(BUNDLED_WORKFLOWS_DIR, file)).metadata?.version || null; } catch { return null; } };
    return fs.readdirSync(ws.workflows)
      .filter(workflows.isWorkflowFile)
      .map((file) => {
        // origin: default (untouched bundled copy), modified (edited bundled copy) or custom (user-created)
        const st = status[file] || { origin: 'custom', updateAvailable: false, restorable: false };
        const origin = { origin: st.origin, updateAvailable: st.updateAvailable, restorable: st.restorable, bundledVersion: st.updateAvailable ? bundledVersion(file) : null };
        try {
          const wf = loadWorkflow(path.join(ws.workflows, file));
          // the visual builder opens it only when it draws everything the workflow uses
          const drawn = builder.fromWorkflow(wf).problems;
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
            inputs: wf.inputs || {},
            // the result contract a chain maps from (#134)
            outputs: wf.outputs || {},
            agents: Object.fromEntries(Object.entries(wf.agents).map(([k, a]) => {
              const d = { ...(wf.defaults || {}), ...a };
              return [k, {
                provider: a.provider, model: a.model, session: d.session || 'persistent', max_context: d.max_context || null, skills: a.skills || [],
                capabilities: capabilities.describe(a.capabilities), isolated: d.isolation !== false,
              }];
            })),
            steps: wf.steps.map((s) => ({
              id: s.id,
              type: s.type || 'agent',
              agent: s.agents ? s.agents.join(' · ') : s.agent || null,
              agents: s.agents || null,
              skills: s.skills || [],
              goal: !!s.goal,
              loop: !!s.loop,
              next: [...new Set((s.transitions || []).map((t) => t.goto).filter(Boolean))],
            })),
          };
        } catch (e) {
          return { file, ...origin, name: file, error: e.message, steps: [] };
        }
      });
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
  function saveBuilderWorkflow({ file, spec }) {
    const { ws } = ctx;
    const name = file ? path.basename(String(file)) : builder.fileNameFor(spec?.name);
    if (!workflows.isWorkflowFile(name)) throw new Error(`Not a workflow file: ${name}`);
    const dest = path.join(ws.workflows, name);
    if (!file && fs.existsSync(dest)) throw new Error(`A workflow file named ${name} already exists: pick another name.`);
    if (file && isBundled(name)) throw new Error(`"${name}" is bundled with the app: clone it to change it.`);
    const exists = file && fs.existsSync(dest);
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
    return { file: name };
  }

  // A copy of any workflow as the user's own (custom): "<name>-copy", comments kept.
  function cloneBuilderWorkflow(file) {
    const name = path.basename(String(file || ''));
    const src = path.join(ctx.ws.workflows, name);
    const doc = loadWorkflow(src);
    const base = String(doc.metadata?.name || name.replace(/\.ya?ml$/i, ''));
    let n = 1, copyName, dest;
    do {
      copyName = `${base}-copy${n > 1 ? `-${n}` : ''}`;
      dest = path.join(ctx.ws.workflows, builder.fileNameFor(copyName));
      n++;
    } while (fs.existsSync(dest));
    fs.writeFileSync(dest, builder.cloneText(fs.readFileSync(src, 'utf8'), copyName));
    try { loadWorkflow(dest); } catch (e) { fs.rmSync(dest, { force: true }); throw e; }
    return { file: path.basename(dest) };
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
    listWorkflows,
    loadBuilderWorkflow,
    restoreSkill,
    restoreWorkflow,
    saveBuilderWorkflow,
  };
};
