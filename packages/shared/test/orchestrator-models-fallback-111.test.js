// #111 (acceptance tests, written before the code): with Codex as the orchestrator AI (#97), a mapped Codex model the
// account does not offer falls back to the closest offered one in the same tier or below, never to a model the
// account does not list.
//
// Contract assumed (packages/shared/orchestrator-models.js):
// - codexFallback(model, offered) -> string | null: `model` (a Codex slug of CODEX_MODEL_FOR's values) when `offered`
//   (the account's model slugs, as the CLI's models_cache.json lists them) has it; else the closest offered model in
//   the same tier or below (tiers: Astra > Sol > Terra > Luna); null when the account offers no usable model for it.
// Worked example of the issue: an account offering gpt-6-luna, gpt-5.6-terra, gpt-5.6-luna (plus gpt-reserve and
// codex-auto-review) runs Sol on gpt-6-luna.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../orchestrator-models');

const MAPPED = ['gpt-6.2-astra', 'gpt-6.2-sol', 'gpt-6.1-terra', 'gpt-6-luna'];
const POOR = ['gpt-6-luna', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-reserve', 'codex-auto-review'];
const NONE_USABLE = ['gpt-reserve', 'codex-auto-review'];

test('#111 codexFallback is exported as a function', () => {
  const { codexFallback } = load();
  assert.equal(typeof codexFallback, 'function');
});

test('#111 codexFallback: Sol and Astra run on gpt-6-luna on an account offering only gpt-6-luna and gpt-5.6-*', () => {
  const { codexFallback } = load();
  assert.equal(codexFallback('gpt-6.2-sol', POOR), 'gpt-6-luna');
  assert.equal(codexFallback('gpt-6.2-astra', POOR), 'gpt-6-luna');
});

test('#111 codexFallback: an offered mapped model is kept (gpt-6-luna stays gpt-6-luna)', () => {
  const { codexFallback } = load();
  assert.equal(codexFallback('gpt-6-luna', POOR), 'gpt-6-luna');
});

test('#111 codexFallback: Terra falls back to an offered model of its tier or below, never a higher one', () => {
  const { codexFallback } = load();
  const got = codexFallback('gpt-6.1-terra', POOR);
  assert.ok(['gpt-5.6-terra', 'gpt-6-luna'].includes(got), `Terra fell back to ${got}`);
});

test('#111 codexFallback: the full list keeps the #97 mapping as is', () => {
  const { codexFallback } = load();
  for (const model of MAPPED) assert.equal(codexFallback(model, [...MAPPED]), model, model);
});

test('#111 codexFallback: an empty list, or one with no tiered model, gives no fallback (null)', () => {
  const { codexFallback } = load();
  for (const model of MAPPED) {
    assert.equal(codexFallback(model, []), null, `${model} with []`);
    assert.equal(codexFallback(model, NONE_USABLE), null, `${model} with ${NONE_USABLE}`);
  }
});

test('#111 codexFallback never returns a model the account does not list', () => {
  const { codexFallback } = load();
  const lists = [POOR, NONE_USABLE, [], ['gpt-6.2-sol'], ['gpt-5.6-luna'], ['gpt-6.1-terra', 'gpt-6-luna'], MAPPED];
  for (const offered of lists) {
    for (const model of MAPPED) {
      const got = codexFallback(model, [...offered]);
      assert.equal(got === null || offered.includes(got), true, `${model} with [${offered}] gave ${got}`);
    }
  }
});

test('#111 codexFallback never picks a higher tier: Luna with only Sol offered has no fallback', () => {
  const { codexFallback } = load();
  assert.equal(codexFallback('gpt-6-luna', ['gpt-6.2-sol', 'gpt-6.2-astra']), null);
});
