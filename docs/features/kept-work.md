---
order: 210
---

<!-- section:engine -->
### Roadmap: kept work from an ended run

A failed, cancelled or interrupted run keeps its work on its branch. When a start would do the same issues again (roadmap
**Retry**, Resume on a paused queue, Start/Assign on an issue, Write & Review from an issue), the
app asks first, with the same question everywhere (#288), e.g. **#282 + #284 + #285: a run stopped at Evidence**:

- why it stopped, in one line: at a human gate (which one) when the app closed, the app closed, a
  failure (its first line), a limit, or cancelled by the owner;
- what is done (the steps passed), what is left, and what it cost (US$ and time); when main moved,
  "main moved 13 commits since: the run merges it at the end";
- when the item groups more issues than the old run had: "the old run only covers #113";
- **Details**: the commits the old run made **itself**, how far its base is behind today's main, the
  files it changed and how many of them changed on main too;
- **Resume** resumes the old run at once, at the step where it stopped; **choose another step…**
  under the buttons opens Resume from step… instead;
- **Start over**: a new run from today's main, saying what it spends again; the old commits stay in
  their branch.

Resume is the primary button (Enter) when the old run has commits of its own; Start over only when
it ended before any commit. Cancel (Esc) never is. Automation never answers: the roadmap and the
queue pause with the same text until you choose.
