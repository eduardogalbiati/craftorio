// #273 acceptance tests (written before the code): the screens show times in the workspace's time
// zone (settings.timeZone), and Settings › General has the Time zone select
// (data-testid="settings-time-zone", an IANA list, the saved zone selected). The page is the real one
// (test/renderer-app-harness.js loads index.html's scripts in a vm sandbox with a fake window.api);
// the tests read the markup strings the views produce. Asia/Tokyo is neither CI's UTC nor the
// owner's UTC-3: 01:14Z reads 10:14 only in Tokyo.
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./renderer-app-harness');

const allEls = (app) => [...app.elements.values(), ...app.created];
// a view's markup may be a function, drawn again in the interface language (#329)
const markupOf = (d) => (typeof d.markup === 'function' ? d.markup() : d.markup || '');
const allMarkup = (app) => [...app.defs.values()].map(markupOf).concat(allEls(app).map((e) => e.innerHTML || '')).join('\n');

async function page(api = {}) {
  const app = loadApp({
    api: {
      getSettings: async () => ({ timeZone: 'Asia/Tokyo' }), getWorkspace: async () => ({ root: 'C:/ws' }),
      // Settings draws its other pages too (the CLIs, the voice CLI's status, the index)
      envDetails: async () => [],
      speechStatus: async () => ({ path: null, command: 'whisper', installHint: 'pip install whisper', models: [], model: 'base', languages: ['en'], language: 'en' }),
      indexStatus: async () => ({ path: 'C:/ws/index.db', runs: 0 }),
      ...api,
    },
  });
  await app.boot();
  return app;
}

test('#273 the page loads the time zone helper (window.TimeZone) for the screens', async () => {
  const app = await page();
  assert.equal(app.run("typeof window.TimeZone?.formatTime === 'function' ? window.TimeZone.formatTime('2026-10-05T01:14:00Z', 'Asia/Tokyo') : null"), '10:14');
});

test('#273 Settings › General has the time zone select', async () => {
  const app = await page();
  app.run("showView('settings')");
  await app.settle(20);
  assert.match(allMarkup(app), /<select[^>]*data-testid="settings-time-zone"/);
});

test('#273 Settings: the time zone select lists IANA zones with the saved one selected', async () => {
  const app = await page();
  app.run("showView('settings')");
  await app.settle(20);
  const select = allEls(app).find((e) => /value="Asia\/Tokyo"/.test(e.innerHTML || '') && /value="America\/Sao_Paulo"/.test(e.innerHTML || ''));
  assert.ok(select, 'an element lists Asia/Tokyo and America/Sao_Paulo as options');
  // selected by the element's value or by the option's `selected` attribute
  const selected = select.value || (/<option[^>]*value="([^"]+)"[^>]*\sselected/.exec(select.innerHTML) || [])[1];
  assert.equal(selected, 'Asia/Tokyo');
});

test('#273 the Oracle screen shows a message\'s time in the chosen zone', async () => {
  const msg = { id: 'm1', role: 'oracle', ts: '2026-10-05T01:14:00.000Z', text: 'Hello' };
  const app = await page({ oracleHistory: async () => [msg], oracleState: async () => ({}) });
  app.run("showView('oracle')");
  await app.settle(20);
  const markup = allEls(app).map((e) => e.innerHTML || '').join('\n');
  assert.ok(markup.includes('Hello'), 'the message is rendered');
  assert.ok(markup.includes('10:14'), 'its time reads 10:14 (Tokyo)');
});

test('#273 choosing another zone in Settings saves it and redraws the open Oracle screen\'s times in it', async () => {
  const msg = { id: 'm1', role: 'oracle', ts: '2026-10-05T01:14:00.000Z', text: 'Hello' };
  const app = await page({ oracleHistory: async () => [msg], oracleState: async () => ({}), setSettings: async (p) => ({ timeZone: p.timeZone }) });
  app.run("showView('oracle')");
  await app.settle(20);
  app.run("showView('settings')");
  await app.settle(20);
  // the fake DOM gives one element per selector string: the one the view binds its handler on
  const select = app.el('#set-time-zone');
  assert.equal(typeof select.onchange, 'function', 'the time zone select has a change handler');
  // Kolkata is UTC+5:30: 01:14Z reads 06:44 (or 6:44 AM), a minute no whole-hour zone shows
  await select.onchange({ target: { value: 'Asia/Kolkata' } });
  await app.settle(20);
  assert.deepEqual(app.callsTo('setSettings').map((args) => JSON.stringify(args[0])), ['{"timeZone":"Asia/Kolkata"}']);
  app.run("showView('oracle')");
  await app.settle(20);
  const markup = allEls(app).map((e) => e.innerHTML || '').join('\n');
  assert.ok(markup.includes('6:44'), 'the Oracle message now reads 06:44 (Kolkata)');
});
