# Security policy

## Reporting a vulnerability

Please report vulnerabilities through GitHub's private vulnerability reporting: open the
repository's **Security** tab and click **Report a vulnerability**. Never report a vulnerability
in a public issue, a pull request or a discussion.

Include what you found, how to reproduce it, the app version and your OS. You will get an answer
on the report; once a fix is released, the advisory is published with credit to you if you wish.

## Supported versions

Fixes go into the latest release only.

## Threat model

What the app protects, and what it does not (the security review of 2026-10-22,
[docs/security-review-2026-10.md](docs/security-review-2026-10.md)).

- **Agents run as you.** An agent turn is a headless CLI (`claude -p`, `codex exec`, `grok`) with
  your environment, credentials and network. Only Codex's sandbox is enforced by the OS; for the
  other CLIs the tool allowlists are prefix rules. Run untrusted repositories only in a VM, a
  container or with Codex's sandbox; treat workflows, skills and seeds as code.
- **The engine server token is full control of the machine** (`npm run serve`): a shell, gate
  approval and paid runs. The server listens on loopback by default and refuses a foreign `Host`
  there; another address needs Tailscale, or `--insecure-http` behind a VPN or a TLS proxy.
- **Secrets at rest without an OS keyring.** When Electron's `safeStorage` is unavailable (Linux
  without a keyring, the `basic_text` backend), the engine connection token and the account session
  (`<userData>/account.bin`) are stored as plain text. Settings › Engine connection says so for the
  token, and the app logs a warning for the account session at start. Install a keyring
  (gnome-keyring, KWallet) to have them encrypted.
- **The control channel's endpoint file** (`<workspace>/control/endpoint.json`) holds the token of
  the loopback control channel. It is written readable by your user only where the OS honours the
  mode, but the workflow's agents run as you and can read it. What that token allows is limited by
  the channel's allowlist: it never resolves a human gate and never changes settings.
- **Human gates are never crossed by automation**, the supervisor included: only you (desktop UI,
  engine server UI, a paired phone) answer a `human_approval`.
- **A gate link sent to a phone reveals the gate's text** to whoever holds it; answering also needs
  the paired device.
- **The account backend** (Supabase) only counts the people using the app. Its publishable key is
  meant to ship; row-level security (each user reads and writes only their own row) is the only
  trust boundary. Auth rate limits and captcha against abuse of the public key are dashboard
  settings, outside this repository (`src/auth-config.js`, `supabase/migrations`).
