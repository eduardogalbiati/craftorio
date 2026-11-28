// Home's cards (phase 3 of docs/reorganisation-study-2026-10.md, decision 5 of 2026-10-24): Home
// (views/dashboard/) is the shell's and shows the flow strip, "What needs you" and "Today", but what
// those hold comes from the fronts, each registering its card as it loads (the way a screen calls
// registerView), so a composition shows only the cards of the fronts it ships: no Inbox stage
// without the plan front, no roadmap rows without the build front, no night cost without the AI front.
// load: early (the fronts' cards register as their files load; Home reads the list when it draws)
//
//   HomeCards.register({ id, order, read, stages, needs, today, morning, actions })
//     id, order      the front's id and where its parts sort among the others'
//     read(ctx)      async: what the card needs of the header's project, kept as its own data
//                    (ctx: { projectId, api, state, list, read }; `read(fn)` swallows a failure to null)
//     stages         [{ id, order, view, count(own, d), open(own, d) }]: the flow strip's stages, each
//                    with its screen (left out when the screen is not registered), its count and how
//                    its count opens the screen (default: showView(view)); the label and the hint are
//                    the catalog's `dashboard.stage_<id>` and `dashboard.stage_<id>_hint`
//     needs(own, d)  the "What needs you" rows: { kind, order, title, detail, since, phoneUrl, button:
//                    { label, attr, value, primary } }; `kind` picks the badge (gate, card, failed-item,
//                    paused-run; the Home redesign of 2026-11-28: pr, error, usage) and is the row's data-kind
//     today(own, d)  the "Last 24 hours" stats (it was "Today" before the Home redesign):
//                    { order, label, value (html), title, attrs }
//     blocks(own, d) the blocks between the flow and the bottom row (the Home redesign: Now, Roadmap, Next
//                    release): [{ id, order, html }], only those with something to show, laid side by side
//     morning(box)   async: draws the card's box beside "Last 24 hours" into `box` (the last watch) and answers what it
//                    showed (kept as own.morning; null hides the box). One banner: Home has one box,
//                    so one card of a composition draws into it (the Night watch's morning summary)
//     actions        { 'data-home-<x>': (value, own, d) => … }: the clicks of the buttons the card draws
//   `d` is what Home read: { projectId, active, runs, cards: { <id>: own } }.
//   HomeCards.list()    the cards by order; HomeCards.stages()  every stage with its card, by order
// Browser: window.HomeCards; Node: module.exports (tested without a DOM).
(function (root) {
  const cards = [];
  const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.id).localeCompare(String(b.id));

  /** Adds a front's card (a second registration under the same id replaces the first). */
  function register(card) {
    if (!card || typeof card.id !== 'string') throw new Error('HomeCards.register: a card needs an id');
    const at = cards.findIndex((c) => c.id === card.id);
    if (at >= 0) cards.splice(at, 1);
    cards.push(card);
    cards.sort(byOrder);
    return card;
  }

  const list = () => [...cards];
  /** Every card's stages with their card, by the stage's order (a tie sorts by the stage's id). */
  const stages = () => cards.flatMap((card) => (card.stages || []).map((s) => ({ ...s, card }))).sort(byOrder);
  /** For tests: forgets every card. */
  const reset = () => { cards.length = 0; };

  const api = { list, register, reset, stages };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.HomeCards = api;
})(typeof window !== 'undefined' ? window : globalThis);
