---
order: 115
---

<!-- section:workflows -->
**Answering gates from the phone** (#226, Settings › Phone gates). The running app can serve a
small page with only the open gates (each gate's summary, recommendation, evidence links and
buttons) on `http://127.0.0.1:7400`, this computer only; nothing else of the app (runs control,
files, terminals, settings, the API) is reachable there. To use it:

1. Settings › Phone gates › **Pair a phone**: scan the QR code with the phone (or open the page
   and type the one-time code, valid 10 minutes). The phone keeps a device token; **Revoke** it
   there at any time.
2. Reach the page privately from outside: [Tailscale](https://tailscale.com) on the computer and
   the phone, then `tailscale serve --bg 7400` (only your devices reach the https address it
   prints), or a named Cloudflare Tunnel to `http://127.0.0.1:7400` behind a Cloudflare Access
   policy that allows only your email. Never a public address without access rules. Paste the
   address in **Address from outside** and press **Check** to see whether it answers.
3. A gate's notification carries the link to that gate's page: signed for that gate only, valid
   30 minutes. Every answer asks you to confirm, showing what the button does ("Merges the branch
   into main"), and is recorded as yours from the phone (`answered_by: owner`, `via: mobile`, the
   device and the time on the gate's `approval.resolved` event).

An agent, a script or the supervisor never answers a gate there: an answer needs a paired device,
the gate's link and your confirmation.

The phone page follows the workspace's **Interface** language in Settings, with English as the
fallback. Reload an open page after changing the language. Gate messages, button meanings and your
notes keep their original text. The pairing code and note fields have labels, status changes are
announced to screen readers, and the page supports keyboard navigation and narrow phone screens.

The gate starts with its short summary, recommendation and the action needed from you. **Full
details** keeps the complete message available without putting a long report above the choices.
The confirmation repeats this context and its evidence links. When your choice differs from the
recommendation, it says so beside the confirmation; the decision is still yours.

If the connection fails while reading the list, **Try again** reads it again without removing the
pairing. A pairing that is no longer valid asks for a new code; an expired or invalid gate link
offers the list so you can open a fresh link. An answered gate says it is no longer waiting.

If the connection fails after you confirm an answer, its result may be unknown: the app might
already have received it. **Check gate status** only reads the gate; it never resends the answer.
If the gate is still open, choose and confirm again yourself. If it has ended, the page says so
without claiming which answer ended it. There is no offline queue or automatic retry of answers.

The list identifies each gate's project, issues and wait time. It refreshes when you return to the
visible tab or the connection comes back. A failed read keeps the last list visible and marks it
outdated; refreshing never sends an answer or changes the field you are editing.

The confirmation accepts a multiline note with a character count. Its draft is scoped to that gate
in this browser tab and expires after 24 hours. Going back or reloading restores only the note, never
a chosen answer. A confirmed answer or an ended gate removes its draft. If the browser blocks draft
storage, the field still works and the page asks you to keep a copy before leaving.

An open gate shows its signed link's remaining lifetime using the server's time. When it expires,
confirmation is disabled and the page offers the list for a fresh link; the note stays in the tab.
The server still checks the signature and expiration on every answer. Keeping the page open does
not renew its authorization.
