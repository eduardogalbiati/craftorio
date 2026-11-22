// #781: the running seed's `last` names what a tool call reads: the wizard's Oracle line says it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { setupWorkspace } = require('../domains/workspace/workspace');
const seeds = require('../domains/seed/seeds');
const projects = require('../domains/project/projects');
const seedRuns = require('../service/seed-runs');

function tmp(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

async function lastOf(t, ...items) {
  const before = process.env.CRAFTORIO_SIMULATION_ONLY;
  process.env.CRAFTORIO_SIMULATION_ONLY = '0';
  t.after(() => { if (before === undefined) delete process.env.CRAFTORIO_SIMULATION_ONLY; else process.env.CRAFTORIO_SIMULATION_ONLY = before; });
  const ws = setupWorkspace(tmp(t, 'seed-781-ws-'), { persist: false });
  seeds.seedSeeds(seeds.BUNDLED_SEEDS_DIR, ws.seeds);
  const project = await projects.createProject(ws.projects, { name: 'demo', folder: tmp(t, 'seed-781-repo-') });
  let last;
  const ctx = {
    ws,
    host: { appVersion: '9.9.9', isPackaged: false },
    events: { emit: () => {} },
    notify: () => {},
    oracleService: () => ({
      budgetRefusal: () => null,
      oneTurn: async ({ onItem }) => {
        items.forEach(onItem);
        last = seedRuns.runState(ctx, project, 'ways-of-working').running.last;
        throw new Error('stop here');
      },
    }),
  };
  await seedRuns.runSeed(ctx, { project, seed: seeds.readSeed(ws.seeds, 'ways-of-working'), mock: false }).catch(() => {});
  return last;
}

test('#781 a tool call says the tool and what it reads', async (t) => {
  assert.equal(await lastOf(t, { kind: 'tool_call', name: 'Read', input: { file_path: 'Cargo.toml' } }), 'Read Cargo.toml');
});

test('#781 a tool call with no input says the tool', async (t) => {
  assert.equal(await lastOf(t, { kind: 'tool_call', name: 'TodoWrite' }), 'TodoWrite');
});

test('#781 text stays the text', async (t) => {
  assert.equal(await lastOf(t, { kind: 'text', text: 'Reading the tags' }), 'Reading the tags');
});

test('#781 a tool\'s result, the usage and the session leave the last reading', async (t) => {
  const read = { kind: 'tool_call', name: 'Read', input: { file_path: 'Cargo.toml' } };
  const rest = [{ kind: 'tool_result', output: 'x' }, { kind: 'usage', usage: {} }, { kind: 'context', tokens: 1 }, { kind: 'session', sessionId: 's' }, { kind: 'thinking', text: 'hm' }];
  assert.equal(await lastOf(t, read, ...rest), 'Read Cargo.toml');
});

test('#781 nothing read yet: no reading, not the item\'s kind', async (t) => {
  assert.equal(await lastOf(t, { kind: 'session', sessionId: 's' }), null);
});
