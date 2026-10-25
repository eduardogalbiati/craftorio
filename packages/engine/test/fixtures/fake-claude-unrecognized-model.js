// Stands in for `claude -p --output-format stream-json --model <model>` on an installed Claude Code
// that does not know the model (#369): with `--unrecognized` it writes Claude Code's
// `[claude-code:unrecognized_model]` line to stderr, then streams one turn whose `result` carries
// total_cost_usd 0.185271 (the CLI priced it at Opus 5.5 rates) and the issue's tokens: 2 input,
// 2,093 output, 12,616 cache read, 17,610 cache write. `--tier 5m|1h` (default 1h): the cache tier
// the assistant message's usage reports. A fresh CLI session id per process. Never calls a model.
const crypto = require('crypto');

const argv = process.argv.slice(2);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback; };
const model = arg('--model', 'fake');
const tier = arg('--tier', '1h');

let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  if (argv.includes('--unrecognized')) {
    process.stderr.write(`[claude-code:unrecognized_model] ${JSON.stringify({ model, query_source: 'sdk' })}\n`);
  }
  const out = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
  const sid = crypto.randomUUID();
  const cacheCreation = tier === '5m'
    ? { ephemeral_5m_input_tokens: 17610, ephemeral_1h_input_tokens: 0 }
    : { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 17610 };
  const usage = { input_tokens: 2, output_tokens: 2093, cache_read_input_tokens: 12616, cache_creation_input_tokens: 17610, cache_creation: cacheCreation };
  out({ type: 'system', subtype: 'init', session_id: sid, model });
  out({ type: 'assistant', message: { id: 'm1', usage, content: [{ type: 'text', text: 'Done.' }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: sid, total_cost_usd: 0.185271, usage });
});
