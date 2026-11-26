// @ts-check
// #79: whether a clone can push, as the runs' agents push (git without the app's credential helper, no terminal
// prompt): `checkPushAccess(dir, { run, remote })` runs `git push --dry-run` and, when git refuses, names the fix
// (`pushFix`: git's HTTPS credentials and the platform CLI's setup-git, the SSH key, else the account's rights).
// `httpsFix(platform)` / `platformOfUrl(url)` are shared with the clone URL's choice (domains/workspace/workspace.js
// pushableUrl). Used by the import (service/areas/project-onboarding.js) and a Remote / Fork + PR run's start
// (engine/run/checkout.js checkPush).

'use strict';

const { execFile } = require('child_process');
const Platforms = require('@craftorio/shared/platforms');

// a remote git URL: https://…, ssh://…, git://…, git@host:owner/repo(.git); a local path is not
const isGitUrl = (s) => /^(https?|ssh|git):\/\/\S+$/i.test(s || '') || /^[\w.-]+@[\w.-]+:\S+$/.test(s || '');

// the platform of a repository URL (its host), GitHub's when the host names none
const platformOfUrl = (url) => Platforms.platformOfRepoUrl(url) || Platforms.platformOrDefault();

// the platform CLI's command that makes git use its login over HTTPS (`gh auth setup-git`), '' when it has none
function setupGitText(platform) {
  const c = platform.setupGitCommand?.();
  return c ? `${c.cli} ${c.args.join(' ')}` : '';
}

// what to do when git has no credentials for an HTTPS remote
function httpsFix(platform) {
  const command = setupGitText(platform);
  return command
    ? `Run \`${command}\` so git pushes with the ${platform.cli} login, or set the remote to its SSH URL.`
    : `Configure a git credential helper for ${platform.host}, or set the remote to its SSH URL.`;
}

// what to do about a refused push → { fix, setupGit? }: git's credentials over HTTPS (setupGit: the platform
// CLI's command that sets them, when it has one), the SSH key, else the account's rights
function pushFix(reason, origin) {
  const platform = platformOfUrl(origin);
  const command = setupGitText(platform);
  if (/could not read Username|terminal prompts disabled|Authentication failed|could not read Password/i.test(reason)) {
    return { fix: httpsFix(platform), ...(command ? { setupGit: { platform: platform.id, command } } : {}) };
  }
  if (/Permission denied \(publickey|Host key verification failed|no such identity/i.test(reason)) {
    const host = Platforms.parseRepoUrl(origin)?.host || platform.host;
    return { fix: `git's SSH key is not accepted by ${host}: add your SSH key to your account (test it with \`ssh -T git@${host}\`), or set the remote to its HTTPS URL${command ? ` and run \`${command}\`` : ''}.` };
  }
  return { fix: 'Check that your account may push to this repository (or fork it) and that the remote is reachable.' };
}

// git as the runs' agents run it: no credential helper of the app, no terminal prompt; rejects with git's message
function plainGit(args, cwd) {
  const env = { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' };
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, env, timeout: 60000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`git ${args[0]} failed: ${String(stderr || err.message).trim()}`));
      else resolve(stdout);
    });
  });
}

/**
 * Whether the clone in `dir` can push: `git push --dry-run <remote>` to a branch name nobody uses, without the
 * app's credential helper, as the runs' agents push. Never rejects.
 * @param {string} dir
 * @param {{ run?: (args: string[], cwd: string) => Promise<any>, remote?: string }} [options]
 * @returns {Promise<{ ok: boolean, reason?: string, fix?: string, setupGit?: { platform: string, command: string } }>}
 */
async function checkPushAccess(dir, { run = plainGit, remote = 'origin' } = {}) {
  const origin = await Promise.resolve().then(() => run(['remote', 'get-url', remote], dir)).then((s) => String(s || '').trim(), () => '');
  try {
    await run(['push', '--dry-run', '--no-verify', remote, 'HEAD:refs/heads/craftorio-push-check'], dir);
    return { ok: true };
  } catch (e) {
    const reason = String(e?.message || e).trim();
    return { ok: false, reason, ...pushFix(reason, origin) };
  }
}

module.exports = {
  checkPushAccess,
  httpsFix,
  isGitUrl,
  platformOfUrl,
  pushFix,
};
