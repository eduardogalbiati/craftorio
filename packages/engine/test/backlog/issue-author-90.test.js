// #90: who wrote an issue. Acceptance tests, written before the code.
// Contract:
// - new module packages/engine/domains/backlog/issue-author.js:
//   - isOutsideAssociation(assoc): false for OWNER, MEMBER, COLLABORATOR (any case); true for anything else
//     (CONTRIBUTOR, FIRST_TIME_CONTRIBUTOR, FIRST_TIMER, NONE, MANNEQUIN, empty, missing, unknown: fail closed);
//   - gitlabAssociation(accessLevel): a GitLab member's access level as an association: 50 'OWNER', 30 and 40
//     'MEMBER' (they may push: the adapter's WRITE_LEVEL), anything lower or missing an outside one ('NONE' when
//     missing);
// - the GitHub adapter's parseIssue (packages/shared/platforms/github.js) reads the raw issue's
//   `authorAssociation` (GraphQL / gh shape; REST's `author_association` too) and gives `authorAssociation`
//   upper-cased (null when missing);
// - fetchIssues (packages/engine/domains/backlog/issues.js) gives every issue `author` (login), `authorAssociation`
//   and `outside` (isOutsideAssociation). The GitHub list answers a JSON array of gh-shaped issues carrying
//   `authorAssociation` (whatever command reads it); GitLab's issue JSON has no association, so fetchIssues also
//   reads the project's members through a glab command whose arguments contain "members" (answer: a JSON array of
//   { username, access_level }) and maps each author with gitlabAssociation;
// - issueFields (the copy a roadmap item keeps, #168) keeps author, authorAssociation and outside.
const test = require('node:test');
const assert = require('node:assert/strict');

const loadAuthor = () => require('../../domains/backlog/issue-author');
const issues = require('../../domains/backlog/issues');
const Platforms = require('@craftorio/shared/platforms');

const ghIssue = (number, login, authorAssociation) => ({
  number, title: `Issue ${number}`, state: 'OPEN', labels: [], url: `https://github.com/o/r/issues/${number}`,
  author: { login }, assignees: [], body: 'Body', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z',
  ...(authorAssociation === undefined ? {} : { authorAssociation }),
});
const glIssue = (iid, username) => ({
  iid, title: `Issue ${iid}`, state: 'opened', labels: [], web_url: `https://gitlab.com/g/app/-/issues/${iid}`,
  author: { username }, assignees: [], description: 'Body', created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z',
});
// the platform CLI is the boundary: a fake exec answering `list` to every command
const answering = (list) => async () => JSON.stringify(list);
const view = (list) => list.map((i) => `${i.number}:${i.author}:${i.authorAssociation}:${i.outside}`);

test('#90 isOutsideAssociation: owner, member and collaborator are inside, in any case', () => {
  const { isOutsideAssociation } = loadAuthor();
  assert.deepEqual(['OWNER', 'MEMBER', 'COLLABORATOR', 'owner', 'Member'].map(isOutsideAssociation), [false, false, false, false, false]);
});

test('#90 isOutsideAssociation: contributors, first-timers, none, unknown and missing are outside', () => {
  const { isOutsideAssociation } = loadAuthor();
  const outside = ['CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'FIRST_TIMER', 'NONE', 'MANNEQUIN', 'SOMETHING_NEW', '', null, undefined];
  assert.deepEqual(outside.map(isOutsideAssociation), outside.map(() => true));
});

test('#90 gitlabAssociation: owner 50, maintainer and developer are inside; reporter, guest and no member are outside', () => {
  const { gitlabAssociation, isOutsideAssociation } = loadAuthor();
  assert.deepEqual([gitlabAssociation(50), gitlabAssociation(40), gitlabAssociation(30)], ['OWNER', 'MEMBER', 'MEMBER']);
  assert.deepEqual([20, 10, undefined].map((l) => isOutsideAssociation(gitlabAssociation(l))), [true, true, true]);
});

test('#90 the GitHub adapter reads the author association of an issue', () => {
  const github = Platforms.findPlatform('github');
  assert.deepEqual([github.parseIssue(ghIssue(1, 'ana', 'owner')).authorAssociation, github.parseIssue(ghIssue(2, 'bob', undefined)).authorAssociation], ['OWNER', null]);
});

test('#90 a GitHub sync records each issue\'s author, association and whether it came from outside', async () => {
  const list = [ghIssue(1, 'ana', 'OWNER'), ghIssue(2, 'cleo', 'COLLABORATOR'), ghIssue(3, 'eve', 'FIRST_TIME_CONTRIBUTOR')];
  const got = await issues.fetchIssues({ platform: 'github', repo: 'https://github.com/o/r', exec: answering(list) });
  assert.deepEqual(view(got), ['1:ana:OWNER:false', '2:cleo:COLLABORATOR:false', '3:eve:FIRST_TIME_CONTRIBUTOR:true']);
});

test('#90 a GitHub issue with no association is outside (fail closed)', async () => {
  const got = await issues.fetchIssues({ platform: 'github', repo: 'https://github.com/o/r', exec: answering([ghIssue(4, 'zed', undefined)]) });
  assert.equal(got[0].outside, true);
});

test('#90 a GitLab sync maps each author through the project\'s members', async () => {
  const members = [{ username: 'ana', access_level: 50 }, { username: 'dev', access_level: 30 }, { username: 'rita', access_level: 20 }];
  const exec = async (cli, args) => JSON.stringify(args.join(' ').includes('members') ? members : [glIssue(1, 'ana'), glIssue(2, 'dev'), glIssue(3, 'rita'), glIssue(4, 'eve')]);
  const got = await issues.fetchIssues({ platform: 'gitlab', repo: 'https://gitlab.com/g/app', exec });
  assert.deepEqual(got.map((i) => `${i.number}:${i.author}:${i.outside}`), ['1:ana:false', '2:dev:false', '3:rita:true', '4:eve:true']);
  assert.deepEqual([got[0].authorAssociation, got[1].authorAssociation], ['OWNER', 'MEMBER']);
});

test('#90 a roadmap item\'s copy of an issue keeps who wrote it', () => {
  const copy = issues.issueFields({ number: 3, title: 't', body: 'b', author: 'eve', authorAssociation: 'NONE', outside: true });
  assert.deepEqual([copy.author, copy.authorAssociation, copy.outside], ['eve', 'NONE', true]);
});
