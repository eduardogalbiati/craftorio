// Steps of features/agent-inbox.feature (#240): the Product Owner's and the Supervisor's request
// inboxes. The Oracle's tool that sends a request is not built yet (part 2), so a Given sends it the
// way the Oracle will, through the app's service: window.api.productOwnerRequest (channel
// po:request) and window.api.supervisorRequest (channel supervisor:request), each called with the
// whole request object, in simulation (mock: true). The request and its result then show in the
// owner's conversation: [data-testid="po-request"] in the Product Owner's drawer,
// [data-testid="svc-request"] in the Supervisor chat drawer (#svc-drawer, not the run's #sup-drawer,
// which has the same aria-label). Locators are roles and data-testid only (skills/ui-conventions).

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

const svcDrawer = (page) => page.getByTestId('svc-drawer');

When('I open the Supervisor chat', async ({ e2e }) => {
  const page = e2e.window;
  await page.getByRole('banner').getByRole('button', { name: 'Supervisor', exact: true }).click();
  await expect(svcDrawer(page)).toBeVisible();
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
