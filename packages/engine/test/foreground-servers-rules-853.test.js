// #853 (acceptance tests, written before the code): agents never hang on a foreground dev server.
// The long-commands skill gets a "Servers and watchers" section (never in the foreground; when needed,
// run_in_background + a short health check with a deadline + stop it before answering), its §1
// `timeout: 600000` advice says it is for commands that end, never for servers; the developer's
// prompt of feature.yaml and of the local AI Development hero carries one line about it; the engine
// doc describes the guard (warning `server_in_foreground`) next to the idle watch.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow } = require('../engine/workflow');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const flat = (s) => s.replace(/\s+/g, ' ');

// the text of a `## ` section whose heading matches, up to the next `## ` heading
function section(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => /^## /.test(l) && heading.test(l));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^## /.test(l));
  return flat([lines[start], ...(end < 0 ? rest : rest.slice(0, end))].join('\n'));
}

const SKILL = () => read('skills', 'long-commands', 'SKILL.md');

test('long-commands has a "Servers and watchers" section: never in the foreground', () => {
  const s = section(SKILL(), /servers and watchers/i);
  assert.ok(s, 'a "## ... Servers and watchers" section');
  assert.match(s, /never/i);
  assert.match(s, /foreground/i);
});

test('the servers section says how to run one when needed: run_in_background, a health check with a timeout and a deadline, stopped before answering', () => {
  const s = section(SKILL(), /servers and watchers/i) || '';
  assert.match(s, /run_in_background/);
  assert.match(s, /curl/);
  assert.match(s, /deadline/i);
  assert.match(s, /stop/i);
  assert.match(s, /before (you )?answer/i);
});

test('the servers section prefers starting and stopping the server inside the test', () => {
  const s = section(SKILL(), /servers and watchers/i) || '';
  assert.match(s, /inside the test/i);
});

test('§1 says its long timeout is for commands that end, never for servers', () => {
  const s = section(SKILL(), /^## 1\./);
  assert.ok(s, 'section 1 still exists');
  assert.match(s, /600000/);
  assert.match(s, /commands that end/i);
  assert.match(s, /never for (dev )?servers|not for (dev )?servers/i);
});

for (const rel of ['workflows/feature.yaml', '.multiagent/workflows/ai-development-local-hero.yaml']) {
  test(`${rel}: the developer's prompt says never to run a dev server or watcher in the foreground (see long-commands)`, () => {
    const develop = loadWorkflow(path.join(ROOT, rel)).steps.find((s) => s.id === 'develop');
    assert.ok(develop, 'a develop step');
    const p = flat(develop.prompt);
    assert.match(p, /never[^.]*dev server[^.]*foreground|never[^.]*foreground[^.]*dev server/i);
    assert.match(p, /watcher/i);
    assert.match(p, /long-commands/);
  });
}

test('the sessions doc describes the server-in-foreground guard next to the idle watch', () => {
  const doc = read('docs', 'agents', 'engine', 'sessions-and-handoff-notes.md');
  assert.match(doc, /server_in_foreground/);
  assert.match(doc, /agent_idle|idle watch/i);
});
