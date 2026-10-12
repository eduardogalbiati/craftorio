// Stands in for `claude -p --output-format stream-json --max-turns n` (#302) when the wrap-up itself
// runs out of requests: the first turn ends on its budget, the wrap-up (--resume) ends on its own
// --max-turns without a note, and a turn whose prompt says it continues after the cut answers
// normally. Never calls a model.
let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const out = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
  const args = process.argv.slice(2);
  const resumed = args.includes('--resume');
  const continued = stdin.includes('continued after');
  const sid = resumed ? args[args.indexOf('--resume') + 1] : `00000000-0000-4000-8000-00000000000${continued ? 2 : 1}`;
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
  const usage = { input_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0, output_tokens: 10 };
  if (continued) return out({ type: 'result', result: 'continued and done\n\n```handoff\n- Goal: fake\n```', session_id: sid, total_cost_usd: 0, usage });
  const turns = resumed ? 10 : 3;
  for (let i = 1; i <= turns; i++) out({ type: 'assistant', message: { id: `${resumed ? 'w' : 'm'}${i}`, usage, content: [] } });
  out({ type: 'result', subtype: 'error_max_turns', is_error: true, num_turns: turns, session_id: sid, total_cost_usd: 0, usage });
  process.exitCode = 1;
});
