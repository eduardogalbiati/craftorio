// Discovery cards (#256, src/discovery.js): the card API of the Inbox screen (views/inbox/), and the
// only way a screen, the Oracle or an agent reaches a card. Every channel works on the workspace's
// discovery folder (layout().discovery), private to the workspace; the store refuses a project id,
// a card id or an attachment name that is a path. The author of a card, a move or a note is the
// person at this machine (the OS user name).

const os = require('os');
const discovery = require('../../discovery');

// who captures, moves and discards from this app
function owner() {
  try { return os.userInfo().username || 'owner'; } catch { return 'owner'; }
}

module.exports = (ctx) => {
  const dir = () => ctx.ws.discovery;
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
    // quick capture: a card (an `idea` unless `type` says otherwise) in the Inbox, `text` its document
    {
      channel: 'discovery:create',
      method: 'createDiscoveryCard',
      params: ['projectId', 'title', 'text', 'type'],
      fn: ({ projectId, title, text, type }) => discovery.createCard(dir(), projectId, { title, text, type: type || 'idea', author: owner() }),
    },
    // fields: title, type, tags, clarity, estimate, links, document, acceptance
    {
      channel: 'discovery:update',
      method: 'updateDiscoveryCard',
      params: ['projectId', 'cardId', 'fields'],
      fn: ({ projectId, cardId, fields }) => discovery.updateCard(dir(), projectId, cardId, fields || {}),
    },
    // to another column (Accept: 'triage'): a history entry and a version of the document
    {
      channel: 'discovery:move',
      method: 'moveDiscoveryCard',
      params: ['projectId', 'cardId', 'column'],
      fn: ({ projectId, cardId, column }) => discovery.moveCard(dir(), projectId, cardId, column, { by: owner() }),
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
