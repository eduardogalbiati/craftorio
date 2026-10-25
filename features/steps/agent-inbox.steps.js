// Steps of features/agent-inbox.feature (#240): the Product Owner's and the Supervisor's request
// inboxes. The Oracle's tool that sends a request is not built yet (part 2), so a Given sends it the
// way the Oracle will, through the app's service: window.api.productOwnerRequest (channel
// po:request) and window.api.supervisorRequest (channel supervisor:request), each called with the
// whole request object, in simulation (mock: true). The request and its result then show in the
// owner's conversation: [data-testid="po-request"] in the Product Owner's drawer,
// [data-testid="svc-request"] in the Supervisor chat drawer (#svc-drawer, not the run's #sup-drawer,
// which has the same aria-label). Locators are roles and data-testid only (skills/ui-conventions).
// #241: the Oracle's request_agent tool (window.api.oracleRequestAgent, channel oracle:requestAgent)
// routes a change to its owner: a mechanical kind is done there, a run retry waits for the owner's
// click on a Do it / Dismiss card in the Supervisor chat (none in the Oracle's), a gate is refused.

const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');

// ---- sending a request as the Oracle ------------------------------------------------------------------

// The request's ref: an id the Oracle gives it (its tool call), unique per scenario
const ref = (kind) => `e2e-${kind}-${Date.now()}`;

async function sendRequest(e2e, method, request) {
  const res = await e2e.window.evaluate(async ({ method, request }) => {
    if (typeof window.api?.[method] !== 'function') return { missing: true };
    try {
      return await window.api[method](request);
    } catch (e) {
      return { thrown: String(e?.message || e) };
    }
  }, { method, request });
  expect(res?.missing, `window.api.${method} (the request inbox's channel)`).toBeFalsy();
  expect(res?.thrown, `window.api.${method} rejected`).toBeFalsy();
  e2e.lastRequest = res;
  return res;
}

const issueNumber = (e2e, title) => {
  const file = path.join(e2e.scratch, 'workspace', 'backlog', `${e2e.project.id}.json`);
  const issue = JSON.parse(fs.readFileSync(file, 'utf8')).issues.find((i) => i.title === title);
  expect(issue, `the backlog's issue "${title}"`).toBeTruthy();
  return issue.number;
};

Given('the Oracle asked the Product Owner to add the issue {string} to the roadmap because {string}', async ({ e2e }, title, reason) => {
  const res = await sendRequest(e2e, 'productOwnerRequest', {
    projectId: e2e.project.id, kind: 'roadmap.add', params: { issues: [issueNumber(e2e, title)] }, reason, from: 'oracle', ref: ref('roadmap-add'), mock: true,
  });
  expect(res?.ok, `the Product Owner's answer: ${res?.error || res?.text}`).toBe(true);
});

Given('the Oracle asked the Supervisor to restart the dispatch because {string}', async ({ e2e }, reason) => {
  const res = await sendRequest(e2e, 'supervisorRequest', {
    kind: 'dispatch.restart', params: {}, reason, from: 'oracle', ref: ref('dispatch-restart'), mock: true,
  });
  expect(res?.ok, `the Supervisor's answer: ${res?.error || res?.text}`).toBe(true);
});

Given('the Oracle asked the Supervisor to stop the run {string} because {string}', async ({ e2e }, runId, reason) => {
  await sendRequest(e2e, 'supervisorRequest', {
    kind: 'run.stop', params: { runId }, reason, from: 'oracle', ref: ref('run-stop'), mock: true,
  });
});

Given('the request failed', async ({ e2e }) => {
  expect(e2e.lastRequest?.ok).toBe(false);
  expect(String(e2e.lastRequest?.error || '')).not.toBe('');
});

// ---- the Supervisor chat drawer ---------------------------------------------------------------------

// #264: the Supervisor has no header button nor screen any more: its conversation is a right-side
// drawer opened by the Workflows screen's "Supervisor" button (like the Backlog's Product Owner)
const svcDrawer = (page) => page.getByTestId('svc-drawer');
const workflowsTabs = (page) => page.getByRole('tablist', { name: 'Workflows', exact: true });

async function openSupervisorFromWorkflows(page) {
  await page.getByRole('main').getByRole('button', { name: 'Supervisor', exact: true }).click();
  await expect(svcDrawer(page)).toBeVisible();
}

// from any screen: Workflows › Runs first, unless the Workflows screen is already in view
When('I open the Supervisor chat', async ({ e2e }) => {
  const page = e2e.window;
  if (!(await workflowsTabs(page).isVisible())) {
    await page.getByRole('navigation').getByRole('button', { name: /^Runs(\s+\d+)?$/ }).click();
    await expect(workflowsTabs(page)).toBeVisible();
  }
  await openSupervisorFromWorkflows(page);
});

When('I open the Supervisor from the Workflows screen', async ({ e2e }) => {
  await expect(workflowsTabs(e2e.window)).toBeVisible();
  await openSupervisorFromWorkflows(e2e.window);
});

Then('the Supervisor chat opens as a drawer on the right', async ({ e2e }) => {
  const page = e2e.window;
  const drawer = svcDrawer(page);
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveAttribute('aria-hidden', 'false');
  // its question box takes the owner's question
  await expect(drawer.getByRole('textbox').first()).toBeVisible();
  const box = await drawer.boundingBox();
  const width = await page.evaluate(() => window.innerWidth);
  expect(box.x + box.width / 2, 'the drawer sits on the right half').toBeGreaterThan(width / 2);
  expect(Math.round(box.x + box.width), 'the drawer reaches the right edge').toBeGreaterThanOrEqual(width - 2);
});

// #409: the Workflows screen's round Supervisor button (data-testid="supervisor-fab"), in the
// bottom-right corner of every tab like the Backlog's Product Owner (#btn-bl-po.po-fab); the header's
// "◆ Supervisor" button is gone
const supervisorFab = (page) => page.getByTestId('supervisor-fab').filter({ visible: true });

Then('the Workflows screen shows the Supervisor\'s round button in its bottom-right corner', async ({ e2e }) => {
  const page = e2e.window;
  await expect(workflowsTabs(page)).toBeVisible();
  const fab = supervisorFab(page);
  await expect(fab).toHaveCount(1);
  const box = await fab.boundingBox();
  const { width, height } = await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
  expect(box.x + box.width / 2, 'the button sits in the right quarter').toBeGreaterThan(width * 0.75);
  expect(box.y + box.height / 2, 'the button sits in the bottom quarter').toBeGreaterThan(height * 0.75);
  // round: as wide as it is tall
  expect(Math.abs(box.width - box.height), `the button is ${box.width}x${box.height}`).toBeLessThanOrEqual(2);
});

// no "◆ Supervisor" button in the screen's header: the round button is the screen's only one
Then('the Workflows screen has no other Supervisor button', async ({ e2e }) => {
  const page = e2e.window;
  await expect(supervisorFab(page)).toHaveCount(1);
  const buttons = page.getByRole('main').getByRole('button', { name: /supervisor/i }).filter({ visible: true });
  await expect(buttons).toHaveCount(1);
  await expect(buttons).toHaveAttribute('data-testid', 'supervisor-fab');
});

When('I open the Supervisor from its round button', async ({ e2e }) => {
  await supervisorFab(e2e.window).click();
  await expect(svcDrawer(e2e.window)).toBeVisible();
});

When('I close the Supervisor chat', async ({ e2e }) => {
  const drawer = svcDrawer(e2e.window);
  await drawer.getByRole('button', { name: /^Close/ }).click();
  await expect(drawer).toHaveAttribute('aria-hidden', 'true');
});

// ---- the request messages ---------------------------------------------------------------------------

const poDrawer = (page) => page.getByRole('complementary', { name: 'Product Owner', exact: true });
const requestIn = {
  "the Product Owner's drawer": (page) => poDrawer(page).getByTestId('po-request').last(),
  'the Supervisor chat': (page) => svcDrawer(page).getByTestId('svc-request').last(),
};
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// "US$ 0" and "US$ 0.00", not "US$ 0.42"
const costRe = (cost) => new RegExp(`${escapeRe(cost)}(\\.0+)?(?![.,]?\\d)`);

for (const [where, request] of Object.entries(requestIn)) {
  Then(`${where} shows a request marked {string} with its time`, async ({ e2e }, origin) => {
    await expect(request(e2e.window)).toBeVisible();
    await expect(request(e2e.window)).toContainText(new RegExp(`${escapeRe(origin)} \\d{1,2}:\\d{2}`));
  });

  Then(`the request in ${where} shows {string}`, async ({ e2e }, text) => {
    await expect(request(e2e.window)).toContainText(text);
  });

  Then(`the request in ${where} shows the cost {string}`, async ({ e2e }, cost) => {
    await expect(request(e2e.window)).toContainText(costRe(cost));
  });
}

Then("the request in the Product Owner's drawer shows its result naming the issue {string}", async ({ e2e }, title) => {
  const message = requestIn["the Product Owner's drawer"](e2e.window);
  await expect(message).toContainText(new RegExp(`#${issueNumber(e2e, title)}\\b`));
});

Then('the request in the Supervisor chat shows that it failed, naming the run {string}', async ({ e2e }, runId) => {
  const message = requestIn['the Supervisor chat'](e2e.window);
  await expect(message).toContainText(runId);
  await expect(message).toContainText(/fail|error|not found|does not exist|no such run|unknown run/i);
});

// ---- #241: the Oracle's request_agent tool routes a change to its owner -----------------------------

// The Oracle's tool, called the way the Oracle calls it: window.api.oracleRequestAgent (channel
// oracle:requestAgent) with { to: 'po' | 'supervisor', kind, params, reason, mock }. The answer says
// what the owner did: ok (done), pending (a card waits for the owner's click) or refused / failed.
const requestAgent = (e2e, request) => sendRequest(e2e, 'oracleRequestAgent', { ...request, mock: true });

When('the Oracle sends the Product Owner a request to add the issue {string} to the roadmap because {string}', async ({ e2e }, title, reason) => {
  const res = await requestAgent(e2e, {
    to: 'po', kind: 'roadmap.add', params: { projectId: e2e.project.id, issues: [issueNumber(e2e, title)] }, reason, projectId: e2e.project.id,
  });
  expect(res?.ok, `the Product Owner's answer: ${res?.error || res?.text}`).toBe(true);
});

// the demo workspace's run whose id ends in `-<fragment>` (features/support/app.js)
const demoRunId = (e2e, fragment) => {
  const runs = path.join(e2e.scratch, 'workspace', 'runs');
  const id = (fs.existsSync(runs) ? fs.readdirSync(runs) : []).find((d) => d.endsWith(`-${fragment}`));
  expect(id, `the demo workspace has no run ending in -${fragment}`).toBeTruthy();
  return id;
};

// a retry starts a run (a real one costs money): it waits for the owner's click in the Supervisor chat
When('the Oracle sends the Supervisor a request to retry the demo run {string} because {string}', async ({ e2e }, fragment, reason) => {
  const res = await requestAgent(e2e, { to: 'supervisor', kind: 'run.retry', params: { runId: demoRunId(e2e, fragment) }, reason });
  expect(res?.error, `the Supervisor's answer: ${res?.error}`).toBeFalsy();
});

// the run of the gate card in view: asking the Supervisor to approve its human gate
When('the Oracle sends the Supervisor a request to approve the gate of the run in view because {string}', async ({ e2e }, reason) => {
  const runId = await e2e.window.getByTestId('run-gate').first().getAttribute('data-run');
  expect(runId, 'the gate card names its run').toBeTruthy();
  await requestAgent(e2e, { to: 'supervisor', kind: 'approval.resolve', params: { runId, answer: 'approve' }, reason });
});

Then("the Oracle's request was refused, naming the human gate", async ({ e2e }) => {
  expect(e2e.lastRequest?.ok).toBe(false);
  expect(String(e2e.lastRequest?.error || e2e.lastRequest?.text || '')).toMatch(/gate/i);
});

Then('the request in the Supervisor chat offers {string} and {string}', async ({ e2e }, a, b) => {
  const card = requestIn['the Supervisor chat'](e2e.window);
  for (const name of [a, b]) await expect(card.getByRole('button', { name, exact: true })).toBeEnabled();
});

// the Oracle's panel in view (fronts/ai/features/steps/oracle.steps.js); its line for a request it sent:
// [data-testid="oracle-request"], "Sent to the <owner> · <kind> · ..."
const oraclePanel = (page) => page.getByRole('complementary', { name: 'Oracle', exact: true });

Then("the Oracle's chat shows its request {string} sent to the {string}", async ({ e2e }, kind, owner) => {
  const line = oraclePanel(e2e.window).getByTestId('oracle-request').filter({ hasText: kind }).last();
  await expect(line).toBeVisible();
  await expect(line).toContainText(`Sent to the ${owner}`);
});

Then("the Oracle's chat offers no {string} button", async ({ e2e }, name) => {
  await expect(oraclePanel(e2e.window).getByRole('button', { name, exact: true })).toHaveCount(0);
});
