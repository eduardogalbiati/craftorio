// Stands in for `claude -p --output-format stream-json`, like fake-claude.js, but its assistant
// message also carries two tool_use blocks (Task and Agent): the engine's sub-agent count (#160)
// must come from the stream, not from a mock run (the mock provider never emits Agent/Task).
let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const out = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
  const sid = '00000000-0000-4000-8000-000000000002';
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
  const usage = (input, cached) => ({ input_tokens: input, cache_read_input_tokens: cached, cache_creation_input_tokens: 0, output_tokens: 10 });
  out({
    type: 'assistant',
    message: {
      id: 'm1',
      usage: usage(1000, 30000),
      content: [
        { type: 'text', text: 'Mapping the change before editing.' },
        { type: 'tool_use', id: 't1', name: 'Task', input: { subagent_type: 'Explore', description: 'Map the login flow' } },
        { type: 'tool_use', id: 't2', name: 'Agent', input: { subagent_type: 'Explore', description: 'Summarize the failing suite log' } },
        { type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'git status' } },
      ],
    },
  });
  out({
    type: 'user',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 't1', content: 'login flow mapped' },
        { type: 'tool_result', tool_use_id: 't2', content: 'suite log summarized' },
        { type: 'tool_result', tool_use_id: 't3', content: 'On branch feat/mock-feature' },
      ],
    },
  });
  const text = 'Done.';
  out({ type: 'result', result: text, session_id: sid, total_cost_usd: 0, usage: { input_tokens: 1500, output_tokens: 20, cache_read_input_tokens: 71000, cache_creation_input_tokens: 0 } });
});
