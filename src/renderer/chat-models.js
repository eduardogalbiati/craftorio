// The CLIs, models and effort levels the chat screens offer (window.ChatModels: PROVIDERS,
// EFFORTS). Read as they load by Write & Review (views/duo/), AI Arena (views/arena/) and the
// Builder (views/workflows/builder.js); later by Agents and the supervisor drawer.
(() => {
  const PROVIDERS = {
    'claude-code': { label: 'Claude Code', key: 'claude', models: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-fable-5-1', 'claude-haiku-4-5'] },
    'codex-cli': { label: 'Codex CLI', key: 'codex', models: ['gpt-6-luna'] },
    'grok-cli': { label: 'Grok Build', key: 'grok', models: ['grok-4.7'] },
  };
  const EFFORTS = ['low', 'medium', 'high', 'xhigh'];
  window.ChatModels = { PROVIDERS, EFFORTS };
})();
