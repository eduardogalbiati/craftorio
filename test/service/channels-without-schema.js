// #338's ratchet (test/service/channel-schema-ratchet-338.test.js): the channels the service answers
// without a JSON Schema (`schema: { params, result }` in their manifest entry), each with why its
// arguments are free-form by design. The list only shrinks: a channel that gains a schema leaves it,
// and a new channel is never added here. A helper module: it registers no test. Sorted by channel.

module.exports = [];
