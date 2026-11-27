// The simulated Product Owner's epics section (#138; moved out of packages/engine/domains/po/product-owner.js with #90, which
// is at its size ceiling): an open issue without an epic joins the epic whose members share its theme (its `area:`
// label, else its first topic label); themes of two or more issues without an epic become new epics.

function mockEpics(data) {
  const issues = (data?.issues || []).filter((i) => i.state === 'open' && !i.isEpic);
  const theme = (i) => {
    const names = (i.labels || []).map((l) => l.name).filter((n) => !/^(complexity|impact|epic)\b/i.test(n) && !/^(bug|enhancement|feature|documentation)$/i.test(n));
    return names.find((n) => /^area[:/]/i.test(n)) || names[0] || null;
  };
  const place = [];
  const loose = issues.filter((i) => !i.epic);
  for (const e of data?.epics || []) {
    const themes = new Set(issues.filter((i) => i.epic === e.id).map(theme).filter(Boolean));
    for (const i of loose) {
      if (theme(i) && themes.has(theme(i)) && !place.some((p) => p.issue === i.number)) place.push({ issue: i.number, epic: e.id, reason: `Shares the theme ${theme(i)} with the epic's members (simulated).` });
    }
  }
  const byTheme = new Map();
  for (const i of loose.filter((x) => !place.some((p) => p.issue === x.number))) {
    const t = theme(i);
    if (!t) continue;
    if (!byTheme.has(t)) byTheme.set(t, []);
    byTheme.get(t).push(i.number);
  }
  const title = (t) => { const s = t.replace(/^area[:/]\s*/i, '').replace(/[-_]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
  const create = [...byTheme].filter(([, ns]) => ns.length >= 2)
    .map(([t, ns]) => ({ title: title(t), goal: `The open issues about ${title(t).toLowerCase()} (label ${t}), tracked together (simulated).`, issues: ns }));
  return { place, create, merge: [], split: [] };
}

module.exports = {
  mockEpics,
};
