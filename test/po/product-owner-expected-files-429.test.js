// #429: issues carry a `## Expected files` section (one repo-relative path per line, a file to create
// marked `(new)`), the city's impact preview reads first (CityImpact.expectedSection):
//   - the Product Owner's simulated 'draft' answer (mockScenario, src/domains/po/product-owner.js) has the section;
//   - the Product Owner's issue rules put the estimated files there, not in the Triage section;
//   - the issue-writing skill documents the section and the `(new)` marker.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const productOwner = require('../../src/domains/po/product-owner');
const CityImpact = require('@multiagent/shared/city-impact');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

test('#429 the simulated draft has an Expected files section that CityImpact.expectedSection parses', () => {
  const out = productOwner.mockScenario('draft', { data: { issues: [] }, question: 'The city should read the expected files' });
  const body = String(out.draft.body);
  assert.equal(body.includes('## Expected files'), true, 'the draft body has the section');
  assert.equal(typeof CityImpact.expectedSection, 'function', 'CityImpact.expectedSection exists');
  const paths = CityImpact.expectedSection(body);
  assert.equal(Array.isArray(paths), true);
  assert.equal(paths.length > 0, true, 'the section lists at least one path');
  assert.equal(paths.every((p) => typeof p === 'string' && p.length > 0), true);
});

test('#429 the Product Owner\'s issue rules put the estimated files in ## Expected files, not in Triage', () => {
  const src = read('src', 'domains', 'po', 'product-owner.js');
  assert.equal(src.includes('## Expected files'), true);
  assert.equal(src.includes('the estimated files (marked as an estimate)'), false);
});

test('#429 the issue-writing skill documents the Expected files section and the (new) marker', () => {
  const skill = read('skills', 'issue-writing', 'SKILL.md');
  assert.equal(skill.includes('## Expected files'), true);
  assert.equal(skill.includes('(new)'), true);
});
