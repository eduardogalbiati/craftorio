// A call to a served engine's HTTP API, as another client makes it (#751): POST /api/<channel> with
// Authorization: Bearer <the served URL's token> → the channel's result. Shared by the steps of
// findings, live updates and terminal paste. `servedUrl` is the served engine's URL (e2e.url).

const { expect } = require('@playwright/test');

async function callEngineAt(servedUrl, channel, arg) {
  const url = new URL(servedUrl);
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

// the same call for a scenario's served engine (e2e.url)
const callEngine = (e2e, channel, arg) => callEngineAt(e2e.url, channel, arg);

module.exports = { callEngineAt, callEngine };
