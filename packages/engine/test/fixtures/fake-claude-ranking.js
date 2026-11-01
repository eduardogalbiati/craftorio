// Stands in for `claude -p --output-format stream-json` in the refactor ranking tests (#728): reads
// the Product Owner's prompt from stdin, finds the open proposals it lists ("- id <id>: ...") and
// answers a ranking in the REVERSE order of the prompt (so a test can tell this answer from the
// simulated one). The first argument, when given, is a file it creates to show it ran. Never calls a model.
const fs = require('fs');
let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const marker = process.argv[2];
  if (marker && marker.endsWith('.ran')) fs.writeFileSync(marker, 'ran');
  const out = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
  const sid = '00000000-0000-4000-8000-000000000728';
  const ids = [...stdin.matchAll(/^- id (\S+?):/gm)].map((m) => m[1]);
  const ranking = ids.slice().reverse().map((id, i) => ({ id, rank: i + 1, reason: `Fake Product Owner reason ${i + 1}`, complexity: 2 }));
  const text = `Ranked.\n\n\`\`\`json\n${JSON.stringify({ ranking })}\n\`\`\``;
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
  out({ type: 'assistant', message: { id: 'm1', usage: { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 10 }, content: [{ type: 'text', text }] } });
  out({ type: 'result', result: text, session_id: sid, total_cost_usd: 0.0123, usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
});
