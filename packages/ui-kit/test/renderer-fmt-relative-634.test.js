// #634: one translated "how long ago" for the whole page (app.js fmtRelative, used by the notification
// centre and the Monitor's Errors screen): just now under a minute, minutes under an hour, hours under a
// day, else the local date; in the interface language (en and pt-BR here). The page is the real one
// (renderer-app-harness.js loads index.html's scripts in a vm sandbox); the times are relative to now,
// with margins well away from each threshold.
const test = require('node:test');
const assert = require('node:assert/strict');
const I18n = require('@multiagent/shared/i18n.js');
const { loadApp } = require('./renderer-app-harness');

const ago = (seconds) => new Date(Date.now() - seconds * 1000).toISOString();
const relative = (app, iso) => String(app.run(`fmtRelative(${JSON.stringify(iso)})`));

test('#634 fmtRelative in English: just now, minutes, hours, then the date', () => {
  const app = loadApp();
  assert.equal(relative(app, ago(20)), 'just now');
  assert.equal(relative(app, ago(5 * 60 + 10)), '5 min ago');
  assert.equal(relative(app, ago(59 * 60 + 10)), '59 min ago');
  assert.equal(relative(app, ago(2 * 3600 + 60)), '2 h ago');
  assert.equal(relative(app, ago(23 * 3600 + 60)), '23 h ago');
  const older = relative(app, ago(3 * 86400));
  assert.match(older, /\d/);
  assert.doesNotMatch(older, /ago|now/);
});

test('#634 fmtRelative in Portuguese (Brazil): agora há pouco, há N min, há N h, then the date', (t) => {
  I18n.setLanguage('pt-BR');
  t.after(() => I18n.setLanguage('en'));
  const app = loadApp();
  // the page's own I18n (the sandbox's copy of shared/i18n.js)
  app.run("(window.I18n || I18n).setLanguage('pt-BR')");
  assert.equal(relative(app, ago(20)), 'agora há pouco');
  assert.equal(relative(app, ago(5 * 60 + 10)), 'há 5 min');
  assert.equal(relative(app, ago(2 * 3600 + 60)), 'há 2 h');
  const older = relative(app, ago(3 * 86400));
  assert.match(older, /\d{1,2}\/\d{1,2}\/\d{4}/);
  assert.doesNotMatch(older, /há|agora/);
});

test('#634 fmtRelative: a time in the future reads just now; no time reads nothing', () => {
  const app = loadApp();
  assert.equal(relative(app, new Date(Date.now() + 60000).toISOString()), 'just now');
  assert.equal(relative(app, 'not a date'), '');
});
