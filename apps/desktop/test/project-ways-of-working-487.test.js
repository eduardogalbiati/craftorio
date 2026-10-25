// #487 (review round 2): the Ways of working drawer (apps/desktop/renderer/views/project/project-ways-of-working.js)
// in a mini DOM with a fake window.api: an older compose answer arriving after a newer one does not
// replace the proposal, and "Edit profile" saves its fields into the answers (an empty field falls back
// to the question's default, or to the inferred value) and recomposes, while Cancel recomposes nothing.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');
const { createDom } = require('./mini-dom');

const FILE = path.join(__dirname, '..', 'renderer', 'views', 'project', 'project-ways-of-working.js');

const INTERVIEW = {
  profile: { team: 'solo', merge: 'local', release: null, testCommand: 'npm test', checkCommand: null, ci: 'github-actions', languages: ['js'] },
  evidence: { team: { numbers: { authors: 1 }, commits: ['a1b2c3d4e5'] } },
  questions: [
    { id: 'review', label: 'Review', question: 'How strict?', type: 'choice', options: [{ value: 'standard', label: 'Standard' }, { value: 'strict', label: 'Strict' }], default: 'standard' },
    { id: 'release', label: 'Release', question: 'Which release?', type: 'choice', options: [{ value: 'milestone', label: 'Milestone' }, { value: 'train', label: 'Train' }], default: 'milestone' },
  ],
};

const proposal = (name) => ({ workflows: [{ name, category: 'solo', path: `.multiagent/workflows/${name}.yaml`, yaml: '' }], manifest: { path: '.multiagent/project.yaml', yaml: '' } });

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

function loadDrawer({ held = false } = {}) {
  const composes = [];
  const api = {
    seedEstimate: async () => ({ costUsd: 0.1, free: false }),
    workflowInterview: async () => JSON.parse(JSON.stringify(INTERVIEW)),
    workflowCompose: (a) => {
      const d = deferred();
      composes.push({ args: JSON.parse(JSON.stringify(a)), ...d });
      return held ? d.promise : Promise.resolve(proposal(`wf-${composes.length}`));
    },
  };
  const sandbox = {
    console, setTimeout, clearTimeout, queueMicrotask, Promise,
    api,
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e), showToast: () => {},
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FILE, 'utf8'), sandbox, { filename: 'project-ways-of-working.js' });
  const doc = dom.document;
  const q = (sel) => doc.querySelector(sel);
  const fire = (el, type, Cls = dom.classes.Event) => el.dispatchEvent(new Cls(type, { bubbles: true, cancelable: true }));
  const click = (el) => fire(el, 'click', dom.classes.MouseEvent);
  const names = () => Array.from(doc.querySelectorAll('[data-testid="ways-of-working-proposed-workflow"]')).map((el) => el.getAttribute('data-name'));
  return { WOW: sandbox.ProjectWaysOfWorking, composes, q, fire, click, names };
}

const settle = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)); };

async function analyzed(opts) {
  const w = loadDrawer(opts);
  await w.WOW.open({ id: 'p1', name: 'demo' });
  await settle();
  w.click(w.q('[data-testid="ways-of-working-analyze"]'));
  await settle();
  return w;
}

test('#487 an older compose answer arriving after a newer one does not replace the proposal', async () => {
  const w = await analyzed({ held: true });
  assert.equal(w.composes.length, 1);
  const review = w.q('select[data-wow-answer="review"]');
  review.value = 'strict';
  w.fire(review, 'change');
  await settle();
  assert.equal(w.composes.length, 2);
  assert.equal(w.composes[1].args.answers.review, 'strict');
  w.composes[1].resolve(proposal('newer'));
  await settle();
  w.composes[0].resolve(proposal('older'));
  await settle();
  assert.deepEqual(w.names(), ['newer']);
});

test('#487 Save in Edit profile puts the fields into the answers and recomposes', async () => {
  const w = await analyzed();
  assert.equal(w.composes.length, 1);
  w.click(w.q('[data-testid="ways-of-working-edit-profile"]'));
  await settle();
  w.q('[data-wow-profile-field="languages"]').value = 'go, rust';
  w.q('[data-wow-profile-field="testCommand"]').value = '';
  w.q('[data-wow-profile-field="release"]').value = '';
  w.q('[data-wow-profile-field="team"]').value = 'team';
  w.fire(w.q('[data-testid="ways-of-working-profile-edit"]'), 'submit');
  await settle();
  assert.equal(w.composes.length, 2);
  const answers = w.composes[1].args.answers;
  assert.equal(answers.languages, 'go, rust');
  assert.equal(answers.team, 'team');
  assert.equal(answers.release, 'milestone');
  assert.equal('testCommand' in answers, false);
  assert.equal(w.q('[data-testid="ways-of-working-profile-edit"]') === null, true);
  assert.deepEqual(w.names(), ['wf-2']);
});

test('#487 Cancel in Edit profile closes the form and recomposes nothing', async () => {
  const w = await analyzed();
  w.click(w.q('[data-testid="ways-of-working-edit-profile"]'));
  await settle();
  w.q('[data-wow-profile-field="team"]').value = 'team';
  w.click(w.q('[data-testid="ways-of-working-profile-cancel"]'));
  await settle();
  assert.equal(w.q('[data-testid="ways-of-working-profile-edit"]') === null, true);
  assert.equal(w.composes.length, 1);
});
