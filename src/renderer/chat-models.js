// The CLIs, models and effort levels the chat screens offer (window.ChatModels: PROVIDERS by provider
// type { label, key, models }, EFFORTS, typeOf(id or model) → its provider type, models(id or type) →
// its models), from the provider registry (window.Providers, packages/shared/providers/). Read as they
// load by Write & Review (views/duo/), AI Arena (views/arena/) and the Builder
// (views/workflows/builder.js); later by Agents and the supervisor drawer.
(() => {
  const registry = window.Providers;
  const PROVIDERS = Object.fromEntries(registry.clis().map((a) => [a.type, { label: a.label, key: a.id, models: a.models }]));
  const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
  const typeOf = (key) => registry.resolve(key)?.type || '';
  const models = (key) => registry.resolve(key)?.models || [];
  window.ChatModels = { PROVIDERS, EFFORTS, models, typeOf };
})();
