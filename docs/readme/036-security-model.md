## Security model

What the app limits, and what it does not. Read it before you run a repository you did not write;
how to report a vulnerability is in [SECURITY.md](SECURITY.md).

- **Agents run as you.** An agent turn is a headless CLI (`claude -p`, `codex exec`, `grok`) started
  with your user, your environment, your credentials and your network; the allowlisted environment
  (see "Account and privacy") keeps cloud keys, API keys and the SSH agent out, nothing more.
- **The engine shapes what the CLI offers the model; only Codex's sandbox is enforced by the OS.**
  For Claude (`acceptEdits` and `--allowedTools`) and Grok (`--always-approve`) the tool limits are
  prefix rules: `bash:git` becomes `Bash(git:*)`, and an allowed program steps around it
  (`git -c alias.x='!cmd' x`, `npm exec` / `npm run <script>`, `node -e`, a `cargo` build script, a
  `cat` of any file). A read-only agent is a convention, not a sandbox.
- **The repository can add instructions.** `CLAUDE.md`, `AGENTS.md`, the README, the issues and the
  PR comments an agent reads can try to steer it, with the tools its workflow gives it. Isolated
  agents never load the checkout's `.claude/settings*.json`, but treat a repository's hooks as code
  that may run until #468 is closed.
- **An issue from outside the project is data, and waits for you** (#90). The backlog sync keeps each
  issue's author and association; one written by someone who is not the owner, a member or a
  collaborator (GitHub `CONTRIBUTOR`, `NONE`…; GitLab below Developer) is marked *Outside*. The
  Product Owner's prompt wraps every issue's text as untrusted data, never instructions, and its
  plan never carries what an issue asks for (a command, a setting, a URL, a skipped check). It gives
  each outside issue a verdict: well written or not, injection suspected or not, with the lines
  that decided it; a suspected one is shown *Quarantined*. Whatever the verdict, an outside issue
  enters no roadmap, pipeline or run until you click *Approve* on the Backlog, and the run's task
  then says the text came from outside: a specification, never instructions. The verdict comes from
  a model that the same text can fool: the author check and your click are the boundary. Your click
  approves the text you saw: it keeps a hash of the title and body, and an issue edited after it
  waits for you again. A trigger (an issue labelled for a workflow) is held while its issue waits
  for you; on an issue the backlog has not synced yet, the label itself counts as your approval
  (labels need triage rights on the repository): keep issue templates from applying a trigger's
  label, or sync the backlog first. When the sync cannot read the
  authors, it records why in the synced backlog (`authorsError`) and keeps each issue's last known author; an issue never
  seen before stays unknown, so it waits for you.
- **The secret scan does not find every secret.** Feature, Fix, Release and this repository's own
  workflows run gitleaks on the commits a run made, before the review (Release: before Ship). It
  knows patterns: a password in plain words, an encoded or split value, a merge commit's own changes
  and what is committed after the scan (the test writer, a merge conflict) can pass. Without
  gitleaks, or turned off, the run says "secrets not scanned". It hides values from the records; a
  value an agent prints itself is only covered by the redaction of known formats.
- **Workflows, skills and seeds are code**: a workflow runs shell commands and templates in the
  app's process, a skill or a seed tells agents with tools what to do. In short, workflows, skills
  and seeds are code: install only ones you trust.
- **The serve token is full control of the machine** (`npm run serve`): a shell, gate approval and
  paid runs. Keep it like a password.
- **The control endpoint file is readable by agents.** `<workspace>/control/endpoint.json` holds the
  token of the loopback control channel; the agents run as you and can read it. Its allowlist
  (`packages/engine/control/allowlist.js`) never resolves a human gate, never changes settings and never
  accepts a workflow. Besides the roadmap actions, whoever reads the token can import a project
  (`projects:create`, its Run App command and install settings included), refresh a backlog
  (`backlog:sync`) and file an issue in the local backlog of a project with no remote
  (`backlog:create-issue`; with a remote it is refused). `npm run serve` opens the same channel with its own
  token; the server's is never in that file.
  The control channel is on by default (#32); turn it off in Settings › Execution › *Allow outside
  sessions to control this app*.

Recommendation: run untrusted repositories only in a VM, a container or with Codex's sandbox
(`workspace-write`), and assume every secret in the agents' environment is readable by them (see
#470 for what is filtered).
