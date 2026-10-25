// Service area: what an open human gate with `diff_base` (developer_check) shows: the worktree's
// changes since that ref, read-only, as a diff terminal or as the list of changed files for its
// Artifacts panel (#108). The ref and the folder come from the open gate, never from the caller.

const path = require('path');
const { resolveCommand } = require('../../engine/providers');
const { cliEnv, runTool } = require('../common');

module.exports = (ctx) => {
  function openDiffGate({ runId, approvalId }) {
    const run = ctx.active.get(String(runId || ''));
    const gate = run?.pendingGates().find((g) => g.approval_id === approvalId);
    if (!gate) throw new Error('The gate is no longer open.');
    if (!gate.diff_base || !gate.work_dir) throw new Error('This gate does not offer a diff.');
    if (gate.diff_base.startsWith('-')) throw new Error(`Not a ref: ${gate.diff_base}`);
    return gate;
  }

  // file: only that file's diff (a changed file clicked in the gate's Artifacts panel, #108).
  function gateDiffSpec({ runId, approvalId, file }) {
    const gate = openDiffGate({ runId, approvalId });
    // ConPTY does not look a bare command name up in PATH
    const git = resolveCommand('git');
    if (!git) throw new Error('git is not installed.');
    const only = file ? [String(file)] : [];
    return {
      title: `Diff ${gate.diff_base}...HEAD${file ? ` · ${path.basename(String(file))}` : ''}`, cwd: gate.work_dir, file: git.file, env: cliEnv(),
      args: ['--no-pager', 'diff', '--color=always', '--stat', '--patch', `${gate.diff_base}...HEAD`, '--', ...only],
    };
  }

  // The files a gate with `diff_base` changed (git diff --numstat): [{ file, added, deleted }]
  // (null counts for binary files).
  async function gateChanges({ runId, approvalId }) {
    const gate = openDiffGate({ runId, approvalId });
    const git = resolveCommand('git');
    if (!git) throw new Error('git is not installed.');
    const { ok, out } = await runTool(git.file, ['-C', gate.work_dir, '--no-pager', 'diff', '--numstat', `${gate.diff_base}...HEAD`, '--']);
    if (!ok) throw new Error(/not a git repository/i.test(out) ? 'the run\'s folder is not a git repository (a simulation works in the project folder).' : `git diff failed: ${out.split('\n')[0]}`);
    return out.split(/\r?\n/).filter(Boolean).map((l) => {
      const [added, deleted, ...rest] = l.split('\t');
      return { file: rest.join('\t'), added: added === '-' ? null : +added, deleted: deleted === '-' ? null : +deleted };
    }).filter((c) => c.file);
  }

  return {
    gateChanges,
    gateDiffSpec,
  };
};
