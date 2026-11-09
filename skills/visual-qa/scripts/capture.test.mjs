import assert from 'node:assert/strict';
import { test } from 'node:test';
import { productionTarget } from './config.mjs';
import {
  isSafeName,
  isSecretField,
  mayTypePassword,
  redactMessage,
  validateScenario,
  withCurrent,
} from './capture.mjs';

const good = {
  name: 'list-filter',
  start: '/',
  viewport: { width: 1280, height: 800 },
  steps: [
    { do: 'click', target: 'role=button[name="Filter"]' },
    { do: 'fill', target: 'input[name=search]', value: 'demo' },
    { do: 'press', key: 'Enter' },
    { do: 'waitFor', target: 'text=Results' },
    { do: 'goto', path: '/settings' },
    { do: 'wait', ms: 500 },
    { do: 'screenshot', name: 'filtered' },
  ],
};

test('validateScenario accepts a good scenario', () => {
  assert.deepEqual(validateScenario(good), []);
});

test('validateScenario rejects a bad name', () => {
  assert.ok(validateScenario({ ...good, name: '../escape' }).length > 0);
  assert.ok(validateScenario({ ...good, name: 'Has Caps' }).length > 0);
});

test('validateScenario rejects a bad screenshot name', () => {
  const steps = [{ do: 'screenshot', name: '../../x' }];
  assert.ok(validateScenario({ ...good, steps }).length > 0);
});

test('validateScenario rejects // and backslash paths', () => {
  assert.ok(validateScenario({ ...good, start: '//evil.example' }).length > 0);
  assert.ok(
    validateScenario({ ...good, steps: [{ do: 'goto', path: '//evil.example' }] }).length > 0,
  );
  assert.ok(
    validateScenario({ ...good, steps: [{ do: 'goto', path: '/\\evil.example' }] }).length > 0,
  );
  assert.ok(validateScenario({ ...good, start: 'settings' }).length > 0);
});

test('validateScenario rejects an unknown step', () => {
  assert.ok(validateScenario({ ...good, steps: [{ do: 'eval', code: '1' }] }).length > 0);
});

test('validateScenario rejects a long wait', () => {
  assert.ok(validateScenario({ ...good, steps: [{ do: 'wait', ms: 10001 }] }).length > 0);
  assert.deepEqual(validateScenario({ ...good, steps: [{ do: 'wait', ms: 10000 }] }), []);
});

test('validateScenario rejects a non-object', () => {
  assert.ok(validateScenario(null).length > 0);
  assert.ok(validateScenario([]).length > 0);
});

test('isSafeName only allows lowercase, digits, hyphens', () => {
  assert.equal(isSafeName('a-1'), true);
  assert.equal(isSafeName('a/b'), false);
  assert.equal(isSafeName(''), false);
});

test('isSecretField', () => {
  assert.equal(isSecretField({ type: 'password' }), true);
  assert.equal(isSecretField({ type: 'PASSWORD' }), true);
  assert.equal(isSecretField({ type: 'text', autocomplete: 'current-password' }), true);
  assert.equal(isSecretField({ type: 'text', autocomplete: 'new-password' }), true);
  assert.equal(isSecretField({ type: 'text', autocomplete: 'one-time-code' }), true);
  assert.equal(isSecretField({ type: 'text', autocomplete: 'section-a current-password' }), true);
  assert.equal(isSecretField({ type: 'text', autocomplete: 'email' }), false);
  assert.equal(isSecretField({ type: null, autocomplete: null }), false);
  assert.equal(isSecretField({}), false);
});

const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const KEY = 'acme/app/deploy-preview';
const preview = { login: 'acme' };

test('mayTypePassword refuses a missing record', () => {
  assert.equal(mayTypePassword({ preview, previewKey: KEY, record: undefined, head: HEAD }), false);
});

test('mayTypePassword refuses a record for another commit', () => {
  const record = { clearedSha: OTHER, preview: KEY };
  assert.equal(mayTypePassword({ preview, previewKey: KEY, record, head: HEAD }), false);
});

test('mayTypePassword refuses a record for another preview', () => {
  const record = { clearedSha: HEAD, preview: 'acme/other/deploy-preview' };
  assert.equal(mayTypePassword({ preview, previewKey: KEY, record, head: HEAD }), false);
  assert.equal(
    mayTypePassword({ preview, previewKey: KEY, record: { clearedSha: HEAD }, head: HEAD }),
    false,
  );
});

test('mayTypePassword refuses when the head is unknown', () => {
  assert.equal(
    mayTypePassword({
      preview,
      previewKey: KEY,
      record: { clearedSha: undefined, preview: KEY },
      head: undefined,
    }),
    false,
  );
});

test('mayTypePassword passes for the head commit and the same preview', () => {
  const record = { clearedSha: HEAD, preview: KEY };
  assert.equal(mayTypePassword({ preview, previewKey: KEY, record, head: HEAD }), true);
});

test('mayTypePassword passes for a preview with no login', () => {
  assert.equal(
    mayTypePassword({ preview: { login: null }, previewKey: KEY, record: undefined, head: HEAD }),
    true,
  );
});

test('redactMessage hides long token-like runs and URL queries, then cuts', () => {
  const token = 'abcDEF0123456789abcDEF0123456789';
  const out = redactMessage(`bad ${token} at https://x.example.test/a?code=1&t=2#frag end`);
  assert.ok(!out.includes(token));
  assert.ok(out.includes('[redacted]'));
  assert.ok(!out.includes('code=1') && !out.includes('frag'));
  assert.ok(out.includes('https://x.example.test/a'));
  assert.equal(redactMessage('x '.repeat(300)).length, 200);
  assert.equal(redactMessage('short message'), 'short message');
});

const config = {
  logins: { acme: { production: 'https://app.example.test', hosts: ['app.example.test'] } },
  repos: {
    'o/r': { previews: { 'x/deploy-preview': { production: 'https://app.example.test' } } },
  },
};

test('productionTarget refuses a deploy-preview URL', () => {
  assert.equal(productionTarget(config, 'https://deploy-preview-12--app.example.test/'), null);
  assert.equal(productionTarget(config, 'https://app.example.test.evil.test/'), null);
});

test('productionTarget accepts the production URL', () => {
  assert.deepEqual(productionTarget(config, 'https://app.example.test/'), {
    origin: 'https://app.example.test',
    login: 'acme',
  });
});

test('withCurrent marks only the head commit as current', () => {
  assert.equal(withCurrent({ sha: HEAD }, HEAD).current, true);
  assert.equal(withCurrent({ sha: OTHER }, HEAD).current, false);
});
