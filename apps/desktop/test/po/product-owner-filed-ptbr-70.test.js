// #70 acceptance, written before the code: what the Product Owner says after filing a draft
// (packages/engine/domains/po/product-owner.js fileDraft → message.text) reads in the interface language,
// the engine's own (packages/shared/i18n.js, set from settings.language.interface by
// service/areas/interface-language.js, as the notifications read it). The issue's own text is never
// translated (Settings › Issues). `exec` is the platform CLI's boundary: no gh runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const productOwner = require('@craftorio/engine/domains/po/product-owner');

const P = 'demo';
const REPO = 'https://github.com/example/repo';
const DRAFT = { title: 'Export the notes', body: 'The owner exports **every** note.\n\n- [ ] As CSV', labels: ['bug', 'area:ui'], related: [], epic: '#5' };
const EPICS = [{ id: '#5', number: 5, kind: 'issue', title: 'Run reports', url: `${REPO}/issues/5` }];
const ENGLISH = /\bFiled\b|\blocal backlog\b|the repository does not have|left out|Placed in|could not be placed|Commented on|Added to|dated section|description|conversation and the analysis|are kept|nothing was filed|The app would|then place/i;

test.afterEach(() => I18n.setLanguage('en'));

// `labels`: the repository's labels; `fails`: the epic's commands fail
function cli({ labels = ['bug', 'area:ui'], fails = false } = {}) {
  const calls = [];
  const exec = async (_cli, args) => {
    calls.push(args);
    if (args.includes('label') && args.includes('list')) return JSON.stringify(labels.map((name) => ({ name })));
    if (args[0] === 'issue' && args[1] === 'create') return `${REPO}/issues/42\n`;
    if (args[0] === 'issue' && args[1] === 'comment') return `${REPO}/issues/7#issuecomment-1\n`;
    if (args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ number: 7, title: 'T', state: 'open', labels: [], url: `${REPO}/issues/7`, author: null, assignees: [], body: 'Original.', createdAt: 'c', updatedAt: 'u' });
    if (args[0] === 'api') { if (fails) throw new Error('HTTP 403 EPIC-DENIED'); return '990\n'; }
    return '';
  };
  return { exec, calls };
}

async function file(t, language, { exec = cli().exec, action = 'create', preview = false, ...over } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-70-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = '2026-11-25T10:00:00.000Z';
  const message = { ts: at, role: 'po', mode: 'issue', thread: 'po-demo-1', text: 'Here it is.', issue: { draft: DRAFT, existingIssue: 7, addition: 'Also as PDF.' } };
  fs.writeFileSync(path.join(dir, `${P}.po.jsonl`), `${JSON.stringify(message)}\n`);
  I18n.setLanguage(language);
  const runsDir = path.join(dir, 'runs');
  const res = await productOwner.fileDraft({
    backlogDir: dir, projectId: P, runsDir, at, action, number: action === 'create' ? null : 7, preview, platform: 'github', repo: REPO,
    cached: action === 'create' ? null : { number: 7, body: 'Original.', url: `${REPO}/issues/7` }, epicList: EPICS, exec, ...over,
  });
  // the kept folder is a path: out of the text the assertions read
  return { ...res, text: res.message.text.replaceAll(path.join(runsDir, 'po-demo-1'), '<folder>') };
}
const english = (text) => ENGLISH.test(text.replaceAll(DRAFT.title, '').replaceAll('Run reports', '').replace(/`[^`]*`/g, ''));

test('#70 pt-BR: the message after filing on the repository, with its number, link and title', async (t) => {
  const { text } = await file(t, 'pt-BR');
  assert.equal(english(text), false, text);
  assert.equal(text.includes(`[#42](${REPO}/issues/42)`), true, text);
  assert.equal(text.includes(DRAFT.title), true, text);
  assert.equal(text.includes('<folder>'), true, text);
});

test('#70 pt-BR: the message after filing in the local backlog says backlog local', async (t) => {
  const { text, filed } = await file(t, 'pt-BR', { repo: null });
  assert.equal(filed.local, true);
  assert.equal(english(text), false, text);
  assert.match(text, /backlog local/i);
  assert.equal(text.includes(`#${filed.number}`), true, text);
});

test('#70 pt-BR: the labels left out are told in Portuguese, by name', async (t) => {
  const { text, skippedLabels } = await file(t, 'pt-BR', { exec: cli({ labels: ['other'] }).exec });
  assert.deepEqual(skippedLabels, ['bug', 'area:ui']);
  assert.equal(english(text), false, text);
  assert.equal(text.includes('bug, area:ui'), true, text);
});

test('#70 pt-BR: the epic the issue was placed in is told in Portuguese', async (t) => {
  const { text, filed } = await file(t, 'pt-BR', { placeEpic: true });
  assert.equal(filed.epic, '#5');
  assert.equal(english(text), false, text);
  assert.equal(text.includes('#5') && text.includes('Run reports'), true, text);
});

test('#70 pt-BR: an epic the issue could not be placed in is told in Portuguese, with the error', async (t) => {
  const { text, filed } = await file(t, 'pt-BR', { placeEpic: true, exec: cli({ fails: true }).exec });
  assert.equal(filed.epic, undefined);
  assert.equal(english(text), false, text);
  assert.equal(text.includes('EPIC-DENIED'), true, text);
});

for (const action of ['comment', 'append']) {
  test(`#70 pt-BR: the message after the ${action} action reads in Portuguese and links the issue`, async (t) => {
    const { text } = await file(t, 'pt-BR', { action });
    assert.equal(english(text), false, text);
    assert.equal(text.includes('[#7]('), true, text);
  });
}

test('#70 pt-BR: the simulated preview says in Portuguese that nothing was filed, with the command', async (t) => {
  const { text, command } = await file(t, 'pt-BR', { preview: true, placeEpic: true });
  assert.equal(english(text), false, text);
  assert.equal(text.includes(command), true, text);
  assert.equal(text.includes('#5'), true, text);
});

test('#70 the issue itself is filed as drafted, whatever the interface language', async (t) => {
  const { exec, calls } = cli();
  const { body } = await file(t, 'pt-BR', { exec });
  const create = calls.find((a) => a[0] === 'issue' && a[1] === 'create');
  assert.equal(create.includes(DRAFT.title), true);
  assert.equal(body, `${DRAFT.body}\n`);
});

test('#70 English unchanged: filed, labels left out, placed in an epic', async (t) => {
  const { text } = await file(t, 'en', { exec: cli({ labels: ['bug'] }).exec, placeEpic: true });
  assert.equal(text, `Filed [#42](${REPO}/issues/42): Export the notes. Labels the repository does not have were left out: area:ui. Placed in the epic #5 Run reports. The conversation and the analysis are kept in \`<folder>\`.`);
});

test('#70 English unchanged: the local backlog, an epic that failed, a comment and an addition', async (t) => {
  const kept = ' The conversation and the analysis are kept in `<folder>`.';
  const local = await file(t, 'en', { repo: null });
  assert.equal(local.text, `Filed #${local.filed.number} in the local backlog: Export the notes.${kept}`);
  assert.equal((await file(t, 'en', { placeEpic: true, exec: cli({ fails: true }).exec })).text.includes(' It could not be placed in the epic #5: HTTP 403 EPIC-DENIED'), true);
  assert.equal((await file(t, 'en', { action: 'comment' })).text, `Commented on [#7](${REPO}/issues/7#issuecomment-1).${kept}`);
  assert.equal((await file(t, 'en', { action: 'append' })).text, `Added to [#7](${REPO}/issues/7): a dated section at the end of its description, the rest kept as it was.${kept}`);
});
