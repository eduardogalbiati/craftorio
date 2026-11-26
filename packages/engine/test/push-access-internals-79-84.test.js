// #79 #84 internals of the review's fixes: engine/push-access.js (an empty repository, a host no platform serves,
// an SSH "Repository not found", a token in a logged URL, the one isGitUrl rule) and project-run-defaults.js's
// document files (upper-case names only: a Makefile is code).
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkPushAccess, isGitUrl, NO_HTTPS_CREDENTIALS, pushFix, safeUrl } = require('../engine/push-access');
const OnboardingModel = require('@craftorio/shared/onboarding-model');
const { projectFacts } = require('../domains/project/project-run-defaults');

const refusing = (origin, message) => async (args) => {
  if (args[0] === 'remote') return origin;
  throw new Error(message);
};

test('checkPushAccess: a repository without a commit has nothing to push: ok, unchecked', async () => {
  const r = await checkPushAccess('/x', { run: refusing('https://github.com/o/r.git', 'git push failed: error: src refspec HEAD does not match any') });
  assert.deepEqual(r, { ok: true, unchecked: true });
});

test('pushFix: an HTTPS host no platform serves gets a credential helper for that host, no gh button', () => {
  const r = pushFix("fatal: could not read Username for 'https://bitbucket.org': terminal prompts disabled", 'https://bitbucket.org/acme/tool.git');
  assert.match(r.fix, /credential helper for bitbucket\.org/);
  assert.doesNotMatch(r.fix, /gh auth/);
  assert.equal(r.setupGit, undefined);
});

test('pushFix: GitHub over HTTPS names gh auth setup-git and its button', () => {
  const r = pushFix('fatal: Authentication failed', 'https://github.com/o/r.git');
  assert.match(r.fix, /gh auth setup-git/);
  assert.equal(r.setupGit?.platform, 'github');
});

test('pushFix: an SSH remote whose account has no access is not told to set up HTTPS credentials', () => {
  const r = pushFix('ERROR: Repository not found.\nfatal: Could not read from remote repository.', 'git@github.com:o/r.git');
  assert.doesNotMatch(r.fix, /setup-git/);
  assert.equal(r.setupGit, undefined);
});

test('NO_HTTPS_CREDENTIALS: git messages without HTTPS credentials', () => {
  for (const m of ['could not read Username', 'could not read Password', 'terminal prompts disabled', 'Authentication failed', 'Repository not found']) assert.ok(NO_HTTPS_CREDENTIALS.test(m), m);
  assert.ok(!NO_HTTPS_CREDENTIALS.test('Permission denied (publickey)'));
});

test('safeUrl: drops a user:token@ from a URL and from a line of text', () => {
  assert.equal(safeUrl('https://user:ghp_secret@github.com/o/r.git'), 'https://github.com/o/r.git');
  assert.equal(safeUrl("fatal: unable to access 'https://x:tok@github.com/o/r.git/'"), "fatal: unable to access 'https://github.com/o/r.git/'");
  assert.equal(safeUrl('git@github.com:o/r.git'), 'git@github.com:o/r.git');
});

test('isGitUrl: the engine and the onboarding model share one rule (a space makes a local path)', () => {
  assert.equal(isGitUrl, OnboardingModel.isGitUrl);
  assert.ok(!isGitUrl('https://host/a/b c'));
  assert.equal(OnboardingModel.repoNameFromUrl('https://github.com/acme/tool.git'), 'acme-tool');
});

test('projectFacts: a Makefile or a Dockerfile next to a README is code, not documentation', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'craftorio-kind-84i-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'README.md'), '# x\n');
  fs.writeFileSync(path.join(dir, 'LICENSE'), 'MIT\n');
  fs.writeFileSync(path.join(dir, 'Makefile'), 'all:\n');
  assert.notEqual(projectFacts(dir).kind, 'docs');
});
