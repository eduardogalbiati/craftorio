// Service area: Maintain (#650, docs/work/write-doc/spec.md R16), the Documents service's door for the
// Monitor (fronts/ai/engine/areas/monitor.js) and the Night watch (packages/engine/service/channels/
// nightwatch.js), which call it as `ctx.recordDocIncident?.()` (this front may not be served).
// recordDocIncident({ projectId, item, date?, source, title?, error, diagnosis? }) → { commit, intent }:
// the incident in docs/work/<item>/maintain.md of the project's repository and a new intent item that
// links back (domains/docs.js recordIncident, one commit). Throws for an unknown project or item.

const projects = require('@multiagent/engine/domains/project/projects');
const docs = require('../domains/docs');

module.exports = (ctx) => ({
  recordDocIncident({ projectId, ...incident }) {
    let folder = null;
    try { folder = projects.readProject(ctx.ws.projects, projectId).folder; } catch { folder = null; }
    if (!folder) throw new Error(`Unknown project or a project without a folder: ${projectId}`);
    return docs.recordIncident(folder, incident);
  },
});
