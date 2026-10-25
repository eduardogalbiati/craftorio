// #481 (SEC-27), src/host/external-terminal.js on Windows: the window title comes from session names, and
// cmd.exe parses `start "<title>" ...` itself, so `"`, `&`, `|`, `<`, `>` and `^` in it could end the
// quoted title and run another command. The title part of the cmd.exe line must hold none of them
// (dropped or replaced); the rest of the title text is kept.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = () => require('../../src/host/external-terminal');
const HOSTILE = 'Live terminal: x" & calc.exe | more < in > out ^ end';

// the text between `start "` and `" /D ` of the cmd.exe /c line
function titlePart(launch) {
  const line = launch.args[launch.args.length - 1];
  const m = /^start "(.*)" \/D "/.exec(line);
  assert.ok(m, `unexpected line: ${line}`);
  return m[1];
}

test('#481 terminalLaunch (Windows): a title with " & | < > ^ yields a start title with none of them', () => {
  const launch = load().terminalLaunch({ platform: 'win32', env: {}, exists: () => true, title: HOSTILE, cwd: 'C:\\repo', file: 'claude', args: ['--resume', 'abc'] });
  const title = titlePart(launch);
  for (const ch of ['"', '&', '|', '<', '>', '^']) assert.equal(title.includes(ch), false, `title contains ${ch}: ${title}`);
  assert.equal(title.includes('calc.exe'), true, 'the rest of the title text is kept');
});

test('#481 terminalLaunch (Windows): a title with %VAR% expands nothing (no % in the start title)', () => {
  const launch = load().terminalLaunch({ platform: 'win32', env: {}, exists: () => true, title: 'Live terminal: %PATH% here', cwd: 'C:\\repo', file: 'claude', args: [] });
  const title = titlePart(launch);
  assert.equal(title.includes('%'), false, `title contains %: ${title}`);
  assert.equal(title.includes('PATH'), true);
});

test('#481 terminalLaunch (Windows): a plain title is unchanged', () => {
  const launch = load().terminalLaunch({ platform: 'win32', env: {}, exists: () => true, title: 'Live terminal: dev', cwd: 'C:\\repo', file: 'claude', args: [] });
  assert.equal(titlePart(launch), 'Live terminal: dev');
});
