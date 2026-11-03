// Screenshot seed of the Monitor's Errors view (--view errors, #634 R12, mock-8): two sources (a
// Sentry project and the api logs file) and four error groups, one per state: a checkout 500 already
// an intent in the Inbox (its real intent card), an orders timeout with a fix run waiting for you,
// a worker error and a long-titled one still new. --mode empty: no source, no group (the empty
// state). The Sources… dialog: --click "#btn-errors-sources".

const path = require('path');

const MIN = 60 * 1000;

// the demo's errors: [ request, message, file:line, count, minutes between events ]
const DEMO = [
  { status: 500, method: 'POST', path: '/api/checkout', message: "TypeError: cannot read properties of undefined (reading 'total')", file: 'src/checkout/cart.ts', line: 142, count: 14, every: 4, state: 'intent' },
  { status: 500, method: 'GET', path: '/api/orders/1842', message: 'Timeout: database query took more than 30 s', file: 'src/orders/repository.ts', line: 57, count: 6, every: 9, state: 'fix-run' },
  { status: 'ERR', worker: 'email-digest', message: 'SMTP 421: service not available, closing channel', count: 3, every: 17, state: 'new' },
  { status: 500, method: 'PUT', path: '/api/customers/77/preferences/notifications/marketing-consent', message: 'ValidationError: consent date is in the future for the customer\'s time zone', file: 'src/customers/preferences/consent-validator.ts', line: 1203, count: 2, every: 25, state: 'new' },
];

function events(now) {
  const out = [];
  DEMO.forEach((d, i) => {
    for (let n = 0; n < d.count; n++) {
      const { count, every, state, ...ev } = d;
      out.push({ ...ev, id: `demo-${i}-${n}`, at: new Date(now - n * every * MIN - i * MIN).toISOString(), source: i % 2 ? 'api-logs' : 'sentry' });
    }
  });
  return out;
}

function seed({ ws, project, src, args }) {
  if (args.mode === 'empty') return;
  let grouping;
  let store;
  let intents;
  try {
    grouping = src('domains/monitor/grouping');
    store = src('domains/monitor/monitor-store');
    intents = src('domains/discovery/intents');
  } catch (e) {
    if (e.code === 'MODULE_NOT_FOUND') return; // an app before the Monitor
    throw e;
  }
  const now = Date.now();
  const evs = events(now);
  const groups = {};
  DEMO.forEach((d, i) => {
    const fp = grouping.fingerprint(evs.find((e) => e.id === `demo-${i}-0`));
    if (d.state === 'intent') {
      const card = intents.createIntent(ws.discovery, project.id, { workflow: 'monitor', finding: fp, title: `${d.method} ${d.path}`, text: `# ${d.method} ${d.path}\n\n- Status: ${d.status}\n- Message: ${d.message}\n- Where: ${d.file}:${d.line}\n- Count: ${d.count}`, author: 'oracle' });
      groups[fp] = { state: 'intent', cardId: card?.id || 'demo-card' };
    }
    if (d.state === 'fix-run') groups[fp] = { state: 'fix-run', cardId: 'demo-card', runId: 'demo-fix-run' };
  });
  store.writeState(ws.monitor || path.join(ws.root, 'monitor'), project.id, {
    sources: [
      { id: 'sentry', type: 'sentry', label: 'Sentry', org: 'acme', project: 'api', polledAt: new Date(now - 2 * MIN).toISOString() },
      { id: 'api-logs', type: 'log-file', label: 'api logs', path: '/var/log/api.log', every: 5 }, // not polled yet: "every 5 min", as in mock-8
    ],
    events: Object.fromEntries(evs.map((e) => [`${e.source}:${e.id}`, e])),
    groups,
    automation: { diagnose: 'ask', fix: 'off', dailyCap: 5 },
    diagnosed: { day: null, count: 0 },
  });
}

module.exports = {
  modes: ['empty'],
  seed,
};
