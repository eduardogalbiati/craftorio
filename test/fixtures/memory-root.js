// Test fixture (#276, test/memory-guard-276.test.js): stands for an agent CLI's root process. It
// starts test/fixtures/memory-hog.js as its child (the arguments are passed on), prints
// "child <pid>", forwards the child's output, prints "child-exit <code> <signal>" when the child
// ends and stays alive itself. It stops its child and exits by itself after 60 s.
const path = require('path');
const { spawn } = require('child_process');

const child = spawn(process.execPath, [path.join(__dirname, 'memory-hog.js'), ...process.argv.slice(2)], {
  stdio: ['ignore', 'pipe', 'inherit'],
  windowsHide: true,
});
process.stdout.write(`child ${child.pid}\n`);
child.stdout.pipe(process.stdout, { end: false });
child.on('exit', (code, signal) => process.stdout.write(`child-exit ${code} ${signal}\n`));
setInterval(() => {}, 1000);
setTimeout(() => {
  try { child.kill('SIGKILL'); } catch { /* already gone */ }
  process.exit(0);
}, 60000);
