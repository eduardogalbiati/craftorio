// #603 acceptance: the shell shows a small "disconnected, reconnecting…" indicator while the pushed
// channel (the WebSocket of the remote-engine window and the web UI) is down, and clears it when the
// channel is back. Never a modal: the page stays usable.
//
// Driven through the page's own seam: the whole page loaded by test/renderer-app-harness.js (the
// page's scripts in a vm sandbox, a fake DOM that records what the scripts write), with a fake
// window.api whose connection state the test drives.
//
// The interface these tests expect (the developer implements it; this file is not edited):
// - The shell subscribes with `window.api.onConnectionChange(cb)` (the browser client's,
//   apps/web/renderer/api-http.js: `cb(connected)`, connected a boolean; see
//   apps/web/test/ws-watchdog-603.test.js) when the api has it, and may read `api.connected`. The
//   desktop app's IPC api (preload) has no such channel to lose: without onConnectionChange the shell
//   shows nothing.
// - `cb(false)`: an element with `data-testid="connection-status"` is shown (created by the script,
//   or one of index.html the script un-hides), not a <dialog> nor a modal; its text says the channel
//   is reconnecting (matches /reconnecting/i, e.g. "Disconnected, reconnecting…", from the
//   catalogs).
// - `cb(true)`: the indicator is gone (removed, or hidden: the `hidden` attribute/property, the
//   `hidden` class or display: none).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { loadApp, text, RENDERER } = require('./renderer-app-harness');
const { pageFile } = require('../../../scripts/source-tree');

const TESTID = 'connection-status';

async function openPage() {
  const handlers = [];
  const page = loadApp({
    api: {
      connected: true,
      onConnectionChange: (cb) => { handlers.push(cb); return () => {}; },
    },
  });
  await page.boot();
  const setConnected = async (connected) => {
    for (const cb of handlers) cb(connected);
    await page.settle(20);
  };
  return { page, handlers, setConnected };
}

const hasTestid = (el) => el.attrs?.['data-testid'] === TESTID || el.dataset?.testid === TESTID;
const hiddenEl = (el) => !!el.hidden || 'hidden' in (el.attrs || {}) || el.classList?.contains?.('hidden') || el.style?.display === 'none' || el.isConnected === false;
// the opening tag of the element with the testid inside some markup ('' when there is none)
const tagIn = (html) => (new RegExp(`<[^>]*data-testid=["']${TESTID}["'][^>]*>`).exec(String(html || '')) || [''])[0];
const tagHidden = (tag) => /\shidden(\s|>|=)/.test(tag) || /class=["'][^"']*\bhidden\b/.test(tag) || /display:\s*none/.test(tag);
// the text right after the opening tag, up to the next tag
const textAfter = (html, tag) => text(String(html).slice(String(html).indexOf(tag) + tag.length).split('<')[0]);

// The indicator as primitives: { shown, text, tags } (tags: the tag names of what was found).
function indicator(page) {
  const found = [];
  // an element the script created, or the one it reached with a selector naming it
  for (const el of page.created) if (hasTestid(el)) found.push({ shown: !hiddenEl(el), text: text(el.textContent || el.innerText || el.innerHTML || el.title), tag: el.tagName });
  for (const [sel, el] of page.elements) {
    if (String(sel).includes(TESTID) || hasTestid(el)) found.push({ shown: !hiddenEl(el), text: text(el.textContent || el.innerText || el.innerHTML || el.title), tag: el.tagName, sel });
  }
  // markup written into an element
  for (const el of [...page.elements.values(), ...page.created]) {
    for (const html of [el.innerHTML, ...(el.inserted || []).map(([, h]) => h)]) {
      const tag = tagIn(html);
      if (tag) found.push({ shown: !hiddenEl(el) && !tagHidden(tag), text: textAfter(html, tag), tag: (/^<(\w+)/.exec(tag) || [])[1]?.toUpperCase() || '' });
    }
  }
  const shown = found.filter((f) => f.shown);
  return { shown: shown.length > 0, text: shown.map((f) => f.text).join(' ').trim(), tags: shown.map((f) => f.tag) };
}

// the text index.html gives the element (when the script only un-hides it): its inner text or its data-i18n key's English text
function staticText() {
  const html = fs.readFileSync(pageFile(path.join(RENDERER, '..', '..', '..'), 'index.html'), 'utf8');
  const tag = tagIn(html);
  if (!tag) return '';
  const key = /data-i18n=["']([^"']+)["']/.exec(tag)?.[1];
  if (key) {
    const en = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'shared', 'i18n', 'en.json'), 'utf8'));
    return String(en[key] || '');
  }
  return textAfter(html, tag);
}

test('#603 the pushed channel down: the shell shows a "reconnecting" indicator, not a modal', async () => {
  const { page, handlers, setConnected } = await openPage();
  assert.ok(handlers.length >= 1, 'the shell did not subscribe with api.onConnectionChange');
  await setConnected(false);
  const ind = indicator(page);
  assert.equal(ind.shown, true, `no visible [data-testid="${TESTID}"] while the channel is down`);
  assert.match(ind.text || staticText(), /reconnecting/i, 'the indicator does not say it is reconnecting');
  assert.ok(!ind.tags.includes('DIALOG'), 'the indicator is a dialog');
});

test('#603 the pushed channel back: the indicator clears', async () => {
  const { page, handlers, setConnected } = await openPage();
  assert.ok(handlers.length >= 1, 'the shell did not subscribe with api.onConnectionChange');
  await setConnected(false);
  assert.equal(indicator(page).shown, true, 'no indicator while the channel is down');
  await setConnected(true);
  assert.equal(indicator(page).shown, false, 'the indicator is still shown once the channel is back');
  // down again, back again: the same indicator comes and goes
  await setConnected(false);
  assert.equal(indicator(page).shown, true, 'no indicator the second time the channel goes down');
  await setConnected(true);
  assert.equal(indicator(page).shown, false);
});
