// Screenshot seed of Home (--view dashboard, the default view, #255): every stage of the flow on demo
// data: the Inbox's cards, the backlog, the roadmap's runs, the local merge, the releases, the Night
// watch's morning summary (#172) and a simulated run.

const { demoDiscovery } = require('./inbox');
const { writeNights } = require('./nightwatch');
const { demoLocalMerge, demoReleases } = require('./releases');
const { demoRoadmap } = require('./roadmap');

function seed(ctx) {
  const { args, ws, project } = ctx;
  demoLocalMerge(ws, project.id);
  demoReleases(ws, project.id);
  demoRoadmap(ws, project.id, args.live, args.budget, args.roadmap);
  demoDiscovery(ws, project.id);
  writeNights(ctx);
}

module.exports = {
  run: true,
  seed,
};
