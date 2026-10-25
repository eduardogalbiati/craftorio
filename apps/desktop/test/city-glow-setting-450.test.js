// #450, the city's Glow in Settings: the `cityGlow` setting (packages/engine/domains/workspace/workspace.js, on by default), its
// switch in Settings › Execution, and the project city (apps/desktop/renderer/views/project/project-city.js)
// mounting the scene with it and showing the header's Glow switch unpressed when it is off.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { makeService } = require('@multiagent/engine/test/service/helpers');
const { createDom } = require('./mini-dom');
const { withI18n } = require('@multiagent/shared/test/i18n-sandbox');

const ROOT = path.join(__dirname, '..', '..', '..');
const hash = '22'.repeat(20);
const FILES = [{ path: 'src/engine/run.js', lines: 100 }, { path: 'docs/a.md', lines: 5 }];

function facts() {
  const { buildModel } = require('@multiagent/shared/architecture-model');
  return buildModel({
    head: { commit: hash, date: '2026-01-05T12:00:00Z' }, branch: 'main', shallow: false, window: { since: null, until: null },
    files: FILES.map((f) => ({ ...f })), log: `\x01${hash} 2026-01-05T12:00:00Z\n\n${FILES.map((f) => `A\t${f.path}`).join('\n')}\n`,
    ignoreRevs: [], attributes: '', exclude: [], includeMass: true, complexity: null,
  });
}

async function openCity(settings) {
  const { buildCity } = require('@multiagent/shared/city-model');
  const answer = { state: 'ok', ...buildCity({ plan: null, facts: facts() }) };
  const mounts = [];
  const noop = () => {};
  const sandbox = {
    console, setTimeout, clearTimeout, Promise,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    api: { architectureCity: async () => answer },
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
    errMsg: (e) => String(e?.message || e),
    state: { settings },
    ProjectCityScene: {
      mount(_el, opts) {
        mounts.push({ glow: opts.glow });
        return { update: noop, pin: noop, flyTo: noop, home: noop, zoom: noop, stats: () => null, unmount: noop };
      },
    },
  };
  const dom = createDom({ window: sandbox });
  Object.assign(sandbox, { window: sandbox, document: dom.document }, dom.classes);
  dom.classes.Element.prototype.getContext = () => ({ getExtension: () => null });
  withI18n(sandbox);
  vm.createContext(sandbox);
  for (const f of ['globs.js', 'json-schema.js', 'architecture-model.js', 'city-model.js', 'city-layout.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'packages', 'shared', f), 'utf8'), sandbox);
  }
  for (const f of ['project-city-notes.js', 'project-city-cards.js', 'project-city.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'renderer', 'views', 'project', f), 'utf8'), sandbox, { filename: f });
  }
  const city = sandbox.ProjectCity.create({ projectId: 'p1', name: 'fixture-app' });
  sandbox.document.body.appendChild(city.el);
  city.update({ facts: { state: 'ok', model: facts() } });
  for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  const glowButton = city.el.querySelector('[data-testid="project-city-glow"]');
  return { mounts, pressed: glowButton?.getAttribute('aria-pressed') ?? 'missing' };
}

test('#450 settings: the city\'s Glow is on by default and Settings can turn it off', (t) => {
  const { api } = makeService(t);
  assert.equal(api['settings:get']().cityGlow, true);
  api['settings:set']({ cityGlow: false });
  assert.equal(api['settings:get']().cityGlow, false);
});

test('#450 settings: Settings › Execution has the Glow switch, bound to cityGlow', () => {
  const src = fs.readFileSync(path.join(ROOT, 'apps', 'desktop', 'renderer', 'views', 'settings', 'settings-markup.js'), 'utf8');
  assert.match(src, /data-setting="cityGlow" data-testid="setting-city-glow"/);
});

test('#450 project city: Glow off in Settings mounts the scene without it, the header switch unpressed', async () => {
  const off = await openCity({ cityGlow: false });
  assert.deepEqual(off.mounts, [{ glow: false }]);
  assert.equal(off.pressed, 'false');
  const on = await openCity({});
  assert.deepEqual(on.mounts, [{ glow: true }]);
  assert.equal(on.pressed, 'true');
});
