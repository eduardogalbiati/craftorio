// The browser app's composition (phase 3 of docs/reorganisation-study-2026-10.md): the fronts the
// engine server's page ships (`multiagent-engine`, `npm run serve`: the root package.json's
// `multiagent.ui` names apps/web/renderer, served at `/`). A list of front ids, nothing else:
// `scripts/docs.js` generates apps/web/renderer/index.html from it (the UI kit's files, these fronts'
// views, then this folder's own api-http.js). The same four fronts as the desktop app's; a browser
// build of one front is a composition of one.
module.exports = { fronts: [
  'ai',
  'analyser',
  'build',
  'plan',
] };
