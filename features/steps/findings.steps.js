// Steps of features/findings.feature (#361): the Findings button for development. The button
// ([data-testid="findings-button"], also Ctrl+Shift+F) shows when the app runs from source (as in the
// E2E app) or when Settings › General › "Findings button" is on. It freezes the view in an overlay
// ([data-testid="findings-overlay"]) with a marking toolbar ([data-testid="findings-toolbar"],
// tools findings-tool-<name>), the frozen picture ([data-testid="findings-canvas"]: a click with the
// pin tool places a numbered [data-testid="findings-pin"]), a note (findings-note), Save
// (findings-save), File as issue (findings-file-issue) and Cancel (findings-cancel); its state line is
// [data-testid="findings-status"]. Settings › General lists the saved findings in
// [data-testid="settings-findings-list"], one list item per finding with its note and status.
// Locators are roles and data-testid only (skills/ui-conventions).

const fs = require('fs');
const os = require('os');
const path = require('path');
const { expect } = require('@playwright/test');
const { Given, When, Then } = require('./fixtures');
const { servedEnv, startServer } = require('../support/served');

const overlay = (page) => page.getByTestId('findings-overlay');
const toolbar = (page) => overlay(page).getByTestId('findings-toolbar');
const canvas = (page) => overlay(page).getByTestId('findings-canvas');
const pins = (page) => overlay(page).getByTestId('findings-pin');
const findingsList = (page) => page.getByTestId('settings-findings-list');
// "1, 2, 3" → ['1', '2', '3']
const listOf = (text) => text.split(',').map((s) => s.trim()).filter(Boolean);

When('I open the findings view', async ({ e2e }) => {
  await e2e.window.getByTestId('findings-button').click();
  await expect(overlay(e2e.window)).toBeVisible();
});

Then('the findings toolbar offers the tools {string}', async ({ e2e }, tools) => {
  await expect(toolbar(e2e.window)).toBeVisible();
  for (const tool of listOf(tools)) await expect(toolbar(e2e.window).getByTestId(`findings-tool-${tool.toLowerCase()}`)).toBeVisible();
});

When('I choose the {string} marking tool', async ({ e2e }, tool) => {
  await toolbar(e2e.window).getByTestId(`findings-tool-${tool.toLowerCase()}`).click();
});

// distinct spots across the middle of the frozen picture
When('I place {int} pin(s) on the frozen view', async ({ e2e }, count) => {
  const box = await canvas(e2e.window).boundingBox();
  expect(box, 'the frozen picture is in view').toBeTruthy();
  for (let i = 0; i < count; i++) {
    await canvas(e2e.window).click({ position: { x: Math.round(box.width * (0.2 + 0.2 * i)), y: Math.round(box.height * 0.5) } });
  }
  await expect(pins(e2e.window)).toHaveCount(count);
});

Then('the frozen view shows the pins numbered {string}', async ({ e2e }, numbers) => {
  const expected = listOf(numbers);
  await expect(pins(e2e.window)).toHaveCount(expected.length);
  await expect(pins(e2e.window)).toHaveText(expected);
});

When('I write the finding note {string}', async ({ e2e }, note) => {
  await overlay(e2e.window).getByTestId('findings-note').fill(note);
});

When('I save the finding', async ({ e2e }) => {
  await overlay(e2e.window).getByTestId('findings-save').click();
});

When('I file the finding as an issue', async ({ e2e }) => {
  await overlay(e2e.window).getByTestId('findings-file-issue').click();
});

Then('the findings view says {string}', async ({ e2e }, text) => {
  await expect(overlay(e2e.window).getByTestId('findings-status')).toContainText(text);
});

Then('the findings view offers {string}', async ({ e2e }, name) => {
  await expect(overlay(e2e.window).getByRole('button', { name, exact: true })).toBeVisible();
});

When('I close the findings view', async ({ e2e }) => {
  await e2e.window.keyboard.press('Escape');
  await expect(overlay(e2e.window)).toBeHidden();
});

Then('the findings view is closed', async ({ e2e }) => {
  await expect(overlay(e2e.window)).toBeHidden();
});

Then('the findings list shows the finding {string} as {string}', async ({ e2e }, note, status) => {
  const item = findingsList(e2e.window).getByRole('listitem').filter({ hasText: note });
  await expect(item).toHaveCount(1);
  await expect(item).toContainText(status);
});

Then('the findings list has no finding', async ({ e2e }) => {
  await expect(findingsList(e2e.window)).toBeVisible();
  await expect(findingsList(e2e.window).getByRole('listitem')).toHaveCount(0);
});

// ---- #751: Findings against a remote engine (features/751-findings-remote-capture.feature) ----------
// The served engine and its browser UI come from features/support/served.js ("Given the engine is
// served on this machine" and "When I open the served UI in the browser", engine-version.steps.js).
// The desktop app in remote mode: the same engine server (servedEnv/startServer) and launchApp with a
// user data folder (MULTIAGENT_USER_DATA) whose engine-connection.json points at it.
// New data-testids (#751):
//   findings-frozen-image    the frozen picture (<img class="fd-img">), only when a capture was taken
//   findings-capture-error   the overlay's message that the capture failed (interface language)
//   findings-frame-label     the frame's label ("Frozen view · WxH" / "Visão congelada · WxH")

const LOAD_TIMEOUT = 30000;
const LANGUAGE_CODES = { English: 'en', 'Português (Brasil)': 'pt-BR' };
// the English texts #751 found in the Portuguese overlay
const ENGLISH_CAPTURE_ERROR = /Could not capture the window|only available in the desktop app/i;
// a capture of the app has many colours; the blank picture is a single #111827 fill
const MIN_COLOURS = 8;

const frozenImage = (page) => overlay(page).getByTestId('findings-frozen-image');
const captureError = (page) => overlay(page).getByTestId('findings-capture-error');

function removeScratch(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch { /* EBUSY: the OS temp folder cleans it */ }
}

// a call to an engine server's HTTP API (Authorization: Bearer <the served URL's token>)
async function callEngineAt(servedUrl, channel, arg) {
  const url = new URL(servedUrl);
  const token = url.searchParams.get('token');
  const res = await fetch(`${url.origin}/api/${encodeURIComponent(channel)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ arg: arg === undefined ? null : arg }),
  });
  const body = await res.json().catch(() => ({}));
  expect(res.status, `${channel} answered ${res.status}: ${JSON.stringify(body).slice(0, 300)}`).toBe(200);
  return body.result;
}

function engineUrl(e2e) {
  expect(e2e.url, 'an engine server runs in this scenario').toBeTruthy();
  return e2e.url;
}

// a picture (data URL, blob URL or address) decoded in the page → { width, height, colours }; colours
// counts the distinct colours of a 200×200 sample, up to 64
async function pictureOf(page, src) {
  return page.evaluate(async (source) => {
    const img = new Image();
    img.src = source;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 200;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, c.width, c.height);
    const data = g.getImageData(0, 0, c.width, c.height).data;
    const seen = new Set();
    for (let i = 0; i < data.length && seen.size < 64; i += 4) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return { width: img.naturalWidth, height: img.naturalHeight, colours: seen.size };
  }, src);
}

Given('the served engine shows the Findings button', async ({ e2e }) => {
  await callEngineAt(engineUrl(e2e), 'settings:set', { findingsButton: true });
});

Given('the served engine\'s interface language is {string}', async ({ e2e }, language) => {
  const code = LANGUAGE_CODES[language];
  expect(code, `a known interface language (${Object.keys(LANGUAGE_CODES).join(', ')})`).toBeTruthy();
  const settings = await callEngineAt(engineUrl(e2e), 'settings:get');
  await callEngineAt(engineUrl(e2e), 'settings:set', { language: { ...(settings?.language || {}), interface: code } });
});

// before the page loads: the window.api the page assigns gets a captureWindow that rejects
Given('the browser cannot capture the page', async ({ e2e }) => {
  await e2e.window.addInitScript(() => {
    let current;
    const refuse = async () => { throw new Error('e2e: the capture failed'); };
    Object.defineProperty(window, 'api', {
      configurable: true,
      get: () => current,
      set: (value) => {
        current = value && new Proxy(value, { get: (target, key, receiver) => (key === 'captureWindow' ? refuse : Reflect.get(target, key, receiver)) });
      },
    });
  });
});

// an engine server (simulation, its own scratch workspace) and the desktop app pointed at it: the
// app's user data holds engine-connection.json { mode: 'remote', address, token: { plain } }
Given('the desktop app is open in remote mode on an engine served on this machine', async ({ e2e }) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'multiagent-e2e-remote-'));
  let server = null;
  const stop = () => {
    if (server) server.child.kill();
    removeScratch(scratch);
  };
  try {
    server = await startServer(scratch, servedEnv(scratch, { size: '1400x900' }));
    // a new workspace opens the first-run Setup (#319) over every page
    await callEngineAt(server.url, 'settings:set', { setupDone: true, findingsButton: true });
    const url = new URL(server.url);
    const userData = path.join(scratch, 'desktop-user-data');
    fs.mkdirSync(userData, { recursive: true });
    fs.writeFileSync(path.join(userData, 'engine-connection.json'), `${JSON.stringify({ mode: 'remote', address: url.origin, token: { plain: url.searchParams.get('token') } }, null, 2)}\n`);
    await e2e.open({ env: { MULTIAGENT_USER_DATA: userData } });
  } catch (e) {
    stop();
    throw e;
  }
  const closeApp = e2e.close;
  e2e.close = async () => {
    await closeApp();
    stop();
  };
  e2e.url = server.url;
  // the window onto the remote engine: the one whose page shows the Findings button
  const remoteWindow = async () => {
    for (const win of e2e.app.windows()) {
      if (win.isClosed()) continue;
      if (await win.getByTestId('findings-button').isVisible().catch(() => false)) return win;
    }
    return null;
  };
  await expect.poll(async () => !!(await remoteWindow()), { timeout: LOAD_TIMEOUT, message: 'the remote engine\'s page loaded with the Findings button' }).toBe(true);
  e2e.window = await remoteWindow();
});

Then('the window title says it runs on the remote engine', async ({ e2e }) => {
  const { port } = new URL(engineUrl(e2e));
  await expect(e2e.window).toHaveTitle(new RegExp(`engine on 127\\.0\\.0\\.1:${port}`));
});

Then('the frozen view shows the captured page', async ({ e2e }) => {
  const img = frozenImage(e2e.window);
  await expect(img).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect.poll(() => img.evaluate((el) => el.complete && el.naturalWidth > 0 && el.naturalHeight > 0), { message: 'the frozen picture loaded' }).toBe(true);
  const src = await img.getAttribute('src');
  expect(src, 'the frozen picture has a source').toBeTruthy();
  const picture = await pictureOf(e2e.window, src);
  expect(picture.colours, 'the frozen picture is the captured page, not a blank picture').toBeGreaterThanOrEqual(MIN_COLOURS);
});

Then('the findings view shows no capture error', async ({ e2e }) => {
  await expect(overlay(e2e.window)).toBeVisible();
  await expect(captureError(e2e.window)).toHaveCount(0);
  await expect(overlay(e2e.window).getByTestId('findings-status')).not.toHaveText(ENGLISH_CAPTURE_ERROR);
});

Then('the findings view shows no English capture error', async ({ e2e }) => {
  await expect(overlay(e2e.window)).toBeVisible();
  await expect(overlay(e2e.window)).not.toContainText(ENGLISH_CAPTURE_ERROR);
});

Then('the findings view says the capture failed with {string}', async ({ e2e }, text) => {
  await expect(captureError(e2e.window)).toBeVisible({ timeout: LOAD_TIMEOUT });
  await expect(captureError(e2e.window)).toContainText(text);
  await expect(overlay(e2e.window)).not.toContainText(ENGLISH_CAPTURE_ERROR);
  // nothing was captured: the marks go on a blank picture
  await expect(frozenImage(e2e.window)).toHaveCount(0);
});

Then('the frozen view\'s label reads {string}', async ({ e2e }, text) => {
  await expect(overlay(e2e.window).getByTestId('findings-frame-label')).toContainText(text);
});

Then('the findings view shows none of the English labels {string}', async ({ e2e }, labels) => {
  const english = listOf(labels);
  const tools = toolbar(e2e.window).locator('[data-testid^="findings-tool-"]');
  await expect(tools).toHaveCount(5);
  for (const name of await tools.allTextContents()) expect(english, `the tool "${name.trim()}" is translated`).not.toContain(name.trim());
  const marks = overlay(e2e.window).getByTestId('findings-marks');
  const empty = (await marks.getAttribute('data-empty')) || '';
  expect(english, `the empty marks list "${empty}" is translated`).not.toContain(empty.trim());
  for (const label of english) await expect(overlay(e2e.window).getByText(label, { exact: true })).toHaveCount(0);
});

// the engine's findings folder (findings:list gives its dir) holds the capture as screenshot.png
Then('the saved finding {string} carries the captured page', async ({ e2e }, note) => {
  const list = await callEngineAt(engineUrl(e2e), 'findings:list');
  const found = (list || []).filter((f) => f.note === note);
  expect(found, `one saved finding with the note "${note}"`).toHaveLength(1);
  const file = path.join(found[0].dir, 'screenshot.png');
  expect(fs.existsSync(file), `${file} exists`).toBe(true);
  const picture = await pictureOf(e2e.window, `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`);
  expect(picture.width, 'the saved screenshot has a width').toBeGreaterThan(0);
  expect(picture.height, 'the saved screenshot has a height').toBeGreaterThan(0);
  expect(picture.colours, 'the saved screenshot is the captured page, not a blank picture').toBeGreaterThanOrEqual(MIN_COLOURS);
});
