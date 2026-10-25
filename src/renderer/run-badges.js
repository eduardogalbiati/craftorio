// What every run list shows of a run besides its status (#84): its display title (the owner's,
// else the issue or the task's first line, as packages/engine/domains/run/run-pr.js computes it) and the PR it opened, a
// pull-request glyph coloured by the PR state with its number as a link. Pure (no DOM): app.js,
// views/runchat/runchat.js and views/backlog/backlog.js draw with it, and it loads in node for tests.
// load: early (app.js draws its run lists with it)
(function (root) {
  // state (packages/engine/domains/run/run-pr.js) → words for the tooltip; null: not read yet
  const PR_STATES = {
    closed: 'closed without merge',
    conflict: 'conflict with its base',
    draft: 'draft',
    failing: 'checks failing',
    merged: 'merged',
    open: 'open',
    pending: 'open, checks running',
    ready: 'ready to merge',
    unknown: 'state unknown',
  };

  // git-pull-request (Octicons, MIT)
  const PR_GLYPH = '<svg class="run-pr-glyph" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>';

  const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  // The tooltip: the state in words and when it was checked.
  function prTooltip(pr) {
    const words = pr.state ? PR_STATES[pr.state] || pr.state : 'checking the state…';
    const detail = pr.detail && pr.state !== 'unknown' ? `: ${pr.detail}` : pr.detail ? ` (${pr.detail})` : '';
    // #273: in the owner's zone (time-zone.js; in node, the computer's)
    const timeZone = typeof TimeZone !== 'undefined' ? TimeZone.current() : undefined;
    const at = pr.checkedAt ? ` · checked ${new Date(pr.checkedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZone })}` : '';
    return `PR #${pr.number ?? '?'}: ${words}${detail}${at}`;
  }

  // The PR glyph in the state's colour and "#66" linking to the PR (data-pr-url: app.js opens it
  // in the browser without selecting or expanding the run around it). '' without a PR.
  function prBadgeHtml(pr, { compact = false } = {}) {
    if (!pr || (!pr.url && !pr.number)) return '';
    const st = pr.state || 'checking';
    const num = pr.number != null ? `#${pr.number}` : 'PR';
    const warn = pr.state === 'conflict' ? '<span class="run-pr-warn" aria-hidden="true">!</span>' : '';
    const label = `<span class="run-pr-num">${escHtml(num)}</span>`;
    const tip = escHtml(prTooltip(pr));
    const cls = `run-pr run-pr-${escHtml(st)}${compact ? ' compact' : ''}`;
    return pr.url
      ? `<a class="${cls}" href="${escHtml(pr.url)}" target="_blank" rel="noopener" data-pr-url="${escHtml(pr.url)}" title="${tip}">${PR_GLYPH}${warn}${label}</a>`
      : `<span class="${cls}" title="${tip}">${PR_GLYPH}${warn}${label}</span>`;
  }

  // The default title (same rule as packages/engine/domains/run/run-pr.js defaultTitle): the issue(s), else the first line
  // of the task. r: a run list item or a window run view ({ issues, task?, inputs? }).
  function defaultTitle(r) {
    const issues = r?.issues || (r?.issue ? [r.issue] : []);
    if (issues.length) {
      const head = `#${issues[0].number}${issues[0].title ? ` ${issues[0].title}` : ''}`;
      return issues.length > 1 ? `${head} (+${issues.length - 1})` : head;
    }
    const task = r?.task ?? r?.inputs?.task;
    const line = String(task || '').split('\n').map((l) => l.trim()).find(Boolean);
    return line ? line.slice(0, 120) : null;
  }

  const api = { PR_STATES, defaultTitle, prBadgeHtml, prTooltip };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RunBadges = api;
})(typeof window !== 'undefined' ? window : globalThis);
