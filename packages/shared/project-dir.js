// The folder of Craftorio's files in a project's repository (T2c, the rename to Craftorio):
// .craftorio/, or .multiagent/ in a repository set up before the rename, when only that one exists.
// Reads look in both, the new one first; writes go to the folder the repository already has, else
// .craftorio/, so a repository never ends up with its files split between the two. Pure: the
// caller says which folders exist. Dual-load (Node + <script>).
//   projectDirName(has)   → '.craftorio' | '.multiagent'     has(name): whether that folder exists
//   projectFiles(rel)     → ['.craftorio/<rel>', '.multiagent/<rel>']   the order to read them in
//   inProjectDir(rel, dir) → rel with a leading '.craftorio/' moved to dir (a composed path, written
//                            into a repository that kept .multiagent/)
(function (root) {
  const PROJECT_DIR = '.craftorio';
  const LEGACY_PROJECT_DIR = '.multiagent';
  const projectDirName = (has) => (!has(PROJECT_DIR) && has(LEGACY_PROJECT_DIR) ? LEGACY_PROJECT_DIR : PROJECT_DIR);
  const projectFiles = (rel) => [PROJECT_DIR, LEGACY_PROJECT_DIR].map((d) => `${d}/${rel}`);
  const inProjectDir = (rel, dir) => (String(rel).startsWith(`${PROJECT_DIR}/`) ? `${dir}/${String(rel).slice(PROJECT_DIR.length + 1)}` : String(rel));
  const api = { LEGACY_PROJECT_DIR, PROJECT_DIR, inProjectDir, projectDirName, projectFiles };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProjectDir = api;
})(typeof window !== 'undefined' ? window : globalThis);
