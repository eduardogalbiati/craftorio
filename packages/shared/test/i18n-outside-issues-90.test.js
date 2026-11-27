// #90: the texts of the outside issues on the Backlog and Roadmap screens, in both catalogs. Acceptance tests,
// written before the code.
// Keys (packages/shared/i18n/en.json and pt-BR.json, flat like the rest of the catalog):
// - backlog.outside_issue_badge: the badge of an issue written from outside the project (data-testid
//   "outside-issue-badge"), e.g. "Outside" / "De fora";
// - backlog.outside_issue_title: the badge's tooltip, why it is there ("Written by someone outside the project");
// - backlog.issue_quarantined: a suspected injection held apart (data-testid "issue-quarantined"), "Quarantined";
// - backlog.po_verdict: the heading of the Product Owner's verdict (data-testid "po-verdict");
// - backlog.approve_outside_issue: the owner's button, "Approve" / "Aprovar".
const test = require('node:test');
const assert = require('node:assert/strict');

const KEYS = ['backlog.outside_issue_badge', 'backlog.outside_issue_title', 'backlog.issue_quarantined', 'backlog.po_verdict', 'backlog.approve_outside_issue'];
const filled = (catalog) => KEYS.filter((k) => typeof catalog[k] === 'string' && catalog[k].trim().length > 0);

test('#90 the English catalog has every outside-issue text', () => {
  assert.deepEqual(filled(require('../i18n/en.json')), KEYS);
});

test('#90 the Portuguese catalog has every outside-issue text, translated', () => {
  const en = require('../i18n/en.json');
  const pt = require('../i18n/pt-BR.json');
  assert.deepEqual(filled(pt), KEYS);
  assert.deepEqual(KEYS.filter((k) => pt[k] === en[k]), []);
});

test('#90 the owner\'s button reads "Approve" in English', () => {
  assert.equal(require('../i18n/en.json')['backlog.approve_outside_issue'], 'Approve');
});
