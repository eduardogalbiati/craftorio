// Screenshot seed of the Documents screen (--view docs, #647): a git repository for the demo project
// with three work items written through the Documents service (fronts/plan/engine/domains/docs.js),
// so each request is its own commit:
// - write-doc: an accepted intent and a draft spec with three requests (one undone);
// - offline-mode: a draft intent, still the skeleton but for its Problem;
// - keyboard-shortcuts-for-the-run-log-and-the-command-palette (a long name): a signed-off spec.
// --mode list (default): the list; editor: write-doc's spec in the editor; changes: the same with
// the changes by request in view; review: the spec with a simulated reviewer's anchored notes and the
// Sign off spec gate (DocsActions.follow); sign-off: the signed-off spec offering Create epic and
// phase issues and Start the Build.

const fs = require('fs');
const path = require('path');

const LONG = 'keyboard-shortcuts-for-the-run-log-and-the-command-palette';

// Swaps the block under a heading (the skeleton's "To be written" line) in both languages: one commit.
function fill(docs, DocModel, dir, item, doc, heading, en, pt, request) {
  const now = docs.readDoc(dir, { item, doc });
  const after = (md, i) => DocModel.blocks(md)[i + 1];
  const index = DocModel.blocks(now.source.markdown).findIndex((b) => b.heading === heading);
  const src = after(now.source.markdown, index);
  const tr = after(now.translation.markdown, index);
  return docs.applyRequest(dir, {
    item, doc, messageId: `seed-${item}-${doc}-${index}`, request,
    source: { lines: { start: src.start, end: src.end }, text: en },
    translation: { lines: { start: tr.start, end: tr.end }, text: pt },
  });
}

function demoDocs(appDir, dir) {
  const docs = require(path.join(appDir, 'fronts', 'plan', 'engine', 'domains', 'docs'));
  const DocModel = require(path.join(appDir, 'packages', 'shared', 'doc-model'));
  const f = (...a) => fill(docs, DocModel, dir, ...a);

  docs.createDoc(dir, { item: 'write-doc', doc: 'intent', title: 'Write doc' });
  f('write-doc', 'intent', 'Problem', 'Stage documents are written by hand in an editor, far from the app that runs the work.', 'Os documentos de estágio são escritos à mão num editor, longe do app que roda o trabalho.', 'State the problem');
  docs.acceptDoc(dir, { item: 'write-doc', doc: 'intent', approver: 'maintainer' });
  docs.createDoc(dir, { item: 'write-doc', doc: 'spec', title: 'Write doc' });
  f('write-doc', 'spec', 'Requirements', '**R1.** The Documents screen lists the items of docs/work/ with their stage.', '**R1.** A tela Documentos lista os itens de docs/work/ com o estágio.', 'List the items first');
  const wrong = f('write-doc', 'spec', 'Design', 'A separate editor window.', 'Uma janela de editor separada.', 'Describe the editor');
  docs.undoChange(dir, { commit: wrong.commit });
  f('write-doc', 'spec', 'Areas of concern', 'The translation must keep the headings in the same order as the source.', 'A tradução precisa manter os títulos na mesma ordem do original.', 'Name the translation risk');

  docs.createDoc(dir, { item: 'offline-mode', doc: 'intent', title: 'Offline mode' });
  f('offline-mode', 'intent', 'Problem', 'Without a network the app cannot start a run, even a simulated one.', 'Sem rede o app não inicia uma execução, nem simulada.', 'Say what breaks offline');

  docs.createDoc(dir, { item: LONG, doc: 'intent', title: 'Keyboard shortcuts' });
  docs.acceptDoc(dir, { item: LONG, doc: 'intent', approver: 'maintainer' });
  docs.createDoc(dir, { item: LONG, doc: 'spec', title: 'Keyboard shortcuts' });
  f(LONG, 'spec', 'Requirements', '**R1.** Ctrl+K opens the command palette on every screen.', '**R1.** Ctrl+K abre a paleta de comandos em toda tela.', 'Start with the palette');
  docs.acceptDoc(dir, { item: LONG, doc: 'spec', approver: 'maintainer' });
}

function seed({ appDir, project, projects, ws }) {
  const dir = path.join(path.dirname(ws.projects), 'repos', 'demo-app');
  fs.mkdirSync(dir, { recursive: true });
  projects.updateProject(ws.projects, project.id, { folder: dir });
  demoDocs(appDir, dir);
}

// the editor's states are opened from the page (DocsActions, views/docs/docs.js)
async function open({ args, click, js, pause }) {
  const mode = args.mode || 'list';
  await click('.nav-item[data-view="docs"]');
  await pause(800);
  if (mode === 'list') return;
  const item = mode === 'sign-off' ? LONG : 'write-doc';
  await js(`await window.DocsActions.openDoc(${JSON.stringify(item)}, 'spec');`);
  if (mode === 'changes') await js('document.querySelector(\'[data-testid="doc-changes"]\')?.scrollIntoView();');
  if (mode === 'review') {
    await js(`await window.DocsActions.follow('demo-write-doc-run', [
      { type: 'step.finished', step_id: 'review', output: { score: 7, summary: 'Clear requirements; the design is missing.', notes: [
        { anchor: 'spec-design', severity: 'major', text: 'The design section is still empty: say where the editor lives.' },
        { anchor: 'spec-requirements', severity: 'minor', text: 'R1 could name the stage values.' },
      ] } },
      { type: 'approval.requested', approval_id: 'a1', step_id: 'approval', message: 'The reviewer scored the spec 7/10: clear requirements; the design is missing.', choices: [{ id: 'accept' }, { id: 'revise' }, { id: 'stop' }] },
    ]);`);
  }
  await pause(800);
}

module.exports = {
  modes: ['list', 'editor', 'changes', 'review', 'sign-off'],
  open,
  seed,
};
