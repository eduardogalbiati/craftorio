## Install

Download the file for your system from the latest
[GitHub Release](https://github.com/eduardogalbiati/multiagent-orchestrator/releases/latest). The
builds are not signed yet, so each system warns once before the first start.

- **Windows** (x64): `MultiagentOrchestrator-win32-x64.zip`. Unzip it anywhere and run
  `MultiagentOrchestrator.exe`. If SmartScreen says "Windows protected your PC", click **More info**,
  then **Run anyway**.
- **macOS** (Apple Silicon: `MultiagentOrchestrator-darwin-arm64.zip`; Intel:
  `MultiagentOrchestrator-darwin-x64.zip`). Unzip it and move `MultiagentOrchestrator.app` to
  Applications. The app is not notarized, so the first start is blocked: open it once, then
  **System Settings › Privacy & Security**, and click **Open Anyway** next to the message about
  the app (or, in Terminal: `xattr -dr com.apple.quarantine /Applications/MultiagentOrchestrator.app`).
  Voice input asks for the microphone the first time you use it.
- **Linux** (x64): `MultiagentOrchestrator-linux-x64.AppImage`. Make it executable and run it:
  `chmod +x MultiagentOrchestrator-linux-x64.AppImage && ./MultiagentOrchestrator-linux-x64.AppImage`
  (if it does not start because FUSE is missing, run it with `--appimage-extract-and-run`). On systems that forbid unprivileged user namespaces (Ubuntu 23.10
  and later, the AppArmor default) the AppImage can only start with Chromium's sandbox off: it says
  so on stderr and in **Settings › About**. Without the sandbox, a compromised page of the app is a
  compromise of the whole app process. To keep the sandbox on, allow unprivileged user namespaces:
  `sudo sysctl kernel.apparmor_restrict_unprivileged_userns=0` (for every start: a file in
  `/etc/sysctl.d/` with `kernel.apparmor_restrict_unprivileged_userns=0`). That is your choice, with
  its trade-off: it applies to the whole system, so every program may create user namespaces again,
  a kernel attack surface Ubuntu closed on purpose. `MultiagentOrchestrator-linux-x64.tar.gz`
  is the same app as a folder: run `./MultiagentOrchestrator` inside it; if it stops with "The SUID
  sandbox helper binary was found, but is not configured correctly", give the sandbox helper its
  rights once: `sudo chown root:root chrome-sandbox && sudo chmod 4755 chrome-sandbox`.

**Sizing.** Each run in progress takes about 4 threads and 6 GB of RAM (its agent CLI, its tests,
its tooling). The app reads this machine at start and proposes how many runs at once (1 to 6) and
how many test workers per run (Settings › Execution › Concurrent runs, also shown in the Setup); a
value you set by hand always wins.

The CLIs the workflows use are installed separately: see
[Installing the CLIs on Windows](#installing-the-clis-on-windows) and its macOS and Linux part.

**App icon.** `apps/desktop/assets/icon.ico` (Windows), `apps/desktop/assets/icon.icns` (macOS) and `apps/desktop/assets/icon.png` (Linux)
are generated from one source image, `apps/desktop/assets/icon-source.png` (its origin and license are in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). To replace the icon, put a square PNG of 1024 px or more at `apps/desktop/assets/icon-source.png` (or pass its path)
and run `npm run icons`, then commit the four files.
