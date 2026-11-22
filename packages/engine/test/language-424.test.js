// #424 acceptance tests (written before the code): "Same as the interface" (settings.language.agents
// unset or 'interface') resolves to the language the interface resolves to, I18n.resolveLanguage(
// settings.language.interface, <the computer's language>) (packages/shared/i18n.js): the saved interface
// language, else the computer's when it has a catalog (en, pt-BR), else English. Today agentsLanguage
// (packages/shared/language.js) gives English while the interface is unset.
// The computer's language reaches the service as host.locale; the service area
// packages/engine/service/areas/interface-language.js applies the interface language from it. These tests go
// through that seam (the area with a host whose locale is set, or the whole service from
// test/service/helpers.js), then call agentsLanguage / languageLine with the settings unchanged.
// After each test the area is applied again with an English host, so no other test sees pt-BR.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeService } = require('./service/helpers');

const load = () => require('@craftorio/shared/language');
const I18n = () => require('@craftorio/shared/i18n');
const area = (locale) => require('../service/areas/interface-language')({ events: { on() {} }, host: { locale } });
// the computer's language is `locale`, nothing saved for the interface
const onComputer = (locale, settings = {}) => area(locale).applyInterfaceLanguage(settings);

const ENGLISH_LINE = '[Language] English: prose, issues, PRs and commits.';

test.afterEach(() => {
  onComputer('en-US');
  I18n().setLanguage('en');
});

test('#424 interface unset, computer in pt-BR: "Same as the interface" resolves to pt-BR', () => {
  onComputer('pt-BR');
  const { agentsLanguage } = load();
  assert.equal(agentsLanguage({}), 'pt-BR');
  assert.equal(agentsLanguage(undefined), 'pt-BR');
  assert.equal(agentsLanguage({ language: {} }), 'pt-BR');
  assert.equal(agentsLanguage({ language: { agents: 'interface' } }), 'pt-BR');
  assert.equal(agentsLanguage({ language: { agents: 'interface', issues: 'en' } }), 'pt-BR');
});

test('#424 interface unset, computer in "pt" (its base language): the pt-BR catalog, so pt-BR', () => {
  onComputer('pt');
  assert.equal(load().agentsLanguage({ language: { agents: 'interface' } }), 'pt-BR');
});

test('#424 interface unset, computer in pt-BR: the [Language] line is the Portuguese one', () => {
  onComputer('pt-BR');
  const { languageLine } = load();
  const line = languageLine({});
  assert.equal(line, languageLine({ language: { agents: 'pt-BR', issues: 'en' } }));
  assert.ok(line.includes('Português (Brasil)'), line);
  assert.notEqual(line, ENGLISH_LINE);
  assert.equal(languageLine({ language: { agents: 'interface' } }), line);
});

test('#424 interface unset, computer in sv (no catalog): English, the short line exactly', () => {
  onComputer('sv');
  const { agentsLanguage, languageLine } = load();
  assert.equal(agentsLanguage({}), 'en');
  assert.equal(agentsLanguage({ language: { agents: 'interface' } }), 'en');
  assert.equal(languageLine({}), ENGLISH_LINE);
});

test('#424 an explicit agents language is kept whatever the computer\'s language', () => {
  onComputer('pt-BR');
  const { agentsLanguage } = load();
  assert.equal(agentsLanguage({ language: { agents: 'es' } }), 'es');
  assert.equal(agentsLanguage({ language: { agents: 'en' } }), 'en');
  assert.equal(load().languageLine({ language: { agents: 'en' } }), ENGLISH_LINE);
});

test('#424 an explicit interface language wins over the computer\'s language', () => {
  const settings = { language: { agents: 'interface', interface: 'en' } };
  onComputer('pt-BR', settings);
  const { agentsLanguage, languageLine } = load();
  assert.equal(agentsLanguage(settings), 'en');
  assert.equal(languageLine(settings), ENGLISH_LINE);
  assert.equal(agentsLanguage({ language: { interface: 'pt-BR' } }), 'pt-BR');
});

test('#424 issuesLanguage stays English by default with the computer in pt-BR', () => {
  onComputer('pt-BR');
  const { issuesLanguage, languageLine } = load();
  assert.equal(issuesLanguage({}), 'en');
  assert.equal(issuesLanguage({ language: { agents: 'interface' } }), 'en');
  assert.match(languageLine({}), /commit messages in English\./);
});

test('#424 the computer back in English: "Same as the interface" is English again (nothing kept from before)', () => {
  onComputer('pt-BR');
  onComputer('en-US');
  assert.equal(load().agentsLanguage({}), 'en');
  assert.equal(load().languageLine({}), ENGLISH_LINE);
});

test('#424 a service whose host\'s locale is pt-BR: once the workspace opens, "Same as the interface" is pt-BR', (t) => {
  makeService(t, { locale: 'pt-BR' });
  assert.equal(load().agentsLanguage({ language: { agents: 'interface' } }), 'pt-BR');
});

test('#424 a service whose host has no locale: English', (t) => {
  makeService(t);
  assert.equal(load().agentsLanguage({}), 'en');
  assert.equal(load().languageLine({}), ENGLISH_LINE);
});
