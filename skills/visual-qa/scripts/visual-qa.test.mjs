import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setupPassed } from './visual-qa.mjs';

const ready = {
  playwright: true,
  chromium: true,
  ffmpeg: true,
  config: true,
  logins: { acme: { secrets: true, signedIn: true } },
};

test('setupPassed needs Playwright, Chromium, ffmpeg, the config, and every login', () => {
  assert.equal(setupPassed(ready), true);
  assert.equal(setupPassed({ ...ready, logins: {} }), true);
  for (const key of ['playwright', 'chromium', 'ffmpeg', 'config']) {
    assert.equal(setupPassed({ ...ready, [key]: false }), false, key);
  }
  const notSignedIn = { ...ready, logins: { acme: { secrets: true, signedIn: false } } };
  assert.equal(setupPassed(notSignedIn), false);
});
