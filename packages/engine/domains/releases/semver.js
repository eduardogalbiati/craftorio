// A release's name as a semver and the order of two (#325), shared by the releases
// (packages/engine/domains/releases/releases.js) and the manifest's `requires`
// (packages/engine/domains/project/project-manifest.js): SEMVER, releaseSemver, compareSemver.

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

// The release's name as a semver (a leading `v` dropped), or null (`release-<run id>`, `v1.4`, `Spring drop`).
function releaseSemver(name) {
  const v = String(name || '').trim().replace(/^v(?=\d)/, '');
  return SEMVER.test(v) ? v : null;
}

// Semver precedence: <0, 0 or >0 (a pre-release is lower than its release; build metadata ignored).
function compareSemver(a, b) {
  const pa = SEMVER.exec(a);
  const pb = SEMVER.exec(b);
  for (let i = 1; i <= 3; i++) if (Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) - Number(pb[i]);
  if (!pa[4] || !pb[4]) return (pa[4] ? -1 : 0) + (pb[4] ? 1 : 0);
  const xa = pa[4].split('.');
  const xb = pb[4].split('.');
  for (let i = 0; i < Math.max(xa.length, xb.length); i++) {
    if (xa[i] === undefined || xb[i] === undefined) return xa[i] === undefined ? -1 : 1;
    const na = /^\d+$/.test(xa[i]);
    const nb = /^\d+$/.test(xb[i]);
    if (na && nb && Number(xa[i]) !== Number(xb[i])) return Number(xa[i]) - Number(xb[i]);
    if (na !== nb) return na ? -1 : 1;
    if (xa[i] !== xb[i]) return xa[i] < xb[i] ? -1 : 1;
  }
  return 0;
}

module.exports = {
  compareSemver,
  releaseSemver,
  SEMVER,
};
