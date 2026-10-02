// src/renderer/views/settings/settings.js: Settings › Execution › Oracle (#122), the daily budget
// (0 = no cap) and the compaction threshold. It runs only inside the Electron renderer (document,
// window.api), so renderOracleSettings/saveOracleSettings are pulled out of the source and
// evaluated in a sandbox, the way test/renderer-run-view.test.js checks app.js as a seam.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'views', 'settings', 'settings.js'), 'utf8');

// A fake <input>: .value stringifies on set, like a real DOM element.
function input(initial = '') {
  let v = String(initial);
  return { get value() { return v; }, set value(x) { v = String(x); } };
}

function loadOracleSettings({ oracle } = {}) {
  const render = /function renderOracleSettings\(\) \{[\s\S]*?\n\}/.exec(src)[0];
  const save = /async function saveOracleSettings\(\) \{[\s\S]*?\n\}/.exec(src)[0];
  assert.ok(render && save, 'renderOracleSettings/saveOracleSettings not found in settings.js: the source moved');

  const setSettingsCalls = [];
  const els = { '#set-oracle-budget': input(), '#set-oracle-compact': input() };
  const sandbox = {
    $: (sel) => els[sel] || null,
    state: { settings: { oracle } },
    api: {
      setSettings: async (patch) => {
        setSettingsCalls.push(patch);
        sandbox.state.settings = { ...sandbox.state.settings, ...patch };
        return sandbox.state.settings;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(`${render}\n${save}\nthis.renderOracleSettings = renderOracleSettings;\nthis.saveOracleSettings = saveOracleSettings;`, sandbox);
  return { renderOracleSettings: sandbox.renderOracleSettings, saveOracleSettings: sandbox.saveOracleSettings, els, setSettingsCalls, state: sandbox.state };
}

test('renderOracleSettings: fills the budget and compaction fields from state.settings.oracle', () => {
  const { renderOracleSettings, els } = loadOracleSettings({ oracle: { dailyBudgetUsd: 5, compactAtTokens: 200000 } });
  renderOracleSettings();
  assert.equal(els['#set-oracle-budget'].value, '5');
  assert.equal(els['#set-oracle-compact'].value, '200000');
});

test('renderOracleSettings: falls back to 20 / 150000 when settings.oracle is missing', () => {
  const { renderOracleSettings, els } = loadOracleSettings({ oracle: undefined });
  renderOracleSettings();
  assert.equal(els['#set-oracle-budget'].value, '20');
  assert.equal(els['#set-oracle-compact'].value, '150000');
});

test('saveOracleSettings: setting the budget to 0 saves dailyBudgetUsd 0 (no cap), not the default', async () => {
  const { saveOracleSettings, els, setSettingsCalls } = loadOracleSettings({ oracle: { dailyBudgetUsd: 20, compactAtTokens: 150000 } });
  els['#set-oracle-budget'].value = '0';
  els['#set-oracle-compact'].value = '150000';
  await saveOracleSettings();
  assert.equal(setSettingsCalls.length, 1);
  assert.equal(setSettingsCalls[0].oracle.dailyBudgetUsd, 0);
});

test('saveOracleSettings: an empty, negative or non-numeric budget keeps the previous value', async () => {
  for (const bad of ['', '-5', 'abc']) {
    const { saveOracleSettings, els, setSettingsCalls } = loadOracleSettings({ oracle: { dailyBudgetUsd: 7, compactAtTokens: 150000 } });
    els['#set-oracle-budget'].value = bad;
    els['#set-oracle-compact'].value = '150000';
    await saveOracleSettings();
    assert.equal(setSettingsCalls[0].oracle.dailyBudgetUsd, 7, `budget input: ${JSON.stringify(bad)}`);
  }
});

test('saveOracleSettings: changing one field sends both fields, so the other is not lost', async () => {
  const { saveOracleSettings, els, setSettingsCalls } = loadOracleSettings({ oracle: { dailyBudgetUsd: 7, compactAtTokens: 200000 } });
  els['#set-oracle-budget'].value = '12';
  els['#set-oracle-compact'].value = '200000'; // unrelated field, left untouched by the UI
  await saveOracleSettings();
  // spread into a plain object: the sandbox's Object is a different realm than assert's
  assert.deepEqual({ ...setSettingsCalls[0].oracle }, { dailyBudgetUsd: 12, compactAtTokens: 200000 });

  const { saveOracleSettings: save2, els: els2, setSettingsCalls: calls2 } = loadOracleSettings({ oracle: { dailyBudgetUsd: 7, compactAtTokens: 200000 } });
  els2['#set-oracle-budget'].value = '7'; // unrelated field, left untouched by the UI
  els2['#set-oracle-compact'].value = '300000';
  await save2();
  assert.deepEqual({ ...calls2[0].oracle }, { dailyBudgetUsd: 7, compactAtTokens: 300000 });
});

test('saveOracleSettings: a compaction value below 10000 keeps the previous value; above 1000000 is clamped', async () => {
  const { saveOracleSettings, els, setSettingsCalls } = loadOracleSettings({ oracle: { dailyBudgetUsd: 20, compactAtTokens: 150000 } });
  els['#set-oracle-budget'].value = '20';
  els['#set-oracle-compact'].value = '500';
  await saveOracleSettings();
  assert.equal(setSettingsCalls[0].oracle.compactAtTokens, 150000);

  const { saveOracleSettings: save2, els: els2, setSettingsCalls: calls2 } = loadOracleSettings({ oracle: { dailyBudgetUsd: 20, compactAtTokens: 150000 } });
  els2['#set-oracle-budget'].value = '20';
  els2['#set-oracle-compact'].value = '5000000';
  await save2();
  assert.equal(calls2[0].oracle.compactAtTokens, 1000000);
});
