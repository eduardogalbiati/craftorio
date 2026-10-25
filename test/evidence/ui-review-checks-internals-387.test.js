// #387 internals: the baselines of screenChecks (a finding the original side has too), the checks
// file beside a capture, the screenshots step's axe_findings, stepOutputSchema and minItems.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checksPath, readChecks, screenChecks } = require('../../src/domains/evidence/ui-review-checks');
const { stepOutputSchema } = require('../../src/engine/run/outputs');
const { validateSchema } = require('../../src/json-schema');
const { captureScreenshots } = require('../../src/engine/screenshot-step');

const contrast = (target) => ({ id: 'color-contrast', impact: 'serious', help: 'Contrast', nodes: [{ target: [target] }] });

test('#387 screenChecks: a finding the original side has too is a baseline, a new one blocks', () => {
  const found = screenChecks({
    modified: { axe: { violations: [contrast('.old'), contrast('.new')] }, html: '<select id="period"></select>' },
    original: { axe: { violations: [contrast('.old')] }, html: '<select id="period"></select>' },
    screen: 'x.modified.png',
  });
  const by = Object.fromEntries(found.map((f) => [f.element, f]));
  assert.equal(by['.old'].baseline, true);
  assert.equal(by['.old'].blocking, false);
  assert.equal(by['.new'].baseline, false);
  assert.equal(by['.new'].blocking, true);
  assert.equal(by['select#period'].baseline, true);
  assert.equal(found.every((f) => f.screenshot === 'x.modified.png'), true);
});

test('#387 screenChecks: without an original side every finding is the change\'s', () => {
  const found = screenChecks({ modified: { axe: { violations: [contrast('.a')] } }, screen: 's.png' });
  assert.equal(found.length, 1);
  assert.equal(found[0].baseline, false);
});

test('#387 readChecks: the file beside the PNG; missing or failed checks are null', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'checks-387-'));
  const png = path.join(dir, 'a.modified.png');
  assert.equal(checksPath(png), path.join(dir, 'a.modified.checks.json'));
  assert.equal(readChecks(png), null);
  fs.writeFileSync(checksPath(png), JSON.stringify({ error: 'the checks did not run' }));
  assert.equal(readChecks(png), null);
  fs.writeFileSync(checksPath(png), JSON.stringify({ axe: { violations: [] }, html: '' }));
  assert.deepEqual(readChecks(png), { axe: { violations: [] }, html: '' });
});

test('#387 captureScreenshots: the checks of each modified side reach axe_findings', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'shots-387-'));
  const cwd = path.join(root, 'wt');
  fs.mkdirSync(cwd);
  fs.writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ scripts: { screenshot: 'electron scripts/screenshot.js' } }));
  const run = async ({ args }) => {
    const out = args[args.indexOf('--out') + 1];
    const name = args[args.indexOf('--name') + 1];
    const side = args[args.indexOf('--side') + 1];
    const png = path.join(out, `${name}.${side}.png`);
    fs.writeFileSync(png, 'png');
    const violations = side === 'modified' ? [contrast('.old'), contrast('.new')] : [contrast('.old')];
    fs.writeFileSync(checksPath(png), JSON.stringify({ axe: { violations }, html: '' }));
    return { code: 0, output: '' };
  };
  const slot = async () => ({ token: 't', release() {} });
  const out = await captureScreenshots({ entries: [{ name: '387-facts-default', caption: 'c', args: ['--view', 'project'] }], cwd, runDir: root, folder: 'developer', round: 1, base: 'main', env: {}, run, slot });
  assert.equal(out.taken, 2);
  assert.deepEqual(out.axe_findings.map((f) => [f.element, f.baseline]), [['.new', false], ['.old', true]]);
  assert.equal(out.axe_findings[0].screenshot, '387-facts-default.modified.png');
});

test('#387 screenChecks: a rule\'s nodes are split, the original side\'s ones a baseline', () => {
  const two = { id: 'color-contrast', impact: 'serious', help: 'Contrast', nodes: [{ target: ['.old'] }, { target: ['.new'] }] };
  const found = screenChecks({ modified: { axe: { violations: [two] } }, original: { axe: { violations: [contrast('.old')] } }, screen: 's.png' });
  assert.deepEqual(found.map((f) => [f.element, f.baseline, f.blocking]), [['.new', false, true], ['.old', true, false]]);
});

test('#387 nativeControlFindings: a data-type attribute is not a date field', () => {
  const { nativeControlFindings } = require('../../src/domains/evidence/ui-review-checks');
  assert.deepEqual(nativeControlFindings('<input data-type="date" type="text">'), []);
  assert.equal(nativeControlFindings('<input data-testid="from" type=date>')[0].element, 'input[type=date][data-testid=from]');
});

test('#387 stepOutputSchema: the step\'s schema without an extension, merged with one', () => {
  const step = { output_schema: { type: 'object', required: ['a'], properties: { a: { type: 'string' } } }, agent_output_schema: { ui: { required: ['b'], properties: { b: { type: 'array', minItems: 1 } } } } };
  assert.equal(stepOutputSchema(step, 'other'), step.output_schema);
  assert.equal(stepOutputSchema(step), step.output_schema);
  const ui = stepOutputSchema(step, 'ui');
  assert.deepEqual(ui.required, ['a', 'b']);
  assert.deepEqual(Object.keys(ui.properties), ['a', 'b']);
  assert.deepEqual(validateSchema({ a: 'x', b: [] }, ui), ['output.b: at least 1 item']);
  assert.deepEqual(validateSchema({ a: 'x', b: [1] }, ui), []);
  assert.equal(stepOutputSchema({}, 'ui'), undefined);
});
