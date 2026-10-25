// The simulated provider (#348): no CLI, the engine's runMock (packages/engine/engine/providers.js) answers each
// turn. Listed by the registry (index.js) so `mock` resolves like the CLIs.
// Browser: window.ProviderMock; Node: module.exports.
(function (root) {
  const mock = {
    id: 'mock',
    type: 'mock',
    cli: null,
    label: 'Simulated',
    short: 'Simulated',
    modelPrefixes: [],
    models: [],
    // attached images: recorded in the turn, never opened
    imageInput: 'record',
  };

  if (typeof module === 'object' && module.exports) module.exports = mock;
  else root.ProviderMock = mock;
})(typeof window !== 'undefined' ? window : globalThis);
