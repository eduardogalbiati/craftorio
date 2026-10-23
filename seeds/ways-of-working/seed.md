---
name: ways-of-working
summary: How the project is worked on (solo or team, local merge or pull requests, release style, tests and CI), with the evidence behind each answer
needs:
  - the repository's history (git log, merges, tags)
  - the CI configuration files and the project's test and build scripts
  - the project's Architecture facts (languages, layout) and an existing .multiagent/ manifest
produces:
  - html
  - json
cost: one or two Oracle turns (reads the history, the CI files and the scripts)
---

# Ways of working

Read how the repository is actually worked on, so the app can propose the workflows that fit it
(#487: the workflow interview, `src/service/areas/workflow-interview.js`). The analysis is
read-only: read the files and the history, never edit, build, test, commit or push anything.

Answer each field of the profile from the evidence, and leave it `null` when the evidence does not
settle it: the interview asks the owner what stays `null`, so a guess costs more than a question.

## Data

- **Who works on it** (`team`): authors per month over the last 12 months (`git log --format=%ae`,
  bot accounts left out). One active author: `solo`; two or more in the same months: `team`.
- **How changes land** (`merge`): commits straight on the main branch vs merge commits of pull
  requests (`git log --first-parent --merges`, "Merge pull request" / "(#123)" squash subjects).
  Straight commits or local merges: `local`; merges or squashes of pull requests: `pr`.
- **How it releases** (`release`): tags and releases, their cadence and their relation to merges.
  A tag per closed milestone or group of issues: `milestone`; a tag after (almost) every merge:
  `per-merge`; tags at a fixed cadence whatever is merged: `train`; `-rc.N` tags before each stable
  one: `rc-stable`; no tags: `null`.
- **How it is tested** (`testCommand`, `ci`): the test script the project runs (`package.json`
  scripts, a Makefile, `pytest`, `go test`...), the CI system (`github-actions`, `gitlab-ci`, other,
  or `null`) and whether CI gates the merges.
- **What it is written in** (`languages`): the Architecture facts' languages, else the file
  extensions; an existing `.multiagent/project.yaml` is reported as is (what to keep).
- Never copy a secret, a token, an e-mail address or an environment value into the result: count
  authors, never name them.

## What it produces

- A self-contained HTML page: the profile as a short sentence ("one author, merges straight to
  main, a tag every two weeks: Solo: local merge + Release: milestone"), then one row per field
  with its value and its evidence. Inline CSS only.
- A JSON model, keys as below; `null` when the evidence does not settle the field:

```json
{
  "profile": {
    "team": "solo | team",
    "merge": "local | pr",
    "release": "milestone | per-merge | train | rc-stable | null",
    "testCommand": "npm test",
    "ci": "github-actions | gitlab-ci | other | null",
    "languages": ["javascript"]
  },
  "evidence": {
    "team": { "numbers": { "authors": 1, "months": 12 }, "commits": ["a1b2c3d"] },
    "merge": { "numbers": { "mergeCommits": 0, "pullRequests": 0 }, "commits": ["a1b2c3d"] },
    "release": { "numbers": { "tags": 6, "daysBetweenTags": 14 }, "commits": ["e4f5a6b"] },
    "testCommand": { "numbers": { "scripts": 1 }, "commits": [] },
    "ci": { "numbers": { "workflows": 1 }, "commits": [] },
    "languages": { "numbers": { "javascript": 240 }, "commits": [] }
  }
}
```

Each evidence entry holds the numbers counted and up to five short commit hashes that show it.

## VERIFY

1. Count the authors of the last month again with `git shortlog -sn --since`: the number matches.
2. Pick one merge (or one straight commit) and check it supports the `merge` value.
3. Compare the newest two tags' dates with the `release` style.
4. Search the result for e-mail addresses and secrets: there is none.

When you are done, tell me:
- the profile in one sentence;
- each field left `null` and why;
- the numbers behind `team`, `merge` and `release`;
- what could not be read and what you assumed.
