// Discovery cards (#256, src/discovery.js): the card API of the Inbox screen (views/inbox/) and of
// the Discovery board (#257, views/discovery/: the board, its WIP limits, a card's place in its
// column, the document's versions, a run's result coming back; #166: the clarity bar, the override
// into Ready, the ready forecast and the Grill me interview), and the
// only way a screen, the Oracle or an agent reaches a card. Every channel works on the workspace's
// discovery folder (layout().discovery), private to the workspace; the store refuses a project id,
// a card id or an attachment name that is a path. The author of a card, a move or a note is the
// person at this machine (the OS user name).
// The commitment point (#258, src/discovery-commit.js): discovery:commit-proposal asks the Product
// Owner how a Ready card splits into issues, discovery:commit files the split the owner confirmed
// on the project's synced repository and commits the card; the board lists the committed cards
// with their delivery (`committed`). Under MULTIAGENT_SIMULATION_ONLY the proposal is the
// rule-based one and the issues only join the workspace's synced backlog: never gh/glab, no model.
// `preview` (the screen's developer mode, like po:file and po:split): the rule-based proposal, and a
// commit that only answers with the commands it would run.
// Column automations (#259, src/service/areas/discovery-automations.js): discovery:move answers with
// what the column's on_enter proposes or started, discovery:set-automation sets a column's mode and
// discovery:run-automation starts a proposed one; the result comes back to the card by itself.

const os = require('os');
const path = require('path');
const backlog = require('../../backlog');
const commits = require('../../discovery-commit');
const discovery = require('../../discovery');
const productOwner = require('../../product-owner');
const projects = require('../../projects');
const releases = require('../../releases');
const simulation = require('../../engine/simulation');
const workspace = require('../../workspace');

// who captures, moves and discards from this app
function owner() {
  try { return os.userInfo().username || 'owner'; } catch { return 'owner'; }
}

module.exports = (ctx) => {
  const dir = () => ctx.ws.discovery;
  // the cards whose issues are being filed: a second commit of one files nothing
  const committing = new Set();
  // when the card was committed: the list shows the last committed first
  const committedAt = (c) => (c.history || []).findLast((h) => h.to === discovery.COMMITTED)?.ts || c.updated;
  // The committed cards (#258), each with its delivery from the Backlog's issues and the releases.
  function committed(projectId) {
    const cards = discovery.listCards(dir(), projectId, { column: discovery.COMMITTED });
    if (!cards.length) return [];
    const id = path.basename(String(projectId));
    const issues = ctx.withIssueRuns(backlog.readBacklog(ctx.ws.backlog, id))?.issues || [];
    const history = releases.readReleases(ctx.ws.releases, id).releases;
    return cards
      .sort((a, b) => String(committedAt(b)).localeCompare(String(committedAt(a))))
      .map((c) => ({ ...c, delivery: commits.cardDelivery(c, issues, history) }));
  }
  // the Backlog marks the issues filed from a card with it (#258, src/service/areas/backlog.js withIssueRuns)
  ctx.discoveryIssueCards = (projectId) => discovery.issueCards(dir(), projectId);
  const board = (projectId) => ({ ...discovery.readBoard(dir(), projectId), forecast: discovery.readyForecast(dir(), projectId), committed: committed(projectId) });
  // A card that may be committed, or the refusal (not Ready, under the commit bar with its gaps).
  function committable(projectId, cardId) {
    const card = discovery.readCard(dir(), projectId, cardId);
    const check = commits.checkCommit(card);
    if (!check.ok) throw new Error(check.reason);
    return card;
  }
  return [
    // the project's cards, newest first; `column` narrows them (the Inbox screen: 'inbox')
    {
      channel: 'discovery:list',
      method: 'listDiscoveryCards',
      params: ['projectId', 'column'],
      fn: ({ projectId, column }) => discovery.listCards(dir(), projectId, { column }),
    },
    // card.json plus its document, acceptance criteria and attachment names
    {
      channel: 'discovery:get',
      method: 'getDiscoveryCard',
      params: ['projectId', 'cardId'],
      fn: ({ projectId, cardId }) => discovery.readCard(dir(), projectId, cardId),
    },
    // quick capture: a card (an `idea` unless `type` says otherwise) in the Inbox, `text` its document;
    // `from` (#258): the committed card it was learned from, kept as links.from
    {
      channel: 'discovery:create',
      method: 'createDiscoveryCard',
      params: ['projectId', 'title', 'text', 'type', 'from'],
      fn: ({ projectId, title, text, type, from }) => discovery.createCard(dir(), projectId, { title, text, type: type || 'idea', author: owner(), from: from || undefined }),
    },
    // fields: title, type, tags, clarity, estimate, links, document, acceptance
    {
      channel: 'discovery:update',
      method: 'updateDiscoveryCard',
      params: ['projectId', 'cardId', 'fields'],
      fn: ({ projectId, cardId, fields }) => discovery.updateCard(dir(), projectId, cardId, fields || {}),
    },
    // to another column (Accept: 'triage'): a history entry and a version of the document; `index`
    // (optional) is its place among the column's other cards, also for a move within its column.
    // Into a column with an automation (#259, areas/discovery-automations.js) the card comes back
    // with `automation`: { status: 'proposed', column, name, kind, file, estimate } in 'ask' mode,
    // { status: 'running', runId, name } in 'on' mode ({ status: 'failed', error } when the start
    // failed: the move is done); nothing in 'off' mode or for a move within the column
    {
      channel: 'discovery:move',
      method: 'moveDiscoveryCard',
      params: ['projectId', 'cardId', 'column', 'index'],
      fn: ({ projectId, cardId, column, index }) => {
        const from = discovery.readCard(dir(), projectId, cardId).column;
        const card = discovery.moveCard(dir(), projectId, cardId, column, { by: owner(), index });
        return ctx.afterDiscoveryMove(projectId, card, from);
      },
    },
    // a column automation's mode (#259): 'ask' (proposed on each move into it), 'on' or 'off' → the board
    {
      channel: 'discovery:set-automation',
      method: 'setDiscoveryAutomation',
      params: ['projectId', 'column', 'mode'],
      fn: ({ projectId, column, mode }) => {
        discovery.setColumnAutomation(dir(), projectId, column, { mode });
        return board(projectId);
      },
    },
    // runs the column's automation on the card (the owner's Run on a proposal) → { runId, name }; the
    // card shows it running (automation { state: 'running', runId }) until its result comes back as a
    // version and a thread entry. The clarity check asks in the thread instead → { runId: null, question }
    {
      channel: 'discovery:run-automation',
      method: 'runDiscoveryAutomation',
      params: ['projectId', 'cardId', 'column'],
      fn: ({ projectId, cardId, column }) => ctx.startDiscoveryAutomation({ projectId, cardId, column }),
    },
    // the owner's override (#166): into Ready below the clarity bar, with a `reason` kept on the card
    // (clarity.override). A person's click only: no agent and no automation calls it
    {
      channel: 'discovery:move-anyway',
      method: 'moveDiscoveryCardAnyway',
      params: ['projectId', 'cardId', 'reason'],
      fn: ({ projectId, cardId, reason }) => discovery.moveCard(dir(), projectId, cardId, 'ready', { by: owner(), force: true, reason }),
    },
    // the board (#257): { columns: [{ id, title, wip }], order: { <column>: [card ids] } }, with the
    // project's clarity bar and night (#166: clarity { bar, byKind, night }), the ready work
    // (forecast { count, unestimated, hours, nights, nightHours }) and the committed cards (#258:
    // committed [{ ...card, delivery: { stage, counts, issues, release } }], the last committed first)
    {
      channel: 'discovery:board',
      method: 'discoveryBoard',
      params: ['projectId'],
      fn: ({ projectId }) => board(projectId),
    },
    // the Product Owner's proposal for committing a Ready card (#258): { split: { issues: [{ title,
    // tasks, complexity, workflow, reason }] }, model, costUsd, fallback? }. Refused like the commit
    // itself. A proposal the Product Owner could not give (no CLI, the budget, no folder) is the
    // rule-based one, with why in `fallback`: the commit never waits on a model
    {
      channel: 'discovery:commit-proposal',
      method: 'proposeDiscoveryCommit',
      params: ['projectId', 'cardId', 'preview'],
      fn: async ({ projectId, cardId, preview }) => {
        const card = committable(projectId, cardId);
        const simulated = !!preview || simulation.simulationOnly();
        const options = ctx.productOwnerOptions(path.basename(String(projectId)), simulated);
        try {
          return await productOwner.proposeCommit({ ...options, card });
        } catch (e) {
          return { ...(await productOwner.proposeCommit({ ...options, card, mock: true })), fallback: e.message };
        }
      },
    },
    // the commit (#258), on the owner's click only (no agent and no automation calls it): files the
    // confirmed `split` ({ issues: [{ title, tasks, complexity, workflow }] }) on the project's synced
    // repository, each issue with "From discovery card <id>", and commits the card (links.issues, off
    // the board) → { issues: [{ number, url, title, … }], card, simulated, failed?, skippedLabels?,
    // syncError? }. Refused outside Ready and under 85% clarity (the message lists the gaps).
    // `preview`: nothing is filed or committed → { preview: true, commands, issues: [], card }
    {
      channel: 'discovery:commit',
      method: 'commitDiscoveryCard',
      params: ['projectId', 'cardId', 'split', 'preview'],
      fn: async ({ projectId, cardId, split, preview }) => {
        committable(projectId, cardId);
        const id = path.basename(String(projectId));
        const data = backlog.readBacklog(ctx.ws.backlog, id);
        if (!data) throw new Error('Sync the backlog first: a commit files its issues on the synced repository.');
        const project = projects.readProject(ctx.ws.projects, id);
        const platform = data.platform || workspace.readSettings(ctx.ws).backlogPlatform || backlog.DEFAULT_PLATFORM;
        const repo = data.repo || project?.repo;
        const simulated = simulation.simulationOnly();
        if (preview && !simulated) return commits.commitCard({ dir: dir(), projectId, cardId, split, platform, repo, preview: true });
        const key = `${id}/${cardId}`;
        if (committing.has(key)) throw new Error('This card is being committed: its issues are being filed.');
        committing.add(key);
        let res;
        try {
          res = await commits.commitCard({
            dir: dir(), projectId, cardId, split, platform, repo, by: owner(),
            ...(simulated ? { exec: commits.simulatedExec({ backlogDir: ctx.ws.backlog, projectId: id, platform, repo }) } : {}),
          });
        } finally {
          committing.delete(key);
        }
        if (simulated) return { ...res, simulated };
        // after a real filing the Backlog shows the new issues right away
        try {
          await backlog.syncBacklog({ dir: ctx.ws.backlog, project, platform });
          return { ...res, simulated };
        } catch (e) {
          return { ...res, simulated, syncError: e.message };
        }
      },
    },
    // the project's clarity bar (0 to 100), a bar per kind ({ hotfix: 60 }; null: the project's) and
    // the night the forecast counts in ({ start, end } as HH:MM) → the board
    {
      channel: 'discovery:set-clarity-bar',
      method: 'setDiscoveryClarityBar',
      params: ['projectId', 'bar', 'byKind', 'night'],
      fn: ({ projectId, bar, byKind, night }) => {
        discovery.setClarityBar(dir(), projectId, { bar, byKind, night });
        return board(projectId);
      },
    },
    // Grill me (#166): asks the card's next open point in its thread → { card, bar, question }
    {
      channel: 'discovery:grill',
      method: 'grillDiscoveryCard',
      params: ['projectId', 'cardId'],
      fn: ({ projectId, cardId }) => discovery.grillCard(dir(), projectId, cardId),
    },
    // the person's answer to the waiting question, written into the card → { card, bar, question }
    // (question: the next one, or null when the interview ended)
    {
      channel: 'discovery:grill-answer',
      method: 'answerDiscoveryGrill',
      params: ['projectId', 'cardId', 'text'],
      fn: ({ projectId, cardId, text }) => discovery.answerGrill(dir(), projectId, cardId, { text, by: owner() }),
    },
    // a column's WIP limit (a positive integer) → the board; the limit warns, the store never blocks a move
    {
      channel: 'discovery:set-wip',
      method: 'setDiscoveryWip',
      params: ['projectId', 'column', 'limit'],
      fn: ({ projectId, column, limit }) => discovery.setWip(dir(), projectId, column, limit),
    },
    // the versions of the card's document, newest first: [{ name, ts, reason }]
    {
      channel: 'discovery:versions',
      method: 'discoveryVersions',
      params: ['projectId', 'cardId'],
      fn: ({ projectId, cardId }) => discovery.listVersions(dir(), projectId, cardId),
    },
    // a version's text (`name`: one of discovery:versions' names)
    {
      channel: 'discovery:version',
      method: 'discoveryVersion',
      params: ['projectId', 'cardId', 'name'],
      fn: ({ projectId, cardId, name }) => discovery.readVersion(dir(), projectId, cardId, name),
    },
    // the version becomes the document again (the replaced document is kept as a version) → the card
    {
      channel: 'discovery:restore-version',
      method: 'restoreDiscoveryVersion',
      params: ['projectId', 'cardId', 'name'],
      fn: ({ projectId, cardId, name }) => discovery.restoreVersion(dir(), projectId, cardId, name, { by: owner() }),
    },
    // the result of a run started from the card (`source`: 'write-review' | 'ai-arena'): the new
    // document, a version and a thread entry → the card
    {
      channel: 'discovery:record-result',
      method: 'recordDiscoveryResult',
      params: ['projectId', 'cardId', 'source', 'text', 'runId'],
      fn: ({ projectId, cardId, source, text, runId }) => discovery.recordResult(dir(), projectId, cardId, { source, text, runId, by: owner() }),
    },
    // a pasted, dropped or picked file (`name` + base64 `data`) → the stored name. A `path` is refused:
    // a screen (the browser UI too) never makes the service read a file of this machine by its path
    {
      channel: 'discovery:add-attachment',
      method: 'addDiscoveryAttachment',
      params: ['projectId', 'cardId', 'path', 'name', 'data'],
      fn: ({ projectId, cardId, path, name, data }) => {
        if (path) throw new Error('A file is attached by its name and data, not by a path.');
        return discovery.addAttachment(dir(), projectId, cardId, { name, data });
      },
    },
    {
      channel: 'discovery:remove-attachment',
      method: 'removeDiscoveryAttachment',
      params: ['projectId', 'cardId', 'name'],
      fn: ({ projectId, cardId, name }) => discovery.removeAttachment(dir(), projectId, cardId, name),
    },
    // { name, size, folder, dataUrl }: dataUrl is the image itself for a thumbnail, null for another file
    {
      channel: 'discovery:attachment',
      method: 'discoveryAttachment',
      params: ['projectId', 'cardId', 'name'],
      fn: ({ projectId, cardId, name }) => discovery.readAttachment(dir(), projectId, cardId, name),
    },
    // the card's thread, oldest first
    {
      channel: 'discovery:conversation',
      method: 'discoveryConversation',
      params: ['projectId', 'cardId'],
      fn: ({ projectId, cardId }) => discovery.readConversation(dir(), projectId, cardId),
    },
    // entry: { text, kind? ('note' by default), author? (the person at this machine by default) }
    {
      channel: 'discovery:append-conversation',
      method: 'appendDiscoveryConversation',
      params: ['projectId', 'cardId', 'entry'],
      fn: ({ projectId, cardId, entry }) => {
        // the store stamps the time: a caller's `ts` is dropped
        const { ts, ...e } = entry && typeof entry === 'object' ? entry : { text: String(entry ?? '') };
        if (!String(e.text ?? '').trim()) throw new Error('A note needs a text.');
        return discovery.appendConversation(dir(), projectId, cardId, { kind: 'note', author: owner(), ...e });
      },
    },
    // the cards whose thread ends with a question (Home's "What needs you", #255), the longest waiting
    // first: { id, title, column, question: { ts, author, text } }
    {
      channel: 'discovery:waiting',
      method: 'listDiscoveryWaiting',
      params: ['projectId'],
      fn: ({ projectId }) => discovery.listWaiting(dir(), projectId),
    },
    // Discard: the card moves to archive/ with its reason
    {
      channel: 'discovery:archive',
      method: 'archiveDiscoveryCard',
      params: ['projectId', 'cardId', 'reason'],
      fn: ({ projectId, cardId, reason }) => discovery.archiveCard(dir(), projectId, cardId, { reason, by: owner() }),
    },
    {
      channel: 'discovery:restore',
      method: 'restoreDiscoveryCard',
      params: ['projectId', 'cardId'],
      fn: ({ projectId, cardId }) => discovery.restoreCard(dir(), projectId, cardId, { by: owner() }),
    },
    // Merge into…: `cardId` joins `intoId` (documents, attachments) and is archived with a link to it
    {
      channel: 'discovery:merge',
      method: 'mergeDiscoveryCard',
      params: ['projectId', 'cardId', 'intoId'],
      fn: ({ projectId, cardId, intoId }) => discovery.mergeCard(dir(), projectId, cardId, intoId, { by: owner() }),
    },
  ];
};
