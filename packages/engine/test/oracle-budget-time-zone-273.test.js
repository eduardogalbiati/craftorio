// #273 acceptance tests (written before the code): the Oracle's day is the owner's local day
// (settings.timeZone): its daily budget counts and resets at local midnight, its "resumes" time is
// that midnight, and its turn context names the zone and the local time. Asia/Tokyo (UTC+9) is
// neither CI's UTC nor the owner's UTC-3, so a cut in either fails. Driven through the service
// (oracle:state, oracle:ask with mock, analytics:agents) with Date faked to a fixed instant; usage.jsonl
// lines keep UTC stamps.
process.env.MULTIAGENT_MOCK_DELAY_SCALE ??= '0.05';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { makeService } = require('./service/helpers');

function tokyoOracle(t, lines, now) {
  const { service, api } = makeService(t);
  api['settings:set']({ timeZone: 'Asia/Tokyo', oracle: { dailyBudgetUsd: 1 } });
  const dir = service.workspace().oracle;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), lines.map((l) => JSON.stringify(l)).join('\n') + (lines.length ? '\n' : ''));
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(now) });
  return { service, api, dir };
}

// 19:00 on Oct 5 in Tokyo; two lines that day (one at 01:00 JST, still Oct 4 in UTC), one the day before
const SPEND = [
  { ts: '2026-10-04T16:00:00.000Z', costUsd: 2, cumulativeUsd: null },
  { ts: '2026-10-05T09:00:00.000Z', costUsd: 3, cumulativeUsd: null },
  { ts: '2026-10-04T14:00:00.000Z', costUsd: 100, cumulativeUsd: null },
];

test('#273 Oracle budget: today\'s spend is the local day\'s turns', (t) => {
  const { api } = tokyoOracle(t, SPEND, '2026-10-05T10:00:00Z');
  assert.equal(api['oracle:state']().today.spentUsd, 5);
});

test('#273 Oracle budget: it resumes at the next local midnight', (t) => {
  const { api } = tokyoOracle(t, [], '2026-10-04T15:30:00Z'); // 00:30 on Oct 5 in Tokyo
  assert.equal(api['oracle:state']().today.resumesAt, '2026-10-05T15:00:00.000Z');
});

test('#273 Oracle budget: a budget spent at 23:00 local is reset at local midnight', (t) => {
  const { api } = tokyoOracle(t, [{ ts: '2026-10-04T14:00:00.000Z', costUsd: 4, cumulativeUsd: null }], '2026-10-04T15:30:00Z');
  const st = api['oracle:state']();
  assert.equal(st.today.spentUsd, 0);
  assert.equal(st.paused, false);
});

test('#273 Analytics › Agents: the Oracle\'s spend today is the local day\'s', (t) => {
  const { api } = tokyoOracle(t, SPEND, '2026-10-05T10:00:00Z');
  assert.equal(api['analytics:agents']({}).agents.oracle.today.spentUsd, 5);
});

test('#273 Oracle turn context: names the owner\'s time zone and the local time', async (t) => {
  const { api, dir } = tokyoOracle(t, [], '2026-10-05T01:14:00Z'); // 10:14 in Tokyo
  await api['oracle:ask']({ question: 'What is going on?', mock: true });
  // the first turn of a session: the whole prompt sent is kept in session.md
  const prompt = fs.readFileSync(path.join(dir, 'session.md'), 'utf8');
  const line = prompt.split('\n').find((l) => l.includes('Asia/Tokyo'));
  assert.ok(line, 'a line names Asia/Tokyo');
  assert.ok(line.includes('10:14'), line);
});
