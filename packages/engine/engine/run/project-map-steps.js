// @ts-check
// `type: project_map` (#372, workflows/analyze-project.yaml since #631): the project map's machine steps, no model
// call and read-only on the project (packages/engine/domains/project/project-map.js does the work), the same in a simulation.
// `action` says which:
// - facts: the cartographer's inputs (the tree counted by folder and file-name pattern, the
//   manifests, #371's folder city and its edges, the plan saved now), also written to
//   project-map/facts.json in the run folder;
// - validate: #371's validator on the plan the `from` step answered (its output's `city_plan`; a
//   refresh keeps the saved plan's ids and names); output { ok, problems, plan, report, ... },
//   written to project-map/plan.json and validation.md;
// - save: the plan the `from` step validated, saved as architecture:savePlan saves it;
// - analyze (#381): the Oracle's architecture analysis of the project (packages/engine/domains/oracle/oracle-architecture.js,
//   saved as architecture:analyze saves it), the one model call of the workflow besides the
//   cartographer's: the Oracle comes from the run's `architectureOracle` option (the service's
//   Oracle and its agent; a simulation writes the simulated report, a real run without it fails);
// - fail: ends the run failed with the `from` step's validation report.
// The project: the run's projectId (or the input project_id); its folder: the input repo_path; its
// plans: <workspace>/architecture/<project id>/ (the workspace: the runs folder's parent).

'use strict';

const fs = require('fs');
const path = require('path');
const projectMap = require('../../domains/project/project-map');

const methods = {
  // where the step works: { folder, archRoot, projectId }
  projectMapPlace(step) {
    const projectId = this.projectId || this.ctx.inputs?.project_id || null;
    const folder = this.ctx.inputs?.repo_path || null;
    if (!projectId || !folder) throw new Error(`Step "${step.id}": the project map needs the project (the run's project, or the input project_id) and its folder (the input repo_path).`);
    return { folder, archRoot: path.join(path.dirname(path.dirname(this.runDir)), 'architecture'), projectId };
  },

  projectMapWrite(name, text) {
    const dir = path.join(this.runDir, 'project-map');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  },

  async runProjectMapStep(step, st) {
    const place = this.projectMapPlace(step);
    const from = step.from ? this.ctx.steps[step.from]?.output : null;
    const log = (level, message) => this.emitEvent('log', { level, kind: 'project_map', step_id: step.id, message: `${step.id}: ${message}` });
    if (step.action === 'facts') {
      const output = await projectMap.mapFacts(place);
      this.projectMapWrite('facts.json', `${JSON.stringify(output, null, 2)}\n`);
      log('info', `${output.files} tracked files, ${output.manifests.length} manifest(s), ${output.current_plan ? 'a saved plan to refresh' : 'no saved plan'}.`);
      return output;
    }
    if (step.action === 'validate') {
      const output = await projectMap.validateMap({ ...place, proposed: from?.city_plan ?? {} });
      this.projectMapWrite('plan.json', `${JSON.stringify(output.plan, null, 2)}\n`);
      this.projectMapWrite('validation.md', `${output.report}\n`);
      log(output.ok ? 'info' : 'warn', `round ${st.visits}: ${output.ok ? 'the plan passes' : output.problems.join('; ')}.`);
      return output;
    }
    if (step.action === 'save') {
      const output = projectMap.saveMap({ ...place, plan: from?.plan });
      log('info', `the city plan of ${place.projectId} is saved${output.history ? ` (the previous one: city-plan-history/${output.history})` : ''}.`);
      return { saved: true, ...output };
    }
    if (step.action === 'analyze') {
      const svc = typeof this.architectureOracle === 'function' ? this.architectureOracle() : null;
      const output = await projectMap.analyzeMap({ ...place, mock: this.machine.simulated, oracle: svc?.oracle || null, agent: svc?.agent || null });
      log('info', `the Oracle's analysis of ${place.projectId} is saved: ${output.findings} finding(s)${output.simulated ? ', simulated' : output.cost_usd != null ? `, US$ ${Number(output.cost_usd).toFixed(2)}` : ''}.`);
      return output;
    }
    throw new Error(`The city plan did not pass the validation after ${this.ctx.steps[step.from]?.visits || 0} round(s); nothing was saved.\n\n${from?.report || '(no validation report)'}`);
  },
};

module.exports = {
  methods,
};
