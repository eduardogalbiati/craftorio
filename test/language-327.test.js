// #327 / #328 acceptance tests (written before the code): the pure module src/shared/language.js
// (UMD like src/shared/time-zone.js: module.exports in Node, window.Language in the browser). It holds
// the language list of Settings › General › Language, what the AI agents and the issues settings
// resolve to, the one [Language] line every agent turn gets, and the issue headings the app writes
// itself in each supported language. The module does not exist yet: it is required inside each test.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { taskProgress } = require('../src/domains/backlog/issues');

const load = () => require('../src/shared/language');
const PT = { language: { agents: 'pt-BR' } };

test('#327 LANGUAGES lists the nine languages, in order, with their own names', () => {
  const { LANGUAGES } = load();
  assert.deepEqual(LANGUAGES.map((l) => [l.code, l.label]), [
    ['en', 'English'],
    ['pt-BR', 'Português (Brasil)'],
    ['es', 'Español'],
    ['fr', 'Français'],
    ['de', 'Deutsch'],
    ['it', 'Italiano'],
    ['ja', '日本語'],
    ['zh', '中文'],
    ['ko', '한국어'],
  ]);
});

test('#327 the AI agents select\'s default value is "interface"', () => {
  assert.equal(load().SAME_AS_INTERFACE, 'interface');
});

test('#327 agentsLanguage: unset, "Same as the interface" and an unknown code are English; a known code is kept', () => {
  const { agentsLanguage } = load();
  assert.equal(agentsLanguage(undefined), 'en');
  assert.equal(agentsLanguage({}), 'en');
  assert.equal(agentsLanguage({ language: {} }), 'en');
  assert.equal(agentsLanguage({ language: { agents: 'interface' } }), 'en');
  assert.equal(agentsLanguage({ language: { agents: 'xx' } }), 'en');
  assert.equal(agentsLanguage(PT), 'pt-BR');
  assert.equal(agentsLanguage({ language: { agents: 'ja' } }), 'ja');
});

test('#328 issuesLanguage: unset or unknown is English; a known code is kept; the agents setting does not leak into it', () => {
  const { issuesLanguage } = load();
  assert.equal(issuesLanguage(undefined), 'en');
  assert.equal(issuesLanguage({}), 'en');
  assert.equal(issuesLanguage({ language: { issues: 'xx' } }), 'en');
  assert.equal(issuesLanguage({ language: { issues: 'pt-BR' } }), 'pt-BR');
  assert.equal(issuesLanguage(PT), 'en');
});

test('#327 labelOf: a code\'s label; English for an unknown code', () => {
  const { labelOf } = load();
  assert.equal(labelOf('pt-BR'), 'Português (Brasil)');
  assert.equal(labelOf('ja'), '日本語');
  assert.equal(labelOf('xx'), 'English');
});

test('#327 languageLine is one line starting with [Language] that names the agents language', () => {
  const line = load().languageLine(PT);
  assert.equal(typeof line, 'string');
  assert.ok(line.startsWith('[Language]'), line);
  assert.equal(line.includes('\n'), false, 'a single line');
  assert.ok(line.includes('Português (Brasil)'), line);
});

test('#327 languageLine says JSON keys and enum values stay as the schema names them', () => {
  const line = load().languageLine(PT);
  assert.match(line, /JSON keys/i);
  assert.match(line, /enum values/i);
  assert.match(line, /schema/i);
});

test('#328 languageLine names the issues language, and closing keywords stay English (Closes #n)', () => {
  const line = load().languageLine({ language: { agents: 'pt-BR', issues: 'es' } });
  assert.ok(line.includes('Español'), line);
  assert.ok(line.includes('Closes #'), line);
});

test('#327 languageLine is identical on two calls with the same settings', () => {
  const { languageLine } = load();
  assert.equal(languageLine({ language: { agents: 'pt-BR', issues: 'en' } }), languageLine({ language: { agents: 'pt-BR', issues: 'en' } }));
});

test('#327 languageLine with nothing set names English and no other language', () => {
  const { languageLine, LANGUAGES } = load();
  const line = languageLine({});
  assert.ok(line.startsWith('[Language]'));
  assert.ok(line.includes('English'), line);
  for (const l of LANGUAGES.filter((x) => x.code !== 'en')) assert.equal(line.includes(l.label), false, `${l.label} in: ${line}`);
  assert.equal(languageLine(undefined), line);
});

test('#328 issueHeadings: English and Português (Brasil) headings for tasks, related issues and decisions', () => {
  const { issueHeadings } = load();
  const en = issueHeadings('en');
  assert.deepEqual([en.tasks, en.related, en.decision], ['## Tasks', 'Related:', 'Decision (owner):']);
  const pt = issueHeadings('pt-BR');
  assert.deepEqual([pt.tasks, pt.related, pt.decision], ['## Tarefas', 'Relacionadas:', 'Decisão (owner):']);
});

test('#328 issueHeadings: an unknown or missing code gets the English headings', () => {
  const { issueHeadings } = load();
  assert.deepEqual(issueHeadings('xx'), issueHeadings('en'));
  assert.deepEqual(issueHeadings(undefined), issueHeadings('en'));
});

test('#328 a body with the pt-BR tasks heading keeps "- [ ]" / "- [x]": taskProgress still counts it', () => {
  const h = load().issueHeadings('pt-BR');
  const body = `${h.tasks}\n\n- [ ] Primeira tarefa\n- [x] Segunda tarefa\n- [ ] Testes\n\n${h.related} #12`;
  assert.deepEqual(taskProgress(body), { done: 1, total: 3 });
});

test('#327 in the browser the module is window.Language', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'language.js'), 'utf8');
  const sandbox = {};
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  assert.equal(typeof sandbox.Language?.languageLine, 'function');
  assert.equal(sandbox.Language.LANGUAGES.length, 9);
});
