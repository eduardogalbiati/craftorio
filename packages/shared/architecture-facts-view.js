// The Architecture tab's Facts view for a human reader (#386): pure functions, no DOM. findingScore
// gives a report finding a 0-100 danger score from its severity and the Danger Zone score (#356,
// packages/shared/architecture-model.js) of its hottest target file, so the same facts give the same
// number; SCORE_FORMULA is the tooltip that says how. rankFindings / findingCounts / filterFindings
// sort the findings by score, count them per severity and new / kept, and filter them. The
// languages as GitHub's sidebar shows them: languageColor (GitHub Linguist's colours, a neutral one
// for the others) and languageShares (one decimal of the counted lines, "Other" for those under
// 0.5%). complexityLine is the one-line complexity note, qualityGateRow the project's own gate as
// three chips (complexity, coverage, duplication), firstSentence the one-line text of a paragraph.
// Browser: window.ArchitectureFactsView; Node: module.exports.
(function (root) {
  const SEVERITY_BASE = { high: 60, medium: 35, low: 10 };
  const DANGER_SPAN = 40;
  const SCORE_FORMULA = 'Score = the severity (high 60, medium 35, low 10) + 40 × the Danger Zone score of the hottest target file ÷ √2 (0 outside the Danger Zone), rounded: the same facts give the same score.';
  const OTHER_SHARE = 0.005;
  const NEUTRAL_COLOR = '#8b949e';
  // GitHub Linguist's colours (github-linguist/linguist, lib/linguist/languages.yml)
  const LINGUIST = {
    'C#': '#178600',
    'C++': '#f34b7d',
    C: '#555555',
    CSS: '#563d7c',
    Dart: '#00B4AB',
    Dockerfile: '#384d54',
    Go: '#00ADD8',
    HTML: '#e34c26',
    JSON: '#292929',
    Java: '#b07219',
    JavaScript: '#f1e05a',
    Kotlin: '#A97BFF',
    Lua: '#000080',
    Markdown: '#083fa1',
    PHP: '#4F5D95',
    PowerShell: '#012456',
    Python: '#3572A5',
    Ruby: '#701516',
    Rust: '#dea584',
    SCSS: '#c6538c',
    SQL: '#e38c00',
    Scala: '#c22d40',
    Shell: '#89e051',
    Swift: '#F05138',
    TOML: '#9c4221',
    TypeScript: '#3178c6',
    Vue: '#41b883',
    YAML: '#cb171e',
  };
  const GATE_ASPECTS = ['complexity', 'coverage', 'duplication'];

  const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /** A finding's danger score, an integer from 0 to 100 (SCORE_FORMULA). */
  function findingScore(finding, dangerZone) {
    const base = SEVERITY_BASE[finding && finding.severity] ?? SEVERITY_BASE.low;
    const zone = dangerZone instanceof Map ? dangerZone : zoneMap(dangerZone);
    let hottest = 0;
    for (const f of (finding && finding.files) || []) hottest = Math.max(hottest, zone.get(f && f.path) || 0);
    const danger = Math.min(1, hottest / Math.SQRT2);
    return Math.max(0, Math.min(100, Math.round(base + DANGER_SPAN * danger)));
  }

  function zoneMap(dangerZone) {
    return new Map((Array.isArray(dangerZone) ? dangerZone : []).map((d) => [d.file, Number(d.score) || 0]));
  }

  /** Copies of the findings with `index` (their place in the input) and `score`, highest score first. */
  function rankFindings(findings, dangerZone) {
    const zone = zoneMap(dangerZone);
    return (findings || []).map((f, index) => ({ ...f, index, score: findingScore(f, zone) }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
  }

  /** { severity: { high, medium, low }, status: { new, kept } }, zeros included. */
  function findingCounts(ranked) {
    const counts = { severity: { high: 0, medium: 0, low: 0 }, status: { new: 0, kept: 0 } };
    for (const f of ranked || []) {
      if (f.severity in counts.severity) counts.severity[f.severity]++;
      if (f.status in counts.status) counts.status[f.status]++;
    }
    return counts;
  }

  /** The findings of a severity and / or a status (new, kept), in their order; no filter keeps them all. */
  function filterFindings(ranked, filter) {
    const { severity, status } = filter || {};
    return (ranked || []).filter((f) => (!severity || f.severity === severity) && (!status || f.status === status));
  }

  /** A language's colour on GitHub; a neutral grey for a language Linguist gives none here. */
  function languageColor(language) {
    return LINGUIST[language] || NEUTRAL_COLOR;
  }

  const percentOf = (lines, total) => Math.round((lines / total) * 1000) / 10;

  /** [{ language, lines, percent, color }] of the counted lines, largest first; "Other" (with `others`) last. */
  function languageShares(languages) {
    const list = (languages || []).filter((l) => Number(l.lines) > 0).map((l) => ({ language: l.language, lines: Number(l.lines) }));
    const total = list.reduce((s, l) => s + l.lines, 0);
    if (!total) return [];
    list.sort((a, b) => b.lines - a.lines || String(a.language).localeCompare(String(b.language)));
    const shares = [];
    const other = { language: 'Other', lines: 0, others: [] };
    for (const l of list) {
      if (l.lines / total < OTHER_SHARE) {
        other.lines += l.lines;
        other.others.push(l.language);
      } else {
        shares.push({ ...l, percent: percentOf(l.lines, total), color: languageColor(l.language) });
      }
    }
    if (other.lines) shares.push({ ...other, percent: percentOf(other.lines, total), color: NEUTRAL_COLOR });
    return shares;
  }

  // "Rust", "Rust and Go", "Rust and 3 more"
  function names(list) {
    if (list.length <= 2) return list.join(' and ');
    return `${list[0]} and ${list.length - 1} more`;
  }

  /** The complexity note in one short line: what is measured, what is not. `languages` are those the line may call measured. */
  function complexityLine(complexity, languages) {
    const c = complexity || {};
    const unmeasured = c.unmeasured || [];
    if (c.status !== 'measured') {
      // 'missing' also means lizard is there but the checkout is off the analysed commit: name the reason's head
      const reason = String(c.reason || '').split(':')[0].trim();
      const why = c.status === 'failed' ? "the tool's check failed"
        : reason && reason.length <= 60 ? reason : 'no tool found';
      return `Complexity: not measured${unmeasured.length ? ` for ${names(unmeasured)}` : ''} (${why})`;
    }
    const measured = (languages || []).map((l) => l.language).filter((l) => l && !unmeasured.includes(l));
    const head = measured.length ? `Complexity: measured for ${names(measured)}` : 'Complexity: measured';
    return unmeasured.length ? `${head}; not measured for ${names(unmeasured)}` : head;
  }

  function gateChip(name, g) {
    const state = g && ['measured', 'pending'].includes(g.state) ? g.state : 'missing';
    const label = state === 'measured' ? `✓ ${capital(name)}${g.value ? ` ${g.value}` : ''}` : `${capital(name)} · ${state}`;
    const title = state === 'measured' ? `Measured by ${g.source || 'the project'}`
      : state === 'pending' ? `Configured in ${g.source || 'the project'}: no report yet`
        : 'Not configured: no evidence, not clean';
    return { name, state, label, title };
  }

  /** The project's own quality gate as three chips: [{ name, state, label, title }], complexity, coverage, duplication. */
  function qualityGateRow(gate) {
    const list = Array.isArray(gate) ? gate : [];
    return GATE_ASPECTS.map((name) => gateChip(name, list.find((g) => g && g.name === name)));
  }

  /** The first sentence of a text, for a one-line summary. */
  function firstSentence(text) {
    const s = String(text || '').replace(/\s+/g, ' ').trim();
    const m = s.match(/^.*?[.!?](?=\s|$)/);
    return m ? m[0] : s;
  }

  const api = {
    SCORE_FORMULA,
    complexityLine,
    filterFindings,
    findingCounts,
    findingScore,
    firstSentence,
    languageColor,
    languageShares,
    qualityGateRow,
    rankFindings,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ArchitectureFactsView = api;
})(typeof window !== 'undefined' ? window : globalThis);
