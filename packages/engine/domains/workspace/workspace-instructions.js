// The instructions of a session the user opens in the workspace folder (#43): <workspace>/AGENTS.md, the
// bytes of the app's workspace-instructions/AGENTS.workspace.md (named so that no CLI reads it as this
// repository's), gives that session the Oracle's role. Seeded with the other defaults
// (packages/engine/domains/seed/seed.js; manifest <workspace>/.seeded.json): an untouched copy follows the app's updates, an
// edited or deleted one and the user's own file (or link) are left alone. Never a CLAUDE.md: it would leave
// out the AGENTS.md of every worktree under the workspace. A run's agents do not load the file
// (packages/engine/engine/project-instructions.js instructionsExcludes).

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { seedBundle } = require('../seed/seed');
const { bundledDir } = require('./app-root');
const { writeFileAtomic } = require('./state-file');

const BUNDLED_INSTRUCTIONS_DIR = bundledDir('workspace-instructions');
const BUNDLED_FILE = 'AGENTS.workspace.md';
const WORKSPACE_FILE = 'AGENTS.md';

const entry = (file) => fs.lstatSync(file, { throwIfNoEntry: false });

// The entry's id is its name in the workspace; in the app's folder the file has another name.
function kindFor(srcDir) {
  const fileIn = (dir, id) => path.join(dir, dir === srcDir ? BUNDLED_FILE : id);
  return {
    list: () => (fs.existsSync(path.join(srcDir, BUNDLED_FILE)) ? [WORKSPACE_FILE] : []),
    // a link is the user's, also one whose target is gone: it exists, and is never equal to a seeded copy
    exists: (dir, id) => !!entry(fileIn(dir, id)),
    hash: (dir, id) => {
      const file = fileIn(dir, id);
      if (dir !== srcDir && !entry(file)?.isFile()) return null;
      return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
    },
    copy: (from, to, id) => writeFileAtomic(fileIn(to, id), fs.readFileSync(fileIn(from, id))),
    // the copy replaces the file in one rename: removed first, a crash in between would read as "deleted by the user"
    remove: () => {},
  };
}

/** Copies/updates <root>/AGENTS.md from the app's folder. Returns the files copied or updated. */
const seedWorkspaceInstructions = (srcDir, root) => seedBundle(srcDir, root, kindFor(srcDir));

module.exports = {
  BUNDLED_INSTRUCTIONS_DIR,
  seedWorkspaceInstructions,
};
