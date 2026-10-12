// Screenshot seed of a project's screen (--view project, opened with openProjectView): the local merge
// (its run list's "issue from cache" badge, #168), the demo roadmap's runs (#289: tonight's runs and
// the artifact runs expanded), child runs, a long run history and a simulated run.

const { demoLocalMerge } = require('./releases');
const { demoRoadmap } = require('./roadmap');
const { demoChildRuns, demoRunHistory } = require('./workflows');

function seed({ args, ws, project }) {
  demoLocalMerge(ws, project.id);
  demoRoadmap(ws, project.id, args.live, args.budget, args.roadmap);
  demoChildRuns(ws, project.id);
  demoRunHistory(ws, project.id);
}

const open = ({ js, project }) => js(`openProjectView(${JSON.stringify(project.id)})`);

module.exports = {
  open,
  run: true,
  seed,
};
