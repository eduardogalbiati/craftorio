// #23 acceptance, written before the code: the Oracle panel (fronts/ai/views/oracle/oracle.js) in pt-BR shows no
// English text: its header's "Night watch" button, the four starter questions of an empty conversation and the
// budget line under the text box ("Today $0.00 of $20.00 daily budget. Each message is one call to the model.").
// The real page (packages/ui-kit/test/agent-chat-page-harness.js), the language applied the way Settings applies it
// (InterfaceLanguage.apply), then the drawer opened as renderer-status-labels-266.test.js opens it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('@craftorio/ui-kit/test/agent-chat-page-harness');

const ENGLISH = [
  'Night watch',
  'What happened overnight?',
  'Which runs failed this week, and why?',
  'Where do my tokens go?',
  'What should I work on next?',
  'daily budget',
  'Today $0.00 of $20.00',
  'Each message is one call to the model.',
  // the harness runs simulated (developer mode): the line's other ending, English today too
  'Simulated (developer mode)',
];
const SERVICE = { model: 'claude-opus-5-5', today: { spentUsd: 0, limitUsd: 20 } };

async function openOracleIn(lang) {
  const page = await loadPage({ api: { oracleHistory: async () => [], oracleState: async () => ({ ...SERVICE }) } });
  page.sandbox.InterfaceLanguage.apply({ language: { interface: lang } });
  await settle();
  page.run("state.view = 'workflows'");
  page.sandbox.OracleChat.open();
  await settle();
  const drawer = page.$('#oracle-drawer');
  assert.ok(drawer, 'the drawer is drawn');
  const text = (el) => String(el?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return {
    page,
    drawer: text(drawer),
    chips: Array.from(drawer.querySelectorAll('[data-oracle-q]')).map(text),
    night: text(drawer.querySelector('[data-oracle-night]')),
    foot: text(page.$('#oracle-foot-drawer')),
  };
}

test('#23 Oracle panel in pt-BR: none of today\'s English strings shows', { timeout: 30000 }, async () => {
  const o = await openOracleIn('pt-BR');
  assert.ok(o.drawer, 'the drawer has text');
  const found = ENGLISH.filter((s) => o.drawer.includes(s));
  assert.deepEqual(found, [], `English text in the Oracle panel: ${o.drawer}`);
});

test('#23 Oracle panel in pt-BR: the header\'s Night watch button is in Portuguese', { timeout: 30000 }, async () => {
  const o = await openOracleIn('pt-BR');
  assert.ok(o.night, 'the button has a label');
  assert.notEqual(o.night, 'Night watch');
});

test('#23 Oracle panel in pt-BR: the Night watch form opened from the header reads in Portuguese', { timeout: 30000 }, async () => {
  const o = await openOracleIn('pt-BR');
  o.page.$('#oracle-drawer [data-oracle-night]').click();
  await settle();
  const form = o.page.$('#oracle-drawer [data-oracle-night-form]');
  assert.equal(form === null, false, 'the form opens');
  const formText = String(form.textContent ?? '').replace(/\s+/g, ' ').trim();
  assert.match(formText, /Vigília noturna até/, formText);
  assert.equal(/Night watch/i.test(formText), false, formText);
});

test('#23 Oracle panel in pt-BR: four starter questions, none in English', { timeout: 30000 }, async () => {
  const o = await openOracleIn('pt-BR');
  assert.equal(o.chips.length, 4, JSON.stringify(o.chips));
  assert.deepEqual(o.chips.filter((c) => ENGLISH.includes(c)), [], JSON.stringify(o.chips));
});

test('#23 Oracle panel in pt-BR: the budget line is in Portuguese', { timeout: 30000 }, async () => {
  const o = await openOracleIn('pt-BR');
  assert.ok(o.foot, 'the budget line is shown');
  for (const s of ['Today', 'daily budget', 'Each message is one call to the model', 'Simulated (developer mode)', 'no model is called']) assert.equal(o.foot.includes(s), false, `"${s}" in "${o.foot}"`);
});

test('#23 guard: Oracle panel in English keeps its starter questions and budget line', { timeout: 30000 }, async () => {
  const o = await openOracleIn('en');
  assert.deepEqual(o.chips, ['What happened overnight?', 'Which runs failed this week, and why?', 'Where do my tokens go?', 'What should I work on next?']);
  assert.match(o.foot, /^Today \$0\.00 of \$20\.00 daily budget\. /);
});
