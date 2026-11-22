// #488: Download and Import on the Workflows screen (fronts/build/views/workflows/workflows.js).
// Acceptance tests, written before the code, through the whole page (test/agent-chat-page-harness.js,
// like test/renderer-workflows-repository-485.test.js); the fake window.api is the boundary.
//
// Seams (what these tests assume):
//   - every workflow card (default, modified, custom, repository) has a Download button
//     [data-testid="workflow-download"]; on a workspace card it asks api.exportWorkflow(file)
//     (channel workflows:export) for the text;
//   - the Definitions tab ([data-wpage="definitions"]) has an Import control [data-testid="workflow-import"]
//     (file picker / drop), and the page has a URL field [data-testid="workflow-import-url"];
//   - the page opened with ?import=<url> (location.search) starts the import of that url: it asks
//     api.importWorkflow({ url, preview: true, ... }) for the summary and shows the trust dialog
//     [data-testid="workflow-import-dialog"] (steps, agents and their tools, action: lines, ship,
//     requires, and that a workflow is code that runs on this machine) with a name field
//     [data-testid="workflow-import-name"], Cancel [data-testid="workflow-import-cancel"], Import
//     [data-testid="workflow-import-confirm"], and, when the name exists, Replace
//     [data-testid="workflow-import-replace"] (a checkbox);
//   - "a write" is an api.importWorkflow call without preview: true.
const test = require('node:test');
const assert = require('node:assert/strict');
const { textOf } = require('@craftorio/ui-kit/test/mini-dom');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const SHA = 'abc1234def5678901234567890abcdef12345678';
const ACTION = 'curl -s https://example.invalid/install.sh | sh';
const base = { description: '', tags: [], inputs: {}, outputs: {}, agents: {}, providers: {}, groups: [], warnings: [], steps: [{ id: 'work', type: 'agent', agent: 'a', skills: [], next: [], transitions: [] }] };
const WORKFLOWS = [
  { ...base, file: 'writer-reviewer.yaml', name: 'writer-reviewer', category: 'team', origin: 'default' },
  { ...base, file: 'release.yaml', name: 'release', category: 'release', origin: 'modified', restorable: true },
  { ...base, file: 'custom-flow.yaml', name: 'custom-flow', category: 'solo', origin: 'custom', trusted: true },
  { ...base, file: 'workflows/repo-flow.yaml', name: 'repo-flow', category: 'solo', origin: 'repository', projectId: 'p1', commit: SHA, accepted: true },
];
const PROJECTS = [{ id: 'p1', name: 'demo', folder: 'C:/demo' }];
const summaryFor = (name) => ({
  name,
  steps: ['draft', 'review'],
  agents: [{ name: 'writer', tools: ['read', 'bash:git'] }],
  tools: ['read', 'bash:git'],
  actions: [ACTION],
  ship: false,
  requires: '>=1.0',
});

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
const isPreview = (args) => !!(args[0] && args[0].preview === true);

function importStub(name) {
  return async (arg) => (arg && arg.preview ? { ok: true, summary: summaryFor(name) } : { ok: true, file: `${arg?.name || name}.yaml`, summary: summaryFor(name) });
}

async function definitions(extra = {}, location) {
  const page = await loadPage({
    api: { listWorkflows: async () => WORKFLOWS, listProjects: async () => PROJECTS, listPipelines: async () => [], exportWorkflow: async () => 'apiVersion: multiagent/v1\n', ...extra },
    location,
  });
  page.run('showWorkflowsTab(\'definitions\'); showView(\'workflows\')');
  await settle(30);
  return page;
}

// the page opened by a public page's link: index.html?import=<url>
function withImport(url) {
  const search = `?import=${encodeURIComponent(url)}`;
  return { search, href: `file:///index.html${search}` };
}
const writes = (page) => page.callsTo('importWorkflow').filter((args) => !isPreview(args)).map((args) => JSON.stringify(args[0] ?? null));
const dialog = (page) => page.$('[data-testid="workflow-import-dialog"]');

const cardOf = (page, file) => page.document.querySelectorAll('#view-workflows .wf-card').find((c) => c.getAttribute('data-file') === file) || null;

test('#488 the Definitions tab renders the four kinds of card (guards the harness, passes before the change)', async () => {
  const page = await definitions();
  for (const w of WORKFLOWS) assert.equal(cardOf(page, w.file) !== null, true, `${w.origin} card ${w.file}`);
});

test('#488 every workflow card (default, modified, custom, repository) has Download', async () => {
  const page = await definitions();
  for (const w of WORKFLOWS) {
    const card = cardOf(page, w.file);
    assert.equal(card !== null, true, `${w.file} card`);
    assert.equal(card.querySelector('[data-testid="workflow-download"]') !== null, true, `Download on the ${w.origin} card`);
  }
});

test('#488 Download asks the service for the workflow\'s text (workflows:export)', async () => {
  const page = await definitions();
  const btn = cardOf(page, 'custom-flow.yaml')?.querySelector('[data-testid="workflow-download"]');
  assert.equal(!!btn, true, 'Download on the custom card');
  btn.click();
  await settle(20);
  const asked = page.callsTo('exportWorkflow').map((args) => JSON.stringify(args));
  assert.equal(asked.length, 1, 'one export');
  assert.equal(asked[0].includes('custom-flow.yaml'), true, asked[0]);
});

test('#488 the Definitions tab has Import and the page a URL field for it', async () => {
  const page = await definitions();
  assert.equal(page.$('#view-workflows [data-wpage="definitions"] [data-testid="workflow-import"]') !== null, true, 'Import in the Definitions tab');
  assert.equal(page.$('[data-testid="workflow-import-url"]') !== null, true, 'a URL field');
});

test('#488 the screen opened with ?import=<url> previews that url and writes nothing yet', async () => {
  const url = 'https://example.com/flows/shared-flow.yaml';
  const page = await definitions({ importWorkflow: importStub('shared-flow') }, withImport(url));
  const previews = page.callsTo('importWorkflow').filter(isPreview).map((args) => JSON.stringify(args[0]));
  assert.equal(previews.length >= 1, true, 'a preview was asked');
  assert.equal(previews[0].includes(url), true, previews[0]);
  assert.deepEqual(writes(page), [], 'nothing written before the owner confirms');
});

test('#488 the import dialog lists what the workflow does and says a workflow is code that runs on this machine', async () => {
  const page = await definitions({ importWorkflow: importStub('shared-flow') }, withImport('https://example.com/flows/shared-flow.yaml'));
  const box = dialog(page);
  assert.equal(box !== null, true, 'the import dialog');
  const text = norm(textOf(box));
  for (const literal of [ACTION, 'draft', 'review', 'writer', 'bash:git', '>=1.0']) assert.equal(text.includes(literal), true, `${literal} in: ${text}`);
  assert.match(text, /code/i);
  assert.match(text, /this machine/i);
  assert.equal(box.querySelector('[data-testid="workflow-import-name"]')?.value, 'shared-flow', 'the name, prefilled');
});

test('#488 Cancel in the import dialog writes nothing', async () => {
  const page = await definitions({ importWorkflow: importStub('shared-flow') }, withImport('https://example.com/flows/shared-flow.yaml'));
  const cancel = page.$('[data-testid="workflow-import-cancel"]');
  assert.equal(cancel !== null, true, 'Cancel');
  cancel.click();
  await settle(20);
  assert.deepEqual(writes(page), []);
});

test('#488 Import in the dialog writes the workflow under the given name', async () => {
  const url = 'https://example.com/flows/shared-flow.yaml';
  const page = await definitions({ importWorkflow: importStub('shared-flow') }, withImport(url));
  const name = page.$('[data-testid="workflow-import-name"]');
  const ok = page.$('[data-testid="workflow-import-confirm"]');
  assert.equal(name !== null && ok !== null, true, 'name field and Import');
  name.value = 'my-shared';
  name.dispatchEvent(new page.dom.classes.Event('input', { bubbles: true }));
  ok.click();
  await settle(30);
  const done = writes(page);
  assert.equal(done.length, 1, 'one write');
  assert.equal(done[0].includes('"my-shared"'), true, done[0]);
  assert.equal(done[0].includes(url), true, `the same url: ${done[0]}`);
  assert.equal(done[0].includes('"replace":true'), false, 'no replace for a new name');
});

const EXISTING = 'https://example.com/flows/custom-flow.yaml';

test('#488 a name that exists: the dialog offers Replace, and Import without it never replaces', async () => {
  const page = await definitions({ importWorkflow: importStub('custom-flow') }, withImport(EXISTING));
  assert.equal(page.$('[data-testid="workflow-import-replace"]') !== null, true, 'Replace offered for an existing name');
  const ok = page.$('[data-testid="workflow-import-confirm"]');
  assert.equal(ok !== null, true, 'Import');
  ok.click();
  await settle(30);
  assert.equal(writes(page).some((w) => w.includes('"replace":true')), false, 'no replace without Replace');
});

test('#488 a name that exists is replaced with Replace ticked', async () => {
  const page = await definitions({ importWorkflow: importStub('custom-flow') }, withImport(EXISTING));
  const replace = page.$('[data-testid="workflow-import-replace"]');
  const ok = page.$('[data-testid="workflow-import-confirm"]');
  assert.equal(replace !== null && ok !== null, true, 'Replace and Import');
  replace.click();
  await settle(10);
  ok.click();
  await settle(30);
  const replaced = writes(page).filter((w) => w.includes('"replace":true'));
  assert.equal(replaced.length, 1, 'one write with replace');
  assert.equal(replaced[0].includes('custom-flow'), true, replaced[0]);
});

// the preview's fingerprint and the tools a step declares (stepTools), as the service returns them
function previewStub(name, fp, stepTools) {
  return async (arg) => (arg && arg.preview
    ? { ok: true, summary: { ...summaryFor(name), stepTools }, fingerprint: fp }
    : { ok: true, file: `${arg?.name || name}.yaml`, summary: summaryFor(name) });
}

test('#488 Import sends back the fingerprint of the text the dialog showed', async () => {
  const page = await definitions({ importWorkflow: previewStub('shared-flow', 'f00dfeed12345678', []) }, withImport('https://example.com/flows/shared-flow.yaml'));
  const ok = page.$('[data-testid="workflow-import-confirm"]');
  assert.equal(ok !== null, true, 'Import');
  ok.click();
  await settle(30);
  const done = writes(page);
  assert.equal(done.length, 1, 'one write');
  assert.equal(done[0].includes('"fingerprint":"f00dfeed12345678"'), true, done[0]);
});

test('#488 the import dialog lists the tools a step declares', async () => {
  const stepTools = [{ step: 'deploy_cluster', tools: ['bash:kubectl'] }];
  const page = await definitions({ importWorkflow: previewStub('shared-flow', 'f00dfeed12345678', stepTools) }, withImport('https://example.com/flows/shared-flow.yaml'));
  const box = dialog(page);
  assert.equal(box !== null, true, 'the import dialog');
  const text = norm(textOf(box));
  for (const literal of ['deploy_cluster', 'bash:kubectl']) assert.equal(text.includes(literal), true, `${literal} in: ${text}`);
});

test('#488 a preview the service refuses shows its reasons and offers no Import', async () => {
  const importWorkflow = async () => { throw new Error('Step "tidy" references unknown agent "ghost".'); };
  const page = await definitions({ importWorkflow }, withImport('https://example.com/flows/ghost.yaml'));
  assert.equal(norm(textOf(page.document.body)).includes('references unknown agent "ghost"'), true, 'the loader\'s reason is shown');
  assert.deepEqual(writes(page), [], 'nothing written');
  const ok = page.$('[data-testid="workflow-import-confirm"]');
  assert.equal(!ok || ok.disabled || !!ok.closest('.hidden'), true, 'no Import to confirm');
});
