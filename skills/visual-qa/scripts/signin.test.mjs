import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { newGuardedContext, signIn, SigninError, statePath } from './signin.mjs';

process.env.VISUAL_QA_HOME = mkdtempSync(join(tmpdir(), 'vqa-signin-test-'));

function fakeBrowser() {
  const seen = { options: [], routes: 0, sockets: 0, closed: 0 };
  const context = {
    route: async () => seen.routes++,
    routeWebSocket: async () => seen.sockets++,
    close: async () => seen.closed++,
  };
  const browser = {
    newContext: async (options) => {
      seen.options.push(options);
      return context;
    },
  };
  return { browser, seen };
}

test('newGuardedContext blocks service workers and the private network', async () => {
  const { browser, seen } = fakeBrowser();
  await newGuardedContext(browser, { viewport: { width: 1, height: 1 }, serviceWorkers: 'allow' });
  assert.equal(seen.options.length, 1);
  assert.equal(seen.options[0].serviceWorkers, 'block');
  assert.deepEqual(seen.options[0].viewport, { width: 1, height: 1 });
  assert.equal(seen.routes, 1);
  assert.equal(seen.sockets, 1);
});

test('newGuardedContext closes the context if the network block fails', async () => {
  const { browser, seen } = fakeBrowser();
  const original = browser.newContext;
  browser.newContext = async (options) => {
    const context = await original(options);
    context.route = async () => {
      throw new Error('route failed');
    };
    return context;
  };
  await assert.rejects(newGuardedContext(browser), /route failed/);
  assert.equal(seen.closed, 1);
});

const login = { hosts: ['app.example.test', 'deploy-preview-{pr}--app.example.test'] };

test('signIn checks the origin before it creates a context or fills anything', async () => {
  for (const origin of [
    'http://app.example.test',
    'https://evil.example.test',
    'https://app.example.test:8443',
    'https://deploy-preview-8--app.example.test',
  ]) {
    const { browser, seen } = fakeBrowser();
    await assert.rejects(
      signIn({ browser, login, loginName: 'acme', origin, pr: 7 }),
      (err) => err instanceof SigninError && err.code === 2,
      origin,
    );
    assert.equal(seen.options.length, 0, origin);
  }
});

test('signIn goes on to create a guarded context for an allowed origin', async () => {
  const seen = [];
  const browser = {
    newContext: async (options) => {
      seen.push(options);
      throw new Error('stop here');
    },
  };
  await assert.rejects(
    signIn({
      browser,
      login,
      loginName: 'acme',
      origin: 'https://deploy-preview-7--app.example.test',
      pr: 7,
    }),
    /stop here/,
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].serviceWorkers, 'block');
});

// A context that records how it was set up and can drive a signed-in page, so
// signIn finishes without a network or a secret.
function guardCheckBrowser() {
  const made = [];
  const browser = {
    newContext: async (options) => {
      const context = {
        options,
        routes: 0,
        sockets: 0,
        route: async () => context.routes++,
        routeWebSocket: async () => context.sockets++,
        newPage: async () => ({
          url: () => 'https://app.example.test/',
          goto: async () => {},
          waitForTimeout: async () => {},
          locator: () => ({ count: async () => 0 }),
          getByRole: () => ({ count: async () => 0 }),
        }),
        close: async () => {},
      };
      made.push(context);
      return context;
    },
  };
  return { browser, made };
}

test('signIn creates its context through the network guard', async () => {
  const file = statePath('acme', 'app.example.test');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, '{}');
  const { browser, made } = guardCheckBrowser();
  const res = await signIn({
    browser,
    login,
    loginName: 'acme',
    origin: 'https://app.example.test',
  });
  assert.equal(res.reused, true);
  assert.equal(made.length, 1);
  assert.equal(made[0].routes, 1);
  assert.equal(made[0].sockets, 1);
  assert.equal(made[0].options.serviceWorkers, 'block');
});
