// #70 acceptance, written before the code: filing a Product Owner's draft for real asks first
// (fronts/build/views/backlog/backlog-po.js, the confirm modal of packages/ui-kit/app.js), and that
// question read in English in the pt-BR interface. Also: with "Create + roadmap" it says the issue goes
// to the roadmap too; for a project with no remote (`repo: null`, #35) it says the issue goes to the
// local backlog; and the heading over the issues that are only related never reads "close" ("Fechar").
//
// The whole page (./backlog-po-785-harness.js) with real runs on (simulationOnly off, developer mode
// off: the modal opens). The wording of the translation is the developer's: only facts are asserted.
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDrawer, click, plain, settle, textOf } = require('./backlog-po-785-harness');

const TITLE = 'Exportar as notas em CSV';
const REMOTE = { id: 'demo', name: 'Demo project', repo: 'https://github.com/o/demo.git' };
const LOCAL = { id: 'demo', name: 'Demo project', repo: null };
// #7: the issue the draft's `addition` is for; #8: a close one, which gets the whole draft
const ISSUE = {
  draft: { title: TITLE, body: 'Como dono, quero exportar.', labels: [], related: [] },
  existingIssue: 7,
  addition: 'Exportar também em PDF.',
  duplicates: [{ number: 8, relation: 'overlaps', title: 'Baixar as notas', state: 'open' }],
};
const HISTORY = [{ role: 'po', mode: 'issue', ts: '2026-11-25T10:00:00.000Z', text: 'Aqui está.', issue: ISSUE }];
const ENGLISH = /Create the issue|It is filed|as shown|project's repository|local backlog|\bAdd to\b|Comment on|is appended|is added|dated section|description|the rest of it|\bdraft\b|\baddition\b|\bThe\b/i;

async function drawer(language, project = REMOTE) {
  const page = await openDrawer({
    history: HISTORY,
    api: {
      appInfo: () => ({ simulationOnly: false }),
      getSettings: () => ({ developerMode: false }),
      listProjects: async () => [plain(project)],
    },
  });
  page.sandbox.BacklogActions.project = () => plain(project);
  page.sandbox.I18n.setLanguage(language);
  return page;
}

// what the modal asks after a click on the draft's `act` (then cancelled: nothing is filed)
async function asked(page, act, n = null) {
  const sel = `#po-drawer [data-po-act="${act}"]${n ? `[data-n="${n}"]` : ''}`;
  await click(page, page.$(sel), sel);
  assert.equal(page.$('#confirm-modal').classList.contains('hidden'), false, `${act} asks before filing`);
  const text = (s) => String(page.$(s).textContent);
  const out = { title: text('#confirm-title'), message: text('#confirm-message'), yes: text('#btn-confirm-yes').trim() };
  page.$('#btn-confirm-no').onclick();
  await settle(10);
  assert.equal(page.callsTo('fileProductOwnerDraft').length, 0, 'cancelled: nothing is filed');
  return out;
}

const relatedHeading = (page) => {
  const list = page.$('#po-drawer').querySelectorAll('.po-sec').find((s) => /#8/.test(textOf(s)) && s.querySelector('.sup-h') && /Baixar as notas/.test(textOf(s)));
  assert.equal(!!list, true, 'the related issues are listed');
  return textOf(list.querySelector('.sup-h')).trim();
};

for (const act of ['create', 'create-roadmap', 'create-assign']) {
  test(`#70 pt-BR: the confirmation of ${act} has no English and names the issue`, { timeout: 30000 }, async () => {
    const q = await asked(await drawer('pt-BR'), act);
    assert.equal(ENGLISH.test(`${q.title} ${q.message}`.replace(TITLE, '')), false, `${q.title} / ${q.message}`);
    assert.equal(q.title.includes(TITLE), true, q.title);
    assert.notEqual(q.message.trim(), '');
    assert.equal(/^(Create|Confirm)\b/.test(q.yes), false, q.yes);
  });
}

for (const [act, n] of [['append', 7], ['append', 8], ['comment', 7], ['comment', 8]]) {
  test(`#70 pt-BR: the confirmation of ${act} on #${n} has no English and names the issue`, { timeout: 30000 }, async () => {
    const q = await asked(await drawer('pt-BR'), act, n);
    assert.equal(ENGLISH.test(`${q.title} ${q.message}`), false, `${q.title} / ${q.message}`);
    assert.equal(q.title.includes(`#${n}`), true, q.title);
    assert.notEqual(q.message.trim(), '');
    assert.equal(/^(Add|Comment|Confirm)$/.test(q.yes), false, q.yes);
  });
}

test('#70 pt-BR: the addition and the whole draft are told apart when added to an issue', { timeout: 30000 }, async () => {
  const page = await drawer('pt-BR');
  const addition = await asked(page, 'append', 7);
  const draft = await asked(page, 'append', 8);
  assert.notEqual(addition.message.replaceAll('#7', '#n'), draft.message.replaceAll('#8', '#n'));
});

for (const [language, project, what] of [['en', REMOTE, 'a remote project'], ['pt-BR', REMOTE, 'a remote project'], ['en', LOCAL, 'a local project'], ['pt-BR', LOCAL, 'a local project']]) {
  test(`#70 ${language}: Create + roadmap on ${what} says the issue also goes to the roadmap, Create does not`, { timeout: 30000 }, async () => {
    const page = await drawer(language, project);
    assert.match((await asked(page, 'create-roadmap')).message, /roadmap/i);
    assert.doesNotMatch((await asked(page, 'create')).message, /roadmap/i);
  });
}

for (const [language, local, remote] of [['en', /local backlog/i, /project's repository/i], ['pt-BR', /backlog local/i, /repositório do projeto/i]]) {
  for (const act of ['create', 'create-roadmap', 'create-assign']) {
    test(`#70 ${language}: ${act} on a project with no remote says the issue goes to the local backlog`, { timeout: 30000 }, async () => {
      const { message } = await asked(await drawer(language, LOCAL), act);
      assert.match(message, local);
      assert.doesNotMatch(message, remote);
    });
  }

  test(`#70 ${language}: create on a project with a remote does not say local backlog`, { timeout: 30000 }, async () => {
    assert.doesNotMatch((await asked(await drawer(language), 'create')).message, local);
  });
}

test('#70 English unchanged: create, append and comment ask as before', { timeout: 30000 }, async () => {
  const page = await drawer('en');
  assert.deepEqual(await asked(page, 'create'), { title: `Create the issue “${TITLE}”`, message: 'It is filed on the project\'s repository as shown.', yes: 'Create' });
  assert.deepEqual(await asked(page, 'append', 7), { title: 'Add to #7', message: 'The addition is appended to #7\'s description as a dated section; the rest of it is kept.', yes: 'Add' });
  assert.deepEqual(await asked(page, 'comment', 8), { title: 'Comment on #8', message: 'The draft is added as a comment on #8.', yes: 'Comment' });
});

test('#70 en: the heading over the related issues says related or similar, never close', { timeout: 30000 }, async () => {
  const heading = relatedHeading(await openDrawer({ history: HISTORY }));
  assert.match(heading, /related|similar/i);
  assert.doesNotMatch(heading, /\bclose\b/i);
});

test('#70 pt-BR: the heading over the related issues says related or similar, never "Fechar"', { timeout: 30000 }, async () => {
  const page = await openDrawer({ history: HISTORY, language: 'pt-BR' });
  const heading = relatedHeading(page);
  assert.match(heading, /relacionad|semelhant|similar|parecid/i);
  assert.doesNotMatch(heading, /fechar/i);
});
