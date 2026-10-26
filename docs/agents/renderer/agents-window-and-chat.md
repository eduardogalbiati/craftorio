# The Agents window and the agents' chat

The separate Agents window (#263) and the agents' chat (#274).

## The Agents window (#263)

The Oracle, the Product Owner and the Supervisor can open in their own window, beside the app:
`apps/desktop/host/agents-window.js` (main process, pure of Electron: `createAgentsWindow({ BrowserWindow,
statePath, dirname })` → `open({ agent })`, `current()`, `setAgent(id)`) creates one
`BrowserWindow` with the main window's preload and isolation, loading the app's page with
`?window=agents&agent=<id>`; its bounds and the last agent live in `<workspace>/agents-window.json`.
`main.js` answers `agents-window:open` (each drawer's "Open in a window" button
`[data-agents-window="<id>"]` / `agent-chat-open-window`, and Ctrl+Shift+A, both handled in
`agents-window.js`) and pushes its events (`chat:progress`, `oracle:changed`, `run:event`…) to both
windows (`broadcast`). On the page, `agents-window.js` (`window.AgentsWindow`) hides the shell and
mounts the rail (`agents-rail`, a nav named "Agents", one `agents-rail-item` per agent: its robot in
its role colour, its name, `agents-rail-unread`, `data-busy` while it answers; icons only under
900px) and the pane (`agents-window-pane`: `agents-window-header` with the agent, its model, cost
and tokens, then its chat). The agents declare themselves: each view calls
`AgentsWindow.register({ id, name, order, color, avatar, mount, unmount, unread, busy, header })` as
it loads (the Oracle, the Product Owner and the Supervisor; an agent added later registers the same
way) and `AgentsWindow.changed()` when its state changes. A pane is a second surface of the agent's
own state through the shared chat (the Oracle's `'window'` surface, the Product Owner's and the
Supervisor's `winChat`): one conversation, two places, a question sent in one shown in the other as
a turn started elsewhere (`setTurn`), and across the two real windows through the service's history
and pushed events. The window never starts a session of its own and never answers a gate. A link to
a screen in its chats (a run, an issue, a file, a request, the Oracle's settings) opens in the main
window: the view asks `AgentsWindow.toMainWindow(name, target)` first (on the window's page it sends
`agents-window:navigate`, which `main.js` relays to the main window as `main-window:navigate` and
brings it to the front; in the main window it answers false) and registers the handler the main
window runs with `AgentsWindow.onNavigate(name, fn)` (the Oracle's `oracle:*`, the Product Owner's
`product-owner:*`).
`npm run screenshot -- --view backlog --agents-window oracle|product-owner|supervisor` captures it
(`--size 700x800` for the collapsed rail, `--theme` for the themes).

## The agents' chat (#274)

`agent-chat.js` (`window.AgentChat.create(container, options)`, with `agent-chat.css`) is the one
chat of the Oracle, the Product Owner and the Supervisor drawers: the messages (Markdown, cost and
tokens), Send (the text box empties at once; a failure or a refusal puts the text back with the
error), the busy lock (#234), the working line, the live turn (#180), scroll to the end on send,
attachments, the unread state (#149) and slots for each agent's own parts (`head`, `top`, `pills`,
`compose`, `actions`, `foot`). Its header lists what it owns. A new agent chat uses agent-chat.js
(never a copy of a drawer's chat code), and a chat fix goes there so every drawer gets it. A drawer
keeps its ids and classes through the `ids` / `classes` options, and draws its own message markup
with `renderMessage`; the component wraps each message in `[data-testid="agent-chat-message"]`
(`display: contents`, the look is the drawer's).
