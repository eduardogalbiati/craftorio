// The workflow.started event of each run in a scenario's scratch workspace (<scratch>/workspace/runs/<id>/events.jsonl),
// as { dir, ...event }: what a step reads to check which runs a click started (or did not start). Shared by the
// steps of fronts/build/features/steps/roadmap-test-stage.steps.js and features/steps/onboarding.steps.js (#846).
// A helper module: no step definitions here.
const fs = require('fs');
const path = require('path');

function startedRuns(e2e) {
  const runs = path.join(e2e.scratch, 'workspace', 'runs');
  if (!fs.existsSync(runs)) return [];
  return fs.readdirSync(runs).map((d) => {
    const file = path.join(runs, d, 'events.jsonl');
    if (!fs.existsSync(file)) return null;
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      try {
        const ev = JSON.parse(line);
        if (ev.type === 'workflow.started') return { dir: d, ...ev };
      } catch { /* a line being written */ }
    }
    return null;
  }).filter(Boolean);
}

// a workflow's name or file without its .yaml / .yml extension, to compare the two forms
const workflowBase = (name) => String(name || '').replace(/\.ya?ml$/i, '');

module.exports = { startedRuns, workflowBase };
