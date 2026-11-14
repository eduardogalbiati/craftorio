// Screenshot seed of the Mockups screen (--view mockups, #625): the demo project's mockups in
// <workspace>/mockups/<project id>/, written through the mockups domain (fronts/plan/engine/domains/mockups.js,
// one local git commit each), so the gallery shows real cards:
// - a tokens kit (the app's own palette as the sample project's tokens);
// - four screens: Orders dashboard (two chat turns, so three versions), Customer detail, Checkout
//   from a Discovery card, and a long title that has to be cut with an ellipsis.
// --mode gallery (default): the kit and the gallery; new: the same with the New mockup dialog open;
// empty: nothing seeded, the empty state with the kit's cost estimate.

const path = require('path');

const LONG = 'Returns and refunds review queue for the support team with filters by reason and age';

const TOKENS = [
  { name: '--bg', value: '#0f1218', file: 'src/styles/theme.css', line: 2 },
  { name: '--panel', value: '#161a22', file: 'src/styles/theme.css', line: 3 },
  { name: '--line', value: '#262c38', file: 'src/styles/theme.css', line: 4 },
  { name: '--text', value: '#d7dce5', file: 'src/styles/theme.css', line: 5 },
  { name: '--muted', value: '#8a91a3', file: 'src/styles/theme.css', line: 6 },
  { name: '--accent', value: '#6aa9ff', file: 'src/styles/theme.css', line: 7 },
  { name: '--radius', value: '6px', file: 'src/styles/theme.css', line: 8 },
];

function demoMockups(appDir, root, projectId) {
  const mockups = require(path.join(appDir, 'fronts', 'plan', 'engine', 'domains', 'mockups'));
  const MockupModel = require(path.join(appDir, 'packages', 'shared', 'mockup-model'));
  mockups.writeKit(root, projectId, {
    tokensCss: MockupModel.tokensCss(TOKENS),
    componentsCss: '',
    kit: { sources: ['src/styles/theme.css'], tokens: TOKENS, fonts: ['Inter'], components: [], inferences: [] },
  });
  const screen = (title, prompt, source) => mockups.createScreen(root, projectId, { title, html: MockupModel.draftScreen({ title, prompt }), source });
  const orders = screen('Orders dashboard', 'Open, shipped and late orders with an Export button', { kind: 'prompt' });
  for (const message of ['Make the Export button primary', 'Add a filter by status above the table']) {
    const html = mockups.screenHtml(root, projectId, orders.slug).replace('</body>', `<!-- designer: ${message} --></body>`);
    mockups.saveTurn(root, projectId, { slug: orders.slug, html, message });
  }
  screen('Customer detail', 'The customer header, their last orders and notes', { kind: 'prompt' });
  screen('Checkout', 'Cart summary, address and payment', { kind: 'discovery', card: 'checkout-in-one-page' });
  screen(LONG, 'A queue of return requests', { kind: 'prompt' });
}

function seed({ args = {}, appDir, project, ws }) {
  if (args.mode === 'empty') return;
  demoMockups(appDir, ws.root, project.id);
}

async function open({ args, click, pause }) {
  await click('.nav-item[data-view="mockups"]');
  await pause(800);
  if (args.mode === 'new') {
    await click('[data-testid="mockups-new"]');
    await pause(300);
  }
}

module.exports = {
  modes: ['gallery', 'new', 'empty'],
  open,
  seed,
};
