// Steps of features/live-updates.feature (#603): a window onto an engine never keeps a stale state when
// its pushed channel (the browser UI's WebSocket, /ws) is silent or down. The served engine and its
// browser UI come from features/support/served.js (the fixture's openServed, "Given the engine is
// served on this machine" in engine-version.steps.js); the gate card's run comes from the Start panel
// (fronts/build/features/steps/run.steps.js).
//
// The relay: page.routeWebSocket on /ws, installed before the UI opens. It forwards both ways; with
// `hold` it drops what the engine pushes while the socket stays open (a silent channel); with `down`
// it closes the open sockets and every new one at once (a dropped channel), until it is up again.
// "Another client" calls the engine's HTTP API (POST /api/<channel>, Authorization: Bearer <server
// token>, the token read from the served URL), as a second window or a phone would.
//
// Locators are roles and data-testid only (skills/ui-conventions):
//   run-gate, run-gate-choice      the gate card (data-approval, data-run) and its choices (existing)
//   sidebar-footer                 the sidebar's runs, one [data-run] row each, data-gate="1" when waiting (existing)
//   toast                          the shell's toast (existing)
//   nav-run-gates                  NEW: the sidebar's waiting-gates badge (today #nav-run-gates)
//   connection-status              NEW: the shell's "Disconnected, reconnecting…" indicator

const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

// "at once": the answer's own HTTP reply updates the window; no push arrives while the relay holds them
const AT_ONCE = 5000;
const LOAD_TIMEOUT = 30000;
const WS_URL = /\/ws(\?.*)?$/;

const visibleGate = (page) => page.getByTestId('run-gate').filter({ visible: true }).first();
const gateCard = (page, approval) => page.locator(`[data-testid="run-gate"][data-approval="${approval}"]`).filter({ visible: true }).first();
const gatesBadge = (page) => page.getByTestId('nav-run-gates');
const runRow = (page, runId) => page.getByTestId('sidebar-footer').locator(`[data-run="${runId}"]`);
const connectionStatus = (page) => page.getByTestId('connection-status');

function relayOf(e2e) {
  expect(e2e.liveRelay, 'the live updates relay was installed before the UI opened').toBeTruthy();
  return e2e.liveRelay;
}

// the gate in view, remembered for the scenario's next steps: { approval, run }
async function theGate(e2e) {
  if (e2e.gate) return e2e.gate;
  const card = visibleGate(e2e.window);
  await expect(card).toBeVisible({ timeout: LOAD_TIMEOUT });
  e2e.gate = { approval: await card.getAttribute('data-approval'), run: await card.getAttribute('data-run') };
  expect(e2e.gate.approval, 'the gate card names its gate').toBeTruthy();
  return e2e.gate;
}

// the answer a choice button sends: its choice id, or true / false for an approve / reject gate
async function answerOf(choice) {
  const id = await choice.getAttribute('data-choice');
  if (id !== null) return id;
  return (await choice.getAttribute('data-answer')) === 'true';
}

// the number on the waiting-gates badge, 0 when it is hidden
async function badgeCount(page) {
  const badge = gatesBadge(page);
  if (!(await badge.isVisible())) return 0;
  return Number((await badge.textContent()).trim()) || 0;
}

// a call to the served engine's HTTP API, as another client makes it → the channel's result
async function callEngine(e2e, channel, arg) {
  const url = new URL(e2e.url);
  const token = url.searchParams.get('token');
  const res = await fetch(`${url.origin}/api/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ arg: arg === undefined ? null : arg }),
  });
  const body = await res.json().catch(() => ({}));
  expect(res.status, `${channel} answered ${res.status}: ${JSON.stringify(body).slice(0, 300)}`).toBe(200);
  return body.result;
}

Given('the served engine has a project {string}', async ({ e2e }, name) => {
  await callEngine(e2e, 'projects:create', { name });
});

Given('the browser\'s live updates from the engine go through a relay I control', async ({ e2e }) => {
  // a served engine on a new workspace opens the first-run Setup (#319) over every page: the scenarios
  // start from Home, as a workspace set up before does (setupDone true, saved before the window loads)
  await callEngine(e2e, 'settings:set', { setupDone: true });
  const relay = { hold: false, down: false, links: new Set() };
  const cut = (link) => {
    relay.links.delete(link);
    link.ws.close().catch(() => {});
    link.server.close().catch(() => {});
  };
  relay.cutAll = () => [...relay.links].forEach(cut);
  await e2e.window.routeWebSocket(WS_URL, (ws) => {
    if (relay.down) {
      ws.close().catch(() => {});
      return;
    }
    const server = ws.connectToServer();
    const link = { ws, server };
    relay.links.add(link);
    ws.onMessage((message) => server.send(message));
    server.onMessage((message) => { if (!relay.hold) ws.send(message); });
    ws.onClose(() => cut(link));
    server.onClose(() => cut(link));
  });
  e2e.liveRelay = relay;
});

When('the browser stops receiving live updates from the engine', async ({ e2e }) => {
  await theGate(e2e);
  relayOf(e2e).hold = true;
});

When('the browser\'s live connection to the engine drops', async ({ e2e }) => {
  const relay = relayOf(e2e);
  // the UI is up and its channel connected before it is cut
  await expect(e2e.window.getByRole('navigation').getByRole('button', { name: /^Home\b/ })).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => relay.links.size, { timeout: LOAD_TIMEOUT, message: 'the browser\'s live connection is open' }).toBeGreaterThan(0);
  relay.down = true;
  relay.cutAll();
});

When('the browser\'s live connection to the engine comes back', async ({ e2e }) => {
  const relay = relayOf(e2e);
  relay.down = false;
  relay.hold = false;
});

// clicks the choice without waiting for the card to change: the Then steps check what the window shows
When('I answer the gate card with its first choice', async ({ e2e }) => {
  const page = e2e.window;
  const { approval } = await theGate(e2e);
  await expect(gatesBadge(page)).toBeVisible({ timeout: LOAD_TIMEOUT });
  e2e.gatesBefore = await badgeCount(page);
  const choice = gateCard(page, approval).getByTestId('run-gate-choice').first();
  await expect(choice).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await choice.click();
});

When('another client answers the gate with its first choice', async ({ e2e }) => {
  const { approval, run } = await theGate(e2e);
  const choice = gateCard(e2e.window, approval).getByTestId('run-gate-choice').first();
  await expect(choice).toBeEnabled({ timeout: LOAD_TIMEOUT });
  await callEngine(e2e, 'approval:resolve', { id: approval, runId: run, answer: await answerOf(choice) });
});

Then('the gate card shows the gate answered', async ({ e2e }) => {
  const page = e2e.window;
  const card = gateCard(page, (await theGate(e2e)).approval);
  await expect(card).toContainText(/answered/i, { timeout: AT_ONCE });
  await expect(card.getByTestId('run-gate-choice').filter({ visible: true }).and(page.locator(':enabled'))).toHaveCount(0, { timeout: AT_ONCE });
});

Then('the sidebar\'s waiting-gates badge counts one gate less', async ({ e2e }) => {
  expect(e2e.gatesBefore, 'the badge counted the gate before the answer').toBeGreaterThanOrEqual(1);
  await expect.poll(() => badgeCount(e2e.window), { timeout: AT_ONCE }).toBe(e2e.gatesBefore - 1);
});

Then('the run\'s entry in the sidebar is no longer waiting at a gate', async ({ e2e }) => {
  const { run } = await theGate(e2e);
  await expect(runRow(e2e.window, run).and(e2e.window.locator('[data-gate="1"]'))).toHaveCount(0, { timeout: AT_ONCE });
});

Then('the gate card says it was already answered at a time', async ({ e2e }) => {
  const card = gateCard(e2e.window, (await theGate(e2e)).approval);
  await expect(card).toContainText(/already answered at \d{1,2}:\d{2}/i, { timeout: AT_ONCE });
});

Then('no error is shown', async ({ e2e }) => {
  const page = e2e.window;
  await expect(page.getByTestId('toast')).not.toContainText(/error|failed|could not/i);
  await expect(page.getByRole('alert').filter({ visible: true }).filter({ hasText: /error|failed|could not/i })).toHaveCount(0);
});

Then('the shell shows that it is reconnecting, without a dialog', async ({ e2e }) => {
  const page = e2e.window;
  const status = connectionStatus(page);
  await expect(status).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(status).toContainText(/reconnecting/i);
  await expect(page.getByRole('dialog').filter({ visible: true })).toHaveCount(0);
});

Then('the reconnecting indicator clears within {int} seconds', async ({ e2e }, seconds) => {
  await expect(connectionStatus(e2e.window)).toBeHidden({ timeout: seconds * 1000 });
});
