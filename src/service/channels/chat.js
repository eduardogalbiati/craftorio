// The agent chats' live turns (#180, src/chat-progress.js): what the Product Owner ('po', key: the
// project id), the Oracle ('oracle') and the Supervisor chat ('supervisor') are doing, pushed on
// chat:progress { chat, key, turnId, phase, items, status } while they answer; chat:cancel stops
// the turn in flight (the partial answer is kept, marked as stopped) → whether there was one.

module.exports = (ctx) => [
  { channel: 'chat:cancel', method: 'cancelChatTurn', params: ['chat', 'key'], fn: ({ chat, key }) => ctx.chatTurns.cancel(String(chat || ''), String(key || '')) },
  { event: 'chat:progress', method: 'onChatProgress' },
];
