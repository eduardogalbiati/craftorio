// #625: the mockup editor window's page (fronts/plan/views/mockups/mockup-editor.js, index.html?window=mockup):
// - the chat's head slot shows the next turn's estimate (D15 chat-edit, $0.03–$0.30) and the screen's chat total
//   (Q-8, MockupModel.chatCostUsd of api.readMockupChat's history), data-testid="mockup-chat-cost";
// - the canvas' axe report ({ type: 'mockup:axe', violations | error }, posted by the iframe) is the mockup-axe
//   badge (hidden before a report);
// - a canvas click ({ type: 'mockup:select', ..., add }) replaces the selection, Shift (add: true) adds a new
//   element and removes one already chosen; one mockup-selection-chip per element in the chat's compose slot;
// - messages that do not come from the canvas' contentWindow are ignored.
// On the real page (packages/ui-kit/test/renderer-app-harness.js): window events reach the document's listeners.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('@craftorio/ui-kit/test/renderer-app-harness');

const HISTORY = [
  { role: 'user', text: 'Make the button blue' },
  { role: 'agent', text: 'Done.', costUsd: 0.05 },
  { role: 'user', text: 'Smaller title' },
  { role: 'agent', text: 'Done.', costUsd: 0.1 },
];

async function editor({ history = HISTORY } = {}) {
  const app = loadApp({
    storage: { 'multiagent.currentProject': 'p1' },
    api: {
      listProjects: async () => [{ id: 'p1', name: 'Project One', repo: 'https://github.com/o/r', folder: 'C:/repo' }],
      getSettings: async () => ({ lastProject: 'p1' }),
      listMockupVersions: async () => [{ commit: 'c41e2a9aaaaaaaa', message: 'Smaller title' }],
      readMockupChat: async () => history,
    },
  });
  app.sandbox.location.search = '?window=mockup&project=p1&slug=orders-dashboard';
  await app.boot();
  await app.settle(10);
  const frame = { name: 'canvas window' };
  app.el('#mockup-canvas').contentWindow = frame;
  const post = async (data, source = frame) => { app.sandbox.dispatchEvent({ type: 'message', source, data }); await app.settle(); };
  return { app, post };
}

const headHtml = (app) => String(app.el('[data-agent-chat-slot="head"]').innerHTML || '');
const chips = (app) => String(app.el('[data-agent-chat-slot="compose"]').innerHTML || '').split('data-testid="mockup-selection-chip"').length - 1;
const plainText = (html) => html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
const pick = (mid, extra = {}) => ({ type: 'mockup:select', mid, selector: `main > button.b${mid}`, kit: null, text: `Button ${mid}`, box: [0, 0, 10, 10], html: '<button>', ...extra });

test('#625 the editor shows the chat turn estimate and what the screen\'s chat has cost so far', async () => {
  const { app } = await editor();
  const html = headHtml(app);
  const line = plainText(html);
  assert.deepEqual([html.includes('data-testid="mockup-chat-cost"'), line.includes('$0.03'), line.includes('$0.30'), line.includes('$0.15')], [true, true, true, true]);
  assert.deepEqual(app.errors.map((e) => String(e.message)), []);
});

test('#625 a screen with no chat yet shows a $0.00 total', async () => {
  const { app } = await editor({ history: [] });
  assert.equal(plainText(headHtml(app)).includes('$0.00'), true);
});

test('#625 the axe badge is hidden until the canvas reports', async () => {
  const { app } = await editor();
  assert.equal(app.el('#mockup-axe').classList.contains('hidden'), true);
});

test('#625 an axe report with violations from the canvas shows the issue count as a warning', async () => {
  const { app, post } = await editor();
  await post({ type: 'mockup:axe', violations: [{ id: 'color-contrast', impact: 'serious', help: 'Elements must meet contrast', nodes: 2 }, { id: 'image-alt', impact: 'critical', help: 'Images need alt text', nodes: 1 }] });
  const axe = app.el('#mockup-axe');
  assert.deepEqual([axe.classList.contains('hidden'), axe.classList.contains('warning'), axe.textContent, axe.title.includes('color-contrast (serious, 2)')],
    [false, true, 'Axe: 2 issues', true]);
});

test('#625 an axe report without violations shows a clean badge', async () => {
  const { app, post } = await editor();
  await post({ type: 'mockup:axe', violations: [] });
  const axe = app.el('#mockup-axe');
  assert.deepEqual([axe.classList.contains('hidden'), axe.classList.contains('success'), axe.textContent], [false, true, 'Axe: clean']);
});

test('#625 an axe report that does not come from the canvas is ignored', async () => {
  const { app, post } = await editor();
  await post({ type: 'mockup:axe', violations: [{ id: 'x', impact: 'minor', help: 'x', nodes: 1 }] }, { name: 'another window' });
  assert.equal(app.el('#mockup-axe').classList.contains('hidden'), true);
});

test('#625 a plain click on the canvas replaces the selection', async () => {
  const { app, post } = await editor();
  await post(pick('m1'));
  await post(pick('m2'));
  const html = String(app.el('[data-agent-chat-slot="compose"]').innerHTML);
  assert.deepEqual([chips(app), html.includes('Button m2'), html.includes('Button m1')], [1, true, false]);
});

test('#625 Shift-click adds an element to the selection and removes one already chosen', async () => {
  const { app, post } = await editor();
  await post(pick('m1'));
  await post(pick('m2', { add: true }));
  const both = String(app.el('[data-agent-chat-slot="compose"]').innerHTML);
  assert.deepEqual([chips(app), both.includes('Button m1'), both.includes('Button m2')], [2, true, true]);
  await post(pick('m1', { add: true }));
  const left = String(app.el('[data-agent-chat-slot="compose"]').innerHTML);
  assert.deepEqual([chips(app), left.includes('Button m1'), left.includes('Button m2')], [1, false, true]);
});

test('#625 a selection message that does not come from the canvas is ignored', async () => {
  const { app, post } = await editor();
  await post(pick('m1'), { name: 'another window' });
  assert.equal(chips(app), 0);
});
