// @ts-check
// #79: whether a clone can push, as the runs' agents push (git without the app's credential helper, no terminal
// prompt): `checkPushAccess(dir, { run, remote })` runs `git push --dry-run` with the caller's git runner and,
// when git refuses, names the fix (`pushFix`: git's HTTPS credentials and the platform CLI's setup-git, the SSH
// key, else the account's rights); its `reason` is git's useful line (`gitSaidLine`). `NO_HTTPS_CREDENTIALS` (git's
// messages without credentials) is shared with workspace.js explainGitError; `httpsFix(platform, host)` with the
// clone URL's choice (domains/workspace/workspace.js pushableUrl); `isSshUrl(url)` with the fork's remote
// (project-onboarding.js forkRemoteOf); `safeUrl(url)` drops a user:token@ before a URL is logged.
// `isGitUrl` is the onboarding model's rule (packages/shared/onboarding-model.js). Used by the import
// (service/areas/project-onboarding.js) and a Remote / Fork + PR run's start (engine/run/checkout.js checkPush).

'use strict';

const Platforms = require('@craftorio/shared/platforms');
const { isGitUrl } = require('@craftorio/shared/onboarding-model');

// git's messages when it has no credentials for an HTTPS remote (or they give no access)
const NO_HTTPS_CREDENTIALS = /could not read Username|could not read Password|terminal prompts disabled|Authentication failed|Repository not found/i;

// git's message for a push from a repository without a commit: nothing to push, not a refusal
const NOTHING_TO_PUSH = /src refspec \S+ does not match any/i;

// an SSH remote (ssh://… or git@host:path)
const isSshUrl = (url) => /^(ssh:\/\/|[\w.-]+@[\w.-]+:)/i.test(String(url || '').trim());

// git's useful line of an error (fatal:, ERROR:, denied), not its last one ("and the repository exists.") nor the
// app's own explanation before it (workspace.js explainGitError); its first line when none matches
function gitSaidLine(text) {
  const lines = String(text || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /fatal:|error:|denied/i.test(l)) || lines[0] || '';
}

// a URL (or a line of text holding URLs) without their user:password@ (a token embedded in an HTTPS remote), for the logs
const safeUrl = (text) => String(text || '').replace(/\b([a-z][\w+.-]*:\/\/)[^@/\s]+@/gi, '$1');

// the platform of a repository URL (its host), GitHub's when the URL names none (an unknown origin)
const repoPlatformOrDefault = (url) => Platforms.platformOfRepoUrl(url) || Platforms.platformOrDefault();

// the platform CLI's command that makes git use its login over HTTPS (`gh auth setup-git`), '' when it has none
function setupGitText(platform) {
  const c = platform?.setupGitCommand?.();
  return c ? `${c.cli} ${c.args.join(' ')}` : '';
}

// what to do when git has no credentials for an HTTPS remote; no platform (a host none of them serves): a
// credential helper for that host
function httpsFix(platform, host = platform?.host) {
  return httpsFixWithKey(platform, host).fix;
}

// #110: httpsFix as { fix (English), fixKey, fixParams }: the screens show the catalog's text for fixKey
function httpsFixWithKey(platform, host = platform?.host) {
  const command = setupGitText(platform);
  if (command) {
    return { fix: `Run \`${command}\` so git pushes with the ${platform.cli} login, or set the remote to its SSH URL.`, fixKey: 'onboarding.push_fix_https_cli', fixParams: { command, cli: platform.cli } };
  }
  return host
    ? { fix: `Configure a git credential helper for ${host}, or set the remote to its SSH URL.`, fixKey: 'onboarding.push_fix_https_helper', fixParams: { host } }
    : { fix: 'Configure a git credential helper for this host, or set the remote to its SSH URL.', fixKey: 'onboarding.push_fix_https_helper_any', fixParams: {} };
}

// what to do about a refused push → { fix, setupGit? }: git's credentials over HTTPS (setupGit: the platform
// CLI's command that sets them, when it has one), the SSH key, else the account's rights. An origin on a host
// no platform serves gets the generic fix, never another host's CLI
function pushFix(reason, origin) {
  const host = Platforms.parseRepoUrl(origin)?.host || '';
  const platform = origin && host && !Platforms.platformOfRepoUrl(origin) ? null : repoPlatformOrDefault(origin);
  const command = setupGitText(platform);
  if (/Permission denied \(publickey|Host key verification failed|no such identity/i.test(reason)) {
    const sshHost = host || platform?.host || 'the host';
    return {
      fix: `git's SSH key is not accepted by ${sshHost}: add your SSH key to your account (test it with \`ssh -T git@${sshHost}\`), or set the remote to its HTTPS URL${command ? ` and run \`${command}\`` : ''}.`,
      fixKey: command ? 'onboarding.push_fix_ssh_cli' : 'onboarding.push_fix_ssh',
      fixParams: { host: sshHost, command },
    };
  }
  if (NO_HTTPS_CREDENTIALS.test(reason) && !isSshUrl(origin)) {
    return { ...httpsFixWithKey(platform, host), ...(command && platform ? { setupGit: { platform: platform.id, command } } : {}) };
  }
  return { fix: 'Check that your account may push to this repository (or fork it) and that the remote is reachable.', fixKey: 'onboarding.push_fix_rights', fixParams: {} };
}

/**
 * Whether the clone in `dir` can push: `git push --dry-run <remote>` to a branch name nobody uses, with `run`, a
 * git runner without the app's credential helper (as the runs' agents push: worktree.js git, workspace.js execGit
 * with auth: false). A repository without a commit has nothing to push: ok (unchecked). Never rejects. `reason`:
 * git's useful line (gitSaidLine); the fix is read from its whole message.
 * @param {string} dir
 * @param {{ run: (args: string[], cwd: string) => Promise<any>, remote?: string }} options
 * #110: `fix` stays English; `fixKey` + `fixParams` name its catalog text (onboarding.push_fix_*) for the screens.
 * @returns {Promise<{ ok: boolean, unchecked?: true, reason?: string, fix?: string, fixKey?: string, fixParams?: object, setupGit?: { platform: string, command: string } }>}
 */
async function checkPushAccess(dir, { run, remote = 'origin' }) {
  const origin = await Promise.resolve().then(() => run(['remote', 'get-url', remote], dir)).then((s) => String(s || '').trim(), () => '');
  try {
    await run(['push', '--dry-run', '--no-verify', remote, 'HEAD:refs/heads/craftorio-push-check'], dir);
    return { ok: true };
  } catch (e) {
    const reason = String(e?.message || e).trim();
    if (NOTHING_TO_PUSH.test(reason)) return { ok: true, unchecked: true };
    return { ok: false, reason: gitSaidLine(reason), ...pushFix(reason, origin) };
  }
}

module.exports = {
  checkPushAccess,
  gitSaidLine,
  httpsFix,
  isGitUrl,
  isSshUrl,
  NO_HTTPS_CREDENTIALS,
  pushFix,
  safeUrl,
};
