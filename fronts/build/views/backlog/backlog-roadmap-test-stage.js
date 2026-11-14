// Backlog › Roadmap: the Test stage of a work item (#702), used by backlog-roadmap.js (statusHtml, next to
// the PR card). The item's `sdlc` is the service's (areas/roadmap.js roadmapView: { item, status,
// testRunning }, the folder under docs/work/, its plan.md status and whether its Test run is alive). A
// built plan (Progress N of N) offers "Start Test" while no Test run is alive: the click goes through
// [data-rm-item] → itemAction → roadmap:item `start_test` (channels/roadmap.js starts sdlc-test.yaml).
// Once started, the item's `testRunId` shows a button that opens that run ([data-run], backlog.js); after
// a rejected Test (the run ended, fix issues built) Start Test is offered again next to it. The Test
// stage never starts by itself.
// Test ids: roadmap-item-start-test, roadmap-test-run (data-run). Uses app.js globals (esc, t).
(() => {
  function html(x) {
    const sdlc = x?.sdlc;
    if (!sdlc?.item) return '';
    const run = x.testRunId
      ? `<button class="link-btn small" type="button" data-testid="roadmap-test-run" data-run="${esc(x.testRunId)}">${esc(t('backlog_roadmap.test_run'))}</button>`
      : '';
    if (sdlc.status !== 'built' || (x.testRunId && sdlc.testRunning !== false)) return run;
    return `${run}<button class="btn sm" type="button" data-rm-item="start_test" data-testid="roadmap-item-start-test" title="${esc(t('backlog_roadmap.start_test_hint', { item: sdlc.item }))}">${esc(t('backlog_roadmap.start_test'))}</button>`;
  }

  window.RoadmapTestStage = { html };
})();
