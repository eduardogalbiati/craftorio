// #387: the UI review catches screens a human cannot read. Acceptance tests written before the code:
// the readability checklist and the design section of ui-conventions (developer-only plan part
// through role_sections), the developer of ai-development-local-hero building with design-system,
// the ui_reviewer's per-screen lines (no rubber-stamp approval), the deterministic checks that run
// before the model (axe-core violations, native controls), the large-project screenshot fixture,
// the issue-writing criteria about hierarchy and the Apache 2.0 credit for frontend-design.
// Modules the change creates are required inside each test, so the file loads before they exist.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadWorkflow, render, validateSchema } = require('@multiagent/engine/engine/workflow');
const { resolveSkill, skillPrompt } = require('@multiagent/engine/domains/agents/skills');

const ROOT = path.join(__dirname, '..', '..', '..');
const WORKFLOW = path.join(ROOT, 'workflows', 'feature.yaml');
const skill = (id) => resolveSkill([path.join(ROOT, 'skills')], id);
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const codeReview = () => loadWorkflow(WORKFLOW).steps.find((s) => s.id === 'code_review');
// the effective output schema of one agent of a fan-out step (the ui_reviewer's differs from the reviewer's)
const schemaFor = (step, agent) => require('@multiagent/engine/engine/workflow').stepOutputSchema(step, agent);
const checks = () => require('@multiagent/engine/domains/evidence/ui-review-checks');

const CHECKLIST = [
  /5-second/i,
  /text budget/i,
  /numbers as visuals/i,
  /one primary action/i,
  /native controls/i,
  /24\s*[×x]\s*24/i,
  /full screen/i,
  /empty, loading and error/i,
  /cut|overlap/i,
];
const DESIGN_ITEMS = [/\bcopy\b/i, /motion/i, /prefers-reduced-motion/, /decoration/i, /--focus-ring/, /minimum size/i];

const screen = (over = {}) => ({
  screenshot: 'facts-large.modified.png',
  message: 'Which modules break the architecture rules, worst first',
  weakness: 'The caveats paragraph pushes the score below the fold',
  checklist: [
    { item: '5-second test', pass: true, evidence: 'The score bar leads the screen' },
    { item: 'Native controls themed', pass: false, evidence: 'The period select opens white' },
  ],
  ...over,
});
const uiOutput = (over = {}) => ({ verdict: 'approved', findings: [], ui_findings: [], screens: [screen()], ...over });

test('#387 ui-conventions: the reviewer gets the fixed checklist and the design items, without the developer-only plan', () => {
  const text = skillPrompt(skill('ui-conventions'), 'ui_reviewer');
  for (const re of [...CHECKLIST, ...DESIGN_ITEMS]) assert.match(text, re, `missing ${re}`);
  assert.doesNotMatch(text, /plan before the markup/i);
});

test('#387 ui-conventions: the developer gets the design section with its plan before the markup', () => {
  const text = skillPrompt(skill('ui-conventions'), 'developer');
  assert.match(text, /plan before the markup/i);
  assert.match(text, /decision log/i);
  assert.match(text, /wireframe/i);
  for (const re of DESIGN_ITEMS) assert.match(text, re, `missing ${re}`);
  assert.match(text, /frontend-design/);
});

test('#387 ai-development-local-hero: the developer builds with ui-conventions and design-system', () => {
  const skills = loadWorkflow(WORKFLOW).agents.developer.skills;
  assert.equal(skills.includes('ui-conventions'), true);
  assert.equal(skills.includes('design-system'), true);
});

test('#387 design-system: names both readers, the developer and the UI reviewer', () => {
  const { meta } = skill('design-system');
  assert.match(String(meta.used_by), /developer/);
  assert.match(String(meta.used_by), /ui_reviewer/);
  assert.match(String(meta.description), /develop|build/i);
  assert.match(skillPrompt(skill('design-system'), 'developer'), /raw value/i);
});

test('#387 code_review: the ui_reviewer prompt repeats the checklist per screenshot and asks for the message and the biggest weakness', () => {
  const step = codeReview();
  const prompt = render(step.prompt, {
    agent: 'ui_reviewer',
    run_dir: 'C:/runs/r1',
    inputs: { task: 'Facts view', base_branch: 'main', issues: [] },
    vars: {},
    steps: {
      develop: { output: { branch: 'b', summary: 's', files_changed: ['apps/desktop/renderer/x.js'] } },
      developer_screenshots: { output: { message: '1 screen', dir: 'evidence/shots', screenshots: [{ path: 'facts.modified.png' }] } },
    },
  });
  for (const re of CHECKLIST.slice(0, 2)) assert.match(prompt, re, `missing ${re}`);
  assert.match(prompt, /pass or fail/i);
  assert.match(prompt, /weakness/i);
  assert.match(prompt, /small data|production-like|real-scale/i);
});

test('#387 code_review: the axe violations reach the ui_reviewer as findings it dismisses only with a written reason', () => {
  const step = codeReview();
  const axe = checks().axeFindings(
    { violations: [{ id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', nodes: [{ target: ['.facts-caveat'], failureSummary: 'contrast 2.1:1' }] }] },
    { screen: 'facts.modified.png', changed: true },
  );
  const prompt = render(step.prompt, {
    agent: 'ui_reviewer',
    run_dir: 'C:/runs/r1',
    inputs: { task: 'Facts view', base_branch: 'main', issues: [] },
    vars: {},
    steps: {
      develop: { output: { branch: 'b', summary: 's', files_changed: ['apps/desktop/renderer/x.js'] } },
      developer_screenshots: { output: { message: '1 screen', dir: 'evidence/shots', screenshots: [{ path: 'facts.modified.png' }], axe_findings: axe } },
    },
  });
  assert.match(prompt, /color-contrast/);
  assert.match(prompt, /\.facts-caveat/);
  assert.match(prompt, /reason/i);
});

test('#387 output schema: the ui_reviewer cannot approve with 0 findings without the per-screen lines', () => {
  const ui = schemaFor(codeReview(), 'ui_reviewer');
  const { screens, ...bare } = uiOutput();
  assert.notDeepEqual(validateSchema(bare, ui), [], 'no screens');
  assert.notDeepEqual(validateSchema(uiOutput({ screens: [] }), ui), [], 'an empty screens list');
  const { message, ...noMessage } = screen();
  assert.notDeepEqual(validateSchema(uiOutput({ screens: [noMessage] }), ui), [], 'no 5-second message');
  const { weakness, ...noWeakness } = screen();
  assert.notDeepEqual(validateSchema(uiOutput({ screens: [noWeakness] }), ui), [], 'no biggest weakness');
  const noEvidence = screen({ checklist: [{ item: '5-second test', pass: true }] });
  assert.notDeepEqual(validateSchema(uiOutput({ screens: [noEvidence] }), ui), [], 'a checklist item without evidence');
});

test('#387 output schema: an approval with the per-screen lines passes, and the code reviewer needs none', () => {
  const step = codeReview();
  assert.deepEqual(validateSchema(uiOutput(), schemaFor(step, 'ui_reviewer')), []);
  assert.deepEqual(validateSchema({ verdict: 'approved', findings: [] }, schemaFor(step, 'reviewer')), []);
});

test('#387 axe: a low-contrast text on a changed screen is a color-contrast finding in the ui_findings shape', () => {
  const found = checks().axeFindings(
    { violations: [{ id: 'color-contrast', impact: 'serious', help: 'Elements must meet minimum color contrast ratio thresholds', nodes: [{ target: ['.facts-caveat'], failureSummary: 'contrast 2.1:1' }] }] },
    { screen: 'facts.modified.png', changed: true },
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'color-contrast');
  assert.equal(found[0].baseline, false);
  assert.match(found[0].element, /\.facts-caveat/);
  assert.equal(found[0].screenshot, 'facts.modified.png');
  const items = codeReview().output_schema.properties.ui_findings.items;
  assert.deepEqual(validateSchema(found[0], items), []);
});

test('#387 axe: a violation on an unchanged screen is a baseline (ratchet), not a blocking finding', () => {
  const found = checks().axeFindings(
    { violations: [{ id: 'target-size', impact: 'serious', help: 'All touch targets must be 24px large', nodes: [{ target: ['#old-button'] }] }] },
    { screen: 'home.modified.png', changed: false },
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].rule, 'target-size');
  assert.equal(found[0].baseline, true);
  assert.equal(found[0].blocking, false);
  assert.deepEqual(checks().axeFindings({ violations: [] }, { screen: 'home.modified.png', changed: true }), []);
});

test('#387 native controls: a bare select, date or datetime field in a changed screen is a finding', () => {
  const { nativeControlFindings } = checks();
  const html = '<div class="toolbar"><select id="period"><option>7 days</option></select>'
    + '<input type="date" id="from"><input type="datetime-local" id="at"></div>';
  const found = nativeControlFindings(html);
  assert.equal(found.length, 3);
  for (const f of found) assert.match(f.convention, /ui-conventions/);
  const items = codeReview().output_schema.properties.ui_findings.items;
  for (const f of found) assert.deepEqual(validateSchema(f, items), []);
  assert.deepEqual(nativeControlFindings('<div class="select" role="combobox" tabindex="0">7 days</div><input type="text">'), []);
});

// #670: an issue's mockups are the specification of its screens. The ui_reviewer compares each
// screenshot with its mockup; mockupFindings(comparison, { screen, mockup }) turns that comparison
// ({ differences: [{ element, problem }] }) into ui_findings: each difference one blocking finding
// (rule and source 'mockup', convention naming the mockup). No mockup: no finding (reviewed as today).
test('#670 mockup: a screenshot missing an element of its mockup is a blocking finding in the ui_findings shape', () => {
  const { mockupFindings } = checks();
  const found = mockupFindings(
    { differences: [{ element: 'Export button', problem: 'the mockup has an Export button in the toolbar; the screenshot has none' }] },
    { screen: 'facts.modified.png', mockup: 'mock-1.jpg' },
  );
  assert.equal(found.length, 1);
  assert.equal(found[0].blocking, true);
  assert.equal(found[0].element, 'Export button');
  assert.equal(found[0].screenshot, 'facts.modified.png');
  assert.equal(found[0].rule, 'mockup');
  assert.equal(found[0].source, 'mockup');
  assert.equal(found[0].baseline, false);
  assert.match(found[0].convention, /mock-1\.jpg/);
  const items = codeReview().output_schema.properties.ui_findings.items;
  assert.deepEqual(validateSchema(found[0], items), []);
});

test('#670 mockup: every difference from the mockup is its own blocking finding', () => {
  const found = checks().mockupFindings(
    { differences: [{ element: 'Title', problem: 'the text differs' }, { element: 'Search icon', problem: 'missing' }] },
    { screen: 'home.modified.png', mockup: 'mock-2.png' },
  );
  assert.deepEqual(found.map((f) => [f.element, f.blocking]), [['Title', true], ['Search icon', true]]);
});

test('#670 mockup: an issue without mockups has no mockup finding, and its screen checks are as today', () => {
  const { mockupFindings, screenChecks } = checks();
  assert.deepEqual(mockupFindings({ differences: [{ element: 'Title', problem: 'differs' }] }, { screen: 'home.modified.png', mockup: null }), []);
  assert.deepEqual(mockupFindings(null, { screen: 'home.modified.png' }), []);
  const html = '<select id="period"><option>7 days</option></select>';
  assert.deepEqual(screenChecks({ modified: { html }, screen: 'home.modified.png' }).map((f) => f.rule), ['native-control']);
});

test('#387 screenshots: a shared large-project fixture gives production-like volume', () => {
  const { largeProjectFixture } = require('../../../scripts/screenshot/helpers');
  const data = largeProjectFixture();
  assert.equal(data.files.length >= 1000, true, `files: ${data.files.length}`);
  assert.equal(data.findings.length >= 50, true, `findings: ${data.findings.length}`);
  assert.equal(data.runs.length >= 300, true, `runs: ${data.runs.length}`);
  assert.equal(JSON.stringify(largeProjectFixture()) === JSON.stringify(data), true, 'deterministic');
});

test('#387 axe-core runs in the screenshot pass: @axe-core/playwright is a dev dependency', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(typeof (pkg.devDependencies || {})['@axe-core/playwright'], 'string');
});

test('#387 issue-writing and Product Owner skills ask what leads a screen, its text budget and what goes behind "more"', () => {
  for (const id of ['issue-writing', 'backlog-product-owner']) {
    const text = skill(id).body;
    assert.match(text, /what leads/i, id);
    assert.match(text, /text budget/i, id);
    assert.match(text, /behind ["“]?more/i, id);
  }
});

test('#387 THIRD_PARTY_NOTICES credits frontend-design under Apache 2.0', () => {
  const text = read('THIRD_PARTY_NOTICES.md');
  assert.match(text, /## Adapted sources \(Apache 2\.0\)/);
  assert.match(text, /anthropics\/skills/);
  assert.match(text, /frontend-design/);
  assert.match(text, /Apache License,? (Version )?2\.0|Apache 2\.0/);
  assert.match(text, /ui-conventions/);
  assert.doesNotMatch(text.split('\n## ')[0], /adapted from other MIT-licensed projects/);
});

test('#387 docs: renderer.md and agents-and-steps.md describe the design section, the axe step and the developer skills', () => {
  const renderer = fs.readdirSync(path.join(ROOT, 'docs', 'agents', 'renderer')).map((f) => read(`docs/agents/renderer/${f}`)).join('\n');
  assert.match(renderer, /axe/i);
  assert.match(renderer, /design section|plan before the markup/i);
  assert.match(read('docs/agents/engine/agents-and-steps.md'), /design-system/);
});
