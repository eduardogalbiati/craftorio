// packages/ui-kit/live-turn.js (#180): the agent chats' shared live turn, used by the Product Owner's
// drawer, the Oracle (dock/drawer) and the Supervisor chat. Pure enough to run outside the browser
// (module.exports): apply() folds chat:progress payloads into the turn, view() derives what the
// activity line shows, stepLabel()/duration()/visibleText() are its small pure helpers, and html()/
// onClick() the markup and its two clickable bits (Stop, the steps toggle).
const test = require('node:test');
const assert = require('node:assert/strict');
const LiveTurn = require('../live-turn');

const { apply, create, duration, html, onClick, stepLabel, view, visibleText } = LiveTurn;

// ---- create / apply: folding chat:progress payloads into the turn -------------------------------

test('create: a fresh turn starts "starting", with no steps or text and the steps list open', () => {
  const turn = create({ agent: 'Product Owner', now: 42 });
  assert.equal(turn.agent, 'Product Owner');
  assert.equal(turn.status, 'starting');
  assert.equal(turn.turnId, null);
  assert.deepEqual(turn.steps, []);
  assert.deepEqual(turn.texts, []);
  assert.equal(turn.stepsOpen, true);
  assert.equal(turn.startedAt, 42);
});

test('apply: "start" adopts the payload\'s turnId; a later payload for a different turnId is ignored', () => {
  let turn = create({ now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 'abc' }, 10);
  assert.equal(turn.turnId, 'abc');
  assert.equal(turn.lastAt, 10);
  const before = JSON.stringify(turn);
  apply(turn, { phase: 'items', turnId: 'other-turn', items: [{ kind: 'text', text: 'nope' }] }, 20);
  assert.equal(JSON.stringify(turn), before);
});

test('apply: a tool_call starts a running step; its tool_result (matched by id) marks it done or error; thinking clears once a step starts', () => {
  let turn = create({ now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'thinking' }] }, 1);
  assert.equal(turn.thinking, true);
  assert.equal(turn.status, 'working');

  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'tool_call', id: 'c1', name: 'Read', input: { file_path: 'a.js' } }] }, 2);
  assert.equal(turn.thinking, false);
  assert.equal(turn.steps.length, 1);
  assert.equal(turn.steps[0].state, 'running');
  assert.equal(turn.steps[0].label, 'Reading a.js');

  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'tool_result', id: 'c1', is_error: true }] }, 3);
  assert.equal(turn.steps[0].state, 'error');
});

test('apply: a tool_result with no id matches the last running step (a simulated turn never sends ids back out of order)', () => {
  let turn = create({ now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'tool_call', id: 'c1', name: 'Grep', input: { pattern: 'x' } }] }, 0);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'tool_result', is_error: false }] }, 1);
  assert.equal(turn.steps[0].state, 'done');
});

test('apply: a text item switches the status to "writing"; "end" sets a final status, an unrecognised one defaulting to "done"', () => {
  let turn = create({ now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'text', text: 'Hello' }] }, 1);
  assert.equal(turn.status, 'writing');
  assert.deepEqual(turn.texts, ['Hello']);

  turn = apply(turn, { phase: 'end', turnId: 't1', status: 'stopped' }, 2);
  assert.equal(turn.status, 'stopped');

  turn = apply(turn, { phase: 'end', turnId: 't1', status: 'weird' }, 3);
  assert.equal(turn.status, 'done');
});

// ---- visibleText: the prose written so far, without the trailing ```json block ------------------

test('visibleText: strips a trailing ```json block, keeping the prose written so far', () => {
  assert.equal(visibleText(['Some analysis.', '```json\n{"a":1}\n```']), 'Some analysis.');
  assert.equal(visibleText([]), '');
});

// ---- stepLabel: what a tool call says it is doing -------------------------------------------------

test('stepLabel: Read, Grep, Glob and TodoWrite read as what they do; an unknown tool falls back to "Using <name>"', () => {
  assert.equal(stepLabel({ name: 'Read', input: { file_path: 'C:\\project\\src\\deep\\nested\\roadmap.js' } }), 'Reading deep/nested/roadmap.js');
  assert.equal(stepLabel({ name: 'Grep', input: { pattern: 'dispatchRoadmaps' } }), 'Searching the code for dispatchRoadmaps');
  assert.equal(stepLabel({ name: 'Glob', input: { pattern: '**/*.test.js' } }), 'Listing files **/*.test.js');
  assert.equal(stepLabel({ name: 'TodoWrite' }), 'Updating its plan');
  assert.equal(stepLabel({ name: 'SomeOtherTool' }), 'Using SomeOtherTool');
  assert.equal(stepLabel({}), 'Using a tool');
});

test('stepLabel: a Bash command reads gh/glab and git as what they do', () => {
  assert.equal(stepLabel({ name: 'Bash', input: { command: 'gh issue list --state open' } }), 'Listing open issues (gh)');
  assert.equal(stepLabel({ name: 'Bash', input: { command: 'gh issue view 15' } }), 'Reading issue #15 (gh)');
  assert.equal(stepLabel({ name: 'Bash', input: { command: 'git log --oneline' } }), 'Reading the git history');
  assert.equal(stepLabel({ name: 'Bash', input: { command: 'npm test' } }), 'Running npm test');
});

test('stepLabel: an mcp__<server>__<tool> name reads as reading the app\'s data, with the tool name spaced out', () => {
  assert.equal(stepLabel({ name: 'mcp__orchestrator__list_runs', input: { limit: 200 } }), "Reading the app's data (list runs)");
});

// ---- duration: "45 s", "1 min 20 s", "12 min" ------------------------------------------------------

test('duration: seconds under a minute, minutes and seconds, and whole minutes from 10 on (or on an exact minute)', () => {
  assert.equal(duration(45000), '45 s');
  assert.equal(duration(80000), '1 min 20 s');
  assert.equal(duration(120000), '2 min'); // an exact minute: no trailing "0 s"
  assert.equal(duration(12 * 60000), '12 min');
  assert.equal(duration(0), '0 s');
});

// ---- view: what the activity line shows at a given time --------------------------------------------

test('view: "Starting the <agent>…", then the running step\'s own label, "Writing the answer…" once text arrives, and "Still working…" after a minute idle', () => {
  let turn = create({ agent: 'Product Owner', now: 0 });
  assert.equal(view(turn, 0).label, 'Starting the Product Owner…');

  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'tool_call', id: 'c1', name: 'Grep', input: { pattern: 'dispatchRoadmaps' } }] }, 0);
  assert.equal(view(turn, 1000).label, 'Searching the code for dispatchRoadmaps');
  assert.equal(view(turn, 1000).stale, false);
  assert.equal(view(turn, 61000).label, 'Still working: last step 1 min ago');
  assert.equal(view(turn, 61000).stale, true);

  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'text', text: 'Some prose' }] }, 61000);
  assert.equal(view(turn, 61500).label, 'Writing the answer…');
});

test('view: a finished turn\'s label names its end status; "stopping" never reads as stale', () => {
  let turn = create({ now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  turn = apply(turn, { phase: 'end', turnId: 't1', status: 'failed' }, 0);
  assert.equal(view(turn, 0).label, 'Failed');
  assert.equal(view(turn, 0).active, false);

  let stopping = create({ now: 0 });
  stopping = apply(stopping, { phase: 'start', turnId: 't1' }, 0);
  stopping.status = 'stopping';
  assert.equal(view(stopping, 999999).stale, false);
  assert.equal(view(stopping, 999999).label, 'Stopping…');
});

test('view: keeps only the last 5 steps in its list, but reports the true count', () => {
  let turn = create({ now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  const items = Array.from({ length: 7 }, (_, i) => ({ kind: 'tool_call', id: `c${i}`, name: 'Read', input: { file_path: `f${i}.js` } }));
  turn = apply(turn, { phase: 'items', turnId: 't1', items }, 0);
  const v = view(turn, 0);
  assert.equal(v.stepCount, 7);
  assert.equal(v.steps.length, 5);
  assert.equal(v.steps[0].label, 'Reading f2.js'); // the last 5 of the 7: f2..f6
});

// ---- html / onClick: the markup and its two clickable bits -----------------------------------------

test('html: the Stop button shows only while the turn is active, disabled while stopping, and omitted when stop is false', () => {
  let turn = create({ agent: 'PO', now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'tool_call', id: 'c1', name: 'Read', input: { file_path: 'a.js' } }] }, 0);

  let out = html(turn, { now: 1000 });
  assert.match(out, /data-live-stop(?!\s*disabled)/);
  assert.match(out, />1 step</);

  turn.status = 'stopping';
  out = html(turn, { now: 1000 });
  assert.match(out, /data-live-stop disabled/);

  out = html(turn, { now: 1000, stop: false });
  assert.doesNotMatch(out, /data-live-stop/);
});

test('html: no text block while nothing was written yet; one appears, rendered from the visible text, once there is some', () => {
  let turn = create({ now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  assert.doesNotMatch(html(turn, { now: 0 }), /live-turn-text/);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'text', text: 'Hello <there>' }] }, 0);
  const out = html(turn, { now: 0 });
  assert.match(out, /live-turn-text/);
  assert.match(out, /Hello &lt;there&gt;/); // escaped (no app.js markdownHtml global outside the browser)
});

test('onClick: the Stop button moves the turn to "stopping", re-renders, then calls onStop once; a second click no longer calls it', () => {
  const turn = create({ now: 0 });
  turn.status = 'working';
  let rendered = 0;
  let stopped = 0;
  const target = { closest: (sel) => (sel === '[data-live-stop]' ? {} : null) };
  const opts = { onStop: () => { stopped += 1; }, render: () => { rendered += 1; } };

  assert.equal(onClick({ target }, turn, opts), true);
  assert.equal(turn.status, 'stopping');
  assert.equal(rendered, 1);
  assert.equal(stopped, 1);

  onClick({ target }, turn, opts); // already stopping: handled, but not fired again
  assert.equal(stopped, 1);
});

test('onClick: the steps toggle flips stepsOpen and re-renders; a click elsewhere is not handled', () => {
  const turn = create({ now: 0 });
  const before = turn.stepsOpen;
  let rendered = 0;
  const stepsTarget = { closest: (sel) => (sel === '[data-live-steps]' ? {} : null) };
  assert.equal(onClick({ target: stepsTarget }, turn, { render: () => { rendered += 1; } }), true);
  assert.equal(turn.stepsOpen, !before);
  assert.equal(rendered, 1);

  const elsewhere = { closest: () => null };
  assert.equal(onClick({ target: elsewhere }, turn, {}), false);
  assert.equal(onClick({ target: elsewhere }, null, {}), false);
});

// ---- #423 the live turn in the interface language (packages/shared/i18n.js, I18n.setLanguage) -----------
// Its text comes from the catalog through t(); what it quotes (paths, patterns, commands, the agent's
// name, the answer) stays verbatim; a step's label follows the language at render time. The English
// texts are the ones above. Each test puts English back.
const I18n = require('@craftorio/shared/i18n');
const inPortuguese = () => I18n.setLanguage('pt-BR');
test.afterEach(() => I18n.setLanguage('en'));

// a turn at each status, rendered at `now`
function turnAt(status, { agent = 'Product Owner' } = {}) {
  let turn = create({ agent, now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  if (status === 'starting') { turn.status = 'starting'; return turn; }
  if (status === 'thinking') return apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'thinking' }] }, 0);
  if (status === 'writing') return apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'text', text: 'Some prose' }] }, 0);
  if (status === 'stale') return apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'tool_call', id: 'c1', name: 'Grep', input: { pattern: 'x' } }] }, 0);
  if (status === 'stopping') { turn.status = 'stopping'; return turn; }
  return apply(turn, { phase: 'end', turnId: 't1', status }, 0);
}
const ENGLISH_VIEW = [
  ['starting', 0, 'Starting the Product Owner…'],
  ['stopping', 0, 'Stopping…'],
  ['writing', 0, 'Writing the answer…'],
  ['thinking', 0, 'Thinking…'],
  ['done', 0, 'Done'],
  ['failed', 0, 'Failed'],
  ['stopped', 0, 'Stopped'],
  ['stale', 61000, 'Still working: last step 1 min ago'],
];

test('#423 view in pt-BR: every status\'s label is not the English one, and keeps the agent\'s name and the minutes', () => {
  for (const [status, now, english] of ENGLISH_VIEW) assert.equal(view(turnAt(status), now).label, english, `English ${status}`);
  inPortuguese();
  for (const [status, now, english] of ENGLISH_VIEW) {
    const label = view(turnAt(status), now).label;
    assert.ok(label, `${status}: a label`);
    assert.notEqual(label, english, `${status}: ${label}`);
    assert.equal(label.includes(english.replace(/…$/, '')), false, `${status}: ${label}`);
  }
  assert.ok(view(turnAt('starting'), 0).label.includes('Product Owner'), 'the agent\'s name stays');
  assert.match(view(turnAt('stale'), 61000).label, /\b1\b/, 'the minutes stay');
  assert.doesNotMatch(view(turnAt('stale'), 61000).label, /Still working|last step|ago/);
});

test('#423 stepLabel in pt-BR: Read, Grep and Bash keep the path, pattern and command verbatim; the fixed part is not English', () => {
  inPortuguese();
  const read = stepLabel({ name: 'Read', input: { file_path: 'C:\\project\\src\\deep\\nested\\roadmap.js' } });
  assert.ok(read.includes('deep/nested/roadmap.js'), read);
  assert.doesNotMatch(read, /Reading/);
  const grep = stepLabel({ name: 'Grep', input: { pattern: 'dispatchRoadmaps' } });
  assert.ok(grep.includes('dispatchRoadmaps'), grep);
  assert.doesNotMatch(grep, /Searching the code/);
  const bash = stepLabel({ name: 'Bash', input: { command: 'npm test -- --grep foo' } });
  assert.ok(bash.includes('npm test -- --grep foo'), bash);
  assert.doesNotMatch(bash, /Running/);
  const gh = stepLabel({ name: 'Bash', input: { command: 'gh issue view 15' } });
  assert.ok(gh.includes('#15') && gh.includes('(gh)'), gh);
  assert.doesNotMatch(gh, /Reading issue/);
  assert.doesNotMatch(stepLabel({ name: 'Bash', input: { command: 'git log --oneline' } }), /git history/);
  assert.doesNotMatch(stepLabel({ name: 'TodoWrite' }), /Updating its plan/);
  const other = stepLabel({ name: 'SomeOtherTool' });
  assert.ok(other.includes('SomeOtherTool'), other);
  assert.doesNotMatch(other, /Using/);
});

test('#423 html in pt-BR: 1 step and 15 steps are counted in Portuguese (singular and plural), never "step(s)"', () => {
  const withSteps = (n) => {
    let turn = create({ now: 0 });
    turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
    const items = Array.from({ length: n }, (_, i) => ({ kind: 'tool_call', id: `c${i}`, name: 'Read', input: { file_path: `f${i}.js` } }));
    return apply(turn, { phase: 'items', turnId: 't1', items }, 0);
  };
  assert.match(html(withSteps(15), { now: 0 }), />15 steps</);
  inPortuguese();
  const one = html(withSteps(1), { now: 0 });
  const many = html(withSteps(15), { now: 0 });
  const count = (out) => />\s*([^<]*)<\/button>/.exec(out.slice(out.indexOf('data-live-steps')))[1].trim();
  assert.match(count(one), /^1\s+\S+/, count(one));
  assert.match(count(many), /^15\s+\S+/, count(many));
  assert.doesNotMatch(count(one), /\bsteps?\b/, count(one));
  assert.doesNotMatch(count(many), /\bsteps?\b/, count(many));
  assert.notEqual(count(one).replace(/^1\s+/, ''), count(many).replace(/^15\s+/, ''), 'singular and plural differ');
});

test('#423 duration in pt-BR: the same numbers, in the units the catalog gives', () => {
  inPortuguese();
  for (const [ms, n] of [[45000, ['45']], [80000, ['1', '20']], [12 * 60000, ['12']]]) {
    const d = duration(ms);
    assert.deepEqual(d.match(/\d+/g), n, d);
  }
});

test('#423 html in pt-BR: the Stop button\'s text and title, and the timer\'s title, are not English', () => {
  let turn = create({ agent: 'PO', now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'tool_call', id: 'c1', name: 'Read', input: { file_path: 'a.js' } }] }, 0);
  const en = html(turn, { now: 1000 });
  assert.match(en, /data-live-stop[^>]*>Stop</);
  inPortuguese();
  const out = html(turn, { now: 1000 });
  const stop = /<button[^>]*data-live-stop[^>]*title="([^"]*)"[^>]*>([^<]*)</.exec(out);
  assert.ok(stop, 'the Stop button with a title');
  assert.ok(stop[2].trim(), 'a text');
  assert.notEqual(stop[2].trim(), 'Stop');
  assert.doesNotMatch(stop[1], /End this turn/);
  assert.doesNotMatch(out, /Time since the question was sent/);
});

test('#423 a step\'s label follows the language at render time: added in English, shown in Portuguese after the switch', () => {
  let turn = create({ now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'tool_call', id: 'c1', name: 'Grep', input: { pattern: 'dispatchRoadmaps' } }] }, 0);
  assert.equal(view(turn, 1000).label, 'Searching the code for dispatchRoadmaps');
  inPortuguese();
  const label = view(turn, 1000).label;
  assert.ok(label.includes('dispatchRoadmaps'), label);
  assert.doesNotMatch(label, /Searching the code/);
  assert.doesNotMatch(view(turn, 1000).steps[0].label, /Searching the code/);
  const out = html(turn, { now: 1000 });
  assert.doesNotMatch(out, /Searching the code/);
  assert.ok(out.includes('dispatchRoadmaps'));
  // and back to English
  I18n.setLanguage('en');
  assert.equal(view(turn, 1000).label, 'Searching the code for dispatchRoadmaps');
});

test('#423 html: the live turn, its label, step count and Stop carry their test ids; the label\'s full text is on hover', () => {
  let turn = create({ now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'tool_call', id: 'c1', name: 'Grep', input: { pattern: 'dispatchRoadmaps' } }] }, 0);
  const out = html(turn, { now: 1000 });
  for (const id of ['live-turn', 'live-turn-label', 'live-turn-steps', 'live-turn-stop']) assert.ok(out.includes(`data-testid="${id}"`), id);
  assert.match(out, /data-testid="live-turn-label" title="Searching the code for dispatchRoadmaps">Searching the code for dispatchRoadmaps</);
  inPortuguese();
  const pt = html(turn, { now: 1000 });
  const label = /data-testid="live-turn-label" title="([^"]*)">([^<]*)</.exec(pt);
  assert.ok(label, 'the label with a title');
  assert.equal(label[1], label[2], 'the hover text is the whole label');
  assert.doesNotMatch(label[1], /Searching the code/);
});

test('#423 the step\'s tooltip (the whole path or command) is never translated', () => {
  let turn = create({ now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'tool_call', id: 'c1', name: 'Bash', input: { command: 'npm test -- --grep foo' } }] }, 0);
  const tooltip = (out) => /<li class="live-step[^"]*" title="([^"]*)"/.exec(out)[1];
  const en = tooltip(html(turn, { now: 1000 }));
  inPortuguese();
  assert.equal(tooltip(html(turn, { now: 1000 })), en);
  assert.ok(en.includes('npm test -- --grep foo'), en);
});

test('#423 the answer is not translated: visibleText and the text block keep what the agent wrote', () => {
  inPortuguese();
  let turn = create({ now: 0 });
  turn = apply(turn, { phase: 'start', turnId: 't1' }, 0);
  turn = apply(turn, { phase: 'items', turnId: 't1', items: [{ kind: 'text', text: 'Done. Searching the code found nothing.' }] }, 0);
  assert.equal(view(turn, 0).text, 'Done. Searching the code found nothing.');
  assert.match(html(turn, { now: 0 }), /Done\. Searching the code found nothing\./);
});

test('#423 the untranslated-text check (#329, test/untranslated-text.js) scans live-turn.js and finds nothing', () => {
  const fs = require('fs');
  const path = require('path');
  const { sourceFiles, untranslated, report } = require('@craftorio/desktop/test/untranslated-text');
  const renderer = path.join(__dirname, '..');
  const file = path.join(renderer, 'live-turn.js');
  assert.ok(sourceFiles(renderer).includes(file), 'the whole-renderer check (test/i18n-every-screen-330) covers live-turn.js');
  const found = untranslated(fs.readFileSync(file, 'utf8'), 'packages/ui-kit/live-turn.js');
  assert.deepEqual(found, [], report(found));
});
