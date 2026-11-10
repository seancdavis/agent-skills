// signin — read the test user's secrets and sign in with Playwright.
//
// Why this exists: some deploy previews need a signed-in user. This is the only
// file that ever types a password. Secrets are read on demand (Keychain holds a
// read-only 1Password service-account token; `op` reads the login), typed into
// the page, and never printed, logged, or put in an error. Before every fill the
// page's origin is checked again (https, default port, an allowed host for this
// PR), so a redirect to anywhere else stops the run before anything is typed.
//
// Sign-in contexts never record video, and nothing here starts tracing or HAR
// capture. Saved browser state goes to <home>/state/<login>__<host>.json, mode 0600,
// and a context only loads the state file for its own login and host.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { home, LOGIN_NAME, secretOriginAllowed } from './config.mjs';

const INSTALL_MESSAGE =
  "Playwright isn't installed in ~/.claude/visual-qa. Run `npm install playwright` and `npx playwright install chromium` there.";
const HEADED_WAIT_MS = 5 * 60 * 1000;

// Exit-code-carrying errors, so the CLI can map them without parsing messages.
export class SigninError extends Error {
  constructor(message, code = 1, payload = null) {
    super(message);
    this.code = code;
    this.payload = payload;
  }
}

function run(cmd, args, env = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf8', env: { ...process.env, ...env } });
  if (res.error || res.status !== 0) {
    const detail = (res.stderr ?? res.error?.message ?? '').trim().slice(0, 200);
    throw new SigninError(`${cmd} ${args[0]} failed: ${detail}`);
  }
  return res.stdout.trim();
}

function readToken(login) {
  return run('security', ['find-generic-password', '-s', login.keychainService, '-w']);
}

export function readSecrets(login) {
  const env = { OP_SERVICE_ACCOUNT_TOKEN: readToken(login) };
  const field = (name) => run('op', ['read', `op://${login.vault}/${login.item}/${name}`], env);
  return { username: field('username'), password: field('password') };
}

export function readOtp(login) {
  const env = { OP_SERVICE_ACCOUNT_TOKEN: readToken(login) };
  return run('op', ['item', 'get', login.item, '--vault', login.vault, '--otp'], env);
}

export function statePath(loginName, host) {
  if (!LOGIN_NAME.test(String(loginName ?? ''))) {
    throw new SigninError('Unsafe login name for a state file.', 2);
  }
  if (!/^[a-z0-9.-]+$/.test(host)) throw new SigninError('Unsafe host name for a state file.', 2);
  return join(home(), 'state', `${loginName}__${host}.json`);
}

function loadPlaywright() {
  try {
    return createRequire(join(home(), 'package.json'))('playwright');
  } catch {
    throw new SigninError(INSTALL_MESSAGE);
  }
}

export function playwrightStatus() {
  try {
    const { chromium } = loadPlaywright();
    return { playwright: true, chromium: existsSync(chromium.executablePath()) };
  } catch {
    return { playwright: false, chromium: false };
  }
}

// Playwright's debug log and inspector (PWDEBUG) can show filled values, so
// both are turned off first.
export async function launchBrowser({ headed = false } = {}) {
  delete process.env.DEBUG; // also cleared at CLI start, before anything loads Playwright
  delete process.env.PWDEBUG;
  const { chromium } = loadPlaywright();
  return chromium.launch({
    headless: !headed,
    // WebRTC can open direct UDP connections that context.route never sees, which
    // would get around the private-network block. This keeps it on the proxy path.
    args: ['--force-webrtc-ip-handling-policy=disable_non_proxied_udp'],
  });
}

// True for hosts on the local machine or a private network. IPv4 and IPv6
// literals are matched by range; names are matched by suffix, and a name with no
// dot (an intranet short name) counts as private. DNS rebinding (a
// public name that resolves to a private address) is not covered.
export function isPrivateHost(hostname) {
  let h = String(hostname ?? '')
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '');
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local')) return true;
  if (h !== '' && !h.includes('.') && !h.includes(':')) return true;
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  if (!h.includes(':')) return false;
  const mapped = h.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mapped) {
    const hi = parseInt(mapped[1], 16);
    const lo = parseInt(mapped[2], 16);
    return isPrivateHost(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
  }
  if (h === '::1' || h === '::') return true;
  const first = parseInt(h.split(':')[0] || '0', 16);
  return (first >= 0xfc00 && first <= 0xfdff) || (first >= 0xfe80 && first <= 0xfebf);
}

function hostOf(url) {
  try {
    return new URL(url).hostname;
  } catch {
    // An unparseable URL has no host to block.
    return '';
  }
}

// Aborts every request and WebSocket connection from the page to a local or
// private host.
export async function blockPrivateNetwork(context) {
  await context.route('**/*', (route) => {
    return isPrivateHost(hostOf(route.request().url()))
      ? route.abort('blockedbyclient')
      : route.continue();
  });
  await context.routeWebSocket(/.*/, (ws) => {
    if (isPrivateHost(hostOf(ws.url()))) return ws.close({ code: 1008, reason: 'blocked' });
    return ws.connectToServer();
  });
}

// Every browser context goes through here, so none can skip the network block.
// Service workers are blocked too: context.route can miss their requests, which
// would let a preview get around the private-network block.
export async function newGuardedContext(browser, options = {}) {
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  try {
    await blockPrivateNetwork(context);
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
  return context;
}

// Resolves the field first, then checks the page's URL (https, default port,
// allowed host for this PR), then fills that same handle, so a navigation
// between the check and the fill cannot redirect the value.
export async function guardedFill(page, locator, value, login, pr) {
  let handle;
  try {
    handle = await locator.elementHandle({ timeout: 15000 });
  } catch {
    throw new SigninError('Could not find a sign-in field.');
  }
  try {
    if (!secretOriginAllowed(page.url(), login.hosts, pr)) {
      throw new SigninError('Page left the allowed origins; stopped before typing anything.', 2);
    }
    await handle.fill(value, { timeout: 15000 });
  } catch (err) {
    if (err instanceof SigninError) throw err;
    // Playwright's own message can echo call details, so it is dropped.
    throw new SigninError('Could not fill a sign-in field.');
  } finally {
    await handle.dispose().catch(() => {});
  }
}

export async function isSignedIn(page) {
  const url = page.url();
  if (url.includes('/login') || url.includes('/two-factor-auth')) return false;
  if ((await page.locator('input[type="password"]').count()) > 0) return false;
  const button = page.getByRole('button', { name: 'Log in with email' });
  return (await button.count()) === 0;
}

async function blockedReason(page) {
  const captcha = await page
    .locator('iframe[src*="captcha" i], [class*="captcha" i], iframe[src*="turnstile" i]')
    .count();
  if (captcha > 0) return 'A CAPTCHA is showing.';
  const alerts = await page.locator('[role="alert"]').count();
  if (alerts > 0) return 'An error message is showing.';
  return 'Still on the sign-in page after submitting.';
}

async function needsHuman(page) {
  if (page.url().includes('/two-factor-auth')) return true;
  return (await blockedReason(page)) === 'A CAPTCHA is showing.';
}

async function netlifyFlow(page, login, origin, pr) {
  const { username, password } = readSecrets(login);
  await page.goto(origin, { waitUntil: 'load', timeout: 45000 });
  await page.getByRole('button', { name: 'Log in with email' }).click({ timeout: 15000 });
  const email = page.locator('input[type="email"], input[name="email"]').first();
  await guardedFill(page, email, username, login, pr);
  await guardedFill(page, page.locator('input[type="password"]').first(), password, login, pr);
  await page.locator('button[type="submit"]').first().click();
  await page.waitForLoadState('load', { timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(3000);
  if (page.url().includes('/two-factor-auth')) {
    const code = page.getByPlaceholder('Enter code');
    await guardedFill(page, code, readOtp(login), login, pr);
    await page.getByRole('button', { name: 'Verify' }).click();
    await page.waitForLoadState('load', { timeout: 45000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }
}

async function waitForSignedIn(page, ms) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await isSignedIn(page)) return true;
    await page.waitForTimeout(2000);
  }
  return false;
}

function saveState(loginName, host, state) {
  const path = statePath(loginName, host);
  mkdirSync(join(home(), 'state'), { recursive: true });
  writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
  chmodSync(path, 0o600);
}

// Signs in on `origin` and saves the browser state for that login and host. Returns once
// signed in; throws a SigninError with code 4 when Sean must finish by hand.
export async function signIn({ browser, login, loginName, origin, pr = null, headed = false }) {
  const host = new URL(origin).hostname;
  if (!secretOriginAllowed(origin, login.hosts, pr)) {
    throw new SigninError(`${host} is not an allowed https sign-in origin for this login.`, 2);
  }
  const file = statePath(loginName, host);
  const options = { viewport: { width: 1280, height: 800 } };
  if (existsSync(file)) options.storageState = file;
  const context = await newGuardedContext(browser, options);
  try {
    const page = await context.newPage();
    if (options.storageState) {
      await page.goto(origin, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(2000);
      if (await isSignedIn(page)) return { host, reused: true };
    }
    // Any guard refusal or flow error ends the run. Only a clean finish that is
    // waiting on a CAPTCHA or a code lets Sean take over in a visible browser.
    await netlifyFlow(page, login, origin, pr);
    const waitMs = headed && (await needsHuman(page)) ? HEADED_WAIT_MS : 3000;
    const ok = await waitForSignedIn(page, waitMs);
    if (!ok) {
      const reason = await blockedReason(page);
      throw new SigninError('Sign-in did not complete.', 4, { needs: 'sean', reason });
    }
    saveState(loginName, host, await context.storageState());
    return { host, reused: false };
  } finally {
    await context.close();
  }
}
