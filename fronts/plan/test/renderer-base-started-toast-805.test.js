// #805: the screens that start a local run without asking about its base (Documents, Write & Review, AI Arena) go on
// from the local base (baseChoice: 'continue') and say it in a toast when the answer carries a baseCheck.
// The real page in the renderer harness, with a fake window.api; the toast is read from #toast.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const baseCheck = { base: 'main', state: 'behind', ahead: 0, behind: 16, canUpdate: true };
const PROJECT = { id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' };

async function appAnswering(answer) {
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [PROJECT],
      getSettings: async () => ({ lastProject: 'p1' }),
      listDocItems: async () => [],
      readDoc: async (projectId, item, doc) => ({ item, doc, status: 'draft', source: { file: `docs/work/${item}/${doc}.md`, markdown: '# Doc\n' }, translation: null }),
      listDocChanges: async () => ({ changes: [], unreviewed: [], base: 'abc123' }),
      startRun: async () => answer,
    },
  });
  await app.boot();
  return app;
}

const SCREENS = {
  Documents: async (app) => {
    app.run("showView('docs')");
    await app.settle(10);
    app.run('DocsPanels.newItemWriters(false)');
    app.el('#docs-new-title').value = 'Export runs as CSV';
    app.el('#docs-new-starts').value = 'intent';
    await app.el('#docs-new-form').onsubmit({ preventDefault() {} });
    await app.settle(20);
  },
  'Write & Review': async (app) => {
    app.run("showView('duo')");
    await app.settle(10);
    app.el('#duo-prompt').value = 'Write the guide';
    app.el('#duo-goal').value = 'A clear guide';
    await app.click('#duo-run');
    await app.settle(20);
  },
  'AI Arena': async (app) => {
    app.run("showView('arena')");
    await app.settle(10);
    app.el('#arena-task').value = 'Compare the options';
    await app.click('#arena-run');
    await app.settle(20);
  },
};

const toastShown = (app) => app.el('#toast').classList.contains('hidden') === false;
const toastText = (app) => String(app.el('#toast').innerHTML).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

for (const [screen, start] of Object.entries(SCREENS)) {
  test(`#805 ${screen}: a run that goes on from a base behind says so in a toast, with the count and origin`, async () => {
    const app = await appAnswering({ runId: 'r9', baseCheck });
    await start(app);
    const starts = app.callsTo('startRun');
    assert.equal(starts.length, 1, 'the screen started its run');
    assert.equal(starts[0][0].baseChoice, 'continue');
    assert.equal(toastShown(app), true);
    assert.match(toastText(app), /Started from the local base/);
    assert.match(toastText(app), /\b16 commits behind origin\/main/);
  });

  test(`#805 ${screen}: a run with no baseCheck in its answer shows no base toast`, async () => {
    const app = await appAnswering({ runId: 'r9' });
    await start(app);
    assert.equal(app.callsTo('startRun').length, 1, 'the screen started its run');
    assert.doesNotMatch(toastText(app), /local base/);
  });
}
