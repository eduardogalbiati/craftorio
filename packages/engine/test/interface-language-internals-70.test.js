// #70 internals: the gates' catalog keys named by the bundled YAML (`translated` filters, label_key, help_key)
// exist in every catalog; the `translated` and `tests_plan_text` filters; a gate record's labels and help in
// the interface language; saved clarity gaps shown in the current language; the suite's reasons.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const I18n = require('@craftorio/shared/i18n');
const productOwner = require('../domains/po/product-owner');
const clarity = require('../domains/discovery/clarity');
const { methods: gates } = require('../engine/run/gates');
const { routedStatus } = require('../engine/suite-no-command');
const { render, testsPlan } = require('../engine/run/templates');

const ROOT = path.join(__dirname, '..', '..', '..');
const catalog = (lang) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packages', 'shared', 'i18n', `${lang}.json`), 'utf8'));
test.afterEach(() => I18n.setLanguage('en'));

test('#70 every catalog has the keys the bundled gates name', () => {
  const texts = ['workflows/feature.yaml', 'fragments/dev-pipeline.yaml'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const keys = [...texts.matchAll(/translated\('([\w.]+)'|(?:label_key|help_key): "?(engine\.\w+)/g)].map((m) => m[1] || m[2]);
  assert.equal(keys.length > 30, true, String(keys.length));
  for (const lang of I18n.languages()) {
    const cat = catalog(lang);
    assert.deepEqual([...keys, 'engine.test_failed_continue_help_no_tests'].filter((k) => !(k in cat)), [], lang);
  }
});

test('#70 translated: the YAML text in English, the key with its params in pt-BR, the YAML text without a key', () => {
  const tpl = "{% filter translated('engine.test_failed_healer', { summary: s }) %}The healer said {{ s }}{% endfilter %}";
  const unknown = "{% filter translated('engine.no_such_key') %}Kept {{ s }}{% endfilter %}";
  assert.equal(render(tpl, { s: 'ok' }), 'The healer said ok');
  I18n.setLanguage('pt-BR');
  assert.equal(render(tpl, { s: 'ok' }), 'O reparador: ok');
  assert.equal(render(tpl, {}), 'O reparador: ', 'a missing value never shows its {placeholder}');
  assert.equal(render(unknown, { s: 'x' }), 'Kept x');
});

test('#70 tests_plan_text: as written in English, the items in pt-BR, the text without items', () => {
  const defs = { unit_tests: { default: 'write_and_run', label: 'Unit tests', options: { off: 'Off', write_and_run: 'Write and run' } } };
  const items = testsPlan(defs, { unit_tests: 'off' }, { unit_tests: 'off' });
  const shown = (ctx) => render('{{ tests_plan | tests_plan_text(tests_plan_items) }}', { tests_plan: 'Unit tests: Off (chosen for this run).', ...ctx });
  assert.equal(shown({ tests_plan_items: items }), 'Unit tests: Off (chosen for this run).');
  I18n.setLanguage('pt-BR');
  assert.equal(shown({ tests_plan_items: items }), 'Testes unitários: Desligado (escolhido para esta run).');
  assert.equal(shown({}), 'Unit tests: Off (chosen for this run).');
  const byDefault = testsPlan(defs, {}, { unit_tests: 'write_and_run' });
  assert.equal(shown({ tests_plan_items: byDefault }), 'Testes unitários: Escrever e rodar (padrão do workflow).');
});

function record(step) {
  const events = [];
  const run = {
    ...gates, pausing: false, nApproval: 0, inputs: {}, approvals: new Map(), orchestrator: {}, issues: [], localPreview: null, ctx: { inputs: {}, vars: {}, steps: {}, bare: true },
    emitEvent: (type, payload) => events.push({ type, payload }), syncGateClock() {}, setStatus() {}, resolveApproval() {},
  };
  run.requestApproval(step).catch(() => {});
  return events.find((e) => e.type === 'approval.requested').payload;
}

test('#70 a gate record reads in the interface language: labels, a templated help_key, the recommendation, Approve / Reject', () => {
  const stop = { id: 'stop', label: 'Stop the run', label_key: 'engine.test_failed_stop', help: 'English.', help_key: 'engine.test_failed_continue_help{% if bare %}_no_tests{% endif %}' };
  const choices = { id: 'g', type: 'human_approval', message: 'm', recommend: 'stop: why', choices: [stop, { id: 'own', label: 'Own label' }] };
  const en = record(choices);
  assert.deepEqual([en.choices[0].label, en.choices[0].help, en.choices[0].help_key], ['Stop the run', 'English.', 'engine.test_failed_continue_help_no_tests']);
  assert.equal(record({ id: 'g', type: 'human_approval', message: 'm' }).approve.label, 'Approve');
  I18n.setLanguage('pt-BR');
  const pt = record(choices);
  assert.deepEqual([pt.choices[0].label, pt.choices[1].label, pt.brief.recommendation.label], ['Parar a run', 'Own label', 'Parar a run']);
  assert.match(pt.choices[0].help, /o projeto não tem testes/);
  const yesNo = record({ id: 'g', type: 'human_approval', message: 'm' });
  assert.deepEqual([yesNo.approve.label, yesNo.reject.label], ['Aprovar', 'Rejeitar']);
  assert.equal(record({ id: 'g', type: 'human_approval', message: 'm', approve_label: 'Merge it' }).approve.label, 'Merge it');
});

test('#70 saved gaps of the rubric read in the current language, another scorer\'s stay as they are', () => {
  const card = { type: 'bug', document: '', acceptance: '' };
  const en = clarity.scoreClarity(card).gaps;
  I18n.setLanguage('pt-BR');
  const pt = clarity.scoreClarity(card).gaps;
  assert.notDeepEqual(pt, en);
  assert.deepEqual(clarity.gapsShown([...en, 'Own gap', { text: 'x' }]), [...pt, 'Own gap', { text: 'x' }]);
  I18n.setLanguage('en');
  assert.deepEqual(clarity.gapsShown(pt), en);
  assert.equal(clarity.gapsShown(undefined), undefined);
});

test('#70 a not_run suite routed as blocked says it in the interface language', () => {
  I18n.setLanguage('pt-BR');
  const out = routedStatus({ status: 'not_run', reason: I18n.t('engine.suite_no_tests') }, { transitions: [] });
  assert.equal(out.status, 'blocked');
  assert.match(out.message, /^A suíte não pôde rodar: não há comando de teste: .*test_command.*o projeto não tem testes/);
});

// the acceptance test replaces the kept folder in the text but not in `command`, which names it too
test('#70 the preview message in pt-BR carries the whole command, the kept folder included, and the epic; a local one says backlog local', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-70-internals-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = '2026-11-25T10:00:00.000Z';
  const draft = { title: 'Export', body: 'b', labels: [], related: [], epic: '#5' };
  fs.writeFileSync(path.join(dir, 'demo.po.jsonl'), `${JSON.stringify({ ts: at, role: 'po', mode: 'issue', thread: 'po-demo-1', text: 'x', issue: { draft } })}\n`);
  I18n.setLanguage('pt-BR');
  const preview = (repo) => productOwner.fileDraft({
    backlogDir: dir, projectId: 'demo', runsDir: path.join(dir, 'runs'), at, action: 'create', number: null, preview: true, platform: 'github', repo,
    epicList: [{ id: '#5', number: 5, kind: 'issue', title: 'Run reports', url: 'u' }], placeEpic: true, exec: async () => '',
  });
  const remote = await preview('https://github.com/example/repo');
  assert.equal(remote.message.text, `**Prévia** (simulada): nada foi registrado. O app rodaria \`${remote.command}\` e depois colocaria a issue no epic #5 Run reports.`);
  const local = await preview(null);
  assert.match(local.message.text, /^\*\*Prévia\*\* .*backlog local.*#5 Run reports\.$/);
  I18n.setLanguage('en');
  assert.equal((await preview(null)).message.text, `**Preview** (simulated): nothing was filed. The app would ${local.command}, then place the issue in the epic #5 Run reports.`);
});
