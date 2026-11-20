// Stands in for `claude -p --output-format stream-json` on a Claude Code that fails during the turn
// (#860): it writes a line to stderr, then streams a `result` event with subtype
// `error_during_execution`, `is_error: true`, an empty `result` and the CLI's own error details
// (its `errors` list), and exits with code 1. Never calls a model.
// Flags (the extra args after the script):
//   --no-details   the result has no `errors` list and nothing is written to stderr (today's message)
//   --result <t>   the result event's `result` text (default: empty)
//   --partial      the assistant writes "Partial answer before the failure." before the error
//   --long-stderr  stderr gets a 5,000-character block that starts with HEAD-OF-STDERR-860 and ends
//                  with the usual stderr line (only its tail is expected in the message)
//   --blank-stderr stderr gets only whitespace
const crypto = require('crypto');

const argv = process.argv.slice(2);
const has = (name) => argv.includes(name);
const arg = (name, fallback) => { const i = argv.indexOf(name); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : fallback; };

const ERRORS = [
  'API Error: 404 {"type":"error","error":{"type":"not_found_error","message":"model: claude-opus-5-5"}}',
  'MCP server "oracle" failed to start',
];
const STDERR_LINE = 'fake-claude-860: the CLI stopped while running the turn';

let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const out = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
  const sid = crypto.randomUUID();
  if (has('--blank-stderr')) process.stderr.write('   \n\n  \n');
  else if (has('--long-stderr')) process.stderr.write(`HEAD-OF-STDERR-860 ${'x'.repeat(5000)}\n${STDERR_LINE}\n`);
  else if (!has('--no-details')) process.stderr.write(`${STDERR_LINE}\n`);
  out({ type: 'system', subtype: 'init', session_id: sid, model: arg('--model', 'fake') });
  const usage = { input_tokens: 3, output_tokens: 7, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
  if (has('--partial')) {
    out({ type: 'assistant', message: { id: 'm1', usage, content: [{ type: 'text', text: 'Partial answer before the failure.' }] } });
  }
  const result = { type: 'result', subtype: 'error_during_execution', is_error: true, result: arg('--result', ''), session_id: sid, total_cost_usd: 0, usage };
  if (!has('--no-details')) result.errors = ERRORS;
  out(result);
  process.exitCode = 1;
});
