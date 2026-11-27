// @ts-check
// Who wrote an issue (#90): on a public repository anyone can open one, and its text must never become work
// without the owner. The backlog sync (issues.js fetchIssues) keeps each issue's author and association:
// - INSIDE / isOutsideAssociation: the owner, a member and a collaborator are inside; anything else is outside,
//   an unknown or missing association too (fail closed);
// - gitlabAssociation: a GitLab member's access level as an association (the adapter's WRITE_LEVEL may push);
// - withAuthors: the synced issues with `authorAssociation` (their own, else the adapter's authors read) and `outside`;
// - awaitsOwner: an outside issue the owner has not approved, or edited since (textHash, approvalHolds), never planned
//   nor run (roadmap.js propose and cleanItem, backlog.js runInputs, the runs:start channel);
// - trustFields: the fields a copy of an issue (a roadmap or queue item) keeps.

const crypto = require('crypto');
const gitlab = require('@craftorio/shared/platforms/gitlab');

const INSIDE = [
  'COLLABORATOR',
  'MEMBER',
  'OWNER',
];
const OWNER_LEVEL = 50;

const isOutsideAssociation = (assoc) => !INSIDE.includes(String(assoc ?? '').toUpperCase());

function gitlabAssociation(level) {
  const n = Number(level);
  if (n >= OWNER_LEVEL) return 'OWNER';
  return n >= gitlab.WRITE_LEVEL ? 'MEMBER' : 'NONE';
}

// The adapter's authors read (parseIssueAuthors): GitHub's [{ number, authorAssociation }], GitLab's members
// [{ login, accessLevel }]. An issue's own association wins; a GitLab author who is no member is NONE.
function associationOf(issue, byNumber, byLogin) {
  if (issue.authorAssociation) return String(issue.authorAssociation).toUpperCase();
  if (byNumber.get(issue.number)) return byNumber.get(issue.number);
  return byLogin.size ? gitlabAssociation(byLogin.get(issue.author)) : null;
}

function withAuthors(issues, authors = []) {
  const byNumber = new Map(authors.filter((a) => a.number != null).map((a) => [Number(a.number), a.authorAssociation || null]));
  const byLogin = new Map(authors.filter((a) => a.login).map((a) => [a.login, a.accessLevel]));
  return issues.map((i) => {
    const authorAssociation = associationOf(i, byNumber, byLogin);
    return { ...i, authorAssociation, outside: isOutsideAssociation(authorAssociation) };
  });
}

// The text the owner approved: an approval ({ at, hash }) holds for that title and body only, so an issue edited after
// the Approve waits for the owner again (an approval without a hash, from a test or a copy, holds as it is)
const textHash = (i) => crypto.createHash('sha256').update(`${i?.title || ''}\n${i?.body || ''}`).digest('hex');
const approvalHolds = (i, approval) => !!approval && (!approval.hash || approval.hash === textHash(i));

const awaitsOwner = (i) => i?.outside === true && !approvalHolds(i, i.ownerApproved);

// What a copy of an issue keeps of who wrote it and the owner's approval (only what is known: an older copy, a
// local or demo issue stays as it was)
function trustFields(i) {
  const known = { author: i?.author, authorAssociation: i?.authorAssociation, outside: i?.outside, ownerApproved: i?.ownerApproved };
  return Object.fromEntries(Object.entries(known).filter(([, v]) => v !== undefined && v !== null));
}

module.exports = {
  approvalHolds,
  awaitsOwner,
  gitlabAssociation,
  INSIDE,
  isOutsideAssociation,
  textHash,
  trustFields,
  withAuthors,
};
