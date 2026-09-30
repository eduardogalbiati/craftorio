// Workflows: one YAML file per workflow in <workspace>/workflows. The app folder only holds the
// bundled defaults (workflows/*.yaml), which are seeded into the workspace like the skills
// (src/seed.js): copied once, untouched copies updated by new app versions, edited copies kept
// ("a newer default exists"), user-created and deleted files left alone.

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const { seedBundle, bundleStatus, restoreBundled } = require('./seed');

const BUNDLED_WORKFLOWS_DIR = path.join(__dirname, '..', 'workflows');
const isWorkflowFile = (f) => /\.ya?ml$/i.test(f);
const isFile = (p) => { try { return fs.statSync(p).isFile(); } catch { return false; } };

const WORKFLOW_KIND = {
  list: (dir) => fs.readdirSync(dir).filter((f) => isWorkflowFile(f) && isFile(path.join(dir, f))).sort(),
  exists: (dir, id) => isFile(path.join(dir, id)),
  hash: (dir, id) => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, id))).digest('hex'),
  copy: (srcDir, destDir, id) => fs.writeFileSync(path.join(destDir, id), fs.readFileSync(path.join(srcDir, id))),
  remove: (dir, id) => fs.rmSync(path.join(dir, id), { force: true }),
};

/** Copies/updates the bundled workflows into the workspace folder. Returns the files copied or updated. */
const seedWorkflows = (srcDir, destDir) => seedBundle(srcDir, destDir, WORKFLOW_KIND);

/** { [file]: { origin: 'default'|'modified'|'custom', updateAvailable, restorable } } for the workspace folder. */
const workflowStatus = (srcDir, destDir) => bundleStatus(srcDir, destDir, WORKFLOW_KIND);

/** Replaces the user's copy of a bundled workflow with the default. */
const restoreWorkflow = (srcDir, destDir, file) => restoreBundled(srcDir, destDir, WORKFLOW_KIND, path.basename(String(file || '')));

/**
 * Finds a workflow file. Absolute paths are used as they are; a name or relative path is looked up
 * in the folders in order (workspace first, then the bundled defaults).
 * @returns {{ file: string, dir: string|null, fallback: boolean }} fallback: found only in a later
 *   folder (e.g. the user deleted the workspace copy). Throws if not found anywhere.
 */
function resolveWorkflow(file, dirs) {
  if (!file) throw new Error('No workflow file given.');
  if (path.isAbsolute(file)) return { file, dir: null, fallback: false };
  const list = dirs.filter(Boolean);
  for (const [i, dir] of list.entries()) {
    const candidate = path.join(dir, file);
    if (isFile(candidate)) return { file: candidate, dir, fallback: i > 0 };
  }
  throw new Error(`Workflow not found: "${file}" (searched in ${list.join(', ')})`);
}

module.exports = {
  BUNDLED_WORKFLOWS_DIR,
  isWorkflowFile,
  resolveWorkflow,
  restoreWorkflow,
  seedWorkflows,
  WORKFLOW_KIND,
  workflowStatus,
};
