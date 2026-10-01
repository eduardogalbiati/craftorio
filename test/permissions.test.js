// src/permissions.js: the only web permission the app's window grants (voice input, #82) is the
// microphone, and only for the app's own page.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const { allowPermission, isAppPage } = require('../src/permissions');

const APP_PAGE = path.join(__dirname, '..', 'src', 'renderer', 'index.html');
const appUrl = (suffix = '') => `${pathToFileURL(APP_PAGE).href}${suffix}`;

test('allowPermission: grants audio-only media requested from the app page', () => {
  assert.equal(allowPermission('media', { requestingUrl: appUrl(), mediaTypes: ['audio'] }, APP_PAGE), true);
});

test('allowPermission: denies video, even alongside audio, and even from the app page', () => {
  assert.equal(allowPermission('media', { requestingUrl: appUrl(), mediaTypes: ['video'] }, APP_PAGE), false);
  assert.equal(allowPermission('media', { requestingUrl: appUrl(), mediaTypes: ['audio', 'video'] }, APP_PAGE), false);
});

test('allowPermission: denies every other permission, even from the app page', () => {
  for (const permission of ['geolocation', 'notifications', 'camera', 'clipboard-read']) {
    assert.equal(allowPermission(permission, { requestingUrl: appUrl(), mediaTypes: ['audio'] }, APP_PAGE), false);
  }
});

test('allowPermission: denies media from any other file: page, and from http(s)', () => {
  const otherFile = path.join(__dirname, '..', 'src', 'renderer', 'other.html');
  assert.equal(allowPermission('media', { requestingUrl: pathToFileURL(otherFile).href, mediaTypes: ['audio'] }, APP_PAGE), false);
  assert.equal(allowPermission('media', { requestingUrl: 'https://example.com/', mediaTypes: ['audio'] }, APP_PAGE), false);
});

test('allowPermission: accepts the permission-check shape (mediaType, singular) too', () => {
  assert.equal(allowPermission('media', { requestingUrl: appUrl(), mediaType: 'audio' }, APP_PAGE), true);
  assert.equal(allowPermission('media', { requestingUrl: appUrl(), mediaType: 'video' }, APP_PAGE), false);
});

test('isAppPage: a hash or a query string on the URL is still the app page', () => {
  assert.equal(isAppPage(appUrl('#settings'), APP_PAGE), true);
  assert.equal(isAppPage(appUrl('?tab=general'), APP_PAGE), true);
});

test('isAppPage: an invalid URL is not the app page (no throw)', () => {
  assert.equal(isAppPage('not a url', APP_PAGE), false);
  assert.equal(isAppPage('', APP_PAGE), false);
});
