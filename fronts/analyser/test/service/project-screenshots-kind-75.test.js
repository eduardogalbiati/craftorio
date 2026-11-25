// #75 acceptance, written before the code: the project page's Next steps card proposes the screenshots spike
// (next-step-screenshots) only to a project with a user interface. The real page
// (packages/ui-kit/test/renderer-app-harness.js, as project-next-steps-onboarding-22.test.js drives it) over the
// real service: every projects:* / onboarding:* method of window.api answers what the service's channel answers,
// so these tests do not care how the detected kind reaches the page.
//
// The contract assumed here, for a project whose Next steps card is open:
// - the kind the owner picked (the record's `kind`) decides first, whatever the files say;
// - with none picked, what the project's files say: no user interface (backend) or no code at all leaves the
//   entry out; a user interface shows it;
// - a page opened again follows the kind and the files as they are then.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('@craftorio/ui-kit/test/page-pieces');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');
const { makeService } = require('@craftorio/engine/test/service/helpers');
const { pageMarkup } = require('../project-page-helpers');

const PHP = {
  'composer.json': JSON.stringify({ name: 'acme/cpf', require: { php: '>=8.2' }, autoload: { 'psr-4': { 'Acme\\': 'src/' } } }),
  'src/Cpf.php': '<?php\nnamespace Acme;\n\nfinal class Cpf\n{\n    public static function isValid(string $cpf): bool\n    {\n        return strlen($cpf) === 11;\n    }\n}\n',
  'README.md': '# CPF\n\nValidates a CPF number.\n',
};
const REACT = {
  'package.json': JSON.stringify({ name: 'shop', private: true, dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' } }),
  'src/App.jsx': 'export default function App() {\n  return <main>Shop</main>;\n}\n',
};
const NO_CODE = { 'README.md': '# Field Notes\n', '.gitignore': 'node_modules/\n' };

function write(folder, files) {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(folder, ...rel.split('/'));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

// a service with one project on a temp folder holding `files`, its kind the picked one when given
async function setup(t, files, kind) {
  const { service, api } = makeService(t);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'next-steps-kind-75-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  write(folder, files);
  const project = await api['projects:create']({ name: 'Kind 75', folder, ...(kind ? { kind } : {}) });
  return { service, api, folder, id: project.id };
}

// ---- window.api over the service ----------------------------------------------------------------------

// the positional arguments of a method -> the channel's one argument, as apps/desktop/host/preload.js does
function payload(params, args) {
  if (!params) return undefined;
  if (typeof params === 'string') return args[0];
  const out = {};
  params.forEach((name, i) => {
    if (name.startsWith('...')) Object.assign(out, args[i]);
    else out[name] = args[i];
  });
  return out;
}

const overIpc = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

// the projects' and the onboarding's methods, answered by the service; pending(): the calls not answered yet
function serviceApi(service) {
  const methods = {};
  let pending = 0;
  for (const entry of service.manifest) {
    if (!entry.method || !/^(projects?|onboarding)[:-]/.test(entry.channel || '') || !service.api[entry.channel]) continue;
    methods[entry.method] = async (...args) => {
      pending += 1;
      try { return overIpc(await service.api[entry.channel](overIpc(payload(entry.params, args)))); } finally { pending -= 1; }
    };
  }
  return { methods, pending: () => pending };
}

// the project's page opened in a new window, once everything it asked the service for is answered and drawn
async function openPage({ service, id }) {
  const bridge = serviceApi(service);
  const app = loadApp({
    api: {
      ...bridge.methods,
      refactorProposals: async () => [],
      getBacklog: async () => ({ issues: [] }),
      refactorCadence: async () => ({ on: false, every: 10, since: null }),
      listDiscoveryCards: async () => [],
      listDiscoveryWaiting: async () => [],
    },
    storage: { 'craftorio.nextSteps': JSON.stringify({ [id]: 'open' }) },
  });
  const drawn = async () => {
    const deadline = Date.now() + 10000;
    let quiet = 0; // rounds in a row with nothing pending
    while (quiet < 3) {
      await app.settle(15);
      quiet = bridge.pending() ? 0 : quiet + 1;
      if (Date.now() > deadline) throw new Error(`the page still waits for the service (${bridge.pending()} calls)`);
    }
  };
  await app.boot();
  await drawn();
  app.run(`openProjectView(${JSON.stringify(id)})`);
  await drawn();
  return app;
}

const shownEl = (e) => !('hidden' in e.attrs) && !String(e.attrs.class || '').split(/\s+/).includes('hidden');
const card = (app) => H.findEl(pageMarkup(app, { defs: false }), (e) => e.attrs['data-testid'] === 'project-next-steps' && shownEl(e));

// 'shown' or 'none': the screenshots entry of the Next steps card, which is itself on the page
async function screenshotsEntry(project) {
  const steps = card(await openPage(project));
  assert.equal(steps === null, false, 'the Next steps card is shown');
  return H.findEl(steps.outer, (e) => e.name === 'li' && e.attrs['data-testid'] === 'next-step-screenshots') ? 'shown' : 'none';
}

// ---- the detected kind ----------------------------------------------------------------------------------

test('#75 a project detected as backend (PHP, no kind picked) has no screenshots entry', { timeout: 60000 }, async (t) => {
  const p = await setup(t, PHP);
  assert.equal(await screenshotsEntry(p), 'none');
});

test('#75 a project with a user interface (React, no kind picked) keeps the screenshots entry', { timeout: 60000 }, async (t) => {
  const p = await setup(t, REACT);
  assert.equal(await screenshotsEntry(p), 'shown');
});

test('#75 a project with no code has no screenshots entry until a user interface is added', { timeout: 60000 }, async (t) => {
  const p = await setup(t, NO_CODE);
  assert.equal(await screenshotsEntry(p), 'none', 'a README and a .gitignore only');
  write(p.folder, REACT);
  assert.equal(await screenshotsEntry(p), 'shown', 'the page opened again, with a user interface');
});

// ---- the picked kind wins -------------------------------------------------------------------------------

test('#75 picked backend wins over files with a user interface: no screenshots entry', { timeout: 60000 }, async (t) => {
  const p = await setup(t, REACT, 'backend');
  assert.equal(await screenshotsEntry(p), 'none');
});

test('#75 picked frontend wins over PHP files: the screenshots entry is shown', { timeout: 60000 }, async (t) => {
  const p = await setup(t, PHP, 'frontend');
  assert.equal(await screenshotsEntry(p), 'shown');
});

test('#75 a project with no code that says it has a user interface (picked frontend) shows the screenshots entry', { timeout: 60000 }, async (t) => {
  const p = await setup(t, NO_CODE, 'frontend');
  assert.equal(await screenshotsEntry(p), 'shown');
});

test('#75 a kind changed later is followed when the page is opened again', { timeout: 60000 }, async (t) => {
  const p = await setup(t, PHP);
  assert.equal(await screenshotsEntry(p), 'none', 'detected backend');
  await p.api['projects:update']({ id: p.id, patch: { kind: 'frontend' } });
  assert.equal(await screenshotsEntry(p), 'shown', 'changed to frontend');
  await p.api['projects:update']({ id: p.id, patch: { kind: 'backend' } });
  assert.equal(await screenshotsEntry(p), 'none', 'changed back to backend');
});
