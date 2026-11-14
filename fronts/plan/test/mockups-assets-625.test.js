// #625 Project mockups: the files and assets the change adds.
// - poc/mockup-editor.html (the phase 0 spike): an <iframe with a sandbox attribute without allow-same-origin,
//   no http:// or https:// script or fetch;
// - workflows/mockup-generate.yaml and workflows/ui-kit-map.yaml load with the engine's workflow loader and
//   have no human_approval step;
// - skills/mockup-design/SKILL.md and skills/ui-kit-extraction/SKILL.md with a `name:` front matter equal to
//   their folder;
// - scripts/screenshot/views/mockups.js (the screenshot seed);
// - docs/agents/storage.md mentions mockups/.
// Written before the files exist: each test reads its file itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { root } = require('@multiagent/engine/test/engine-helpers');

const read = (rel) => fs.readFileSync(path.join(root, ...rel.split('/')), 'utf8').replace(/\r\n/g, '\n');
const loadWorkflow = (file) => require('@multiagent/engine/engine/workflow').loadWorkflow(path.join(root, 'workflows', file));
const frontMatterName = (md) => {
  const m = /^---\n([\s\S]*?)\n---/.exec(md);
  return m ? (/^name:\s*["']?([^"'\n]+?)["']?\s*$/m.exec(m[1]) || [])[1] ?? null : null;
};

// ---- the phase 0 spike -------------------------------------------------------------------------

test('#625 poc/mockup-editor.html has an iframe whose sandbox does not allow same-origin', () => {
  const html = read('poc/mockup-editor.html');
  const iframes = [...html.matchAll(/<iframe\b[^>]*>/gi)].map((m) => m[0]);
  assert.equal(iframes.length >= 1, true, 'no iframe');
  assert.deepEqual(iframes.map((tag) => [/\bsandbox\s*=/.test(tag), /allow-same-origin/.test(tag)]), iframes.map(() => [true, false]), iframes.join('\n'));
});

test('#625 poc/mockup-editor.html loads no http(s) script and fetches nothing over the network', () => {
  const html = read('poc/mockup-editor.html');
  assert.deepEqual([/<script\b[^>]*\bsrc\s*=\s*["']https?:\/\//i.test(html), /fetch\(\s*["'`]https?:\/\//i.test(html)], [false, false]);
});

// ---- workflows ---------------------------------------------------------------------------------

test('#625 workflows/mockup-generate.yaml loads and has no human_approval step', () => {
  const wf = loadWorkflow('mockup-generate.yaml');
  assert.equal(Array.isArray(wf.steps) && wf.steps.length > 0, true, 'no steps');
  assert.equal(JSON.stringify(wf.steps).includes('"human_approval"'), false);
});

test('#625 workflows/ui-kit-map.yaml loads and has no human_approval step', () => {
  const wf = loadWorkflow('ui-kit-map.yaml');
  assert.equal(Array.isArray(wf.steps) && wf.steps.length > 0, true, 'no steps');
  assert.equal(JSON.stringify(wf.steps).includes('"human_approval"'), false);
});

// ---- skills ------------------------------------------------------------------------------------

test('#625 skills/mockup-design/SKILL.md is named mockup-design in its front matter', () => {
  assert.equal(frontMatterName(read('skills/mockup-design/SKILL.md')), 'mockup-design');
});

test('#625 skills/ui-kit-extraction/SKILL.md is named ui-kit-extraction in its front matter', () => {
  assert.equal(frontMatterName(read('skills/ui-kit-extraction/SKILL.md')), 'ui-kit-extraction');
});

// ---- screenshot seed, storage doc --------------------------------------------------------------

test('#625 the screenshot seed scripts/screenshot/views/mockups.js exists', () => {
  assert.equal(fs.existsSync(path.join(root, 'scripts', 'screenshot', 'views', 'mockups.js')), true);
});

test('#625 docs/agents/storage.md documents the mockups/ folder', () => {
  assert.equal(read('docs/agents/storage.md').includes('mockups/'), true);
});
