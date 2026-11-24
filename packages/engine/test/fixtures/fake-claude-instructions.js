// Stands in for `claude -p --output-format stream-json` in tests of the project instructions (#45).
// Never calls a model. `--record <file>` (a provider argument): each call appends one JSON line there
// with what reached the model (`stdin`, and `system`: --append-system-prompt[-file]) and the settings
// it loaded. Like the real CLI (2.1.316), only the setting sources of --setting-sources load
// (all three without the flag): `project` runs the checkout's SessionStart hooks, takes its
// permissions.allow and loads its CLAUDE.md by itself.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const argv = process.argv.slice(2);
const after = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
const read = (file) => { try { return fs.readFileSync(file, 'utf8'); } catch { return ''; } };

let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const system = [];
  argv.forEach((a, i) => {
    if (a === '--append-system-prompt') system.push(argv[i + 1]);
    if (a === '--append-system-prompt-file') system.push(read(argv[i + 1]));
  });
  const raw = after('--setting-sources');
  const sources = raw === null ? ['user', 'project', 'local'] : raw.split(',').map((s) => s.trim()).filter(Boolean);
  const allow = [];
  let native = '';
  const load = (file) => {
    const s = read(path.join(process.cwd(), '.claude', file));
    if (!s) return;
    const settings = JSON.parse(s);
    allow.push(...(settings.permissions?.allow || []));
    for (const g of settings.hooks?.SessionStart || []) for (const h of g.hooks) execSync(h.command, { cwd: process.cwd(), stdio: 'ignore' });
  };
  if (sources.includes('project')) { load('settings.json'); native = read(path.join(process.cwd(), 'CLAUDE.md')); }
  if (sources.includes('local')) load('settings.local.json');

  const record = after('--record');
  const resumed = after('--resume');
  if (record) fs.appendFileSync(record, `${JSON.stringify({ argv, cwd: process.cwd(), resumed, stdin, system: system.join('\n'), native, sources, allow })}\n`);

  const out = (ev) => process.stdout.write(`${JSON.stringify(ev)}\n`);
  const sid = resumed || '00000000-0000-4000-8000-000000000045';
  const usage = { input_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, output_tokens: 5 };
  out({ type: 'system', subtype: 'init', session_id: sid, model: 'fake' });
  out({ type: 'assistant', message: { id: 'm1', usage, content: [{ type: 'text', text: 'done' }] } });
  out({ type: 'result', result: 'done', session_id: sid, total_cost_usd: 0, usage });
});
