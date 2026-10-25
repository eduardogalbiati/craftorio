// The deterministic checks of a captured screen (#387), run by scripts/screenshot.js right after the
// capture, in the same window state: axe-core's `color-contrast` and `target-size` rules
// (src/domains/evidence/ui-review-checks.js AXE_RULES) and the markup of the visible native controls (<select>, date
// and datetime-local fields, each as its bare start tag). Written next to the PNG as
// `<name>.<side>.checks.json` ({ axe: { violations }, html }); src/engine/screenshot-step.js turns
// both sides into the ui_reviewer's `axe_findings`. A check that cannot run writes its `error`
// instead: the capture never fails because of it.

const fs = require('fs');
const { AXE_RULES, checksPath } = require('../../src/domains/evidence/ui-review-checks');

// the page script: axe on the document, then the visible native controls' start tags
const pageScript = (axeSource) => `(async () => {
  ${axeSource}
  const r = await window.axe.run(document, { runOnly: { type: 'rule', values: ${JSON.stringify(Object.keys(AXE_RULES))} }, resultTypes: ['violations'] });
  const violations = r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target, failureSummary: n.failureSummary })) }));
  const html = [...document.querySelectorAll('select, input[type=date], input[type=datetime-local]')]
    .filter((el) => el.getClientRects().length).map((el) => el.cloneNode(false).outerHTML).join('\\n');
  return { axe: { violations }, html };
})()`;

// webContents: the captured window's; png: the image just written → the checks file's path
async function writeChecks(webContents, png) {
  let result;
  try {
    const source = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
    result = await webContents.executeJavaScript(pageScript(source));
  } catch (e) {
    result = { error: `the checks did not run: ${e.message}` };
  }
  const file = checksPath(png);
  fs.writeFileSync(file, JSON.stringify(result, null, 2));
  return file;
}

module.exports = {
  writeChecks,
};
