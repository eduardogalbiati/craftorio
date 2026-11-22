// #557 (first part of #478, SEC-13): every release deploy.yml publishes ships a signed SHA256SUMS.
// CONTRACT (acceptance tests written before the code):
// - the job that runs `gh release create` (publish) computes the sums with `sha256sum` over the
//   downloaded assets into a file named SHA256SUMS, signs it (cosign sign-blob, keyless through the
//   job's OIDC token, or a GPG detached signature) and uploads both with the packages;
// - the notes keep `--generate-notes` and add the sums (`--notes` / `--notes-file`);
// - sums and signature come before `gh release create`, never `continue-on-error`, never `|| true`;
// - the signing never runs on a fork (a `github.repository` guard) nor on a pull request;
// - (2026-10-31) a stable tag builds and publishes its own release, an rc only by hand: both carry the
//   sums and the signature;
// - docs/readme/020-install.md says how to check a download per system; SEC-13 notes what shipped.
// Reads files only: nothing here builds, signs or publishes.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const load = () => yaml.load(read('.github', 'workflows', 'deploy.yml'));
const stepText = (s) => `${s.run || ''}\n${s.uses || ''}\n${JSON.stringify(s.with || {})}`;
const jobOf = (wf, re) => {
  const found = Object.entries(wf.jobs || {}).filter(([, job]) => (job.steps || []).some((s) => re.test(stepText(s))));
  assert.equal(found.length, 1, `one job matches ${re}`);
  return { id: found[0][0], job: found[0][1], steps: found[0][1].steps };
};
const publishJob = (wf = load()) => jobOf(wf, /gh release create/);
const idx = (steps, re) => steps.findIndex((s) => re.test(stepText(s)));
const SIGNER = /cosign\s+sign-blob|gpg\b[^\n]*--detach-sign|gpg\b[^\n]*-b\b/;
const SIG_FILE = /SHA256SUMS\.(sig|pem|sigstore\.json|bundle|asc|crt)/;
const signerKind = (script) => (/cosign/.test(script) ? 'cosign' : /gpg/.test(script) ? 'gpg' : null);

test('#557 the publish job writes SHA256SUMS with sha256sum, after the assets are downloaded', () => {
  const { steps } = publishJob();
  const download = idx(steps, /download-artifact/);
  const sums = idx(steps, /sha256sum[\s\S]*SHA256SUMS|SHA256SUMS[\s\S]*sha256sum/);
  assert.equal(download >= 0, true, 'the job downloads the build artifacts');
  assert.equal(sums >= 0, true, 'a step runs sha256sum into SHA256SUMS');
  assert.equal(sums > download, true, 'the sums are computed from the downloaded files');
});

test('#557 SHA256SUMS is signed in the publish job (cosign sign-blob or a GPG detached signature)', () => {
  const { steps } = publishJob();
  const sign = idx(steps, SIGNER);
  assert.equal(sign >= 0, true, 'a step signs with cosign sign-blob or gpg --detach-sign');
  assert.match(stepText(steps[sign]), /SHA256SUMS/, 'the signed file is SHA256SUMS');
  const sums = idx(steps, /sha256sum/);
  assert.equal(sign >= sums, true, 'signed after it is written');
});

test('#557 the release carries SHA256SUMS and its signature next to the packages', () => {
  const { steps } = publishJob();
  const script = steps.map(stepText).join('\n');
  const create = steps.map(stepText).find((t) => /gh release create/.test(t));
  const uploadLines = steps.map(stepText).filter((t) => /gh release (create|upload)/.test(t)).join('\n');
  assert.match(create, /assets\/\*/, 'every package of assets/ is still published');
  const sumsUploaded = /SHA256SUMS(?!\.)/.test(uploadLines) || /assets\/SHA256SUMS(?!\.)/.test(script);
  assert.equal(sumsUploaded, true, 'SHA256SUMS goes with the release (named in the upload or written into assets/)');
  const sigUploaded = SIG_FILE.test(uploadLines) || new RegExp(`assets/${SIG_FILE.source}`).test(script);
  assert.equal(sigUploaded, true, 'the signature (.sig/.pem, .sigstore.json or .asc) goes with the release');
});

test('#557 the release notes keep the generated notes and add the sums', () => {
  const { steps } = publishJob();
  const create = steps.map(stepText).find((t) => /gh release create/.test(t));
  assert.match(create, /--generate-notes/);
  assert.match(create, /--notes(-file)?[\s=]/, 'the sums go in the notes (--notes or --notes-file)');
});

test('#557 a failure of the sums or the signature stops the release before it is published', () => {
  const { steps } = publishJob();
  const create = idx(steps, /gh release create/);
  const sums = idx(steps, /sha256sum/);
  const sign = idx(steps, SIGNER);
  assert.equal(sums >= 0 && sign >= 0, true, 'sums and signature steps exist');
  assert.equal(create >= Math.max(sums, sign), true, 'gh release create comes after the sums and the signature');
  for (const s of steps.filter((st) => /sha256sum|cosign|gpg/.test(stepText(st)))) {
    assert.equal(s['continue-on-error'] === true, false, `${s.name || s.uses}: no continue-on-error`);
    const risky = String(s.run || '').split('\n').filter((l) => /sha256sum|sign-blob|gpg/.test(l) && /\|\|\s*(true|:)/.test(l));
    assert.deepEqual(risky, [], 'a failing sums or signature command is not swallowed');
  }
});

test('#557 signing: the OIDC permission only on the publish job, never on forks or pull requests', () => {
  const wf = load();
  const { id, job, steps } = publishJob(wf);
  const script = steps.map(stepText).join('\n');
  const kind = signerKind(script);
  assert.notEqual(kind, null, 'the publish job signs with cosign or gpg');
  assert.notEqual(wf.permissions?.['id-token'], 'write', 'no id-token: write for the whole workflow');
  for (const [other, j] of Object.entries(wf.jobs)) {
    if (other !== id) assert.notEqual(j.permissions?.['id-token'], 'write', `${other}: no id-token: write`);
  }
  if (kind === 'cosign') {
    assert.equal(job.permissions?.['id-token'], 'write', 'cosign keyless needs id-token: write on the publish job');
    assert.equal(job.permissions?.contents, 'write', 'the publish job still writes the release');
  } else {
    assert.match(script, /secrets\./, 'the GPG key comes from a repository secret');
  }
  const on = wf.on || {};
  assert.equal('pull_request' in on || 'pull_request_target' in on, false, 'Deploy never runs for a pull request');
  const signStep = steps[idx(steps, SIGNER)];
  const guard = `${job.if || ''}\n${signStep.if || ''}`;
  assert.match(guard, /github\.repository\s*==/, 'the signing is guarded against forks (github.repository == ...)');
});

test('#557 every release deploy.yml creates carries the sums: the stable one (tag) and the rc (by hand)', () => {
  const { steps } = publishJob();
  const creates = steps.filter((st) => /gh release create/.test(stepText(st)));
  assert.equal(creates.length, 2, 'the stable release and the rc');
  for (const st of creates) assert.match(stepText(st), /--notes-file[^\n]*sha256-notes/, `${st.name}: the sums in the notes`);
  assert.equal(creates.every((st) => idx(steps, SIGNER) < steps.indexOf(st)), true, 'signed before either is created');
});

test('#557 Install docs: per system, compute the hash and compare it with SHA256SUMS', () => {
  const doc = read('docs', 'readme', '020-install.md');
  assert.match(doc, /SHA256SUMS/);
  assert.match(doc, /Get-FileHash[^\n]*-Algorithm SHA256/, 'Windows');
  assert.match(doc, /shasum -a 256/, 'macOS');
  assert.match(doc, /sha256sum/, 'Linux');
  assert.match(doc, /not signed yet/, 'code signing is still #478');
});

test('#557 Install docs: the signature check matches the workflow\'s signer and identity', () => {
  const doc = read('docs', 'readme', '020-install.md');
  const kind = signerKind(publishJob().steps.map(stepText).join('\n'));
  if (kind === 'cosign') {
    const verify = doc.split('\n').filter((l, i, all) => /cosign verify-blob/.test(l) || /cosign verify-blob/.test(all.slice(Math.max(0, i - 6), i).join('\n'))).join('\n');
    assert.match(verify, /cosign verify-blob/);
    assert.match(verify, /SHA256SUMS/);
    assert.match(verify, /--certificate-identity(-regexp)?[\s=][^\n]*eduardogalbiati\/craftorio\/\.github\/workflows\/deploy\.yml/, 'the identity is this repository\'s deploy.yml');
    assert.match(verify, /--certificate-oidc-issuer[\s=]+["']?https:\/\/token\.actions\.githubusercontent\.com/, 'GitHub Actions is the issuer');
  } else {
    assert.equal(kind, 'gpg', 'the workflow signs SHA256SUMS');
    assert.match(doc, /gpg --verify[^\n]*SHA256SUMS/);
  }
});

test('#557 security review SEC-13: checksums and their signature shipped, code signing still #478', () => {
  const review = read('docs', 'security-review-2026-10.md');
  const start = review.indexOf('SEC-13');
  assert.equal(start >= 0, true, 'SEC-13 is in the review');
  // its bullet, up to the next finding (SEC-14) or the end of the list
  const ends = [review.indexOf('\n- **', start), review.indexOf('\n\n', start)].filter((i) => i > 0);
  const sec13 = review.slice(start, ends.length ? Math.min(...ends) : undefined);
  assert.match(sec13, /SHA256SUMS/);
  assert.match(sec13, /#557/);
  assert.match(sec13, /#478/);
});
