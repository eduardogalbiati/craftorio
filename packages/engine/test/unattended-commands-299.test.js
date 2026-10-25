// #299: Bash calls the Claude CLI never refuses. The unattended command guide every CLI agent gets
// (capabilities.commandGuide), the read-only utilities allowed next to an agent's own commands
// (READ_UTILITIES), and the long-commands skill the developer and the test writer share.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const caps = require('../engine/capabilities');

const argAfter = (args, flag) => args[args.indexOf(flag) + 1];
const LONG_COMMANDS = path.join(__dirname, '..', '..', '..', 'skills', 'long-commands', 'SKILL.md');

test('commandGuide (#299): tells every agent with commands about the CLI parser refusals (# or $ inside quotes, heredocs, inline scripts with braces)', () => {
  const guide = caps.commandGuide(caps.normalize({ tools: ['read', 'write', 'bash:npm'] }), 'C:/run');
  assert.match(guide, /quot[^\n]*#|#[^\n]*quot/i, 'a `#` (after a newline) inside a quoted argument is refused');
  assert.match(guide, /quot[^\n]*\$|\$[^\n]*quot/i, 'a `$` expansion inside a quoted argument is refused');
  assert.match(guide, /heredoc/i, 'heredocs (`cat > file <<EOF`, `node - <<EOF`) are refused');
  assert.match(guide, /brace|node -e/i, 'inline scripts with braces and quotes (`node -e "...{...}..."`) are refused');
});

test('READ_UTILITIES (#299): read-only awk joins the utilities allowed next to an agent\'s commands; sed stays out (its -i form writes)', () => {
  assert.ok(caps.READ_UTILITIES.includes('awk'), 'awk is read-only without a redirect');
  assert.ok(!caps.READ_UTILITIES.includes('sed'), 'sed -i writes files');
  const allowed = argAfter(caps.providerArgs('claude-code', { caps: caps.normalize({ tools: ['read', 'bash:git'] }) }).args, '--allowedTools');
  assert.ok(allowed.includes('Bash(awk:*)'), 'a read-only agent may pipe into awk');
  assert.ok(!allowed.includes('Bash(sed:*)'), 'no agent gets sed through the utility list');
});

test('long-commands skill (#299): one operation per Bash call, never sed -i, heredocs or inline scripts; a script goes to a file written with Write', () => {
  const text = fs.readFileSync(LONG_COMMANDS, 'utf8');
  assert.match(text, /never `cd <worktree>/, 'no cd: the current folder is the worktree');
  assert.match(text, /sed -i/, 'never sed -i');
  assert.match(text, /heredoc/i, 'never a heredoc');
  assert.match(text, /\bawk\b/, 'never an inline awk script');
  assert.match(text, /<run_dir>[\\/]scratch/, 'a script goes to a file under <run_dir>/scratch');
  assert.match(text, /`Write`/, 'written with the Write tool');
});

test('long-commands skill (#299): the file tools replace cat, sed -n, grep -n, ls and cat > file for files', () => {
  const text = fs.readFileSync(LONG_COMMANDS, 'utf8');
  for (const tool of ['Read', 'Grep', 'Glob', 'Edit', 'Write']) assert.ok(text.includes(`\`${tool}\``), `the ${tool} tool is named`);
  assert.match(text, /sed -n/, 'sed -n is replaced by Read');
  assert.match(text, /grep -n/, 'grep -n is replaced by Grep');
  assert.match(text, /rephrase[^.]*once/i, 'after a refusal, rephrase once');
});
