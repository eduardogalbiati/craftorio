// Backlog › Product Owner drawer: what a draft's real filing asks first (#70; backlog-po.js fileDraft), in the
// interface language. draftTexts → [title, text, button] of the confirm dialog: a new issue goes to the project's
// repository, or to the local backlog of a project with no remote (#35), and with Create + roadmap to the roadmap
// too; append and comment say whether the draft's addition or the whole draft is added.
/* global t */
(() => {
  function createText(local, roadmap) {
    if (local) return roadmap ? t('backlog_po.create_confirm_local_roadmap') : t('backlog_po.create_confirm_local');
    return roadmap ? t('backlog_po.create_confirm_remote_roadmap') : t('backlog_po.create_confirm_remote');
  }

  /** act: create | create-roadmap | create-assign | append | comment; n: the issue added to; x: the answer's issue; project: its record. */
  function draftTexts(act, n, x, project) {
    if (act.startsWith('create')) return [t('backlog_po.create_the_issue_title', { title: x.draft.title }), createText(!!project && !project.repo, act === 'create-roadmap'), t('backlog_po.create')];
    const addition = x.existingIssue === n && x.addition;
    if (act === 'append') return [t('backlog_po.add_to_n', { n }), addition ? t('backlog_po.append_addition_confirm', { n }) : t('backlog_po.append_draft_confirm', { n }), t('backlog_po.add_to_n_yes')];
    return [t('backlog_po.comment_on_n', { n }), addition ? t('backlog_po.comment_addition_confirm', { n }) : t('backlog_po.comment_draft_confirm', { n }), t('backlog_po.comment_on_n_yes')];
  }

  window.BacklogPoConfirm = {
    draftTexts,
  };
})();
