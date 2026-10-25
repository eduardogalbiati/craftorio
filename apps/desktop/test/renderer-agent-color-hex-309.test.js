// #309: in the agent editor (views/agents/agents.js, modal #agent-modal) a custom colour is visible as
// a selected swatch and editable as hex text. Acceptance tests, written before the code, through the
// whole page (test/agent-chat-page-harness.js: real-ish DOM, every page script loaded).
//
// Seams, per colour row `.ag-color[data-color="body|shell|visor|glow"]`:
// - the preset swatches `button.ag-swatch[data-hex]` (`.active` when selected) and the "+"
//   `input[type="color"]` stay;
// - new: a text field [data-testid="agent-color-hex"] showing the selected colour as #RRGGBB (uppercase);
// - new: a custom swatch [data-testid="agent-color-custom"], selected (class `active` or
//   aria-pressed="true") when the row's colour is not one of its presets;
// - new: a message [data-testid="agent-color-hex-error"] with text after an invalid hex, empty otherwise.
// Save (#btn-ag-save submits #agent-form) sends `appearance` through api.saveAgent(id, data).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadPage, settle } = require('./agent-chat-page-harness');

const LOOK = { shell: '#F4F4F6', visor: '#15161A', glow: '#C9B8FF', eyes: 'dots', emblem: 'none' };
// a user agent (editable, saved with api.saveAgent) whose main colour is the first preset
const PRESET_AGENT = { id: 'u1', name: 'Painter', description: '', prompt: 'Paint things.', skills: [], appearance: { body: '#7C5CFF', ...LOOK } };
// the same agent with a main colour that is none of the presets
const CUSTOM_AGENT = { ...PRESET_AGENT, appearance: { body: '#ABCDEF', ...LOOK } };
const HEX6 = /^#[0-9A-F]{6}$/;

/** The Agents screen with one agent, its editor opened by a click on the agent's card. */
async function openEditor(agent, api = {}) {
  const page = await loadPage({ api: { listAgents: async () => [agent], listSkills: async () => [], saveAgent: async () => ({}), createAgent: async () => ({}), ...api } });
  page.sandbox.showView('agents');
  await settle(20);
  const card = page.document.querySelectorAll('#agents-list .agent-card').find((c) => c.dataset.id === agent.id);
  assert.ok(card, 'the Agents screen lists the agent\'s card');
  card.click();
  await settle();
  assert.equal(page.$('#agent-modal').classList.contains('hidden'), false, 'the editor opened');
  return page;
}

const row = (page, key) => {
  const el = page.$(`#agent-modal .ag-color[data-color="${key}"]`);
  assert.ok(el, `the editor has the ${key} colour row`);
  return el;
};
const hexField = (page, key) => {
  const el = row(page, key).querySelector('[data-testid="agent-color-hex"]');
  assert.ok(el, `the ${key} row has the hex field [data-testid="agent-color-hex"]`);
  return el;
};
const customSwatch = (page, key) => {
  const el = row(page, key).querySelector('[data-testid="agent-color-custom"]');
  assert.ok(el, `the ${key} row has the custom swatch [data-testid="agent-color-custom"]`);
  return el;
};
const colorInput = (page, key) => row(page, key).querySelector('input[type="color"]');
const errorText = (page, key) => String(row(page, key).querySelector('[data-testid="agent-color-hex-error"]')?.textContent || '').trim();
const isSelected = (el) => el.classList.contains('active') || el.getAttribute('aria-pressed') === 'true';
const activePresets = (page, key) => row(page, key).querySelectorAll('.ag-swatch.active').length;
const preview = (page) => String(page.$('#ag-robot').innerHTML);

const changeEvent = (page) => new page.dom.classes.Event('change', { bubbles: true });
const inputEvent = (page) => new page.dom.classes.Event('input', { bubbles: true });
/** The native picker ("+") set to `hex`: `input` while dragging, then `change`. */
function pickCustom(page, key, hex) {
  const input = colorInput(page, key);
  input.value = hex;
  input.dispatchEvent(inputEvent(page));
  input.dispatchEvent(changeEvent(page));
}
/** The owner types `text` in the row's hex field and leaves it (change). */
function typeHex(page, key, text) {
  const field = hexField(page, key);
  page.dom.type(field, text);
  field.dispatchEvent(changeEvent(page));
}
async function save(page) {
  page.$('#btn-ag-save').click();
  await settle();
  const calls = page.callsTo('saveAgent');
  assert.equal(calls.length, 1, 'Save sent the agent once (api.saveAgent)');
  return calls[0][1];
}

test('#309 a colour picked with "+" selects the row\'s custom swatch and the hex field shows it, no preset active', async () => {
  const page = await openEditor(PRESET_AGENT);
  pickCustom(page, 'body', '#123456');
  await settle();
  assert.equal(isSelected(customSwatch(page, 'body')), true, 'the custom swatch is selected');
  assert.equal(hexField(page, 'body').value, '#123456');
  assert.equal(activePresets(page, 'body'), 0, 'no preset swatch is active in the body row');
});

test('#309 a valid shorthand typed in the hex field becomes the row\'s colour: custom swatch, "+" value, preview and the field itself', async () => {
  const page = await openEditor(PRESET_AGENT);
  typeHex(page, 'body', 'abc');
  await settle();
  assert.equal(isSelected(customSwatch(page, 'body')), true, 'the custom swatch is selected');
  assert.equal(colorInput(page, 'body').value, '#aabbcc', 'the native picker follows (colour inputs are lowercase)');
  assert.match(preview(page), /#AABBCC/i, 'the robot preview is painted in the typed colour');
  assert.equal(hexField(page, 'body').value, '#AABBCC', 'the field shows the normalized colour');
});

test('#309 an invalid hex shows an error and keeps the previous colour: "+" value, preview and what Save sends', async () => {
  const page = await openEditor(PRESET_AGENT);
  typeHex(page, 'body', '#GG00ZZ');
  await settle();
  assert.notEqual(errorText(page, 'body'), '', 'the row shows an error message');
  assert.equal(colorInput(page, 'body').value, '#7c5cff', 'the native picker keeps the previous colour');
  assert.match(preview(page), /#7C5CFF/i, 'the preview keeps the previous colour');
  assert.doesNotMatch(preview(page), /#GG00ZZ/i);
  const data = await save(page);
  assert.equal(data.appearance.body, '#7C5CFF', 'Save sends the previous colour');
});

test('#309 a valid hex clears the error of the row', async () => {
  const page = await openEditor(PRESET_AGENT);
  typeHex(page, 'body', '#GG00ZZ');
  await settle();
  assert.notEqual(errorText(page, 'body'), '', 'an error first');
  typeHex(page, 'body', '#123456');
  await settle();
  assert.equal(errorText(page, 'body'), '', 'no error after a valid colour');
});

test('#309 a preset clicked after a custom colour deselects the custom swatch and the hex field shows the preset', async () => {
  const page = await openEditor(PRESET_AGENT);
  pickCustom(page, 'body', '#123456');
  await settle();
  assert.equal(isSelected(customSwatch(page, 'body')), true, 'custom first');
  row(page, 'body').querySelector('.ag-swatch[data-hex="#3D7BF7"]').click();
  await settle();
  assert.equal(isSelected(customSwatch(page, 'body')), false, 'the custom swatch is not selected any more');
  assert.equal(hexField(page, 'body').value, '#3D7BF7');
  assert.equal(row(page, 'body').querySelector('.ag-swatch[data-hex="#3D7BF7"]').classList.contains('active'), true);
});

test('#309 Save sends a custom main colour typed in the hex field, every colour as #RRGGBB', async () => {
  const page = await openEditor(PRESET_AGENT);
  typeHex(page, 'body', '123456');
  await settle();
  assert.equal(hexField(page, 'body').value, '#123456');
  const data = await save(page);
  assert.equal(data.appearance.body, '#123456');
  for (const key of ['shell', 'visor', 'glow']) assert.match(String(data.appearance[key]), HEX6, `${key} is #RRGGBB`);
});

test('#309 Save sends a custom main colour picked with "+", the one the custom swatch shows', async () => {
  const page = await openEditor(PRESET_AGENT);
  pickCustom(page, 'body', '#123456');
  await settle();
  assert.equal(isSelected(customSwatch(page, 'body')), true, 'the custom swatch shows the colour about to be saved');
  const data = await save(page);
  assert.equal(data.appearance.body, '#123456');
  for (const key of ['shell', 'visor', 'glow']) assert.match(String(data.appearance[key]), HEX6, `${key} is #RRGGBB`);
});

test('#309 opening an agent whose main colour is not a preset shows it selected as the custom swatch, with its hex', async () => {
  const page = await openEditor(CUSTOM_AGENT);
  assert.equal(isSelected(customSwatch(page, 'body')), true, 'the body row\'s custom swatch is selected');
  assert.equal(hexField(page, 'body').value, '#ABCDEF');
  assert.equal(activePresets(page, 'body'), 0, 'no preset is active in the body row');
});

test('#309 the rows whose colour is a preset show that preset active and the custom swatch not selected', async () => {
  const page = await openEditor(CUSTOM_AGENT);
  for (const [key, hex] of [['shell', '#F4F4F6'], ['visor', '#15161A'], ['glow', '#C9B8FF']]) {
    assert.equal(isSelected(customSwatch(page, key)), false, `${key}: the custom swatch is not selected`);
    assert.equal(hexField(page, key).value, hex, `${key}: the hex field shows the preset`);
  }
});

test('#309 "Reset look" after a custom colour selects no custom swatch, every hex field shows a preset and the preview drops the custom colour', async () => {
  const page = await openEditor(CUSTOM_AGENT);
  assert.match(preview(page), /#ABCDEF/i, 'the custom colour first');
  page.$('#btn-ag-reset').click();
  await settle();
  const swatches = page.document.querySelectorAll('#agent-modal [data-testid="agent-color-custom"]');
  assert.equal(swatches.length, 4, 'one custom swatch per row');
  assert.equal(swatches.filter(isSelected).length, 0, 'none selected');
  const fields = page.document.querySelectorAll('#agent-modal [data-testid="agent-color-hex"]');
  assert.equal(fields.length, 4, 'one hex field per row');
  for (const f of fields) assert.match(String(f.value), HEX6);
  assert.doesNotMatch(preview(page), /#ABCDEF/i);
});
