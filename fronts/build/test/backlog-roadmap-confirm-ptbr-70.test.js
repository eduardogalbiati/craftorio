// #70 acceptance, written before the code: Start and Resume on the Roadmap
// (fronts/build/views/backlog/backlog-roadmap.js, window.BacklogRoadmap.onClick with data-rm="start")
// ask before starting real runs; title, text (the warning about spending) and button read in English in
// the pt-BR interface. The whole page with real runs on; the modal is app.js's confirmDialog. The
// English of Resume is also pinned by renderer-backlog-roadmap.test.js (#243).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const ENGLISH = /Start the roadmap|Resume|Its items run|real runs|they use|subscriptions|cost money|Human gates|wait for you|Runs in progress|keep going|next planned items|pauses again/i;
const SPENDING = /custa|dinheiro|gast|cobr/i;

const item = (n, status) => ({ id: `it${n}`, status, workflow: 'w.yaml', mock: false, issues: [{ number: n, title: `#${n}`, url: 'u' }] });
const roadmap = (over) => ({
  roadmap: {
    state: 'planned', scope: null,
    stages: ['planned', 'planned', 'planned'].map((s, n) => ({ id: `st${n + 1}`, name: `Etapa ${n + 1}`, note: '', items: [item(n + 1, s)] })),
    ...over,
  },
  issues: [],
});
const START = roadmap({ state: 'planned' });
const RESUME = roadmap({ state: 'paused' });
const RESUME_STAGE = roadmap({ state: 'paused', scope: { stage: 'st2' } });

function startButton() {
  const btn = { dataset: { rm: 'start' } };
  btn.closest = (sel) => (sel === '[data-rm]' ? btn : null);
  return btn;
}

async function asked(language, data) {
  const page = await loadPage({ api: { appInfo: () => ({ simulationOnly: false }), getSettings: () => ({ developerMode: false }) } });
  page.sandbox.I18n.setLanguage(language);
  const ctx = { projectId: 'p1', setData() {}, setError() {}, render() {} };
  const done = page.sandbox.BacklogRoadmap.onClick({ target: startButton() }, ctx, JSON.parse(JSON.stringify(data)));
  await settle(20);
  assert.equal(page.$('#confirm-modal').classList.contains('hidden'), false, 'it asks before starting');
  const out = { title: String(page.$('#confirm-title').textContent), message: String(page.$('#confirm-message').textContent), yes: String(page.$('#btn-confirm-yes').textContent).trim() };
  page.$('#btn-confirm-no').onclick();
  await done;
  assert.equal(page.callsTo('startRoadmap').length, 0, 'cancelled: nothing starts');
  return out;
}

for (const [what, data, stage] of [['Start', START, false], ['Resume', RESUME, false], ['Resume of a stage on its own', RESUME_STAGE, true]]) {
  test(`#70 pt-BR: the confirmation of ${what} reads in Portuguese, the spending warning included`, { timeout: 30000 }, async () => {
    const q = await asked('pt-BR', data);
    assert.equal(ENGLISH.test(`${q.title} ${q.message}`), false, `${q.title} / ${q.message}`);
    assert.match(q.message, SPENDING);
    assert.equal(/^(Start|Resume|Confirm)$/.test(q.yes), false, q.yes);
    if (stage) {
      assert.match(q.title, /\b2\b/);
      assert.match(q.message, /\b2\b/);
    }
  });
}

test('#70 pt-BR: Start and Resume are told apart (title and button)', { timeout: 30000 }, async () => {
  const start = await asked('pt-BR', START);
  const resume = await asked('pt-BR', RESUME);
  assert.notEqual(start.title, resume.title);
  assert.notEqual(start.yes, resume.yes);
  assert.equal(ENGLISH.test(`${start.title} ${resume.title}`), false);
});

test('#70 English unchanged: Start, Resume and Resume stage ask as before', { timeout: 30000 }, async () => {
  assert.deepEqual(await asked('en', START), {
    title: 'Start the roadmap', message: 'Its items run as real runs: they use your CLI subscriptions and cost money. Human gates still wait for you.', yes: 'Start',
  });
  assert.deepEqual(await asked('en', RESUME), {
    title: 'Resume the roadmap', message: 'Runs in progress keep going; the next planned items start as real runs (they use your CLI subscriptions and cost money). Human gates still wait for you.', yes: 'Resume',
  });
  assert.deepEqual(await asked('en', RESUME_STAGE), {
    title: 'Resume stage 2', message: 'Runs in progress keep going; the next planned items of stage 2 start as real runs (they use your CLI subscriptions and cost money). Human gates still wait for you. The roadmap pauses again when that stage is done.', yes: 'Resume',
  });
});
