## Skills

Skills are reusable instructions (`SKILL.md` + support files) that the engine injects into the
agents, for Claude **and** Codex. The YAML keeps the contract (who, when, schema, transitions);
the skill keeps the know-how.

```yaml
agents:
  test_writer:
    skills: ["unit-test-writer-{{ inputs.language }}"]   # system prompt (1st turn); templates allowed
steps:
  - id: compete
    skills: ["{{ inputs.document_skill }}"]              # the step's prompt
```

```yaml
# SKILL.md frontmatter
name: unit-test-writer-go
description: ...
uses: [testing-principles]   # loaded first, once, cycles ignored
```

- The `SKILL.md` body goes inline; support files (e.g. `rules/python.md`) are listed with their
  absolute path so the agent reads only the relevant ones.
- Lookup: `<workspace>/skills/<name>` first, then the app's `skills/`. The app's skills are copied
  into the workspace on startup. When the app ships a new version of a skill, untouched copies are
  updated; copies you edited are kept, and skills you deleted are not brought back.
- `providers.<p>.skill_args` lets the agent read the skill folder, which is outside `working_dir`
  (Claude: `["--add-dir", "{{ skill_dir }}"]`; Codex in `read-only` can already read any path).

### Naming convention

Language- or platform-specific skills are named `<capability>-<suffix>`, and every family has
one skill per suffix (a test enforces it):
- language suffixes: `js`, `python`, `go`, `java`, `csharp`;
- platform suffixes: `gh` (GitHub), `gl` (GitLab).

What is shared by a family lives in a suffix-less skill referenced with `uses:`.

### Bundled skills

<!-- generated:skills -->

<!-- /generated:skills -->

`bug-diagnosis`, `merge-conflict-resolver`, `pr-description`, `testing-principles` and parts of
`code-review` adapt ideas from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT);
`claim-verification`, `blast-radius`, `review-synthesis`, `design-sketch`, `decision-log` and
`run-retrospective` adapt ideas from [cursor/plugins](https://github.com/cursor/plugins) (MIT).
All of them are rewritten for agents that run unattended: where the originals ask the user, ours
record an assumption or a recommended default instead.

<!-- generated:engine -->

<!-- /generated:engine -->
