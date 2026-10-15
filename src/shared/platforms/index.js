// The git platform registry (#351): the only place that maps a platform's id (`github`, `gitlab`:
// the backlog, the settings) to its short id (`gh`, `gl`: the workflow input `git_platform`, the
// skill suffixes such as ci-pipeline-gh). Every lookup by either vocabulary gives the adapter module
// itself (./github.js, ./gitlab.js); callers ask the adapter instead of branching on the platform.
// - PLATFORMS: the adapters, GitHub first; DEFAULT_PLATFORM: the first one's id;
// - resolvePlatform(name): the adapter, or an error naming the unknown platform;
// - findPlatform(name): the adapter or null; platformOrDefault(name): the adapter or GitHub's;
// - platformOfUrl(url): the adapter an issue, pull request or merge request URL belongs to, or null;
// - requestRef(name, number): "PR #12" / "MR !12".
// Browser: window.Platforms (loads after the adapters); Node: module.exports.
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const PLATFORMS = Object.freeze(node
    ? [require('./github'), require('./gitlab')]
    : [root.PlatformGitHub, root.PlatformGitLab]);
  const DEFAULT_PLATFORM = PLATFORMS[0].id;

  function findPlatform(name) {
    const key = String(name ?? '').trim().toLowerCase();
    return (key && PLATFORMS.find((p) => p.id === key || p.short === key)) || null;
  }

  function resolvePlatform(name) {
    const found = findPlatform(name);
    if (found) return found;
    const known = PLATFORMS.map((p) => `${p.id} (${p.short})`).join(', ');
    throw new Error(`Unknown git platform: ${name === undefined || name === null || name === '' ? '(none)' : JSON.stringify(String(name))}; known: ${known}.`);
  }

  const platformOrDefault = (name) => findPlatform(name) || PLATFORMS[0];

  function platformOfUrl(url) {
    return PLATFORMS.find((p) => p.parseIssueUrl(url) || p.parseTargetUrl(url)?.kind === 'pr') || null;
  }

  // "PR #12" / "MR !12" (GitHub's terms when the platform is unknown)
  function requestRef(name, number) {
    const r = platformOrDefault(name).request;
    return `${r.short} ${r.sign}${number}`;
  }

  const api = { DEFAULT_PLATFORM, findPlatform, platformOfUrl, platformOrDefault, PLATFORMS, requestRef, resolvePlatform };
  if (node) module.exports = api;
  else root.Platforms = api;
})(typeof window !== 'undefined' ? window : globalThis);
