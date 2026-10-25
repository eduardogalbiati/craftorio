# Open-source readiness checklist

Audit of `main` (d19a24c) on 2026-10-22, before making the repository public. Status: **OK** (nothing to do), **Needs change**, **Missing**, **Decide**. Items ticked in #482 / #471 (2026-10-23) say what was done; the open ones are the owner's (GitHub settings, a product decision, an action on the remote).

## A. Must do before flipping to public

- [ ] **Security fixes** from [security-review-2026-10.md](security-review-2026-10.md): at least SEC-1 (`will-navigate` + DOMPurify `form`), SEC-2 (IPC sender check), SEC-3 (`--setting-sources project,local`), SEC-4 (`action:` through a shell), SEC-5 (env + `printenv`).
- [ ] **Enable "Private vulnerability reporting"** and Dependabot alerts in Settings › Code security right after flipping. `SECURITY.md` and `ISSUE_TEMPLATE/config.yml` link to it and the link is 404 while the repo is private.
- [ ] **Decide the sign-in model** (Decide). The packaged app requires an account (`apps/desktop/host/main.js`, `required: app.isPackaged`), and every fork's build phones the owner's Supabase project (`packages/engine/domains/account/auth-config.js`). Options: make sign-in optional ("Skip" / anonymous counter), or a build flag. Done in #482: README "Account and privacy" says a fork needs its own Supabase project, how long the data is kept and how to have it deleted; the Skip / build-flag choice is still open.
- [x] **Threat model in README and SECURITY.md** (#471). README "Security model" and SECURITY.md "Scope"; "Agent capabilities and isolation" now says context economy, not a security boundary.
- [ ] **CI and Deploy are not running** (Needs change). Last CI runs (2026-10-05) failed, last Deploy runs were cancelled, nothing ran for the merges of Oct 13 and Oct 21 (likely private-repo Actions minutes). Get a green run before announcing.
- [x] **Releases as rc + stable** (#482, replaced by #489). A push to `main` publishes a prerelease `vX.Y.Z-rc.N` (never latest); a `vX.Y.Z` tag on an rc's commit promotes that release to the stable, latest one without a rebuild, so the "latest release" link always serves a stable. Still open: promote the first rc so the link serves 1.3.0.
- [x] **Third-party license texts**. `npm run licenses` writes `resources/THIRD_PARTY_LICENSES.txt` (production dependencies plus three/react bundled by `scripts/build-3d.js`), shipped in the package's `resources/`; `THIRD_PARTY_NOTICES.md` names dompurify (Apache-2.0 OR MPL-2.0) and qualifies the Rust crate table.
- [x] **Icon provenance**. `THIRD_PARTY_NOTICES.md` "App icon" states its origin and license (to be confirmed by the owner).
- [x] **Code of Conduct contact**. Full Contributor Covenant 2.1 text and a confidential email.
- [x] **Trademark note**. README "License".

## B. Should do in the first weeks

- [x] `.github/dependabot.yml` for npm, cargo and github-actions (weekly).
- [x] `CODEOWNERS` (`* @eduardogalbiati`); `FUNDING.yml` left out (optional).
- [x] Labels `good first issue` and `help wanted`, mentioned in CONTRIBUTING (the labels themselves are created on GitHub).
- [x] A "Releasing" section in CONTRIBUTING and a pointer to GitHub Releases.
- [x] Environment-variable table in `docs/agents/environment.md`.
- [x] Short human-facing `docs/ARCHITECTURE.md` (engine, service, renderer, native sidecars) linked from CONTRIBUTING.
- [ ] Code signing: Apple Developer ID + notarization, Windows Authenticode; until then publish SHA-256 sums in release notes (#478).
- [ ] Clean up `v0.3.0-build.N` tags (61 of them); new releases use plain `vX.Y.Z` (Decide: deleting remote tags is the owner's).
- [ ] `poc/` (750 KB of proofs of concept, excluded from the package): keep, move to a branch, or delete (Decide).
- [x] Update `bug_report.yml` placeholder version (now 1.1.2).
- [x] Extend `test/open-source.test.js` (no owner paths) to `scripts/`, `docs/`, `workflows/`, `skills/`; screenshot fixtures use author `maintainer`.
- [ ] Supabase: once the publishable key is public, enable auth rate limits and captcha in the dashboard; keep RLS as the only trust boundary.
- [ ] Run `gitleaks detect` once for a third opinion on history.

## C. Already in place (verified)

- MIT `LICENSE` (2026, Eduardo Galbiati), consistent with `package.json`, `native/Cargo.toml` and README.
- `CONTRIBUTING.md` builds from a clean clone: `.nvmrc` 24, `npm install`, `npm start`, Rust optional with a JS fallback, `MULTIAGENT_AUTH=off`.
- `SECURITY.md`, issue templates (bug, feature, config with security link), PR template.
- CI is fork-safe: `pull_request` (not `pull_request_target`), no `secrets.*` in any workflow, status steps guarded by same-repo check; `preview.yml` is dispatch-only; least-privilege `permissions:`.
- No secrets in the working tree or in history (grep for `sk-ant-`, `ghp_`, `github_pat_`, `eyJhbGci`, `AKIA`, `sb_secret_`, `service_role`: only a redaction regex and fake test tokens). `.env*`, `runs/`, `build/`, `dist/`, `generated/`, test output all gitignored.
- No hardcoded personal paths, emails or hostnames (placeholders only; `test/open-source.test.js` enforces it under `src/` and `test/`).
- Telemetry is minimal and disclosed: `touch_account(app_version, platform)` once a day; analytics and usage views are local only. README has an "Account and privacy" section.
- `package.json` `"private": true` only blocks `npm publish`; fine for an Electron app.
