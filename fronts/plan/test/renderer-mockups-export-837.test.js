// #837 the Mockups screen's "Export to the repository" dialog: submitted with no screen checked, it says
// to choose one (mockups.export_repo_choose) and never opens the Start panel (openDrawer).
// The renderer harness answers [] to querySelectorAll, so every checkbox reads as unchecked here: the
// path with chosen screens is covered by the @issue-837 BDD scenario.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@multiagent/ui-kit/test/renderer-app-harness');

async function mockupsScreen() {
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listMockups: async () => [{ slug: 'orders-dashboard', title: 'Orders dashboard', components: 'static-kit' }],
    },
  });
  await app.boot();
  app.run("showView('mockups')");
  await app.settle(10);
  const opened = [];
  app.sandbox.openDrawer = async (opts) => { opened.push(JSON.parse(JSON.stringify(opts ?? null))); };
  return { app, opened };
}

test('#837 Export to the repository with no screen checked asks to choose one and opens no Start panel', async () => {
  const { app, opened } = await mockupsScreen();
  const exportButton = { closest: (sel) => (sel === '[data-mockups-export-repo]' ? exportButton : null) };
  app.el('#mockups-body').onclick({ target: exportButton });
  await app.settle(5);
  const dialogOpen = !app.el('#mockups-export-repo-dialog').classList.contains('hidden');
  await app.el('#mockups-export-repo-form').onsubmit({ preventDefault() {} });
  await app.settle(5);
  assert.deepEqual([dialogOpen, String(app.el('#mockups-export-repo-error').textContent), opened.length],
    [true, 'Choose at least one screen to export.', 0]);
});
