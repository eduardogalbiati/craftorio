# The Oracle's panel and drawer

The Oracle's states, unread badge, pasted images and memory form (#171).

## The Oracle's panel and drawer (#171)

`views/oracle/oracle.js` registers a view with no screen of its own: it docks `#oracle-dock` inside
`#view-dashboard` (class `oracle-docked`, a two-column grid) and adds `#oracle-drawer` (a `.drawer`
like `#svc-drawer`) and the header's `#nav-oracle` button, inserted before the notifications bell
(#254: `.topbar .actions`, top right). On
Home's Overview it focuses the dock, elsewhere (Home's Analytics tab included, #255: the dock is hidden there) it toggles the drawer. Both places render the same
state from `OracleChatModel` (`views/oracle/oracle-chat-model.js`, pure, tested in Node):

- **states**: `empty` (a line on what it reads, 4 `.chip` suggestions), `conversation`,
  `answering` (the shared chat's working line "Oracle is working…", Send and chips disabled, input
  editable; the box emptied on Send, #274), `error` (the chat's error line, the question back in the
  input; the Oracle's own buttons' errors as a `.sup-wmsg system error` line), `paused` (daily budget:
  a notice with spent/limit and a link to Settings › Execution, input and Send disabled),
  `unavailable` (another live process owns `oracle/owner.json`: the form is replaced by a notice
  naming it);
- **unread**: the `.nav-badge.oracle-unread` counts Oracle answers newer than `oracle:state`'s
  `readAt`; the conversation in view (dock on Home's Overview, or the open drawer) saves it with
  `oracle:markRead`, so the count survives a reload;
- **pasted images** (`addImages`/`removeImage`, 5 MB and 4 per message): thumbnails above the input,
  an inline error under it; sent as data URLs to `oracle:ask`, shown in the log through
  `oracle:attachment`;
- **memory**: the Memory button opens a framed `.field` form (Save / Cancel); a save error keeps
  the draft.

Answers go through `markdownHtml`, then `decorate()` turns run ids and `#<n>` into links
(`selectRun`, the Backlog's `BacklogActions.focusIssue`), absolute paths under `runs/<id>/` into
Artifacts links (`openArtifactsAt`) and other absolute paths into copy-on-click code. Screenshots:
`--view oracle` (Projects with the drawer open) and `--oracle <state>` on any view (see
`scripts/screenshot.js --help`).
