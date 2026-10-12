// Screenshot view of a run's chat (--view run-chat): a simulated run of --workflow (default
// software-development.yaml), or a copy of a run folder (--run <dir>), opened with openRunChat.

async function open({ js, run }) {
  if (!run) throw new Error('no run to show');
  await js(`window.openRunChat({ runId: ${JSON.stringify(run.runId)}, workflow: ${JSON.stringify(run.workflow)} })`);
}

module.exports = {
  open,
  run: true,
};
