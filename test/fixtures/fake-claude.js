// Stands in for `claude -p --output-format stream-json` in tests: answers with the arguments it
// was started with (so a test can check the flags the engine built), two requests' usage and a
// handoff note. Never calls a model.
let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const out = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
  const sid = '00000000-0000-4000-8000-000000000001';
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
  const usage = (input, cached) => ({ input_tokens: input, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: 10 });
  out({ type: 'assistant', message: { id: 'm1', usage: usage(1000, 30000), content: [{ type: 'text', text: 'thinking about it' }] } });
  // a sub-agent's request: not the main conversation's context
  out({ type: 'assistant', parent_tool_use_id: 't1', message: { id: 'm2', usage: usage(90000, 0), content: [] } });
  out({ type: 'assistant', message: { id: 'm3', usage: usage(500, 41000), content: [] } });
  const text = `args: ${JSON.stringify(process.argv.slice(2))}\nprompt chars: ${stdin.length}\nMULTIAGENT_SIMULATION_ONLY: ${process.env.MULTIAGENT_SIMULATION_ONLY}\nMULTIAGENT_WORKSPACE: ${process.env.MULTIAGENT_WORKSPACE}\n\n\`\`\`handoff\n- Goal: fake\n\`\`\``;
  out({ type: 'result', result: text, session_id: sid, total_cost_usd: 0, usage: { input_tokens: 1500, output_tokens: 20, cache_read_input_tokens: 71000, cache_creation_input_tokens: 0 } });
});
