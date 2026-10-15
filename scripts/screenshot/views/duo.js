// Screenshot seed of the Duo screen (--view duo): the accepted Write & Review run that enriched #12
// (views/backlog.js demoEnrichRun).

const { demoEnrichRun } = require('./backlog');

function seed({ ws, project }) {
  demoEnrichRun(ws, project.id);
}

module.exports = {
  seed,
};
