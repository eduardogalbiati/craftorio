// The simulated Product Owner's placement on shared files (packages/engine/domains/po/product-owner.js mockAnswer): two
// groups of one stage whose issues name the same hot file of the conflict map (#150), or the same
// feature file both add scenarios to (#380), go to different stages; each move is a conflict naming
// the shared files.

// a feature file (Gherkin scenarios) named in an issue's text, e.g. features/architecture.feature
const FEATURE_FILE = /(?:[\w.-]+\/)*[\w.-]+\.feature\b/g;

const textOf = (i) => `${i?.title || ''}\n${i?.body || ''}`;

// #150 (simulated): a group whose issues name a hot file another group of its stage names moves to the
// next stage without it; each move is a conflict naming the shared hot files. Mutates `planned`.
// `what`: what the shared files are, for the reason (#380: also the feature files both add scenarios to).
function separateHotFiles(planned, hotFiles, issues, what = 'a hot file of the conflict map') {
  const conflicts = [];
  if (!hotFiles.length) return conflicts;
  const textOfGroup = (nums) => nums.map((n) => issues.find((i) => i.number === n)).map(textOf).join('\n');
  const byStage = new Map();
  for (const g of planned) {
    const files = hotFiles.filter((f) => textOfGroup(g.issues).includes(f));
    if (!files.length) continue;
    g.files = [...new Set([...g.files, ...files])];
    for (;;) {
      const clash = (byStage.get(g.stage) || []).find((o) => o.files.some((f) => files.includes(f)));
      if (!clash) break;
      const shared = clash.files.filter((f) => files.includes(f));
      conflicts.push({ issues: [...clash.group.issues, ...g.issues], reason: `Both touch ${shared.join(', ')}, ${what}: run them in different stages (simulated).`, files: shared });
      g.stage += 1;
    }
    byStage.set(g.stage, [...(byStage.get(g.stage) || []), { group: g, files }]);
  }
  return conflicts;
}

// #380 (simulated): the hot files first, then the feature files the issues name (those not already hot).
function separateSharedFiles(planned, hotFiles, issues) {
  const conflicts = separateHotFiles(planned, hotFiles, issues);
  const featureFiles = [...new Set(issues.flatMap((i) => textOf(i).match(FEATURE_FILE) || []))].filter((f) => !hotFiles.includes(f));
  return [...conflicts, ...separateHotFiles(planned, featureFiles, issues, 'a feature file both add scenarios to')];
}

module.exports = {
  separateHotFiles,
  separateSharedFiles,
};
