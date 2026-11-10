import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { productionTarget } from './config.mjs';
import {
  isPrivateHost,
  isSafeName,
  isSecretField,
  mayTypePassword,
  originProblem,
  passedRunProblem,
  recheckBeforeSignIn,
  recordShaProblem,
  redactMessage,
  resolvePreviewOrigin,
  runCapture,
  runRecord,
  runSide,
  runSigninCommand,
  validateScenario,
  withCurrent,
} from './capture.mjs';
import { blockPrivateNetwork, guardedFill, statePath } from './signin.mjs';

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

test('isPrivateHost blocks local and private hosts', () => {
  for (const h of [
    'localhost',
    'app.localhost',
    'printer.local',
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.1',
    '192.168.1.1',
    '100.64.0.1',
    '100.127.255.254',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    '[::1]',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '[fe80::1]',
    '::ffff:7f00:1',
    'intranet',
    'printer',
  ]) {
    assert.equal(isPrivateHost(h), true, h);
  }
});

test('isPrivateHost allows public hosts', () => {
  for (const h of [
    'app.netlify.com',
    '8.8.8.8',
    '172.32.0.1',
    '172.15.0.1',
    '192.169.0.1',
    '100.63.255.255',
    '100.128.0.1',
    'locallhost.test',
  ]) {
    assert.equal(isPrivateHost(h), false, h);
  }
});

const entry = { url: 'https://deploy-preview-{pr}--app.example.test' };

test('resolvePreviewOrigin uses the template, then the check URL', () => {
  assert.deepEqual(resolvePreviewOrigin(entry, { url: 'https://x.test' }, 7), {
    origin: 'https://deploy-preview-7--app.example.test',
  });
  assert.deepEqual(resolvePreviewOrigin({}, { url: 'https://x.test/a' }, 7), {
    origin: 'https://x.test',
  });
});

test('resolvePreviewOrigin rejects a port, http, or no URL', () => {
  assert.ok(resolvePreviewOrigin({}, { url: 'https://x.test:8443/' }, 7).problem);
  assert.ok(resolvePreviewOrigin({}, { url: 'http://x.test/' }, 7).problem);
  assert.ok(resolvePreviewOrigin({}, {}, 7).problem);
});

test('originProblem requires an allowed https origin when a login is set', () => {
  const login = { hosts: ['app.example.test', 'deploy-preview-{pr}--app.example.test'] };
  assert.equal(originProblem('https://app.example.test', login, null), null);
  assert.equal(originProblem('https://deploy-preview-7--app.example.test', login, 7), null);
  assert.ok(originProblem('https://deploy-preview-8--app.example.test', login, 7));
  assert.ok(originProblem('https://evil.test', login, 7));
  assert.ok(originProblem('https://app.example.test:8443', login, 7));
  assert.ok(originProblem('http://app.example.test', login, 7));
  assert.equal(originProblem('https://x.test', null, null), null);
  assert.ok(originProblem('https://x.test:444', null, null));
});

test('isPrivateHost treats a dotless name as private but not an empty host', () => {
  assert.equal(isPrivateHost('intranet'), true);
  assert.equal(isPrivateHost('intranet.'), true);
  assert.equal(isPrivateHost('a.b'), false);
  assert.equal(isPrivateHost(''), false);
});

test('statePath keys by login and host, and rejects unsafe names', () => {
  assert.ok(statePath('acme', 'app.example.test').endsWith('acme__app.example.test.json'));
  assert.notEqual(statePath('a', 'x.test'), statePath('b', 'x.test'));
  assert.throws(() => statePath('../evil', 'x.test'));
  assert.throws(() => statePath('', 'x.test'));
  assert.throws(() => statePath(undefined, 'x.test'));
  assert.throws(() => statePath('acme', 'X/y'));
  assert.throws(() => statePath('_x', 'x.test'));
  assert.throws(() => statePath('-x', 'x.test'));
  assert.throws(() => statePath('Acme', 'x.test'));
});

// ---------- passed records ----------

const goodRun = { sha: HEAD, stale: false, demo: '/runs/demo.webm' };
const exists = () => true;

test('passedRunProblem accepts a current run with a demo that exists', () => {
  assert.equal(passedRunProblem(goodRun, HEAD, exists), null);
});

test('passedRunProblem refuses a missing run.json, another commit, a stale run, or no demo', () => {
  assert.ok(passedRunProblem(null, HEAD, exists));
  assert.ok(passedRunProblem({ ...goodRun, sha: OTHER }, HEAD, exists));
  assert.ok(passedRunProblem({ ...goodRun, stale: true }, HEAD, exists));
  assert.ok(passedRunProblem({ ...goodRun, demo: null }, HEAD, exists));
  assert.ok(passedRunProblem(goodRun, HEAD, () => false));
});

// ---------- the checks, with fakes ----------

const prView = (head, state = 'SUCCESS') => ({
  headRefOid: head,
  statusCheckRollup: [
    { __typename: 'StatusContext', context: KEY, state, targetUrl: 'https://x.test' },
  ],
});
const cleared = { clearedSha: HEAD, preview: KEY };

test('recheckBeforeSignIn lets a cleared head with a successful preview through', () => {
  assert.equal(
    recheckBeforeSignIn({ repo: 'o/r', pr: 7, previewKey: KEY, record: cleared }, () =>
      prView(HEAD),
    ),
    null,
  );
});

test('recheckBeforeSignIn refuses when the head changed', () => {
  const res = recheckBeforeSignIn({ repo: 'o/r', pr: 7, previewKey: KEY, record: cleared }, () =>
    prView(OTHER),
  );
  assert.equal(res.code, 3);
  assert.equal(res.out.reason, 'head-changed');
});

test('recheckBeforeSignIn refuses a missing record or another preview', () => {
  const get = () => prView(HEAD);
  assert.equal(
    recheckBeforeSignIn({ repo: 'o/r', pr: 7, previewKey: KEY, record: null }, get).code,
    3,
  );
  const other = { clearedSha: HEAD, preview: 'x/other/deploy-preview' };
  assert.equal(
    recheckBeforeSignIn({ repo: 'o/r', pr: 7, previewKey: KEY, record: other }, get).out.reason,
    'head-changed',
  );
});

test('recheckBeforeSignIn refuses when the preview check is not a success', () => {
  for (const state of ['PENDING', 'FAILURE']) {
    const res = recheckBeforeSignIn({ repo: 'o/r', pr: 7, previewKey: KEY, record: cleared }, () =>
      prView(HEAD, state),
    );
    assert.equal(res.code, 3);
    assert.equal(res.out.reason, 'preview-not-ready');
  }
});

const fillLogin = { hosts: ['app.example.test', 'deploy-preview-{pr}--app.example.test'] };

function fakeFill(url) {
  const filled = [];
  const handle = { fill: async (v) => filled.push(v), dispose: async () => {} };
  const page = { url: () => url };
  const locator = { elementHandle: async () => handle };
  return { page, locator, filled };
}

test('guardedFill refuses http, a port, or another host, and types nothing', async () => {
  for (const url of [
    'http://app.example.test/login',
    'https://app.example.test:8443/login',
    'https://evil.test/login',
    'https://deploy-preview-8--app.example.test/',
  ]) {
    const { page, locator, filled } = fakeFill(url);
    await assert.rejects(guardedFill(page, locator, 'secret', fillLogin, 7), /left the allowed/);
    assert.deepEqual(filled, [], url);
  }
});

test('guardedFill fills on an allowed https origin', async () => {
  for (const url of [
    'https://app.example.test/login',
    'https://deploy-preview-7--app.example.test/',
  ]) {
    const { page, locator, filled } = fakeFill(url);
    await guardedFill(page, locator, 'secret', fillLogin, 7);
    assert.deepEqual(filled, ['secret']);
  }
});

test('blockPrivateNetwork aborts private hosts and continues public ones', async () => {
  let httpHandler;
  let wsHandler;
  const context = {
    route: async (_pattern, fn) => (httpHandler = fn),
    routeWebSocket: async (_pattern, fn) => (wsHandler = fn),
  };
  await blockPrivateNetwork(context);
  const route = (url) => {
    const seen = {};
    return {
      seen,
      request: () => ({ url: () => url }),
      abort: (reason) => (seen.aborted = reason),
      continue: () => (seen.continued = true),
    };
  };
  const priv = route('http://192.168.1.5/admin');
  await httpHandler(priv);
  assert.equal(priv.seen.aborted, 'blockedbyclient');
  assert.equal(priv.seen.continued, undefined);
  const dotless = route('http://intranet/x');
  await httpHandler(dotless);
  assert.equal(dotless.seen.aborted, 'blockedbyclient');
  const pub = route('https://app.example.test/a.js');
  await httpHandler(pub);
  assert.equal(pub.seen.continued, true);
  assert.equal(pub.seen.aborted, undefined);

  const socket = (url) => {
    const seen = {};
    return {
      seen,
      url: () => url,
      close: (opts) => (seen.closed = opts),
      connectToServer: () => (seen.connected = true),
    };
  };
  const wsPriv = socket('ws://localhost:3000/ws');
  await wsHandler(wsPriv);
  assert.ok(wsPriv.seen.closed);
  assert.equal(wsPriv.seen.connected, undefined);
  const wsPub = socket('wss://app.example.test/ws');
  await wsHandler(wsPub);
  assert.equal(wsPub.seen.connected, true);
  assert.equal(wsPub.seen.closed, undefined);
});

// ---------- record sha ----------

test('recordShaProblem needs a 40-char sha that is the current head', () => {
  const base = { head: HEAD, status: 'skipped', runJson: null };
  assert.equal(recordShaProblem({ ...base, sha: HEAD }), null);
  assert.match(recordShaProblem({ ...base, sha: undefined }), /--sha/);
  assert.match(recordShaProblem({ ...base, sha: 'abc123' }), /--sha/);
  assert.match(recordShaProblem({ ...base, sha: 'A'.repeat(40) }), /--sha/);
  assert.match(recordShaProblem({ ...base, sha: OTHER }), /PR moved/);
});

test('recordShaProblem needs a recorded run to be for the same commit', () => {
  const args = { sha: HEAD, head: HEAD };
  assert.equal(recordShaProblem({ ...args, status: 'passed', runJson: { sha: HEAD } }), null);
  assert.equal(recordShaProblem({ ...args, status: 'failed', runJson: { sha: HEAD } }), null);
  assert.equal(recordShaProblem({ ...args, status: 'failed', runJson: null }), null);
  for (const status of ['passed', 'failed']) {
    assert.match(
      recordShaProblem({ ...args, status, runJson: { sha: OTHER } }),
      /different commit/,
    );
  }
});

// ---------- the re-check comes before sign-in ----------

process.env.VISUAL_QA_HOME = mkdtempSync(join(tmpdir(), 'vqa-capture-test-'));

const SCENARIO = fileURLToPath(new URL('../references/example-scenario.json', import.meta.url));
const PREVIEW_HOST = 'deploy-preview-7--app.example.test';
const guardConfig = {
  logins: { acme: { hosts: ['app.example.test', 'deploy-preview-{pr}--app.example.test'] } },
  repos: {
    'o/r': {
      previews: { [KEY]: { login: 'acme', covers: 'x', url: `https://${PREVIEW_HOST}` } },
    },
  },
};

function guardDeps(overrides = {}) {
  const calls = [];
  const deps = {
    loadConfig: () => guardConfig,
    loadGate: () => ({ prs: { 7: cleared } }),
    readPr: () => prView(HEAD),
    launchBrowser: async () => ({ close: async () => {} }),
    recheck: () => {
      calls.push('recheck');
      return null;
    },
    signIn: async ({ origin }) => {
      calls.push(`signIn ${new URL(origin).hostname}`);
      return { host: new URL(origin).hostname, reused: false };
    },
    runSide: async ({ origin, scenario }) => {
      calls.push('runSide');
      return {
        url: `${origin}${scenario.start}`,
        shots: [],
        failedStep: null,
        consoleErrors: 0,
        pageErrors: 0,
        messages: [],
      };
    },
    ...overrides,
  };
  return { deps, calls };
}

test('runCapture re-checks before it signs in on a preview', async () => {
  const { deps, calls } = guardDeps();
  const res = await runCapture(
    { pr: 7, repo: 'o/r', previewKey: KEY, scenarioFile: SCENARIO, demo: false },
    deps,
  );
  assert.equal(res.code, 0);
  assert.deepEqual(calls, ['recheck', `signIn ${PREVIEW_HOST}`, 'runSide']);
});

test('runCapture does not sign in when the re-check refuses', async () => {
  const refusal = { code: 3, out: { blocked: true, reason: 'head-changed' } };
  const { deps, calls } = guardDeps({
    recheck: () => {
      calls.push('recheck');
      return refusal;
    },
  });
  const res = await runCapture(
    { pr: 7, repo: 'o/r', previewKey: KEY, scenarioFile: SCENARIO, demo: false },
    deps,
  );
  assert.equal(res, refusal);
  assert.deepEqual(calls, ['recheck']);
});

test('runSigninCommand re-checks before it signs in on a preview', async () => {
  const { deps, calls } = guardDeps();
  const res = await runSigninCommand({ pr: 7, repo: 'o/r', previewKey: KEY }, deps);
  assert.equal(res.code, 0);
  assert.deepEqual(calls, ['recheck', `signIn ${PREVIEW_HOST}`]);
});

test('runSigninCommand does not sign in when the re-check refuses', async () => {
  const refusal = { code: 3, out: { blocked: true, reason: 'preview-not-ready' } };
  const { deps, calls } = guardDeps({
    recheck: () => {
      calls.push('recheck');
      return refusal;
    },
  });
  const res = await runSigninCommand({ pr: 7, repo: 'o/r', previewKey: KEY }, deps);
  assert.equal(res, refusal);
  assert.deepEqual(calls, ['recheck']);
});

// ---------- call sites use the network guard ----------

test('runSide creates its context through the network guard', async () => {
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
          setDefaultTimeout: () => {},
          on: () => {},
          video: () => null,
          url: () => 'https://app.example.test/',
          goto: async () => {},
          waitForTimeout: async () => {},
          screenshot: async () => {},
        }),
        close: async () => {},
      };
      made.push(context);
      return context;
    },
  };
  const dir = mkdtempSync(join(tmpdir(), 'vqa-runside-'));
  const res = await runSide({
    browser,
    origin: 'https://app.example.test',
    scenario: { name: 'x', start: '/', steps: [] },
    dir,
    prefix: 'before',
    login: null,
    loginName: null,
  });
  assert.equal(res.failedStep, null);
  assert.equal(made.length, 1);
  assert.equal(made[0].routes, 1);
  assert.equal(made[0].sockets, 1);
  assert.equal(made[0].options.serviceWorkers, 'block');
});

// ---------- runRecord with a --run folder ----------

function writeRunFolder(sha) {
  const dir = join(process.env.VISUAL_QA_HOME, 'runs', 'o__r', 'pr-7', 'abc1234', 'scn');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ sha, stale: false, files: [] }));
  return dir;
}

test('runRecord refuses a skipped record whose --run is for another commit', () => {
  const run = writeRunFolder(OTHER);
  const res = runRecord(
    { pr: 7, repo: 'o/r', status: 'skipped', reason: 'no UI', run, sha: HEAD },
    () => prView(HEAD),
  );
  assert.equal(res.code, 2);
  assert.match(res.out.problems[0], /different commit/);
});

test('runRecord saves a skipped record whose --run is for the head commit', () => {
  const run = writeRunFolder(HEAD);
  const res = runRecord(
    { pr: 7, repo: 'o/r', status: 'skipped', reason: 'no UI', run, sha: HEAD },
    () => prView(HEAD),
  );
  assert.equal(res.code, 0);
  assert.equal(res.out.sha, HEAD);
});
