import { test } from 'node:test';
import assert from 'node:assert';
import {
  approveAuthor,
  hostAllowed,
  productionTarget,
  rememberPreview,
  secretOriginAllowed,
  validateConfig,
} from './config.mjs';

const PATTERNS = ['app.example.test', 'deploy-preview-{pr}--app.example.test'];

function validConfig() {
  return {
    logins: {
      demo: {
        flow: 'netlify',
        keychainService: 'svc',
        vault: 'vault',
        item: 'item',
        production: 'https://app.example.test',
        hosts: [...PATTERNS],
      },
    },
    repos: {
      'acme/web': {
        previews: {
          'acme/app/deploy-preview': {
            covers: 'The app',
            production: 'https://app.example.test',
            login: 'demo',
          },
        },
      },
    },
    approvedAuthors: ['octocat'],
  };
}

test('hostAllowed matches exact hosts, case-insensitively', () => {
  assert.equal(hostAllowed('app.example.test', PATTERNS, null), true);
  assert.equal(hostAllowed('APP.Example.Test', PATTERNS, null), true);
  assert.equal(hostAllowed('other.example.test', PATTERNS, null), false);
});

test('hostAllowed {pr} matches only the given PR', () => {
  const host = 'deploy-preview-12--app.example.test';
  assert.equal(hostAllowed(host, PATTERNS, 12), true);
  assert.equal(hostAllowed(host, PATTERNS, 1), false);
  assert.equal(hostAllowed(host, PATTERNS, 123), false);
});

test('hostAllowed rejects lookalike hosts', () => {
  assert.equal(hostAllowed('deploy-preview-12--app.example.test.evil.com', PATTERNS, 12), false);
  assert.equal(hostAllowed('xdeploy-preview-12--app.example.test', PATTERNS, 12), false);
  assert.equal(hostAllowed('app.example.test.evil.com', PATTERNS, null), false);
});

test('hostAllowed {pr} patterns never match without a PR', () => {
  assert.equal(hostAllowed('deploy-preview-12--app.example.test', PATTERNS, null), false);
  assert.equal(hostAllowed('deploy-preview-null--app.example.test', PATTERNS, null), false);
});

test('validateConfig accepts a good config', () => {
  assert.deepEqual(validateConfig(validConfig()), []);
});

test('secretOriginAllowed requires https, the default port, and an allowed host', () => {
  assert.equal(secretOriginAllowed('https://app.example.test/login', PATTERNS, null), true);
  assert.equal(
    secretOriginAllowed('https://deploy-preview-12--app.example.test/', PATTERNS, 12),
    true,
  );
  assert.equal(secretOriginAllowed('http://app.example.test/', PATTERNS, null), false);
  assert.equal(secretOriginAllowed('https://app.example.test:8443/', PATTERNS, null), false);
  assert.equal(secretOriginAllowed('https://app.example.test.evil.com/', PATTERNS, null), false);
  assert.equal(secretOriginAllowed('about:blank', PATTERNS, null), false);
  assert.equal(secretOriginAllowed('not a url', PATTERNS, null), false);
});

test('validateConfig requires flow netlify', () => {
  const c = validConfig();
  c.logins.demo.flow = 'github';
  assert.match(validateConfig(c).join('\n'), /flow/);
});

test('validateConfig requires https production URLs', () => {
  const c = validConfig();
  c.logins.demo.production = 'http://app.example.test';
  assert.match(validateConfig(c).join('\n'), /production must be an https/);
  const d = validConfig();
  d.repos['acme/web'].previews['acme/app/deploy-preview'].production = 'http://app.example.test';
  assert.match(validateConfig(d).join('\n'), /preview acme\/app\/deploy-preview: production/);
});

test('validateConfig requires the production host in a plain hosts entry', () => {
  const c = validConfig();
  c.logins.demo.hosts = ['deploy-preview-{pr}--app.example.test'];
  assert.match(validateConfig(c).join('\n'), /production host must match/);
});

test('validateConfig rejects bad host patterns', () => {
  for (const bad of ['*.example.test', 'App.example.test', 'a-{pr}-{pr}.example.test', 'a b']) {
    const c = validConfig();
    c.logins.demo.hosts = ['app.example.test', bad];
    assert.match(validateConfig(c).join('\n'), /bad host pattern/, bad);
  }
});

test('validateConfig requires keychainService, vault, and item', () => {
  for (const field of ['keychainService', 'vault', 'item']) {
    const c = validConfig();
    c.logins.demo[field] = '';
    assert.match(validateConfig(c).join('\n'), new RegExp(`${field} is required`), field);
  }
});

test('validateConfig requires a preview url to be an https template', () => {
  for (const bad of ['not a url', 'http://deploy-preview-{pr}--app.example.test', '']) {
    const c = validConfig();
    c.repos['acme/web'].previews['acme/app/deploy-preview'].url = bad;
    assert.match(validateConfig(c).join('\n'), /url must be an https URL template/, bad);
  }
  const ok = validConfig();
  ok.repos['acme/web'].previews['acme/app/deploy-preview'].url =
    'https://deploy-preview-{pr}--app.example.test';
  assert.deepEqual(validateConfig(ok), []);
});

test('validateConfig requires a preview login to exist', () => {
  const c = validConfig();
  c.repos['acme/web'].previews['acme/app/deploy-preview'].login = 'missing';
  assert.match(validateConfig(c).join('\n'), /login "missing" does not exist/);
  c.repos['acme/web'].previews['acme/app/deploy-preview'].login = null;
  assert.deepEqual(validateConfig(c), []);
});

test('validateConfig rejects bots in approvedAuthors', () => {
  const c = validConfig();
  c.approvedAuthors.push('dependabot[bot]');
  assert.match(validateConfig(c).join('\n'), /is a bot/);
});

test('productionTarget recognizes production origins and nothing else', () => {
  const c = validConfig();
  assert.deepEqual(productionTarget(c, 'https://app.example.test/sites?x=1'), {
    origin: 'https://app.example.test',
    login: 'demo',
  });
  assert.equal(productionTarget(c, 'https://deploy-preview-12--app.example.test/'), null);
  assert.equal(productionTarget(c, 'http://app.example.test/'), null);
  assert.equal(productionTarget(c, 'not a url'), null);
});

test('productionTarget finds a preview-only production origin', () => {
  const c = validConfig();
  c.repos['acme/web'].previews['acme/docs/deploy-preview'] = {
    covers: 'Docs',
    production: 'https://docs.example.test',
    login: null,
  };
  assert.deepEqual(productionTarget(c, 'https://docs.example.test/'), {
    origin: 'https://docs.example.test',
    login: null,
  });
});

test('approveAuthor adds a human once and refuses a bot', () => {
  const c = validConfig();
  const next = approveAuthor(approveAuthor(c, 'hubot-human'), 'hubot-human');
  assert.deepEqual(next.approvedAuthors, ['octocat', 'hubot-human']);
  assert.deepEqual(c.approvedAuthors, ['octocat']);
  assert.throws(() => approveAuthor(c, 'dependabot[bot]'), /bot/);
});

test('rememberPreview saves an entry without mutating the input', () => {
  const c = validConfig();
  const next = rememberPreview(c, 'acme/new', 'acme/x/deploy-preview', {
    covers: 'New site',
    login: 'demo',
    url: 'https://deploy-preview-{pr}--new.example.test',
  });
  assert.deepEqual(next.repos['acme/new'].previews['acme/x/deploy-preview'], {
    covers: 'New site',
    production: null,
    login: 'demo',
    url: 'https://deploy-preview-{pr}--new.example.test',
  });
  assert.equal(c.repos['acme/new'], undefined);
  assert.deepEqual(validateConfig(next), []);
});
