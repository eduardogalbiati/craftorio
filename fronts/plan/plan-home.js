// The Design & Plan front's Home card (phase 3 of docs/reorganisation-study-2026-10.md, decision 5;
// the kit's home-cards.js): the flow strip's Inbox, Discovery and Ready stages with their counts, and
// the "What needs you" rows of the discovery cards whose thread ends with a question (e.g. a grill-me
// question), each with Answer, which opens the Inbox on the card (a card still in the Inbox) or the
// Discovery board. A composition without this front shows none of it. Uses the globals of app.js
// (showView, viewRegistry) at call time and the Inbox's window.InboxActions (views/inbox/inbox.js).
(function () {
  // the cards whose question waits: a card that left the Inbox needs the Discovery board (#261) to be answered
  const canAnswer = (c) => viewRegistry.has(c.column === 'inbox' ? 'inbox' : 'discovery');
  const inColumns = (own, columns) => own.cards.filter((c) => columns.includes(c.column)).length;

  window.HomeCards.register({
    id: 'plan',
    order: 10,
    async read({ projectId, api, list, read }) {
      const [inbox, cards, waiting] = await Promise.all([
        read(() => projectId && api.listDiscoveryCards(projectId, 'inbox')),
        read(() => projectId && viewRegistry.has('discovery') && api.listDiscoveryCards(projectId)),
        read(() => projectId && api.listDiscoveryWaiting(projectId)),
      ]);
      return { inbox: list(inbox), cards: list(cards), waiting: list(waiting) };
    },
    stages: [
      { id: 'inbox', order: 10, view: 'inbox', count: (own) => (own.inbox || []).length },
      { id: 'discovery', order: 20, view: 'discovery', count: (own) => inColumns({ cards: own.cards || [] }, ['triage', 'shape', 'define']) },
      { id: 'ready', order: 30, view: 'discovery', count: (own) => inColumns({ cards: own.cards || [] }, ['ready']) },
    ],
    needs(own) {
      return (own.waiting || []).filter(canAnswer).map((c) => ({
        kind: 'card', order: 30, since: c.question?.ts || null,
        title: c.title || t('dashboard.discovery_card'), detail: [c.question?.author, c.question?.text].filter(Boolean).join(': '),
        button: { label: t('dashboard.answer'), attr: 'data-home-card', value: c.id, primary: true },
      }));
    },
    actions: {
      // Answer: the Inbox with the card open, else the Discovery board
      'data-home-card': (id, own) => {
        const card = (own.waiting || []).find((c) => c.id === id);
        return card?.column === 'inbox' ? window.InboxActions?.openCard(id) : showView('discovery');
      },
    },
  });
})();
