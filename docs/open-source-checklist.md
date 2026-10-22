# Open-source readiness checklist

Audit of `main` (d19a24c) on 2026-10-22, before making the repository public. Status: **OK** (nothing to do), **Needs change**, **Missing**, **Decide**.

## A. Must do before flipping to public

- [ ] **Security fixes** from [security-review-2026-10.md](security-review-2026-10.md): at least SEC-1 (`will-navigate` + DOMPurify `form`), SEC-2 (IPC sender check), SEC-3 (`--setting-sources project,local`), SEC-4 (`action:` through a shell), SEC-5 (env + `printenv`).
- [ ] **Enable "Private vulnerability reporting"** and Dependabot alerts in Settings › Code security right after flipping. `SECURITY.md` and `ISSUE_TEMPLATE/config.yml` link to it and the link is 404 while the repo is private.
- [ ] **Decide the sign-in model** (Needs change). The packaged app requires an account (`src/main.js`, `required: app.isPackaged`), and every fork's build phones the owner's Supabase project (`src/auth-config.js`). Options: make sign-in optional ("Skip" / anonymous counter), or a build flag, and document that forks need their own Supabase project. Add retention and deletion wording to README "Account and privacy".
- [ ] **Threat model in README and SECURITY.md** (Missing). State plainly: agents run as the user with the user's environment and credentials; "read-only agent" and bash allowlists are conventions, not a sandbox (only Codex has an OS sandbox); workflows, skills and seeds are code; run untrusted repositories in a VM or container; the serve token equals full control of the machine. README currently says "enforced by the engine" and "Claude Code isolates fully", which readers will take as a security boundary.
- [ ] **CI and Deploy are not running** (Needs change). Last CI runs (2026-10-05) failed, last Deploy runs were cancelled, nothing ran for the merges of Oct 13 and Oct 21 (likely private-repo Actions minutes). Get a green run before announcing.
- [ ] **Release on tag or manual dispatch, not on every push to `main`** (Needs change). `deploy.yml` publishes a `--latest` release for each merge. Latest release is `v0.3.0-build.69` while `package.json` is 1.1.2, so README's "latest release" link serves an old build.
- [ ] **Third-party license texts** (Needs change). `THIRD_PARTY_NOTICES.md` says npm libraries "are not listed here", but the packaged app ships them inside app.asar and `scripts/build-3d.js` bundles three/react into `generated/`. Generate a production license file (for example `license-checker --production`) and ship it in `resources/`; mention dompurify (Apache-2.0 OR MPL-2.0). Complete or qualify the Rust crate table (`cargo about` / `cargo license`).
- [ ] **Icon provenance** (Decide). `assets/icon-source.png` is "a placeholder for now" (README); state its origin and license or replace it.
- [ ] **Code of Conduct contact** (Needs change). `CODE_OF_CONDUCT.md` adopts Contributor Covenant 2.1 by link and gives a GitHub handle as the only contact; add a confidential email and paste the full text so GitHub's community profile recognises it.
- [ ] **Trademark note** (Missing). One paragraph: not affiliated with Anthropic, OpenAI or xAI; Claude Code, Codex and Grok are their marks; users are responsible for each CLI's terms and costs.

## B. Should do in the first weeks

- [ ] `.github/dependabot.yml` for npm, cargo and github-actions (Missing).
- [ ] `CODEOWNERS` (`* @eduardogalbiati`) and, if wanted, `FUNDING.yml` (Missing, optional).
- [ ] Labels `good first issue` and `help wanted`, mentioned in CONTRIBUTING (Missing).
- [ ] A "Releasing" section in CONTRIBUTING and a CHANGELOG or a pointer to GitHub Releases (Missing).
- [ ] Environment-variable table in CONTRIBUTING or `docs/agents/environment.md`: `MULTIAGENT_AUTH`, `MULTIAGENT_SUPABASE_URL/KEY`, `MULTIAGENT_WORKSPACE`, `MULTIAGENT_USER_DATA`, `MULTIAGENT_SIMULATION_ONLY`, `MULTIAGENT_SERVER_TOKEN`, `MULTIAGENT_E2E_WORKERS` (Partial).
- [ ] Short human-facing `docs/ARCHITECTURE.md` (engine, service, renderer, native sidecars) linked from CONTRIBUTING; `docs/agents/*` are agent-facing and README is 244 KB (Partial).
- [ ] Code signing: Apple Developer ID + notarization, Windows Authenticode; until then publish SHA-256 sums in release notes (Needs change).
- [ ] Clean up `v0.3.0-build.N` tags (61 of them) and use plain `vX.Y.Z` (Decide).
- [ ] `poc/` (750 KB of proofs of concept, excluded from the package): keep, move to a branch, or delete (Decide).
- [ ] Update `bug_report.yml` placeholder version `0.3.0` (Needs change).
- [ ] Extend `test/open-source.test.js` (no owner paths) to `scripts/`, `docs/`, `workflows/`, `skills/` (cosmetic: screenshot fixtures use author `eduardo`).
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
