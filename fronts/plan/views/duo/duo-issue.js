// Write & Review from a Backlog issue (#103): the document types the writer and the reviewer can
// load (the workflow's `document_skill` input, empty = free-form), the default goal of each one, and
// the inputs that prefill the screen from an issue ("Enrich in Write & Review": its title, number,
// URL, labels and full body in the prompt). Pure, no DOM. Browser: window.DuoIssue; Node: module.exports.
(function (root) {
  const t = (...a) => (typeof module === 'object' && module.exports ? require('@multiagent/shared/i18n') : root.I18n)?.t(...a) ?? a[0];
  const DOC_TYPES = [
    {
      skill: 'issue-writing',
      label: 'Enriched issue',
      noun: 'a complete issue',
      goal: 'A complete issue someone else can implement without asking: the problem and its context with evidence, '
        + 'the decisions taken (open questions marked as such), the scope and what is out of it, and verifiable '
        + 'acceptance criteria as a task list.',
    },
    {
      skill: 'rfc-writing',
      label: 'RFC',
      noun: 'an RFC',
      goal: 'An RFC the owner can decide on: the motivation with evidence, the proposal in enough detail to implement it, '
        + 'drawbacks, the alternatives considered and why they were rejected, unresolved questions and a rollout plan.',
    },
    {
      skill: 'prd-writing',
      label: 'PRD',
      noun: 'a PRD',
      goal: 'A PRD a team can build from: the problem and who has it, goals and non-goals, prioritized requirements, '
        + 'success metrics and open questions.',
    },
    {
      skill: 'design-doc-writing',
      label: 'Design doc',
      noun: 'a design doc',
      goal: 'A design doc reviewers can approve: context, goals and non-goals, the design with its trade-offs, '
        + 'alternatives, failure modes and a rollout plan.',
    },
    { skill: '', label: 'Free-form (no document skill)', noun: 'a fuller document', goal: '' },
  ];
  const DEFAULT_ISSUE_SKILL = 'issue-writing';

  const docType = (skill) => DOC_TYPES.find((t) => t.skill === (skill || '')) || null;
  /** The default goal of a document type ('' for free-form or an unknown skill). */
  const defaultGoal = (skill) => docType(skill)?.goal || '';

  /**
   * The prompt that asks for an issue to be enriched into a document of type `skill`: the issue's
   * title, number, URL, labels and full body.
   * @param {{ number: number, title: string, url: string, body?: string, labels?: ({ name: string } | string)[] }} issue
   */
  function issuePrompt(issue, skill = DEFAULT_ISSUE_SKILL) {
    const labels = (issue.labels || []).map((l) => (typeof l === 'string' ? l : l.name)).filter(Boolean);
    const what = docType(skill)?.noun || `a document (${skill})`;
    return [
      `Enrich issue #${issue.number} into ${what}. Keep its intent and every fact it states; ground what you add in the project's files and mark assumptions as such.`,
      `Issue #${issue.number}: ${issue.title}`,
      `URL: ${issue.url}`,
      `Labels: ${labels.length ? labels.join(', ') : 'none'}`,
      `<issue>\n${String(issue.body || '').trim() || t('duo_issue.no_description')}\n</issue>`,
    ].join('\n');
  }

  /** The inputs that prefill Write & Review from an issue: { prompt, goal, document_skill }. */
  function enrichInputs(issue, skill = DEFAULT_ISSUE_SKILL) {
    return { prompt: issuePrompt(issue, skill), goal: defaultGoal(skill), document_skill: skill };
  }

  const api = { DOC_TYPES, DEFAULT_ISSUE_SKILL, defaultGoal, enrichInputs, issuePrompt };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DuoIssue = api;
})(typeof window !== 'undefined' ? window : globalThis);
