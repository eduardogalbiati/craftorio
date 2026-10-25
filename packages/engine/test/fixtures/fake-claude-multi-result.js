// Stands in for `claude -p --output-format stream-json` on a turn that used sub-agents (#277): the
// stream ends with two `result` events one ms apart, both carrying the CLI session's running
// total_cost_usd (US$ 15), the first with the larger usage. A fresh CLI session id per process.
// Never calls a model.
const crypto = require('crypto');

let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const out = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
  const sid = crypto.randomUUID();
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
  out({ type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, cache_read_input_tokens: 30000, cache_creation_input_tokens: 0, output_tokens: 50 }, content: [{ type: 'text', text: 'Done.' }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: sid, total_cost_usd: 15,
    usage: { input_tokens: 102, output_tokens: 84376, cache_read_input_tokens: 7714400, cache_creation_input_tokens: 198504 } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: sid, total_cost_usd: 15,
    usage: { input_tokens: 22, output_tokens: 18805, cache_read_input_tokens: 1203311, cache_creation_input_tokens: 40211 } });
});
