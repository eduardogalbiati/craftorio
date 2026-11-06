// A disposable, simulation-only Phone gates service for the official smoke's browser page and
// manual preview. There are no workflow processes or real approvals, only this in-memory fixture.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createMobileGatesServer } = require('../../domains/workspace/mobile-gates');

async function phoneGatesFixture() {
  if (process.env.MULTIAGENT_SIMULATION_ONLY !== '1') throw new Error('Phone gates fixture requires simulation-only mode.');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phone-gates-smoke-'));
  const state = { language: 'en', time: Date.now(), open: true, answers: [] };
  const gate = {
    approval_id: 'approval-mobile', step_id: 'review', message: 'Review the mobile recovery change',
    brief: {
      headline: 'Phone gates now explains connection failures before you answer.',
      recommendation: { label: 'Request changes', why: 'Review the screenshots and test evidence before shipping.' },
      evidence: [{ label: 'Implementation evidence', url: 'https://example.test/evidence/phone-gates-accessibility-and-connection-recovery' }],
    },
    choices: [
      { id: 'approve', label: 'Approve release', help: 'Merges the branch into main.' },
      { id: 'redo', label: 'Request changes', help: 'Returns the change to the developer with your note.', feedback_required: true },
    ],
  };
  const run = {
    runId: 'simulated-mobile', title: 'Phone gates: accessible recovery', gates: [gate],
    nextTurns: [{ agent: 'developer', turn: { kind: 'warm', tokens: 20000 } }],
  };
  const server = createMobileGatesServer({
    language: () => state.language,
    now: () => state.time,
    service: {
      workspace: () => ({ root }),
      api: { 'runs:active': () => state.open ? [run] : [] },
      answerPhoneGate: (...args) => {
        if (!state.open) return false;
        state.answers.push(args);
        state.open = false;
        return true;
      },
    },
  });
  const { url } = await server.listen();
  return {
    server, state, url, gate, run,
    link: () => server.gateLink(run.runId, gate.approval_id),
    async close() { await server.close(); fs.rmSync(root, { recursive: true, force: true }); },
  };
}

module.exports = { phoneGatesFixture };
