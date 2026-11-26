// #41 acceptance, written before the code: what the Product Owner says in simulation (packages/engine/domains/po/
// product-owner.js mockIssueAnswer, discardDraft; po-file-issues.js fileDecongest / fileSpec in preview) reads in the
// interface language, the engine's own (packages/shared/i18n.js, set from Settings › language, as #70's filed
// messages read it): "Simulated draft (no model was called, no code was read)…", the clipped title's
// "(21 more characters)", "Preview (simulated): nothing was filed…", "Draft discarded: nothing was filed.".
// English stays as it is. `exec` is the platform CLI's boundary: no gh runs (and a preview calls none).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const I18n = require('@craftorio/shared/i18n');
const productOwner = require('@craftorio/engine/domains/po/product-owner');

const P = 'demo';
const REPO = 'https://github.com/example/repo';
const AT = '2026-11-25T10:00:00.000Z';

test.afterEach(() => I18n.setLanguage('en'));

// a first sentence of 101 characters with its full stop: the draft's title is clipped at 80, 21 left out
const BASE = 'When the owner exports the notes of a project with many runs the export button stays grey';
const LONG = `${BASE} ${'x'.repeat(100 - BASE.length - 1)}`;
const QUESTION = `${LONG}. It should export them as CSV.`;
const draftOf = (lang) => {
  I18n.setLanguage(lang);
  return productOwner.mockIssueAnswer({ data: { issues: [] }, question: QUESTION, previous: [] });
};

test('#41 English unchanged: the simulated draft says "Simulated draft (no model was called, no code was read)" and its title "(21 more characters)"', () => {
  assert.equal(`${LONG}.`.length, 101);
  const a = draftOf('en');
  assert.match(a.reply, /Simulated draft\*\* \(no model was called, no code was read\)/);
  assert.match(a.draft.title, /\(21 more characters\)$/);
});

test('#41 pt-BR: the simulated draft\'s reply and its clipped title are not in English', () => {
  const a = draftOf('pt-BR');
  assert.doesNotMatch(a.reply, /Simulated draft|no model was called|no code was read|Review it below|tell me what to change/);
  assert.doesNotMatch(a.draft.title, /more characters/);
  assert.match(a.draft.title, /\b21\b/, 'the count of characters left out stays');
});

// a conversation with one message, in a scratch backlog folder
function folder(t, message) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-41-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, `${P}.po.jsonl`), `${JSON.stringify(message)}\n`);
  return { backlogDir: dir, projectId: P, runsDir: path.join(dir, 'runs') };
}
const noCli = async () => { throw new Error('a preview runs no CLI'); };
const PLAN = {
  ts: AT, role: 'po', text: 'Here is the plan.',
  answer: { summary: 'Plan', groups: [], decongest: [{ file: 'src/app.js', line: 12, runs: 4, of: 5, fix: 'Split it by screen.' }], spec: { item: 'Notes', issues: [{ title: 'Export the notes', body: 'As CSV.' }] } },
};
const PREVIEWS = [['fileDecongest', { index: 0 }], ['fileSpec', {}]];

for (const [fn, extra] of PREVIEWS) {
  for (const lang of ['en', 'pt-BR']) {
    test(`#41 ${lang}: ${fn}'s preview ${lang === 'en' ? 'says' : 'does not say'} "Preview (simulated): nothing was filed. The app would run"`, async (t) => {
      const where = folder(t, PLAN);
      I18n.setLanguage(lang);
      const res = await productOwner[fn]({ ...where, at: AT, preview: true, platform: 'github', repo: REPO, exec: noCli, ...extra });
      const text = String(res.message.text).replace(/`[^`]*`/g, '');
      if (lang === 'en') assert.match(text, /\*\*Preview\*\* \(simulated\): nothing was filed\. The app would run:/);
      else assert.doesNotMatch(text, /Preview|\(simulated\)|nothing was filed|The app would run/);
    });
  }
}

for (const lang of ['en', 'pt-BR']) {
  test(`#41 ${lang}: a discarded draft ${lang === 'en' ? 'reads' : 'does not read'} "Draft discarded: nothing was filed."`, (t) => {
    const where = folder(t, { ts: AT, role: 'po', mode: 'issue', thread: 'po-demo-1', text: 'Here it is.', issue: { draft: { title: 'Export the notes', body: 'As CSV.', labels: [], related: [] } } });
    I18n.setLanguage(lang);
    const messages = productOwner.discardDraft(where.backlogDir, P, AT, where.runsDir);
    const last = String(messages[messages.length - 1].text);
    if (lang === 'en') assert.equal(last, 'Draft discarded: nothing was filed.');
    else assert.doesNotMatch(last, /Draft discarded|nothing was filed/);
  });
}
