// The desktop app's composition (phase 3 of docs/reorganisation-study-2026-10.md, decision 7): the
// fronts this app ships (`fronts/<id>`, each a workspace of `views/` folders that register themselves
// with `registerView`). A list of front ids, nothing else: `scripts/docs.js` generates
// apps/desktop/renderer/index.html from it (the UI kit's files, these fronts' views in this order,
// then the renderer folder's own files), and the smoke and screenshot runners read it through
// `scripts/source-tree.js` (composition). A front never depends on another as it loads, so the list
// is sorted; a composition of one front builds that front alone; this one, the default, ships them all.
module.exports = {
  fronts: [
    'ai',
    'analyser',
    'build',
    'plan',
  ],
};
