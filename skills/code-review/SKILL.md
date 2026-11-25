---
name: code-review
description: Reviews a diff/branch on three separate axes - correctness (bugs, security, tests), spec (does it do what the task asked) and standards (repo conventions plus market best practices) - applying per-language rules from rules/<language>.md. Use whenever you review code changes.
summary: "Correctness, spec and standards axes, severities, `rules/` per language (JS/TS, Python, Go, Java/Kotlin, C#, Rust, SQL, Shell/CI) and `rules/smells.md`"
used_by: "reviewer"
# the reuse pass is one text shared with the developer's self-review (#756), the secret triage with the developer a finding goes back to (#49)
uses: [reuse-pass, secret-triage]
---

# Code review

You review **changes** (the diff), not the whole repository. The goal is to stop bugs, security
holes and regressions from reaching the base, and to make visible when clean code does not do
what was asked. It is not to rewrite the code in your style.

You run unattended: nobody can answer questions. When something is ambiguous, state your
assumption in the finding.

## 1. Pin the change

- Validate the base: `git rev-parse <base>`; if it fails, report it and stop.
- Diff with the merge base: `git diff <base>...<branch>`; commits: `git log --oneline <base>..<branch>`.
- Empty diff → `approved`, no findings, and say the diff was empty.
- Read the whole diff and, when you need context, the full file around each hunk. Never report
  something you did not verify.

## 2. Find the spec

In this order: the task/summary given in your prompt; issue references in commit messages
(`#123`, `Closes #45`, GitLab `!67`); spec or PRD files under `docs/`, `specs/` matching the
branch or feature. No spec found → skip the spec axis and say so.

When the issue names a **finding bundle** (a `findings/<timestamp>/` folder), it is part of the
spec. Read `note.md` and `marks.json`: each numbered pin names the element (`data-testid`, view,
tab, ids) the fix must change. Check that the diff touches the module behind each pin. Check that
a check reproduces the finding: it fails without the change and passes with it.

## 3. Load the rules

- Detect the languages from the changed files' extensions and **read the rules file for each**
  (table below). Files without a specific rule get only the core checklist.
- Read the repository's own standards if they exist (`CONTRIBUTING.md`, `CODING_STANDARDS.md`,
  `docs/adr/`, linter configs). **Repository standards override this skill.**
- Read `rules/smells.md` for the standards axis.

| Extensions | Rules |
|---|---|
| `.js` `.mjs` `.cjs` `.jsx` `.ts` `.tsx` | `rules/javascript-typescript.md` |
| `.py` | `rules/python.md` |
| `.go` | `rules/go.md` |
| `.java` `.kt` `.kts` | `rules/java-kotlin.md` |
| `.cs` | `rules/csharp.md` |
| `.rs` | `rules/rust.md` |
| `.sql`, migrations, queries in strings | `rules/sql.md` |
| `.sh` `.bash` `.ps1`, `Dockerfile`, CI files (`.github/workflows/*.yml`, `.gitlab-ci.yml`) | `rules/shell-ci.md` |

## 4. Review on three axes

Keep the axes separate: a change can be correct and still miss the spec, or match the spec with
a security hole. Do not let a strong axis hide a weak one.

### Correctness (core checklist, any language)

- **Logic**: does it do what it intends? Edges: empty, null, zero, negative, list limits,
  unicode, time zones, rounding, overflow. Inverted conditions, off-by-one, early returns that
  skip cleanup, shared mutable state.
- **Concurrency**: races, non-atomic check-then-act, unawaited promises/futures, locks not
  released on error paths.
- **Errors**: no silently swallowed errors; useful messages without secrets or personal data;
  resources released on every path.
- **Security** (OWASP as the minimum): external input never reaches SQL, shell, file paths,
  HTML, regex, eval, deserialization or outbound URLs raw (injection, path traversal, XSS, SSRF,
  ReDoS). No secrets in code or logs; judge each entry the change adds to `.gitleaksignore` and
  each change of `.gitleaks.toml` with the secret-triage skill, and refuse one without a good reason. Authorization checked on the server at the point of use.
  No home-made crypto, no MD5/SHA1 for passwords, secure randomness for tokens. New
  dependencies are needed, maintained and free of known vulnerabilities.
- **Contracts**: changes to public APIs, schemas, file formats, events or environment variables
  break no consumer, or come with a migration/version. Database migrations are reversible and
  safe for existing data.
- **Tests**: new or fixed behaviour has a test that would fail without the change; tests check
  behaviour through public seams, not implementation details; no sleeps, order or real network.
  A bug fix without a regression test is at least `minor`.
- **Performance** (only real impact): N+1 on database/network, I/O in loops, loading whole
  collections, quadratic work on growing input, missing pagination/limits.
- **Observability**: relevant failures are logged with enough context, without sensitive data.

### Spec (only when a spec was found)

Quote the requirement line for each finding:
- **missing or partial**: a requirement or acceptance criterion not implemented;
- **scope creep**: behaviour nobody asked for (flag it, it is not automatically wrong);
- **wrong**: implemented differently from what the spec says.

### Standards

- Repository conventions (naming, structure, error handling style, the patterns neighbouring
  code uses). Local convention beats your personal preference.
- Code smells from `rules/smells.md`.
- Mark each standards finding as **hard violation** (breaks a documented repository rule; cite
  it) or **judgement call** (a smell or preference). Judgement calls are `minor` at most.
- Skip anything the linter/formatter/type checker already enforces.

### Reuse pass

Before the verdict, run the shared reuse pass (the `reuse-pass` skill, loaded above this one and
also run by the developer's self-review, #756) on every new function, constant and rule of the diff.

## 5. Severity and verdict

| Severity | When | Examples |
|---|---|---|
| `blocker` | must not reach production at all | exploitable vulnerability, data loss/corruption, crash on the main path, secret in the diff, broken build |
| `major` | real bug or concrete risk, fix before merging | plausible edge case that breaks, swallowed error, contract break without migration, feature without tests, likely race, required spec item missing or wrong, a rule or mapping table that already exists elsewhere (reuse pass) |
| `minor` | worth fixing, does not block | missing test for a secondary case, confusing name, small duplication of copied lines, judgement-call smell, scope creep |
| `nit` | preference/aesthetics | formatting the linter does not cover, import order, comment wording |

- `changes_requested` **only** if there is at least one `blocker` or `major`; otherwise
  `approved`, even with `minor`/`nit` findings.
- When torn between two severities, pick the lower one and explain the risk.

## 6. Writing each finding

- `axis`: `correctness`, `spec` or `standards`.
- `file` and `line` in the diff.
- `description`: the problem in one sentence with the concrete failing scenario ("with an empty
  list, `items[0]` throws TypeError"), then the suggested fix, the simplest one.
- One finding per problem. For a repeated pattern, report one and list the other locations.
- Keep each axis under about 400 words in total.

## Never

- Mark style as `major`, ask for refactors outside the change's scope, or review untouched code
  (unless the change breaks it).
- Invent problems to look thorough: a good diff gets `approved` with no findings.

## Done when

Every changed file was read, every language's rules file was read, each axis has either
findings or an explicit "no findings", and the reuse pass searched for every new function,
constant and mapping table.
