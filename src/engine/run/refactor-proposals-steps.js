// @ts-check
// `type: refactor_proposals` (#378, workflows/refactor-proposals.yaml): the Refactor proposals
// workflow's machine steps (src/refactor-proposals-run.js does the work). `action` says which:
// - facts: the Architecture facts at the default branch, the files changed since the input `since`
//   and the analyst's prompt (#356's, focused on the Danger Zone and the changed files);
// - propose: the `from` step's report (#356's format) added to the Refactor tab's proposals; the
//   findings that match a proposal or an open `refactor` issue are dropped, and the output says which;
// - prioritize: #357's Product Owner ranking (a simulation ranks without a model; a real run takes
//   the Product Owner from the run's `refactorPriorityOptions` option, the service's), the top
//   `inputs.limit` of the `from` step's new proposals kept;
// - file: the `from` step's kept proposals filed as `refactor` issues (a simulation previews them).
// The project: the run's projectId (or the input project_id); its folder: the input project_path;
// the stores: <workspace>/refactor, architecture and backlog (the workspace: the runs folder's parent).

'use strict';

const path = require('path');
const work = require('../../refactor-proposals-run');

const methods = {
  // where the step works: { folder, wsRoot, projectId }
  refactorProposalsPlace(step) {
    const projectId = this.projectId || this.ctx.inputs?.project_id || null;
    const folder = this.ctx.inputs?.project_path || null;
    if (!projectId || !folder) throw new Error(`Step "${step.id}": refactor proposals need the project (the run's project, or the input project_id) and its folder (the input project_path).`);
    return { folder, wsRoot: path.dirname(path.dirname(this.runDir)), projectId };
  },

  async runRefactorProposalsStep(step) {
    const place = this.refactorProposalsPlace(step);
    const from = step.from ? this.ctx.steps[step.from]?.output : null;
    const simulated = !!this.machine.simulated;
    const log = (level, message) => this.emitEvent('log', { level, kind: 'refactor_proposals', step_id: step.id, message: `${step.id}: ${message}` });
    if (step.action === 'facts') {
      const output = await work.readRunFacts({ ...place, since: this.ctx.inputs?.since || '' });
      log(output.since_unknown ? 'warn' : 'info', `${output.changed.length} file(s) changed since ${output.since || 'nothing (no release given)'}${output.since_unknown ? ' (not a tag or a commit)' : ''}, ${output.danger_zone.length} in the Danger Zone.`);
      return output;
    }
    if (step.action === 'propose') {
      const output = work.proposeFindings({ ...place, report: from, runId: this.runId });
      log('info', `${output.added.length} new proposal(s); ${output.dropped.length} finding(s) dropped${output.dropped.length ? `: ${output.dropped.map((d) => `${d.title} (${d.reason})`).join('; ')}` : ''}.`);
      return output;
    }
    if (step.action === 'prioritize') {
      const options = simulated ? null : typeof this.refactorPriorityOptions === 'function' ? this.refactorPriorityOptions(place.projectId) : null;
      const output = await work.rankProposals({ ...place, ids: (from?.added || []).map((x) => x.id), limit: Number(this.ctx.inputs?.limit ?? 5), mock: simulated, options });
      log('info', `${output.ranked.length} new proposal(s) ranked, the top ${output.kept.length} kept${output.simulated ? ' (simulated ranking)' : ''}.`);
      return output;
    }
    // file
    const output = await work.fileProposals({ ...place, ids: from?.kept || [], simulated });
    log('info', `${output.message}${output.skipped.length ? ` Skipped: ${output.skipped.map((s) => `${s.title} (${s.reason})`).join('; ')}.` : ''}`);
    return output;
  },
};

module.exports = {
  methods,
};
