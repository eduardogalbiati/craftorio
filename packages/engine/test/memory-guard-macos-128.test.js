// #128 the memory guard on macOS (packages/engine/engine/memory-guard.js realProbe): os.freemem() there
// counts only the fully free pages (near 0 on a Mac in use), so every real run was held for "low memory".
// The free memory must be what is usable now: free + inactive + speculative (+ purgeable) pages of
// `vm_stat`, the page size read from its header ("page size of 16384 bytes").
//
// Seams (assumptions of these tests written before the code):
//   - memory-guard.js exports `parseVmStat(text)` -> the usable bytes (a number) read from vm_stat's
//     output: (free + inactive + speculative [+ purgeable]) * the header's page size. Active, wired,
//     compressed and file-backed pages are not counted;
//   - the macOS probe runs `vm_stat` by name (resolved through PATH; through the long-lived `sh` helper
//     or a child process, either way): the last test fakes process.platform as 'darwin' and puts a fake
//     `vm_stat` first in PATH, the command's output being the system boundary. It needs /bin/sh, so it
//     is skipped on Windows.
// The module is required inside each test, so this file loads before the code exists.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MODULE = '../engine/memory-guard';
const load = () => require(MODULE);
const GIB = 1024 ** 3;

// a Mac with 16 GB in use: almost no fully free page, most of the usable memory inactive
const VM_STAT = (pageSize = 16384) => [
  `Mach Virtual Memory Statistics: (page size of ${pageSize} bytes)`,
  'Pages free:                                4274.',
  'Pages active:                            370000.',
  'Pages inactive:                          198411.',
  'Pages speculative:                          280.',
  'Pages throttled:                              0.',
  'Pages wired down:                        150000.',
  'Pages purgeable:                           1593.',
  '"Translation faults":                 123456789.',
  'Pages copy-on-write:                    5550000.',
  'Pages zero filled:                     98765432.',
  'Pages reactivated:                      1234567.',
  'Pages purged:                            654321.',
  'File-backed pages:                       160000.',
  'Anonymous pages:                         400000.',
  'Pages stored in compressor:              300000.',
  'Pages occupied by compressor:            100000.',
  'Decompressions:                         2000000.',
  'Compressions:                           3000000.',
  'Pageins:                                4000000.',
  'Pageouts:                                 50000.',
  'Swapins:                                      0.',
  'Swapouts:                                     0.',
  '',
].join('\n');

// free + inactive + speculative pages, with or without the purgeable ones
const usable = (pageSize) => [(4274 + 198411 + 280) * pageSize, (4274 + 198411 + 280 + 1593) * pageSize];

test('#128 parseVmStat: free + inactive + speculative (+ purgeable) pages at the header\'s 16 KB page size, about 3.3 GB', () => {
  const { parseVmStat } = load();
  const bytes = parseVmStat(VM_STAT(16384));
  assert.equal(usable(16384).includes(bytes), true, `got ${bytes}, expected 3325378560 (or 3351478272 with the purgeable pages)`);
});

test('#128 parseVmStat: the page size comes from the header (4096 bytes on an Intel Mac)', () => {
  const { parseVmStat } = load();
  const bytes = parseVmStat(VM_STAT(4096));
  assert.equal(usable(4096).includes(bytes), true, `got ${bytes}, expected 831344640 (or 837869568 with the purgeable pages)`);
});

test('#128 a 16 GB Mac with that vm_stat is not held under a 10% floor (1.6 GB): no wait, no low-memory reason', async (t) => {
  const { parseVmStat, createMemoryGuard, memoryProblem } = load();
  const total = 16 * GIB;
  const floorBytes = Math.round(total * 0.10);
  const guard = createMemoryGuard({
    limitBytes: total, floorBytes, intervalMs: 60000,
    sampler: async () => [], freeMemory: async () => ({ freeBytes: parseVmStat(VM_STAT(16384)), totalBytes: total }),
  });
  t.after(() => guard.close());
  let waited = 0;
  const r = await guard.waitForMemory({ maxWaitMs: 1000, onWait: () => { waited++; } });
  assert.deepEqual([r.recovered, r.waitedMs, waited], [true, 0, 0]);
  assert.equal(memoryProblem({ freeBytes: parseVmStat(VM_STAT(16384)), floorBytes }), '');
});

test('#128 parseVmStat gives null for output it cannot read (no header, a missing field, empty)', () => {
  const { parseVmStat } = load();
  const noHeader = VM_STAT(16384).split('\n').slice(1).join('\n');
  const noInactive = VM_STAT(16384).split('\n').filter((l) => !l.startsWith('Pages inactive')).join('\n');
  assert.deepEqual([noHeader, noInactive, '', 'vm_stat: command not found'].map((s) => parseVmStat(s)), [null, null, null, null]);
});

// a fake `vm_stat` (script body after the shebang) first in PATH, process.platform faked as darwin, and a
// fresh memory-guard module; returns the module
function fakeMac(t, body) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'vmstat-128-'));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bin, 'vm_stat'), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
  t.after(() => {
    Object.defineProperty(process, 'platform', platform);
    process.env.PATH = oldPath;
  });
  delete require.cache[require.resolve(MODULE)];
  const mod = load();
  delete require.cache[require.resolve(MODULE)];
  return mod;
}

test('#128 on macOS a vm_stat that fails or prints nothing readable falls back to os.freemem(), never an error', { skip: process.platform === 'win32' ? 'needs /bin/sh' : false }, async (t) => {
  const { createMemoryGuard } = fakeMac(t, 'echo "vm_stat: something went wrong" >&2\nexit 1');
  const guard = createMemoryGuard({ intervalMs: 60000 });
  t.after(() => guard.close());
  const m = await guard.freeMemory();
  const freeBytes = m?.freeBytes ?? null;
  assert.equal(Number.isFinite(freeBytes) && freeBytes > 0, true, `freeBytes ${freeBytes}`);
  assert.equal(usable(16384).includes(freeBytes), false);
});

test('#128 on macOS the free memory is read again at each ask (one long-lived helper, two answers)', { skip: process.platform === 'win32' ? 'needs /bin/sh' : false }, async (t) => {
  const vmStat = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vmstat-txt-128-')), 'vm_stat.txt');
  t.after(() => fs.rmSync(path.dirname(vmStat), { recursive: true, force: true }));
  fs.writeFileSync(vmStat, VM_STAT(16384));
  const { createMemoryGuard } = fakeMac(t, `cat '${vmStat}'`);
  const guard = createMemoryGuard({ intervalMs: 60000 });
  t.after(() => guard.close());
  const first = (await guard.freeMemory())?.freeBytes ?? null;
  fs.writeFileSync(vmStat, VM_STAT(4096));
  const second = (await guard.freeMemory())?.freeBytes ?? null;
  assert.deepEqual([usable(16384).includes(first), usable(4096).includes(second)], [true, true]);
});

test('#128 on macOS the guard\'s free memory is read from vm_stat, not os.freemem()', { skip: process.platform === 'win32' ? 'needs /bin/sh' : false }, async (t) => {
  // a fake vm_stat first in PATH (the command's output is the system boundary)
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'vmstat-128-'));
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  fs.writeFileSync(path.join(bin, 'vm_stat.txt'), VM_STAT(16384));
  fs.writeFileSync(path.join(bin, 'vm_stat'), `#!/bin/sh\ncat '${path.join(bin, 'vm_stat.txt')}'\n`, { mode: 0o755 });
  const oldPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${oldPath}`;
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' });
  t.after(() => {
    Object.defineProperty(process, 'platform', platform);
    process.env.PATH = oldPath;
  });
  // a fresh module: nothing decided about the platform before it was faked
  delete require.cache[require.resolve(MODULE)];
  const { createMemoryGuard } = load();
  delete require.cache[require.resolve(MODULE)];
  const guard = createMemoryGuard({ intervalMs: 60000 });
  t.after(() => guard.close());
  const m = await guard.freeMemory();
  const freeBytes = m?.freeBytes ?? null;
  assert.equal(usable(16384).includes(freeBytes), true, `got ${freeBytes} (os.freemem() is ${os.freemem()}), expected vm_stat's 3325378560 (or 3351478272)`);
});
