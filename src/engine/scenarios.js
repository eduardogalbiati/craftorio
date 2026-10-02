// End-to-end BDD scenarios (#143): a step output's `scenarios` ([{ feature, name, steps, status,
// reason, screenshots }], the test writer's, skills e2e-test-writer-<language>) and `e2e_note`.
// `normalizeScenarios` keeps the valid entries (status passed / failed / skipped, steps as
// "Given …" lines, screenshot paths relative to the run folder), `scenarioCounts` counts them,
// `featureText` writes them back as Gherkin (one Feature per feature file, the status and reason
// as comments), `scenariosMessage` gives a gate message's lines (filter `e2e_scenarios`) and
// `recordScenarios` saves <run_dir>/e2e/scenarios.feature + scenarios.json after
// the step (WorkflowRun.finishStep), the run folder's copy the Dev/QA reads at the gates.

const fs = require('fs');
const path = require('path');

const STATUSES = ['passed', 'failed', 'skipped'];
const KEYWORDS = /^(Given|When|Then|And|But|\*)\b/i;

// A screenshot path as the run folder knows it: relative, forward slashes
function runPath(runDir, p) {
  const s = String(p || '').trim();
  if (!s) return '';
  const rel = runDir && path.isAbsolute(s) ? path.relative(runDir, s) : s;
  return rel.split(/[\\/]/).join('/');
}

// The valid scenarios of an output (an unknown status becomes `skipped` with the reason saying so).
function normalizeScenarios(list, runDir = null) {
  if (!Array.isArray(list)) return [];
  return list.filter((s) => s && typeof s === 'object' && String(s.name || '').trim()).map((s) => {
    const raw = String(s.status || '').toLowerCase();
    const status = STATUSES.includes(raw) ? raw : 'skipped';
    const reason = String(s.reason || '').trim() || (status === raw ? '' : `no valid status reported (${raw || 'none'})`);
    const steps = (Array.isArray(s.steps) ? s.steps : String(s.steps || '').split(/\r?\n/))
      .map((t) => String(t || '').trim()).filter(Boolean);
    const screenshots = (Array.isArray(s.screenshots) ? s.screenshots : [])
      .map((x) => runPath(runDir, typeof x === 'object' && x ? x.path : x)).filter(Boolean);
    return { feature: String(s.feature || '').trim(), name: String(s.name).trim(), steps, status, reason, screenshots };
  });
}

function scenarioCounts(list) {
  const counts = { total: 0, passed: 0, failed: 0, skipped: 0 };
  for (const s of normalizeScenarios(list)) { counts.total++; counts[s.status]++; }
  return counts;
}

// Gherkin of the scenarios, grouped by feature file; a step without its keyword gets `*`.
function featureText(list, { title = 'Acceptance scenarios', note = '' } = {}) {
  const all = normalizeScenarios(list);
  const head = [`# ${title}: written and run by the test writer. Status and reason of each scenario in comments.`];
  if (note) head.push(`# Note: ${String(note).replace(/\s*\r?\n\s*/g, ' ')}`);
  if (!all.length) return `${head.join('\n')}\n# No scenario${note ? '' : ' reported'}.\n`;
  const features = [...new Set(all.map((s) => s.feature))];
  const blocks = features.map((f) => {
    const scenarios = all.filter((s) => s.feature === f).map((s) => [
      `  # ${s.status}${s.reason ? `: ${s.reason.replace(/\s*\r?\n\s*/g, ' ')}` : ''}`,
      ...s.screenshots.map((p) => `  # screenshot: ${p}`),
      `  Scenario: ${s.name}`,
      ...s.steps.map((t) => `    ${KEYWORDS.test(t) ? t : `* ${t}`}`),
    ].join('\n'));
    return [`${f ? `# file: ${f}\n` : ''}Feature: ${f ? path.basename(f.replace(/\\/g, '/')).replace(/\.feature$/i, '') : title}`, ...scenarios].join('\n\n');
  });
  return `${head.join('\n')}\n\n${blocks.join('\n\n')}\n`;
}

// A gate message's lines (the `e2e_scenarios` template filter): '' when the output has no
// `scenarios`; an empty list says so, with the note (why there is none).
function scenariosMessage(output) {
  if (!output || !Array.isArray(output.scenarios)) return '';
  const all = normalizeScenarios(output.scenarios);
  const note = String(output.e2e_note || '').trim();
  if (!all.length) return `E2E scenarios: none${note ? ` (${note})` : ''}.`;
  const c = scenarioCounts(all);
  const counts = STATUSES.filter((k) => c[k]).map((k) => `${c[k]} ${k}`).join(' · ');
  const lines = all.map((s) => `- ${s.status}: ${s.name}${s.reason ? ` (${s.reason})` : ''}`);
  return [`E2E scenarios (written and run by the test writer): ${counts}`, ...lines, ...(note ? [`Note: ${note}`] : [])].join('\n');
}

// Saves the run folder's copy when the output has `scenarios` (even empty: the note says why).
// Returns the files written, or null when the output has none.
function recordScenarios(runDir, stepId, output) {
  if (!runDir || !output || !Array.isArray(output.scenarios)) return null;
  const dir = path.join(runDir, 'e2e');
  fs.mkdirSync(dir, { recursive: true });
  const scenarios = normalizeScenarios(output.scenarios, runDir);
  const note = String(output.e2e_note || '').trim();
  const feature = path.join(dir, 'scenarios.feature');
  const json = path.join(dir, 'scenarios.json');
  fs.writeFileSync(feature, featureText(scenarios, { note }));
  fs.writeFileSync(json, `${JSON.stringify({ step: stepId, counts: scenarioCounts(scenarios), note, scenarios }, null, 2)}\n`);
  return { feature, json };
}

module.exports = {
  featureText,
  normalizeScenarios,
  recordScenarios,
  scenarioCounts,
  scenariosMessage,
  STATUSES,
};
