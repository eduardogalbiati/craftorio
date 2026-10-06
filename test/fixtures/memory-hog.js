// Test fixture (#276, test/memory-guard-276.test.js): a process that allocates memory without
// bound, 50 MB every 100 ms with every page touched (filled with 1, so RSS grows on Linux too),
// up to `--cap-mb` (default 1024), then holds it. Prints "allocated <MB>" after each block.
// `--marker <text>` only tags its command line. It exits by itself after 60 s, so a failed test
// never leaves it behind for long.
const arg = (name, def) => {
  const i = process.argv.indexOf(name);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
};
const capMb = Number(arg('--cap-mb', 1024)) || 1024;
const keep = [];
let mb = 0;
const timer = setInterval(() => {
  if (mb >= capMb) { clearInterval(timer); return; }
  keep.push(Buffer.alloc(50 * 1024 * 1024, 1));
  mb += 50;
  process.stdout.write(`allocated ${mb}\n`);
}, 100);
setInterval(() => {}, 1000);
setTimeout(() => process.exit(0), 60000);
