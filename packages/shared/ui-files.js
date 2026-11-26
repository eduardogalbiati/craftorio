// @ts-check
// What a UI file of a project is (#80, #57): one rule for the engine's test-ids.js (and through it the
// `ui_files` template filter and the project's UI folders) and the result summary. Pure, dual-load
// (Node + <script>).
//   UI_FILE, STYLE_FILE        a page or a component; a stylesheet (a UI file under the root folder './')
//   normFolder(p)              a repository-relative folder or file, forward slashes, no './' nor '/' at the end
//   uiFiles(files, folders)    the files of a change under the UI folders (none: by the extension)
//   screenNotReviewed(develop, inputs, reviewed)  why a change with UI files gets no visual review, or ''
(function (root) {
  // #80: a UI file (a page or a component), what finds a project's UI folders (domains/project/
  // project-run-defaults.js) and what the `ui_files` filter matches in a run without UI folders
  const UI_FILE = /\.(html|jsx|tsx|vue|svelte)$/i;
  // #80: a stylesheet, a UI file too under the root UI folder ('./': a site's pages and its css/)
  const STYLE_FILE = /\.(css|less|sass|scss)$/i;

  // #80: a repository-relative folder or file with forward slashes, without a leading './' nor a
  // trailing '/'; the root ('./', '.') is ''. Shared with the `ui_files` filter, so both read a
  // project's UI folders alike.
  function normFolder(p) {
    const f = String(p ?? '').replace(/\\/g, '/').replace(/^(\.\/)+/, '').replace(/\/+$/, '');
    return f === '.' ? '' : f;
  }

  // The files of a list (a step's files_changed) under the project's UI folders (#588), compared with
  // forward slashes; folders: one or a list, repository-relative. #80: the root folder ('./') holds the
  // pages and stylesheets anywhere (UI_FILE, STYLE_FILE), never a README or a package.json; without folders
  // (none given, or an empty list: an empty project) a UI file is a page or a component by its extension.
  function uiFiles(files, folders) {
    const dirs = [].concat(folders ?? []).filter((d) => String(d ?? '').trim()).map(normFolder);
    const under = (f, d) => (d === '' ? UI_FILE.test(f) || STYLE_FILE.test(f) : f === d || f.startsWith(`${d}/`));
    return [].concat(files ?? []).filter((f) => (dirs.length ? dirs.some((d) => under(normFolder(f), d)) : UI_FILE.test(normFolder(f))));
  }

  // #57: why a change with UI files (uiFiles of develop's files_changed) gets no visual review, '' when it has
  // no UI file or its screens are reviewed: screenshots off (a backend or docs project, or the run's own pick),
  // or (reviewed === false, the run ended without screenshots) none taken. The gates' and result.md's
  // "Screen not reviewed: <reason>".
  function screenNotReviewed(develop, inputs, reviewed = true) {
    if (!uiFiles(develop?.files_changed, inputs?.ui_folders).length) return '';
    if (inputs?.screenshots === 'off') return 'screenshots are off in this run (the project\'s kind is backend or docs, or the run turned them off); change the project\'s kind or the run\'s screenshots input to review it';
    return reviewed ? '' : 'no screenshots were taken in this run';
  }

  const api = {
    normFolder,
    screenNotReviewed,
    STYLE_FILE,
    UI_FILE,
    uiFiles,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UiFiles = api;
})(typeof window !== 'undefined' ? window : globalThis);
