// #40 acceptance, written before the code: the Start drawer (packages/ui-kit/start-drawer.js openDrawer) for a
// project whose default workflow comes from its repository's .craftorio/ manifest and waits for the owner's
// acceptance at the current commit (Workflows › Definitions' "Awaiting your acceptance"): the drawer says so (a
// hint naming the workflow and pointing to Definitions), never opens on settings.lastWorkflow (another
// project's last pick) and opens on the project's own bundled Feature workflow (feature.yaml) instead.
// Unchanged: a default the Setup hid (#27/#319: settings.lastWorkflow) and an accepted default (no hint).
// On the real page (renderer-app-harness.js), as start-drawer-project-default-27.test.js.
//
// The contract assumed here:
// - "waits for acceptance" is the existing rule (workflows-acceptance.js awaitsAcceptance): an entry of
//   api.listWorkflows({ projectId[, repositoryOnly] }) with origin 'repository' and accepted === false;
//   api.listWorkflows() without a project does not list the repository's workflows (as the service does);
// - the project record carries the manifest's default (`manifest.default`, and `defaultWorkflow`, #790);
// - the hint is an element with data-testid="start-drawer-awaiting-acceptance" (rendered markup, or a static
//   element of index.html whose text the drawer fills and shows), naming the workflow and pointing to Definitions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./renderer-app-harness');

const ROOT = path.join(__dirname, '..', '..', '..');
const pageFile = (rel) => require('../../../scripts/source-tree').pageFile(ROOT, rel);

const HINT = 'start-drawer-awaiting-acceptance';
const REPO_WF = 'ai-development-remote-hero';
const task = { task: { type: 'string', required: true } };
const wf = (name, label) => ({ file: `${name}.yaml`, name: label, steps: [], inputs: task });
const WORKFLOWS = [wf('analyze-project', 'Analyze project'), wf('feature', 'Feature'), wf('fix', 'Fix'), wf('issue', 'Issue')];
const repoEntry = (accepted) => ({
  file: `${REPO_WF}.yaml`, name: REPO_WF, origin: 'repository', projectId: 'p5', commit: 'c0ffee1234567890',
  changedCommit: accepted ? null : 'c0ffee1234567890', accepted, acceptedCommit: accepted ? 'c0ffee1234567890' : null,
  trusted: accepted, steps: [], inputs: task, category: 'feature',
});
const IMPORTED = {
  id: 'p5', name: 'Remote hero', folder: 'C:/p/remote', exists: true, repo: 'https://github.com/o/remote',
  defaultWorkflow: REPO_WF, manifest: { default: REPO_WF },
};
const CREATED = { id: 'p1', name: 'Shop', folder: 'C:/p/shop', exists: true, workflows: [{ name: 'feature', category: 'feature' }], defaultWorkflow: 'feature' };

async function page({ accepted = false, lastWorkflow = 'issue.yaml', hiddenWorkflows = [] } = {}) {
  const repo = [repoEntry(accepted)];
  const app = loadApp({
    api: {
      getSettings: async () => ({ setupDone: true, lastWorkflow, hiddenWorkflows }),
      setSettings: async (s) => ({ setupDone: true, lastWorkflow, hiddenWorkflows, ...s }),
      listWorkflows: async (opts = {}) => {
        if (opts?.projectId !== 'p5') return JSON.parse(JSON.stringify(WORKFLOWS));
        return JSON.parse(JSON.stringify(opts.repositoryOnly ? repo : [...WORKFLOWS, ...repo]));
      },
      listProjects: async () => JSON.parse(JSON.stringify([IMPORTED, CREATED])),
      listPipelines: async () => [],
    },
  });
  await app.boot();
  return app;
}

async function open(app, args) {
  await app.run(`openDrawer(${JSON.stringify(args)})`);
  await app.settle(10);
  return String(app.el('#wf-select').value);
}

// Every markup and text the page's fake elements hold (what the views wrote into them)
function pageMarkup(app) {
  const parts = [];
  for (const el of [...app.elements.values(), ...app.created]) {
    parts.push(String(el.innerHTML || ''), String(el.textContent || ''), ...(el.inserted || []).map(([, h]) => String(h)));
  }
  return parts.join('\n');
}

// The hint's visible text, or '' when it is not shown: a rendered element with its test id, or index.html's
// static element with that test id, filled and not hidden
function hintText(app) {
  const html = pageMarkup(app);
  const at = html.indexOf(`data-testid="${HINT}"`);
  if (at >= 0) return html.slice(at, at + 2000).replace(/<[^>]*>/g, ' ');
  const index = fs.readFileSync(pageFile('index.html'), 'utf8');
  const tag = new RegExp(`<[^>]*data-testid="${HINT}"[^>]*>`).exec(index)?.[0];
  const id = tag && /\bid="([^"]+)"/.exec(tag)?.[1];
  if (!id) return '';
  const el = app.el(`#${id}`);
  const hidden = el.hidden || el.classList.contains('hidden') || 'hidden' in el.attrs;
  return hidden ? '' : `${el.textContent || ''} ${String(el.innerHTML || '').replace(/<[^>]*>/g, ' ')}`;
}

test('#40 a project whose repository default awaits acceptance opens the drawer on its own Feature workflow', async () => {
  const app = await page();
  assert.equal(await open(app, { project: 'p5' }), 'feature.yaml');
});

test('#40 a project whose repository default awaits acceptance never opens on settings.lastWorkflow', async () => {
  const app = await page({ lastWorkflow: 'fix.yaml' });
  assert.notEqual(await open(app, { project: 'p5' }), 'fix.yaml');
});

test('#40 the header project\'s repository default awaits acceptance: the drawer opened without a project falls back the same way', async () => {
  const app = loadApp({
    storage: { 'craftorio.currentProject': 'p5' },
    api: {
      getSettings: async () => ({ setupDone: true, lastWorkflow: 'issue.yaml', hiddenWorkflows: [] }),
      listWorkflows: async (opts = {}) => JSON.parse(JSON.stringify(opts?.projectId === 'p5' ? (opts.repositoryOnly ? [repoEntry(false)] : [...WORKFLOWS, repoEntry(false)]) : WORKFLOWS)),
      listProjects: async () => JSON.parse(JSON.stringify([IMPORTED, CREATED])),
      listPipelines: async () => [],
    },
  });
  await app.boot();
  assert.equal(await open(app, {}), 'feature.yaml');
});

test('#40 the drawer shows a hint naming the repository default that awaits acceptance', async () => {
  const app = await page();
  await open(app, { project: 'p5' });
  const text = hintText(app);
  assert.equal(text.includes(REPO_WF), true, `the hint (data-testid="${HINT}") names ${REPO_WF}: ${JSON.stringify(text)}`);
});

test('#40 the awaiting-acceptance hint points to Workflows › Definitions', async () => {
  const app = await page();
  await open(app, { project: 'p5' });
  const html = pageMarkup(app);
  const at = html.indexOf(`data-testid="${HINT}"`);
  const around = at >= 0 ? html.slice(at, at + 2000) : hintText(app);
  assert.match(around, /definitions/i, `the hint links or names Definitions: ${JSON.stringify(around.slice(0, 400))}`);
});

test('#40 unchanged: a default the Setup hid from Start still opens on settings.lastWorkflow, with no acceptance hint', async () => {
  const app = await page({ hiddenWorkflows: ['feature'] });
  assert.equal(await open(app, { project: 'p1' }), 'issue.yaml');
  assert.equal(hintText(app), '', 'no awaiting-acceptance hint for a Setup-hidden default');
});

test('#40 unchanged: a repository default already accepted shows no acceptance hint', async () => {
  const app = await page({ accepted: true });
  await open(app, { project: 'p5' });
  assert.equal(hintText(app), '');
});

test('#40 unchanged: a project whose default is a bundled workflow opens on it, with no acceptance hint', async () => {
  const app = await page();
  assert.equal(await open(app, { project: 'p1' }), 'feature.yaml');
  assert.equal(hintText(app), '');
});
