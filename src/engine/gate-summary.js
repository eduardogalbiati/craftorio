// Gate summaries (#213): what every human gate shows a person first, before its long message.
// gateBrief builds { headline, body, recommendation, options, user_action } from the step's
// `summary:` template (Markdown, already rendered: its first line is "What happened", the next lines
// the status per issue), its `recommend:` template ("<answer>: <reason>") and the supervisor on call's
// diagnosis, whose recommend / recommendation / options win over the workflow's. A gate without
// `summary:` gets the first two sentences of its message. issueLines and suiteLines are the template
// filters `issue_lines` and `suite_lines` the summaries use (one ✔ / ✖ line per issue or failing test).
// Pure functions: the engine's requestApproval stores the brief on the gate record (and its event),
// the renderer (gate-panel.js gateCardHtml) and every place that mentions a gate read it.

const HEADLINE_MAX = 240;
const BODY_LINES = 6;
const REASON_MAX = 200;
const ISSUE_LINES = 5;

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
// A text on one line, cut with an ellipsis: the `one_line` filter (a report or an error in a summary line)
const oneLine = (s, n = 110) => clip(s, n);
// Markdown marks and links out of a one-line text (a headline, a reason)
// (issue refs like #186 and names like test_command are kept)
const plain = (s) => String(s ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\*\*|__|`/g, '').replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+)/, '');

// The first n sentences of a text, on one line; the part under a `---` (the supervisor's note) is left out.
function firstSentences(text, n = 2) {
  const top = String(text ?? '').split(/\r?\n-{3,}\r?\n/)[0];
  const flat = plain(top).replace(/\s+/g, ' ').trim();
  return clip(flat.split(/(?<=[.!?:])\s+/).filter(Boolean).slice(0, n).join(' '), HEADLINE_MAX);
}

const issueRef = (u) => {
  const m = /\/(?:issues|pull|merge_requests)\/(\d+)/.exec(String(u ?? ''));
  return m ? `#${m[1]}` : String(u ?? '').trim();
};
const PASSED = /^(verified|pass|passed|done|ok)$/i;

// One Markdown line per issue: ✔ / ✖, the issue (#n), one short reason. A developer's issues
// ({ issue, done, summary }) or a verifier's ({ issue, verdict, evidence }); `only: 'not_done'`
// keeps the failed ones. Over max lines, the last one says how many more are in Details.
function issueLines(issues, { only = null, max = ISSUE_LINES } = {}) {
  let list = (Array.isArray(issues) ? issues : []).filter((i) => i && typeof i === 'object');
  const ok = (i) => (i.verdict !== undefined ? PASSED.test(String(i.verdict)) : i.done === true);
  if (only === 'not_done') list = list.filter((i) => !ok(i));
  const lines = list.slice(0, max).map((i) => {
    const why = firstSentences(i.summary || i.evidence || i.reason || '', 1);
    const verdict = i.verdict !== undefined && !ok(i) ? ` (${String(i.verdict).replace(/_/g, ' ')})` : '';
    return `- ${ok(i) ? '✔' : '✖'} **${issueRef(i.issue ?? i.number)}**${verdict}${why ? `: ${clip(why, 110)}` : ''}`;
  });
  if (list.length > max) lines.push(`- … and ${list.length - max} more (see Details)`);
  return lines.join('\n');
}

// One Markdown line per failing test of a `type: suite` step's output (src/engine/suite-step.js),
// then the pre-existing failures as one count (#211: they fail on the base too). '' when not a suite's.
function suiteLines(output, { max = 4 } = {}) {
  if (output?.kind !== 'suite') return '';
  const fails = output.failures || [];
  const lines = fails.slice(0, max).map((f) => `- ✖ \`${clip(f.test, 80)}\`${f.file ? ` (${clip(f.file, 60)})` : ''}`);
  if (fails.length > max) lines.push(`- … and ${fails.length - max} more (see Details)`);
  const pre = output.preexisting?.length || 0;
  if (pre) lines.push(`- ${pre} pre-existing failure${pre === 1 ? '' : 's'} not counted (they fail on the base too)`);
  return lines.join('\n');
}

// "<answer>: <reason>" → { answer, reason } when <answer> is one of the gate's answers; any other
// text is a reason without an answer. null when empty.
function parseRecommend(text, ids) {
  const t = clip(plain(text), REASON_MAX);
  if (!t) return null;
  const m = /^([\w-]+)\s*[:—–-]\s*(.*)$/.exec(t);
  const id = m && ids.find((a) => a.toLowerCase() === m[1].toLowerCase());
  return id ? { answer: id, reason: m[2].trim() } : { answer: null, reason: t };
}

// message: the gate's rendered message; summary / recommend: the step's rendered templates ('' when
// it has none); diagnosis: the supervisor on call's ({ explanation, recommend, recommendation,
// options, user_action }) or null; answers: [{ id, label }], `approve` / `reject` for a yes/no gate.
function gateBrief({ message = '', summary = '', recommend = '', diagnosis = null, answers = [] } = {}) {
  const lines = String(summary || '').trim().split(/\r?\n/);
  const head = lines.findIndex((l) => l.trim());
  const headline = head >= 0 && lines[head].trim() ? clip(plain(lines[head]), HEADLINE_MAX) : firstSentences(message);
  const rest = head >= 0 ? lines.slice(head + 1).filter((l) => l.trim()) : [];
  const body = rest.slice(0, BODY_LINES).join('\n');
  const ids = answers.map((a) => String(a.id));
  let recommendation = null;
  if (diagnosis && (diagnosis.recommend || diagnosis.recommendation)) {
    const id = diagnosis.recommend ? ids.find((a) => a.toLowerCase() === String(diagnosis.recommend).toLowerCase()) : null;
    recommendation = { answer: id || null, reason: clip(plain(diagnosis.recommendation || ''), REASON_MAX), source: 'supervisor' };
  } else {
    const p = parseRecommend(recommend, ids);
    if (p) recommendation = { ...p, source: 'workflow' };
  }
  if (recommendation) recommendation.label = answers.find((a) => String(a.id) === recommendation.answer)?.label || null;
  const options = (Array.isArray(diagnosis?.options) ? diagnosis.options : []).map((o) => clip(plain(o), 160)).filter(Boolean).slice(0, 3);
  return {
    headline,
    body,
    recommendation,
    options,
    ...(diagnosis?.user_action ? { user_action: clip(diagnosis.user_action, 240) } : {}),
  };
}

module.exports = {
  firstSentences,
  gateBrief,
  issueLines,
  oneLine,
  parseRecommend,
  suiteLines,
};
