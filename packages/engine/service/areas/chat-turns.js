// Service area: the agent chats' turns in flight (#180, packages/engine/domains/chat/chat-progress.js). The Product Owner,
// Oracle and Supervisor chat channels start one per question; its items are pushed on
// 'chat:progress' and chat:cancel (packages/engine/service/channels/chat.js) stops it.

const { createChatTurns } = require('../../domains/chat/chat-progress');

module.exports = (ctx) => {
  const chatTurns = createChatTurns({ emit: (payload) => ctx.events.emit('chat:progress', payload) });
  return {
    chatTurns,
  };
};
