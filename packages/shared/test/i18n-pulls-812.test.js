// #812 the PRs / MRs screen's texts are in both catalogs (packages/shared/i18n/en.json, pt-BR.json). Acceptance
// tests written before the code. Assumed keys (under `pulls.*`, the screen's folder name):
//   pulls.menu_prs "PRs", pulls.menu_mrs "MRs" (the menu entry on GitHub / GitLab),
//   pulls.group_need_you "Need you", pulls.group_waiting "Waiting", pulls.group_others "Others",
//   pulls.empty_none, pulls.empty_no_remote, pulls.empty_no_cli (the empty states),
//   pulls.project_unreadable (a project that cannot be read), pulls.open_run (the link to the run).
const test = require('node:test');
const assert = require('node:assert/strict');
const en = require('../i18n/en.json');
const pt = require('../i18n/pt-BR.json');

const KEYS = ['menu_prs', 'menu_mrs', 'group_need_you', 'group_waiting', 'group_others', 'empty_none', 'empty_no_remote', 'empty_no_cli', 'project_unreadable', 'open_run'].map((k) => `pulls.${k}`);

test('#812 i18n: the screen\'s keys exist in en.json and pt-BR.json, none empty', () => {
  const missing = (cat) => KEYS.filter((k) => typeof cat[k] !== 'string' || !cat[k].trim());
  assert.deepEqual([missing(en), missing(pt)], [[], []]);
});

test('#812 i18n: the menu reads PRs / MRs and the groups Need you / Waiting / Others in English', () => {
  assert.deepEqual(
    ['menu_prs', 'menu_mrs', 'group_need_you', 'group_waiting', 'group_others'].map((k) => en[`pulls.${k}`]),
    ['PRs', 'MRs', 'Need you', 'Waiting', 'Others'],
  );
});
