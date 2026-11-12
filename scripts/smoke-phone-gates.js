// Phone gates mode of the official scratch-workspace smoke. No desktop host or real workflow is
// launched: a sandboxed browser loads the actual gates-only HTTP page with in-memory approvals.
// Usage: npx electron scripts/smoke.js --phone-gates <output-dir>
// Captures both interface languages and recovery states, checks real browser scripts and axe,
// and writes checks.json beside the PNGs. All approved answers belong only to the mock fixture.
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');
const { app, BrowserWindow } = require('electron');
const { phoneGatesFixture } = require('@multiagent/engine/test/fixtures/mobile-gates-page');

async function waitFor(win, expression) {
  for (let i = 0; i < 100; i++) {
    if (await win.webContents.executeJavaScript(`!!(${expression})`)) return;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error(`Phone gates did not reach: ${expression}`);
}

async function runChecks(win) {
  await win.webContents.executeJavaScript(fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));
  const axe = await win.webContents.executeJavaScript('axe.run(document, {runOnly: {type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]}})');
  assert.deepEqual(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(', ')}`), []);
  const layout = await win.webContents.executeJavaScript(`({
    width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    meaningful: !!document.querySelector('[data-testid="phone-gates-page"] h1')?.textContent,
    labels: [...document.querySelectorAll('input')].every(x => !!document.querySelector('label[for="'+x.id+'"]')),
    targets: [...document.querySelectorAll('button:not(:disabled),a.btn')].filter(x=>x.getClientRects().length).every(x=>{const b=x.getBoundingClientRect();return b.width>=44&&b.height>=44})
  })`);
  assert.ok(layout.scrollWidth <= layout.width, 'no page overflow');
  assert.equal(layout.meaningful, true, 'the intended page is not blank');
  assert.ok(win.webContents.getTitle(), 'the page has its intended title');
  assert.equal(layout.labels, true, 'all inputs have labels');
  assert.equal(layout.targets, true, 'primary and recovery targets are at least 44px');
  return { ...layout, axeViolations: axe.violations.length };
}

async function scenarios(win, fixture, out) {
  const results = [];
  const js = (code) => win.webContents.executeJavaScript(code);
  async function capture(name, width = 390) {
    assert.equal(new URL(win.webContents.getURL()).origin, fixture.url, 'the page comes from the scratch server');
    win.setContentSize(width, 844);
    await new Promise((resolve) => setTimeout(resolve, 60));
    const checks = await runChecks(win);
    fs.writeFileSync(path.join(out, name + '.png'), (await win.webContents.capturePage()).toPNG());
    results.push({ name, title: win.webContents.getTitle(), url: new URL(win.webContents.getURL()).pathname, ...checks });
  }
  const openList = async () => { await win.loadURL(fixture.url); await waitFor(win, '!document.getElementById("retry").hidden || !document.getElementById("pairing").hidden'); };
  await openList();
  await capture('01-pairing-en');
  fixture.state.language = 'pt-BR';
  await openList();
  await capture('02-pairing-pt-BR', 320);
  const code = fixture.server.pair().code;
  await js(`document.getElementById('pc').value=${JSON.stringify(code)};document.getElementById('pf').requestSubmit()`);
  await waitFor(win, 'document.querySelector("#gates article")');
  await capture('03-gates-pt-BR');
  await capture('03-gates-360', 360);
  await capture('04-gates-narrow', 320);
  await capture('05-gates-desktop', 900);
  win.setContentSize(390, 844);
  win.webContents.setZoomFactor(2);
  await capture('06-gates-zoom-200');
  win.webContents.setZoomFactor(1);

  await js(`window.originalFetch=window.fetch;window.fetch=async()=>{throw new Error('simulated offline')};document.getElementById('retry').click()`);
  await waitFor(win, 'document.getElementById("msg").getAttribute("role")==="alert"');
  await capture('07-connection-failed');
  await js('window.fetch=window.originalFetch;document.getElementById("retry").click()');
  await waitFor(win, 'document.querySelector("#gates article")');
  await win.loadURL(await js('document.querySelector("#gates a").href'));
  assert.equal(fixture.state.answers.length, 0, 'opening a gate sends no answer');
  await capture('08-gate-details-pt-BR');
  await win.loadURL(await js(`document.querySelector('.btns a[href*="answer=redo"]').href`));
  await capture('08-confirmation-pt-BR');
  await js(`window.originalFetch=window.fetch;window.fetch=async(...args)=>{await window.originalFetch(...args);throw new Error('simulated lost response')};document.getElementById('fb').value='Please verify the narrow-screen captures.';document.getElementById('confirm').requestSubmit()`);
  await waitFor(win, '!document.getElementById("recover").hidden');
  assert.equal(await js('document.activeElement.id'), 'msg');
  assert.equal(fixture.state.answers.length, 1);
  await js('document.getElementById("confirm").requestSubmit()');
  assert.equal(fixture.state.answers.length, 1, 'no replay of an uncertain answer');
  await capture('09-answer-unknown');
  await win.loadURL(await js('document.getElementById("recover").href'));
  await capture('10-gate-ended');
  fixture.state.open = true;
  const expired = fixture.link();
  fixture.state.time += 31 * 60000;
  await win.loadURL(expired);
  await capture('11-link-expired');
  fixture.server.revoke(fixture.server.devices()[0].id);
  await openList();
  await capture('12-pairing-revoked');
  fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ simulated: true, confirmedAnswers: fixture.state.answers.length, captures: results }, null, 2));
}

async function run() {
  process.env.MULTIAGENT_SIMULATION_ONLY = '1';
  const out = path.resolve(process.argv.slice(process.argv.indexOf('--phone-gates') + 1)[0] || 'phone-gates-captures');
  const fixture = await phoneGatesFixture();
  const userData = path.join(require('os').tmpdir(), `phone-gates-user-data-${process.pid}`);
  fs.mkdirSync(userData, { recursive: true });
  app.setPath('userData', userData);
  const timeout = setTimeout(() => { console.error('phone-gates smoke: timed out'); app.exit(1); }, 90000);
  let win;
  let exitCode = 0;
  const consoleErrors = [];
  try {
    await app.whenReady();
    fs.mkdirSync(out, { recursive: true });
    win = new BrowserWindow({ show: false, width: 390, height: 844, useContentSize: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    win.webContents.on('console-message', (event) => { if (event.level === 'error') consoleErrors.push(event.message); });
    await scenarios(win, fixture, out);
    const unexpected = consoleErrors.filter((error) => !/Failed to load resource.*\b(401|403)\b/.test(error));
    assert.deepEqual(unexpected, [], 'no browser script or CSP errors');
    fs.writeFileSync(path.join(out, 'console.json'), JSON.stringify({ expectedHttpErrors: consoleErrors, unexpected }, null, 2));
    console.log(`phone-gates smoke: passed; screenshots and checks in ${out}`);
  } catch (error) {
    console.error(error.stack);
    console.error(JSON.stringify({ consoleErrors }));
    exitCode = 1;
  } finally {
    clearTimeout(timeout);
    win?.destroy();
    await fixture.close();
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    app.exit(exitCode);
  }
}

module.exports = { run };
