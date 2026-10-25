// The constant-time comparison of a shared secret: the engine server's token (packages/engine/server/index.js,
// which re-exports it for the control channel) and the supervisor bridge's bearer (packages/engine/domains/supervisor/supervisor-bridge.js, SEC-21).

const crypto = require('crypto');

// (token) => (candidate) => boolean, compared in constant time
function tokenCheck(token) {
  const expected = crypto.createHash('sha256').update(String(token)).digest();
  return (t) => !!t && crypto.timingSafeEqual(crypto.createHash('sha256').update(String(t)).digest(), expected);
}

module.exports = {
  tokenCheck,
};
