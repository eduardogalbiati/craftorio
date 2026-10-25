# Factor 2: Own your prompts

## The factor

Do not let a framework hide your prompts behind an abstraction. Prompts are first-class code:
versioned, reviewed, tested, and written in full by the team that owns the agent. A framework's
"just pass a persona string" is a fast start and a slow dead end. ([factor 2](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-02-own-your-prompts.md))

## In this project

- **Workflows carry their prompts.** Every agent's `system_prompt`, every step's `prompt` and every
  gate's `message` is in the workflow YAML (`workflows/*.yaml`, `fragments/*.yaml`), rendered with
  nunjucks by `src/engine/run/templates.js`. The filters a template may use are listed in that
  file's header; the loader (`src/engine/run/load.js`, `field-rules.js`) refuses unknown fields and
  unsafe template names (#469, #474).
- **Skills are prompts too.** `skills/<name>/SKILL.md` is the instruction a role gets; what a family
  shares is a suffix-less skill referenced with `uses:` (the naming rule in `AGENTS.md`, enforced by
  a test). `code-review` keeps per-language rules in `rules/*.md`.
- **The engine's own prompt pieces are constants in code**, not scattered strings:
  `HANDOFF_INSTRUCTIONS`, `HANDOFF_ONLY` and `WRAP_UP` in `src/engine/run/sessions.js`, the schema
  retry in `src/engine/run/outputs.js` (`retryPrompt`), the previous-attempt block in
  `src/engine/run/turns.js` (`attemptSummary`), the language line in `src/shared/language.js`
  (#327).
- **Nothing else may inject a prompt.** Isolated Claude agents load no settings file
  (`--setting-sources ''`, #468, SEC-3 in `decisions.md`), so a repository's `.claude/settings*.json`
  cannot add hooks or prompts behind the workflow's back; a project `CLAUDE.md` asking for another
  chat language cannot break the JSON answer (`OUTPUT_LANGUAGE`, #94).
- **Prompts are tested.** The mock provider runs every bundled workflow end to end in `npm test`
  (`docs/agents/testing.md`), so a renamed output field or a broken template fails a test, not a
  night run.

## Gaps

- **The CLI's system prompt is not ours.** An agent turn runs inside Claude Code, Codex CLI or Grok
  Build, each with its own system prompt, tool descriptions and agentic loop. The workflow's
  `system_prompt` is appended to that, not substituted for it. This is the trade-off of running
  headless CLIs instead of calling the model API directly: the CLIs bring their tools, sandboxing
  and session handling for free; in exchange the first few thousand tokens of every turn are not
  under our control. Known and accepted; the alternative is a provider that calls the API with our
  own tool loop, a different product.

## References

- [12-Factor Agents, factor 2](https://github.com/humanlayer/12-factor-agents/blob/main/content/factor-02-own-your-prompts.md)
- `docs/agents/engine/agents-and-steps.md`: which prompt fields exist and where
- `docs/agents/capabilities.md`: how a CLI is launched and what it gets
