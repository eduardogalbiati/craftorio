// Token counts the stream parsers of the provider adapters share (#348): a turn's empty usage and the
// tokens in one request's context window. Browser: window.ProviderUsage; Node: module.exports.
(function (root) {
  const emptyUsage = () => ({ input: 0, output: 0, cache_read: 0, cache_write: 0, reasoning: 0 });

  // Tokens in one request's context window (Anthropic-style usage: new + cached input).
  const contextTokens = (u) => (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);

  const api = {
    contextTokens,
    emptyUsage,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ProviderUsage = api;
})(typeof window !== 'undefined' ? window : globalThis);
