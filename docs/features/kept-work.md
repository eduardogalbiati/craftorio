---
order: 210
---

<!-- section:engine -->
### Roadmap: kept work from an ended run

A failed or cancelled run keeps its worktree. When a start would do the same issues again (roadmap
**Retry**, Resume on a paused queue, Start/Assign on an issue, Write & Review from an issue), the
app asks first, with the same question everywhere, e.g. **#113 + #142 already have work from a
cancelled run**:

- what the old work is: the commits the old run made **itself** (not the base's commits merged or
  not pushed since), when it ran and how far its base is behind today's main, with a warning when
  the files it touched changed on main since ("resuming will likely conflict");
- when the item groups more issues than the old run had: "the old run only covers #113";
- **Start from scratch**: a new run from today's main; the old commits stay in their worktree,
  untouched;
- **Resume the old run**: continues from those commits (opens Resume from step… for that run).

The recommended button is the primary one: Start from scratch when the old work is stale (behind
main and its files changed), Resume otherwise. Automation never answers: the roadmap and the queue
pause with the same text until you choose.
