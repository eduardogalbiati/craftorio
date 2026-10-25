// Stands in for `claude -p --output-format stream-json` in tests (#470): answers with the names of
// the environment variables it was started with (never their values), so a test can check which
// variables the engine passes to an agent. Never calls a model.
let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const out = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
  const sid = '00000000-0000-4000-8000-000000000470';
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
  const text = `env keys: ${JSON.stringify(Object.keys(process.env))}\nprompt chars: ${stdin.length}\n\n\`\`\`handoff\n- Goal: fake\n\`\`\``;
  out({ type: 'result', result: text, session_id: sid, total_cost_usd: 0, usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
});
