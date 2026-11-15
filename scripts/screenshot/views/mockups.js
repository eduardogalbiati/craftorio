// Screenshot seed of the Mockups screen (--view mockups, #625): the demo project's mockups in
// <workspace>/mockups/<project id>/, written through the mockups domain (fronts/plan/engine/domains/mockups.js,
// one local git commit each), so the gallery shows real cards:
// - a tokens kit (the app's own palette as the sample project's tokens);
// - four screens: Orders dashboard (two chat turns, so three versions), Customer detail, Checkout
//   from a Discovery card, and a long title that has to be cut with an ellipsis.
// - #835: the kit map's three components (with file:line sources and two inferred gaps), a flow
//   (order-follow-up: the dashboard → Customer detail) and a variant branch (compact-table).
// --mode gallery (default): the kit and the gallery; new: the same with the New mockup dialog open;
// empty: nothing seeded, the empty state with the kit's cost estimate; kit: the Kit tab (tokens,
// components with their live preview, inferred gaps). Compare and variants live in the editor window:
// the @issue-835 scenarios of mockups.feature capture them.

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
  const customer = screen('Customer detail', 'The customer header, their last orders and notes', { kind: 'prompt' });
  screen('Checkout', 'Cart summary, address and payment', { kind: 'discovery', card: 'checkout-in-one-page' });
  screen(LONG, 'A queue of return requests', { kind: 'prompt' });
  // #835 the kit map's components (the Kit tab), a flow from the dashboard to the customer, a variant
  mockups.applyKitMap(root, projectId, {
    components_css: COMPONENTS.map((c) => c.css).join('\n'),
    components: COMPONENTS.map(({ name, source, html }) => ({ name, class: MockupModel.slugify(name), source, html })),
    inferences: ['No focus style declared: the kit uses --accent as the focus ring', 'No danger colour: a red token is still to be chosen'],
  });
  const mid = (mockups.screenHtml(root, projectId, orders.slug).match(/data-mid="([^"]+)"/g) || []).pop()?.slice(10, -1);
  if (mid) mockups.saveFlow(root, projectId, { name: 'order-follow-up', links: [{ from: { screen: orders.slug, mid }, to: customer.slug }] });
  mockups.createVariant(root, projectId, { name: 'compact-table' });
  mockups.switchVariant(root, projectId, { name: 'main' });
}

const COMPONENTS = [
  { name: 'Primary button', source: 'src/components/Button.jsx:12', html: '<button class="primary-button">Export</button>', css: '.primary-button { background: var(--accent); color: var(--bg); border: 0; border-radius: var(--radius); padding: 6px 12px; }' },
  { name: 'Status badge', source: 'src/components/Badge.jsx:5', html: '<span class="status-badge">Shipped</span>', css: '.status-badge { border: 1px solid var(--line); color: var(--muted); border-radius: var(--radius); padding: 2px 6px; font-size: 12px; }' },
  { name: 'Data table', source: 'src/components/Table.jsx:21', html: '<table class="data-table"><tr><th>Order</th><th>Status</th></tr><tr><td>#1042</td><td>Late</td></tr></table>', css: '.data-table { border-collapse: collapse; color: var(--text); } .data-table td, .data-table th { border-bottom: 1px solid var(--line); padding: 4px 8px; }' },
];

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
  if (args.mode === 'kit') {
    await click('[data-testid="mockups-kit-tab"]');
    await pause(800);
  }
}

module.exports = {
  modes: ['gallery', 'new', 'empty', 'kit'],
  open,
  seed,
};
