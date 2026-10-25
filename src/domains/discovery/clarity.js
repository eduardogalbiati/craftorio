// Clarity score (#166): how clear a discovery card is, 0 to 100, from a rubric per kind (idea, prd,
// rfc, task, bug, hotfix). Deterministic, no model: a point of the rubric is covered when the card's
// document has a markdown heading for it with something written under it (the acceptance criteria:
// the card's own acceptance.md, or such a heading). The score is the covered weight over the kind's
// total; every point not covered is a gap, listed with what is missing.
//   scoreClarity(card)            → { score, gaps }             card: { type, document, acceptance }
//   clarityBar(settings, kind)    → the bar a kind must reach to enter Ready (85 by default)
//   claritySettings(raw)          → { bar, byKind, night } checked, with the defaults (board.json)
//   readyForecast(items, settings)→ the ready work in agent hours and nights (nightHours: a night's length)
//   said(text)                    → is something written (not a placeholder such as TBD)
//   nextQuestion / recordAnswer   → the Grill me interview: the next open point as a question (with a
//                                   proposed answer when the card already holds one), and the answer
//                                   written into the card's text under the point's heading
// The same rubric is the bundled skill skills/clarity-score (for agents that score what they write).
// Pure: the discovery store (src/domains/discovery/discovery.js) saves the score in card.json and keeps the bar.

const DEFAULT_BAR = 85;
// the owner's night, when agents work alone
const DEFAULT_NIGHT = { start: '23:00', end: '08:00' };
// `task` is the development board's kind: no discovery card has it yet (discovery.TYPES)
const KINDS = ['idea', 'prd', 'rfc', 'task', 'bug', 'hotfix'];

const NON_GOALS = /\bnon[- ]?goals?\b|\b(out of|not in) scope\b/;
const withoutNonGoals = (h) => h.replace(new RegExp(NON_GOALS.source, 'g'), ' ');

// A point of the rubric: `label` (the heading Grill me writes), `weight`, `heading` (does a
// lower-case heading name it), `gap` (what is missing) and `question` (what Grill me asks).
const CRITERIA = {
  problem: {
    label: 'Problem', weight: 3, heading: (h) => /\b(problem|motivation|background)\b/.test(h),
    gap: 'what is wrong or missing today, and for whom', question: 'What is wrong or missing today, and who feels it?',
  },
  goal: {
    label: 'Goal', weight: 2, heading: (h) => /\b(goals?|objectives?)\b/.test(withoutNonGoals(h)),
    gap: 'what is true when this is done', question: 'What is the goal: what is true when this is done?',
  },
  users: {
    label: 'Users', weight: 2, heading: (h) => /\b(users?|personas?|audience)\b/.test(h),
    gap: 'who uses it, and in which situation', question: 'Who are the users, and in which situation do they need this?',
  },
  steps: {
    label: 'Steps to reproduce', weight: 3, heading: (h) => /\breproduc/.test(h),
    gap: 'how to reproduce it, step by step', question: 'How is it reproduced, step by step?',
  },
  observed: {
    label: 'Observed', weight: 2, heading: (h) => /\b(observed|actual)\b/.test(h),
    gap: 'what happens today (the error text, the wrong value)', question: 'What happens today (the error text, the wrong value)?',
  },
  expected: {
    label: 'Expected', weight: 2, heading: (h) => /\bexpected\b/.test(h),
    gap: 'what should happen instead', question: 'What should happen instead?',
  },
  scope: {
    label: 'Scope', weight: 2, heading: (h) => /\bscope\b/.test(withoutNonGoals(h)),
    gap: 'what is part of this change', question: 'What is in scope: which parts change?',
  },
  nonGoals: {
    label: 'Non-goals', weight: 1, heading: (h) => NON_GOALS.test(h),
    gap: 'what is left out on purpose', question: 'What is left out on purpose (the non-goals)?',
  },
  alternatives: {
    label: 'Alternatives considered', weight: 2, heading: (h) => /\balternatives?\b/.test(h),
    gap: 'the other options and why they lose', question: 'Which alternatives were considered, and why does each one lose?',
  },
  acceptance: {
    label: 'Acceptance criteria', weight: 3, heading: (h) => /\bacceptance\b|\bdone when\b|\bdefinition of done\b/.test(h),
    gap: 'nothing verifiable says when it is done', question: 'Which criteria, each one verifiable, say that it is done?',
  },
  metrics: {
    label: 'Success metrics', weight: 2, heading: (h) => /\b(metrics?|success)\b/.test(h),
    gap: 'how success is measured', question: 'How is success measured (the metric and its target)?',
  },
  decisions: {
    label: 'Decisions', weight: 1, heading: (h) => /\bdecisions?\b/.test(h),
    gap: 'what was decided, by whom', question: 'Which decisions are already made, and by whom?',
  },
  openQuestions: {
    label: 'Open questions', weight: 1, heading: (h) => /\b(open (questions?|points?)|questions)\b/.test(h),
    gap: 'what is still undecided ("None" when nothing is)', question: 'What is still undecided? Say "None" when nothing is.',
  },
  dependencies: {
    label: 'Dependencies', weight: 1, heading: (h) => /\b(dependenc(y|ies)|depends on|blocked by)\b/.test(h),
    gap: 'what it needs first, or what it blocks ("None" when nothing)', question: 'What does it depend on, or block? Say "None" when nothing.',
  },
  evidence: {
    label: 'Evidence', weight: 1, heading: (h) => /\b(evidence|references?)\b/.test(h),
    gap: 'what shows the problem is real (a run, a log, a number, a file)', question: 'What shows the problem is real (a run, a log, a number, a file)?',
  },
};

// each kind's points, in the order Grill me asks them
const BUG = ['problem', 'steps', 'observed', 'expected', 'goal', 'scope', 'nonGoals', 'acceptance', 'decisions', 'openQuestions', 'dependencies', 'evidence'];
const COMMON = ['problem', 'goal', 'scope', 'nonGoals', 'acceptance', 'decisions', 'openQuestions', 'dependencies', 'evidence'];
const RUBRICS = {
  idea: COMMON,
  prd: ['problem', 'goal', 'users', 'scope', 'nonGoals', 'acceptance', 'metrics', 'decisions', 'openQuestions', 'dependencies', 'evidence'],
  rfc: ['problem', 'goal', 'scope', 'nonGoals', 'alternatives', 'acceptance', 'decisions', 'openQuestions', 'dependencies', 'evidence'],
  task: COMMON,
  bug: BUG,
  hotfix: BUG,
};

// The text without its HTML comments (a template's hints). No regular expression: a document is any
// text, and one full of unclosed comments must not slow the scan down.
function withoutComments(text) {
  let out = '';
  let from = 0;
  for (;;) {
    const start = text.indexOf('<!--', from);
    const end = start < 0 ? -1 : text.indexOf('-->', start + 4);
    if (end < 0) return out + text.slice(from);
    out += text.slice(from, start);
    from = end + 3;
  }
}

/** Something is written: more than list markers, empty checkboxes or a placeholder (TBD, TODO, ?). */
function said(text) {
  const t = withoutComments(String(text ?? '')).replace(/^[\s>*+-]+/gm, '').replace(/\[[ xX]?\]/g, '').trim();
  return !!t && !/^(tbd|todo|to be (defined|decided)|\?+|\.+)$/i.test(t);
}

// A line that opens or closes a code fence, with its marker.
const FENCE = /^\s*(`{3,}|~{3,})/;

// The document's sections: { title (lower case), body }, a body running to the next heading of the
// same or a higher level (so a section made of sub-sections is not empty). `lead` is the text
// before the first heading. A heading inside a code fence is text.
function outline(document) {
  const sections = [];
  const open = [];
  let lead = '';
  let fence = false;
  for (const line of String(document ?? '').split(/\r?\n/)) {
    if (FENCE.test(line)) fence = !fence;
    // the title is trimmed below, not by the expression: a long line of spaces stays linear
    const m = fence ? null : /^ {0,3}(#{1,6})[ \t]+(.*)$/.exec(line);
    if (!m) {
      if (!open.length) lead += `${line}\n`;
      for (const s of open) s.body += `${line}\n`;
      continue;
    }
    while (open.length && open.at(-1).level >= m[1].length) open.pop();
    const section = { level: m[1].length, title: m[2].replace(/[*_`:#]/g, '').trim().toLowerCase(), body: '' };
    sections.push(section);
    open.push(section);
  }
  return { sections, lead };
}

// The points of the card's kind that its text does not cover, in the rubric's order.
function openPoints(card) {
  const { type, document, acceptance } = card || {};
  const { sections } = outline(document);
  const rubric = Object.hasOwn(RUBRICS, String(type)) ? RUBRICS[type] : RUBRICS.idea;
  const covered = (id) => (id === 'acceptance' && said(acceptance)) || sections.some((s) => CRITERIA[id].heading(s.title) && said(s.body));
  return { rubric, open: rubric.filter((id) => !covered(id)) };
}

/**
 * Scores a card's text against the rubric of its kind: `score` (an integer, 0 to 100) and `gaps`,
 * one line per point not covered ("Acceptance criteria: nothing verifiable says when it is done").
 */
function scoreClarity(card) {
  const { rubric, open } = openPoints(card);
  const weight = (ids) => ids.reduce((sum, id) => sum + CRITERIA[id].weight, 0);
  return {
    score: Math.round((100 * (weight(rubric) - weight(open))) / weight(rubric)),
    gaps: open.map((id) => `${CRITERIA[id].label}: ${CRITERIA[id].gap}`),
  };
}

const isPercent = (n) => Number.isInteger(n) && n >= 0 && n <= 100;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The bar a card of `kind` must reach: the kind's own (settings.byKind), else the project's, else 85. */
function clarityBar(settings, kind) {
  const own = settings?.byKind?.[kind];
  if (isPercent(own)) return own;
  return isPercent(settings?.bar) ? settings.bar : DEFAULT_BAR;
}

/** A project's clarity settings as stored (board.json `clarity`), with the defaults for what is missing or invalid. */
function claritySettings(raw) {
  const byKind = {};
  for (const kind of KINDS) if (isPercent(raw?.byKind?.[kind])) byKind[kind] = raw.byKind[kind];
  // a night that starts when it ends has no length: not a night
  const night = CLOCK.test(raw?.night?.start) && CLOCK.test(raw?.night?.end) && raw.night.start !== raw.night.end ? { start: raw.night.start, end: raw.night.end } : { ...DEFAULT_NIGHT };
  return { bar: clarityBar({ bar: raw?.bar }), byKind, night };
}

// The length of a night window in hours; one that ends before it starts crosses midnight.
function nightHours(night) {
  const minutes = (clock) => { const [h, m] = clock.split(':').map(Number); return h * 60 + m; };
  const { start, end } = claritySettings({ night }).night;
  const span = (minutes(end) - minutes(start) + 1440) % 1440;
  return Math.round(span / 6) / 10;
}

/**
 * The ready work, for the cards given (the Ready column): only the ones at or above their bar count
 * (a card moved there below it, by the owner's override, does not). `hours` sums their estimates
 * (estimate.minutes; `unestimated` counts the ones without), `nights` is how many whole nights
 * (settings.night, `nightHours` long) that work fills, 1 as soon as there is any.
 */
function readyForecast(items, settings) {
  const perNight = nightHours(settings?.night);
  const ready = (items || []).filter((c) => typeof c?.clarity?.score === 'number' && c.clarity.score >= clarityBar(settings, c.type));
  const estimate = (c) => Math.max(0, Number(c.estimate?.minutes) || 0);
  const minutes = ready.reduce((sum, c) => sum + estimate(c), 0);
  const hours = Math.round(minutes / 6) / 10;
  return {
    count: ready.length,
    unestimated: ready.filter((c) => !estimate(c)).length,
    hours,
    nights: hours > 0 ? Math.max(1, Math.floor(hours / perNight)) : 0,
    nightHours: perNight,
  };
}

// ---- Grill me ---------------------------------------------------------------------------------------

const clip = (text, max = 600) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

// An answer the card already holds for a point, without its heading: the text before the first
// heading (the problem, as captured), the document's unchecked checklist (acceptance criteria), its
// lines that ask something (open questions). '' when it holds none.
function proposal(id, card) {
  const lines = String(card.document ?? '').split(/\r?\n/).map((l) => l.trim());
  if (id === 'problem') {
    const lead = outline(card.document).lead.trim();
    return said(lead) ? clip(lead) : '';
  }
  if (id === 'acceptance') return clip(lines.filter((l) => /^[-*+] \[ \] \S/.test(l)).join('\n'));
  if (id === 'openQuestions') return clip(lines.filter((l) => /\?$/.test(l) && !/^#/.test(l)).map((l) => `- ${l.replace(/^[-*+] (\[[ xX]?\] )?/, '')}`).join('\n'));
  return '';
}

/** The next question of the interview: the first open point of the card's kind, `{ criterion, label, question, proposal }`, or null when every point is covered. */
function nextQuestion(card) {
  const [id] = openPoints(card).open;
  return id ? { criterion: id, label: CRITERIA[id].label, question: CRITERIA[id].question, proposal: proposal(id, card || {}) } : null;
}

// An answer as the body of its point's section (level 2), whatever markdown the person wrote: its
// headings go two levels down (as a section of its own it would leave the point's empty, and the
// point would be asked again), and a code fence left open is closed (the answers after it would be
// code). The fences are read as `outline` reads them: a heading inside one is text.
function contained(text) {
  let fence = null;
  const lines = text.split(/\r?\n/).map((line) => {
    const mark = FENCE.exec(line);
    if (mark) fence = fence ? null : mark[1];
    if (fence || mark) return line;
    return line.replace(/^( {0,3})(#{1,6})(?=[ \t])/, (m, indent, hashes) => `${indent}${'#'.repeat(Math.min(6, hashes.length + 2))}`);
  });
  if (fence) lines.push(fence);
  return lines.join('\n');
}

/**
 * The card's text with the person's answer to a point: `{ acceptance }` (the criteria, one list item
 * per line) or `{ document }` (a new section under the point's heading, after what the document has;
 * the answer's own headings and fences stay inside it).
 */
function recordAnswer(card = {}, criterion, answer) {
  const text = String(answer ?? '').trim();
  const after = (before) => (String(before ?? '').trim() ? `${String(before).trimEnd()}\n` : '');
  if (criterion === 'acceptance') {
    const items = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => (/^([-*+]|\d+[.)]) /.test(l) ? l : `- ${l}`));
    return { acceptance: `${after(card.acceptance)}${items.join('\n')}\n` };
  }
  const { label } = Object.hasOwn(CRITERIA, String(criterion)) ? CRITERIA[criterion] : CRITERIA.decisions;
  const before = after(card.document);
  return { document: `${before}${before ? '\n' : ''}## ${label}\n\n${contained(text)}\n` };
}

module.exports = {
  clarityBar,
  claritySettings,
  DEFAULT_BAR,
  DEFAULT_NIGHT,
  KINDS,
  nextQuestion,
  nightHours,
  readyForecast,
  recordAnswer,
  said,
  scoreClarity,
};
