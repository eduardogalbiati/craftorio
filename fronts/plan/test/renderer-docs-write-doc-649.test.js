// #649 (write-doc phase 3, R1): "Write a document" on a Discovery card opens the Documents editor on a new
// intent named after the card (fronts/plan/views/docs/docs.js, window.writeDocForCard({ projectId,
// cardId, title })). The run is the card's project's: its folder is the run's project_path, the
// editor reads the document from that project (even when the header shows another one), and the run
// is linked to the card. The real page in the renderer harness with a fake window.api.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const PROJECTS = [
  { id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' },
  { id: 'p2', name: 'Other project', repo: 'https://github.com/o/other', folder: 'C:/other' },
  { id: 'p3', name: 'No folder', repo: 'https://github.com/o/none' },
];

async function app() {
  const a = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => PROJECTS,
      getSettings: async () => ({ lastProject: 'p1' }),
      listDocItems: async () => [],
      readDoc: async (projectId, item, doc) => ({ item, doc, status: 'draft', source: { file: `docs/work/${item}/${doc}.md`, markdown: '# Intent\n' }, translation: null }),
      listDocChanges: async () => ({ changes: [], unreviewed: [], base: 'abc123' }),
      startRun: async () => ({ runId: 'run-wd' }),
    },
  });
  await a.boot();
  a.run("showView('discovery')");
  await a.settle(10);
  return a;
}

async function writeFor(a, link) {
  await a.run(`writeDocForCard(${JSON.stringify(link)})`);
  await a.settle(20);
}

test('#649 Write a document starts one write-doc run in the card\'s project, on a new intent named after the card', async () => {
  const a = await app();
  await writeFor(a, { projectId: 'p2', cardId: 'c1', title: 'Export runs as CSV' });
  const starts = a.callsTo('startRun');
  assert.equal(starts.length, 1);
  const [req] = starts[0];
  assert.equal(req.file, 'write-doc.yaml');
  assert.equal(req.projectId, 'p2');
  assert.equal(req.inputs.project_path, 'C:/other');
  assert.equal(req.inputs.title, 'Export runs as CSV');
  assert.equal(req.inputs.item, 'export-runs-as-csv');
  assert.equal(req.inputs.document, 'intent');
});

test('#649 the editor opened from the card reads the document from the card\'s project, not the header\'s', async () => {
  const a = await app();
  await writeFor(a, { projectId: 'p2', cardId: 'c1', title: 'Export runs as CSV' });
  const reads = a.callsTo('readDoc');
  assert.equal(reads.length > 0, true, 'the editor read the document');
  assert.deepEqual(reads.map((r) => r[0]).filter((p) => p !== 'p2'), [], 'every read is of the card\'s project');
});

test('#649 a card project without a folder still starts the writer, without a project_path', async () => {
  const a = await app();
  await writeFor(a, { projectId: 'p3', cardId: 'c1', title: 'Export runs' });
  const starts = a.callsTo('startRun');
  assert.equal(starts.length, 1);
  assert.equal('project_path' in starts[0][0].inputs, false);
  assert.equal(starts[0][0].inputs.title, 'Export runs');
});

test('#649 the run started from the card is linked to it, so its document comes back to the card', async () => {
  const a = await app();
  await writeFor(a, { projectId: 'p2', cardId: 'c1', title: 'Export runs as CSV' });
  const runs = JSON.parse(a.run("localStorage.getItem('discovery.runs')") || '{}');
  assert.deepEqual(runs['run-wd'], { projectId: 'p2', cardId: 'c1', source: 'write-doc', item: 'export-runs-as-csv', doc: 'intent' });
});
