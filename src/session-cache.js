// An agent session's prompt cache (#320): the cache's lifetime per provider and the session's next
// turn (fresh, warm, cold, new). The module lives in src/shared/session-cache.js so the screens
// load the same code; this file is its Node entry for the engine, the service and the Oracle.
module.exports = require('./shared/session-cache');
