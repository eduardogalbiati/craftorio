# Sources: an annotated reading list on agent architecture

Everything this guide draws on, plus what was read and set aside while writing it, in one place
for whoever writes the next page or a post. Grouped by theme; within a theme, primary sources
first. Each entry says what the source holds and how much weight to give it. Dates are the source's
own; "read 2026-10" is when it was checked for this guide.

Weight words: **primary** = the author's own methodology, paper or documentation; **practitioner** =
an experienced engineer's opinion with examples, not measured; **secondary** = a summary or a
vendor guide that repeats others, useful for vocabulary, not for claims.

## Engineering principles for agents

- **12-Factor Agents**, Dex Horthy (HumanLayer), [github.com/humanlayer/12-factor-agents](https://github.com/humanlayer/12-factor-agents),
  2025, a v1.1 draft on a branch. Primary. The methodology this guide is built on: twelve
  principles plus a bonus, modelled on the 12-Factor App, arguing that production agents are mostly
  deterministic code with targeted model calls. Each factor has its own page under `content/`
  (linked from every factor page here). The talk version: [AI Engineer, "12-Factor Agents"](https://ai.engineer/talks/12-factor-agents);
  the landing page: [humanlayer.dev/12-factor-agents](https://www.humanlayer.dev/12-factor-agents).
- **Building effective agents**, Anthropic, [anthropic.com/engineering/building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents),
  December 2024. Primary. The distinction between workflows (code-defined paths) and agents
  (model-directed), the five workflow patterns (Prompt Chaining, Routing, Parallelization,
  Orchestrator-Workers, Evaluator-Optimizer), and "start simple". The names this guide's pattern
  table uses.
- **Effective context engineering for AI agents**, Anthropic, [anthropic.com/engineering/effective-context-engineering-for-ai-agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents),
  2025. Primary. The attention budget, compaction, structured note-taking, sub-agents for
  exploration, minimal tool sets. Factor 3 and the codebase-structure page.
- **Writing effective tools for agents**, Anthropic, [anthropic.com/engineering/writing-tools-for-agents](https://www.anthropic.com/engineering/writing-tools-for-agents),
  2025. Primary. Few high-impact tools, namespacing, meaningful results over ids, token-efficient
  responses, specific errors, descriptions written as onboarding. Applies to the service channels
  and the probes here.
- **Equipping agents for the real world with Agent Skills**, Anthropic, [anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills),
  October 2025. Primary. The skill folder (`SKILL.md` plus references and scripts), progressive
  disclosure in three levels, authoring from evaluation. The model for `skills/` here.
- **Best practices for Claude Code**, Anthropic, [code.claude.com/docs/en/best-practices](https://code.claude.com/docs/en/best-practices)
  (the former `anthropic.com/engineering/claude-code-best-practices` redirects here), read 2026-10.
  Primary. What belongs in `CLAUDE.md` and what does not, `.claude/skills/`, `.claude/agents/`,
  hooks as deterministic gates, "give Claude a way to verify its work", subagents for
  investigation, writer/reviewer sessions, fan-out with `claude -p`. The best-documented source on
  repository files for agents.

## Pattern catalogues

- Liu, Y. et al. (CSIRO Data61), **Agent Design Pattern Catalogue: A Collection of Architectural
  Patterns for Foundation Model based Agents**, [arXiv:2405.10467](https://arxiv.org/abs/2405.10467v4),
  v4 November 2024. Primary, academic. 18 patterns with context, forces and trade-offs, and a
  decision model for selecting them. The most citable catalogue; its human-in-the-loop and
  multi-agent patterns map onto the gates and the fan-out steps here.
- **Architecting Agentic Communities using Design Patterns**, [arXiv:2601.03624](https://arxiv.org/pdf/2601.03624),
  January 2026. Primary, academic. Extends the catalogue approach to systems of several agents
  ("agentic communities"). Read for the multi-agent vocabulary; not yet applied here.
- Ng, A., **Agentic Design Patterns**, The Batch (DeepLearning.AI), 2024. Primary. The four
  patterns most guides start from: Reflection, Tool Use, Planning, Multi-Agent Collaboration.
- **Agentic design patterns**, Augment Code, [augmentcode.com/guides/agentic-design-patterns](https://www.augmentcode.com/guides/agentic-design-patterns).
  Secondary. A 12-pattern taxonomy that merges Ng's four, Anthropic's five and reliability and
  memory patterns; good for names, read the primaries for the claims.
- **The definitive guide to agentic design patterns in 2026**, SitePoint, [sitepoint.com/the-definitive-guide-to-agentic-design-patterns-in-2026](https://www.sitepoint.com/the-definitive-guide-to-agentic-design-patterns-in-2026/).
  Secondary. Six core patterns, practitioner level.
- **AI agent design patterns 2026**, aiagentrank.io, [aiagentrank.io/blog/ai-agent-design-patterns-2026](https://aiagentrank.io/blog/ai-agent-design-patterns-2026),
  May 2026. Secondary. ReAct, Reflection, Plan-and-Execute, Routing, Orchestrator-Workers and
  others with latency and token-cost trade-offs; vendor blog.
- **Agentic AI design patterns**, AIMultiple, [aimultiple.com/agentic-ai-design-patterns](https://aimultiple.com/agentic-ai-design-patterns),
  and fast.io, [fast.io/resources/agentic-ai-design-patterns](https://fast.io/resources/agentic-ai-design-patterns/).
  Secondary; vocabulary only.

## Repositories and codebases built for agents

- **AGENTS.md**, Agentic AI Foundation (Linux Foundation), [agents.md](https://agents.md/).
  Primary (the convention's own page). A "README for agents" at the root, nested files per
  subproject, the closest file wins, no required sections; the list of agents that read it. Claude
  Code reads `CLAUDE.md`, hence `@AGENTS.md` as its first line here.
- Böckeler, B. (Thoughtworks), **Context Engineering for Coding Agents**, martinfowler.com,
  [martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html](https://martinfowler.com/articles/exploring-gen-ai/context-engineering-coding-agents.html),
  2026-02-05. Practitioner, strong. Build rules files gradually, path-scoped rules, "not too little,
  not too much", the code itself as the first context, think in probabilities. The source behind
  #572.
- Vasilopoulos, A., **Codified Context: Infrastructure for AI Agents in a Complex Codebase**,
  [arXiv:2602.20478](https://arxiv.org/html/2602.20478), February 2026. Primary, observational
  (one developer, one 108k-line C# project, no control). Three tiers: a ~660-line constitution,
  19 specialist agents, 34 on-demand documents behind an MCP search server; 24% of the code's size
  in context; stale specs as the main failure mode; 1 to 2 hours a week of upkeep. The case study
  the codebase-structure page measures this repository against; the source behind #574.
- Phoenix, J., **Agent-Native Architecture**, [understandingdata.com/posts/agent-native-architecture](https://understandingdata.com/posts/agent-native-architecture/).
  Practitioner. Agents as first-class users: parity (whatever the UI does, a tool does),
  granularity, composability, emergent capability. The channel manifest here is the parity layer.
- **How to build agent-native: lessons from four apps**, Every, [every.to/source-code/how-to-build-agent-native-lessons-from-four-apps](https://every.to/source-code/how-to-build-agent-native-lessons-from-four-apps).
  Practitioner. Apps where every interaction goes to an agent that picks tools; the code's job is
  the interface and the tools.
- **Agent-native architecture (key concepts)**, [agent-native.com/docs/key-concepts](https://agent-native.com/docs/key-concepts),
  and the skill **agent-native-architecture** on skills.sh. Secondary; the same ideas packaged.
- **The Agent-Native Repo: why AGENTS.md is the new standard**, Harness, [harness.io/blog/the-agent-native-repo-why-agents-md-is-the-new-standard](https://www.harness.io/blog/the-agent-native-repo-why-agents-md-is-the-new-standard).
  Secondary. Humans get quick starts, agents get deterministic commands, directory boundaries and
  prohibited patterns. Its adoption and bug-reduction figures have no primary source: do not quote
  them.
- **How to Manage Context Files in Your Codebase**, freeCodeCamp, [freecodecamp.org/news/how-to-manage-context-files-in-your-codebase-and-get-better-agent-output](https://www.freecodecamp.org/news/how-to-manage-context-files-in-your-codebase-and-get-better-agent-output/).
  Practitioner. A short root file, scoped files per directory, on-demand docs referenced by path.
- **Scaling your coding agent's context beyond a single AGENTS.md file**, [ursula8sciform.substack.com/p/scaling-your-coding-agents-context](https://ursula8sciform.substack.com/p/scaling-your-coding-agents-context).
  Practitioner; the same layering argument.
- **Good practices creating AGENTS.md**, AI Native Compass, [ainativecompass.substack.com/p/good-practices-creating-agentsmd](https://ainativecompass.substack.com/p/good-practices-creating-agentsmd),
  and **What AGENTS.md does**, Morph, [morphllm.com/agents-md-guide](https://morphllm.com/agents-md-guide).
  Secondary. One of them recommends a 20 to 30 line root file; a single source's number.
- **Codebase Design for AI Agents: invariants via types and CI**, SitePoint, [sitepoint.com/codebase-design-for-ai-agents](https://www.sitepoint.com/codebase-design-for-ai-agents/).
  Practitioner. Types as invariants, lint rules for architectural boundaries, CI as the agent's
  feedback loop.
- **Clean Code for AI Agents**, aidailycheck.com, [aidailycheck.com/learn/clean-code-for-ai-agents](https://aidailycheck.com/learn/clean-code-for-ai-agents).
  Secondary. Small well-named files to find code, deep modules to test it; its token-saving figure
  is anecdotal.
- Hightower, R., **Keep the AI Vibe: optimizing codebase architecture for AI coding tools**, Medium,
  [medium.com/@richardhightower/ai-optimizing-codebase-architecture-for-ai-coding-tools-ff6bb6fdc497](https://medium.com/@richardhightower/ai-optimizing-codebase-architecture-for-ai-coding-tools-ff6bb6fdc497).
  Practitioner. Vertical slices as an agent-friendly layout, because a feature's files sit together.
- **Context Windows in AI Coding Agents Explained**, Pickuma, [pickuma.com/for-dev/context-windows-ai-coding-agents](https://pickuma.com/for-dev/context-windows-ai-coding-agents/).
  Secondary. Why an agent must choose which files to read.
- **Engineering Software for AI Coding Agents**, Leanpub, [leanpub.com/engineeringsoftwareforaicodingagents](https://leanpub.com/engineeringsoftwareforaicodingagents).
  Book, practitioner (author listed as Steve Publications). Chapters on directory layouts, naming,
  types as communication, documentation strategies, tests that catch hallucinations. Read for
  structure; nothing in it was found to differ from good conventional engineering.
- **AI-native codebase**, Context Studios glossary, [contextstudios.ai/glossary/ai-native-codebase](https://www.contextstudios.ai/glossary/ai-native-codebase).
  Secondary, a services firm's definition; vocabulary only.

## Skills and progressive disclosure, beyond Anthropic's post

Third-party reading on skills, kept for the vocabulary; the authoritative text is Anthropic's post
above and the Claude Code docs.

- **Claude Code and Progressive Disclosure**, Medium, [medium.com/@quanap5/claude-code-progressive-disclosure-insights-from-my-learning-5244bc9864aa](https://medium.com/@quanap5/claude-code-progressive-disclosure-insights-from-my-learning-5244bc9864aa).
  Practitioner; the three levels explained with examples.
- **Your Code Style Skill Is Making Claude Worse**, Varun Bhanot, [varunbhanot.substack.com/p/your-code-style-skill-is-making-claude](https://varunbhanot.substack.com/p/your-code-style-skill-is-making-claude).
  Practitioner. A useful distinction: a capability-uplift skill (teaches what the model cannot do)
  suits progressive disclosure; an encoded-preference skill (how you want things done, relevant on
  nearly every change) belongs in the always-loaded file. Relevant to what goes in `AGENTS.md` vs a
  skill here.
- **Claude Code Skills: 8 rules from 17,000 real sessions**, StationX, [app.stationx.net/articles/claude-code-skills](https://app.stationx.net/articles/claude-code-skills);
  KDnuggets, **Anthropic's complete guide to Claude Skills building**, [kdnuggets.com/anthropics-complete-guide-to-claude-skills-building](https://www.kdnuggets.com/anthropics-complete-guide-to-claude-skills-building);
  and the guides on jiangren.com.au, idealogic.io, wmedia.es, aiintelligencebrief. Secondary.
  Their numbers (lines per `SKILL.md`, truncation limits, token cost per skill) were not verified
  against Anthropic's documentation.

## How to add a source

One bullet, in the theme it belongs to, primary before practitioner before secondary: author or
organisation, title in bold, the link, the date, the weight word, one or two sentences on what it
holds and where this guide uses it. If a figure in it has no primary source, say so, as the Harness
entry does. A source used on a factor page is also listed in that page's References.
