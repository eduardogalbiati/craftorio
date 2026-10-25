// Release version (#436): naming the next release, pure (no DOM, no files, no model call). Loads in
// node (require) and in the renderer (<script>, window.ReleaseVersion), like roadmap-model.js.
//   suggestVersion({ last, issues })   the next version from the last shipped one and the labels of
//     the issues it ships: `breaking` a major, `enhancement` a minor, only `bug` / `documentation`
//     (or nothing labelled) a patch; a leading "v" kept; '1.0.0' when nothing shipped; '' when the
//     last name is not a version. → { version, bump, counts, reason: { key, values } }
//   reasonText(reason)                 that reason in the interface language ("Minor: 6 enhancements…")
//   recentReleases(releases, n = 3)    the last n shipped releases of releases:list, newest first
//   releaseIssues(stages, at, since)   the issues of a cut line after stage `at`: the ones done since the
//     last release (`since`, releases:list's next.issues) and the ones planned up to the cut
(function (root) {
  const node = typeof module === 'object' && module.exports;
  const t = (...a) => (node ? require('./i18n') : root.I18n)?.t(...a) ?? a[0];
  // the form src/domains/releases/releases.js accepts (SEMVER there), with a two-part "v1.4" too
  const VERSION = /^([vV]?)(\d+)\.(\d+)(?:\.(\d+))?$/;
  const KINDS = ['breaking', 'enhancement', 'bug', 'documentation'];
  const kindOf = (label) => {
    const name = String(label?.name ?? label ?? '').trim().toLowerCase();
    return /^breaking([ -]change)?$/.test(name) ? 'breaking' : KINDS.includes(name) ? name : null;
  };
  const REASONS = {
    first: 'release_version.reason_first',
    major: 'release_version.reason_major',
    minor: 'release_version.reason_minor',
    notVersion: 'release_version.reason_not_a_version',
    patch: 'release_version.reason_patch',
  };
  const COUNT_KEYS = {
    breaking: 'release_version.count_breaking',
    bug: 'release_version.count_bug',
    documentation: 'release_version.count_documentation',
    enhancement: 'release_version.count_enhancement',
  };

  function suggestVersion({ last, issues } = {}) {
    const counts = { breaking: 0, enhancement: 0, bug: 0, documentation: 0 };
    for (const i of issues || []) for (const kind of new Set((i?.labels || []).map(kindOf))) if (kind) counts[kind] += 1;
    const name = String(last ?? '').trim();
    if (!name) return { version: '1.0.0', bump: 'first', counts, reason: { key: REASONS.first, values: {} } };
    const m = VERSION.exec(name);
    if (!m) return { version: '', bump: null, counts, reason: { key: REASONS.notVersion, values: { last: name } } };
    const [major, minor, patch] = [+m[2], +m[3], m[4] == null ? null : +m[4]];
    const bump = counts.breaking ? 'major' : counts.enhancement ? 'minor' : 'patch';
    const parts = bump === 'major' ? [major + 1, 0, 0] : bump === 'minor' ? [major, minor + 1, 0] : [major, minor, (patch || 0) + 1];
    // a two-part name stays two-part unless a patch needs the third
    const version = `${m[1]}${patch == null && bump !== 'patch' ? parts.slice(0, 2).join('.') : parts.join('.')}`;
    return { version, bump, counts, reason: { key: REASONS[bump], values: { since: name, counts } } };
  }

  function reasonText(reason) {
    if (!reason?.key) return '';
    const counts = reason.values?.counts || {};
    const what = KINDS.filter((k) => counts[k]).map((k) => t(COUNT_KEYS[k], { count: counts[k] }));
    const list = what.length > 1 ? `${what.slice(0, -1).join(', ')} ${t('release_version.and')} ${what.at(-1)}` : what[0] || t('release_version.no_labelled_issue');
    return t(reason.key, { ...reason.values, what: list });
  }

  function recentReleases(releases, n = 3) {
    return (Array.isArray(releases) ? releases : [])
      .filter((r) => r && (!r.status || r.status === 'shipped'))
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, n);
  }

  function releaseIssues(stages, at, since = []) {
    const list = stages || [];
    let from = 0;
    for (let k = at - 1; k >= 0; k--) if (list[k]?.release) { from = k + 1; break; }
    // a cut line still waiting before this one holds what is done since the last release
    const held = from > 0 && list[from - 1].release.status !== 'shipped';
    const planned = list.slice(from, at + 1).filter((s) => !s.disabled).flatMap((s) => s.items || [])
      .filter((x) => x.status !== 'skipped').flatMap((x) => (x.issues?.length ? x.issues : x.number ? [x] : []));
    const seen = new Set();
    return [...(held ? [] : since || []), ...planned].filter((i) => i && !seen.has(i.number) && seen.add(i.number));
  }

  const api = {
    reasonText,
    recentReleases,
    releaseIssues,
    suggestVersion,
  };
  if (node) module.exports = api;
  else root.ReleaseVersion = api;
})(typeof window !== 'undefined' ? window : globalThis);
