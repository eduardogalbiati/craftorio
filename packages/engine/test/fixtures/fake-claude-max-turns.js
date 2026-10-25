// Stands in for `claude -p --output-format stream-json --max-turns n` (#302): a first turn ends on its
// budget (a `result` of subtype error_max_turns, exit code 1); the wrap-up (--resume) answers with a
// note; a turn whose prompt says it continues after the cut answers normally. Never calls a model.
let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const out = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
  const args = process.argv.slice(2);
  const resumed = args.includes('--resume');
  const sid = resumed ? args[args.indexOf('--resume') + 1] : `00000000-0000-4000-8000-00000000000${stdin.includes('continued after') ? 2 : 1}`;
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
  const usage = { input_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0, output_tokens: 10 };
  const result = (text) => out({ type: 'result', result: text, session_id: sid, total_cost_usd: 0, usage });
  if (resumed) return result(`args: ${JSON.stringify(args)}\n\n\`\`\`handoff\n- Goal: fake wrap-up note\n\`\`\``);
  if (stdin.includes('continued after')) return result('continued and done\n\n```handoff\n- Goal: fake\n```');
  for (const id of ['m1', 'm2', 'm3']) out({ type: 'assistant', message: { id, usage, content: [] } });
  out({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: 3, session_id: sid, total_cost_usd: 0, usage });
  process.exitCode = 1;
});
