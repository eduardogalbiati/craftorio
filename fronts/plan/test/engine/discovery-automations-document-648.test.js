// #648: a Discovery column automation's result comes back to the card (fronts/plan/engine/areas/
// discovery-automations.js). write-doc's `document` output is the accepted document's path
// (docs/work/<item>/<doc>.md): the card gets that file's text, read from the card's project folder; a
// path whose file is missing keeps the text of an earlier stage; any other value is the text itself.
// The area runs with a hand-made ctx (the workspace's folders, its event bus, a stubbed run start): no
// real run, the run's end is the run:event the service would emit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { layout } = require('@craftorio/engine/domains/workspace/workspace');
const discovery = require('@craftorio/engine/domains/discovery/discovery');
const projects = require('@craftorio/engine/domains/project/projects');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const load = () => require('../../engine/areas/discovery-automations');

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'discovery-doc-648-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const ws = layout(root);
  const folder = path.join(root, 'project');
  const project = await projects.createProject(ws.projects, { name: 'p1', folder });
  const events = new EventEmitter();
  let n = 0;
  const ctx = {
    ws,
    events,
    liveRun: () => null,
    listPipelines: () => [],
    projectWorkflowFile: (_projectId, file) => path.join(ROOT, 'workflows', path.basename(file)),
    startWorkflowRun: async () => ({ runId: `run-${++n}` }),
  };
  const area = load()(ctx);
  const card = discovery.createCard(ws.discovery, project.id, { title: 'Export CSV', text: 'Old text.', column: 'shape' });
  const writeDoc = (item, doc, markdown) => {
    fs.mkdirSync(path.join(folder, 'docs', 'work', item), { recursive: true });
    fs.writeFileSync(path.join(folder, 'docs', 'work', item, `${doc}.md`), markdown);
  };
  const cardNow = () => discovery.readCard(ws.discovery, project.id, card.id);
  const finished = (runId, document, then = null) => events.emit('run:event', { type: 'workflow.finished', run_id: runId, status: 'success', outputs: { document }, ...(then ? { then } : {}) });
  return { area, events, projectId: project.id, card, writeDoc, cardNow, finished };
}

test('#648 a write-doc result naming docs/work/<item>/<doc>.md gives the card that document\'s text, read from the project folder', async (t) => {
  const s = await setup(t);
  s.writeDoc('export-csv', 'intent', '# Export CSV\n\nShaped intent text.\n');
  const { runId } = await s.area.startDiscoveryAutomation({ projectId: s.projectId, cardId: s.card.id, column: 'shape' });
  s.finished(runId, 'docs/work/export-csv/intent.md');
  const card = s.cardNow();
  assert.equal(card.automation.state, 'done');
  assert.match(card.document, /Shaped intent text\./);
  assert.equal(card.document.includes('docs/work/'), false, 'the path itself is not the text');
});

test('#648 a result that is not a document path is the card\'s text as it is', async (t) => {
  const s = await setup(t);
  const { runId } = await s.area.startDiscoveryAutomation({ projectId: s.projectId, cardId: s.card.id, column: 'shape' });
  s.finished(runId, '# Shaped\n\nPlain text from the run.');
  assert.match(s.cardNow().document, /Plain text from the run\./);
});

test('#648 a later stage naming a document path whose file is missing keeps the earlier stage\'s text', async (t) => {
  const s = await setup(t);
  s.writeDoc('export-csv', 'intent', '# Export CSV\n\nFirst stage text.\n');
  const { runId } = await s.area.startDiscoveryAutomation({ projectId: s.projectId, cardId: s.card.id, column: 'shape' });
  // stage 1 ends with a chain to stage 2, which writes no file (a simulated write-doc)
  s.finished(runId, 'docs/work/export-csv/intent.md', { action: 'workflow', workflow: 'issue.yaml' });
  s.events.emit('run:chain', { run_id: runId, state: 'started', nextRunId: 'stage-2' });
  s.finished('stage-2', 'docs/work/export-csv/spec.md');
  const card = s.cardNow();
  assert.equal(card.automation.state, 'done');
  assert.match(card.document, /First stage text\./);
});
