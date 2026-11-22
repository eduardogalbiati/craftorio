// #782: the notes' corners: the analyzed commit gone from the history asks for an analysis, and a failed analysis on
// a current plan keeps one "Analyze again", on its error card.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { withI18n } = require('@craftorio/shared/test/i18n-sandbox');

const ROOT = path.join(__dirname, '..', '..', '..');
const DATE = '2026-10-20T10:00:00.000Z';

function notes({ analysed, analysis = {}, timeZone = null }) {
  const sandbox = { console, esc: (s) => String(s ?? ''), ...(timeZone ? { TimeZone: timeZone } : {}) };
  sandbox.window = sandbox;
  withI18n(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'fronts', 'analyser', 'views', 'project', 'project-city-notes.js'), 'utf8'), sandbox);
  return sandbox.ProjectCityNotes.html({ model: { grouping: 'plan', districts: [] }, validation: { coverage: 1 }, layout: {}, analysis, analysed, ready: true });
}

const buttons = (html) => (html.match(/data-testid="project-city-analyze"/g) || []).length;

test('#782 the analyzed commit gone from the history: the primary action and why, not the current plan', () => {
  const html = notes({ analysed: { date: DATE, commit: 'abc1234', commitsSince: null, commitGone: true } });
  assert.match(html, /data-testid="project-city-moved"/);
  assert.match(html, /abc1234 is no longer in the history/);
  assert.match(html, /r3d-primary/);
  assert.doesNotMatch(html, /data-testid="project-city-plan"/);
});

test('#782 a count not known (git timed out) is not a commit gone: the plan stays current', () => {
  const html = notes({ analysed: { date: DATE, commit: 'abc1234', commitsSince: null, commitGone: false } });
  assert.match(html, /data-testid="project-city-plan"/);
  assert.doesNotMatch(html, /no longer in the history/);
  assert.doesNotMatch(html, /r3d-primary/);
});

test('#782 a report with no commit stays a current plan', () => {
  const html = notes({ analysed: { date: DATE, commit: null, commitsSince: null } });
  assert.match(html, /data-testid="project-city-plan"/);
  assert.doesNotMatch(html, /r3d-primary/);
});

test('#782 a failed analysis on a current plan shows one "Analyze again", on the error card', () => {
  const html = notes({ analysed: { date: DATE, commit: 'abc1234', commitsSince: 0 }, analysis: { error: 'The run failed.' } });
  assert.equal(buttons(html), 1);
  assert.match(html, /data-testid="project-city-plan"/);
  assert.match(html, /data-testid="project-city-analysis-error"[^]*data-testid="project-city-analyze"/);
});

test('#782 the date is the shared TimeZone\'s, in the owner\'s zone', () => {
  const asked = [];
  const timeZone = { current: () => 'America/Sao_Paulo', formatLocale: (...args) => { asked.push(args); return '20/10/2026'; } };
  const html = notes({ analysed: { date: DATE, commit: 'abc1234', commitsSince: 0 }, timeZone });
  assert.match(html, /Analyzed on 20\/10\/2026 · abc1234/);
  assert.equal(asked[0][2], 'America/Sao_Paulo');
});
