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
// capture. Saved browser state goes to <home>/state/<host>.json, mode 0600, and a
// context only loads the state file for its own host.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { home, hostAllowed, secretOriginAllowed } from './config.mjs';

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

export function statePath(host) {
  if (!/^[a-z0-9.-]+$/.test(host)) throw new SigninError('Unsafe host name for a state file.', 2);
  return join(home(), 'state', `${host}.json`);
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

// Playwright's debug log can print filled values, so it is turned off first.
export async function launchBrowser({ headed = false } = {}) {
  delete process.env.DEBUG;
  const { chromium } = loadPlaywright();
  return chromium.launch({ headless: !headed });
}

// Resolves the field first, then checks the page's URL (https, default port,
// allowed host for this PR), then fills that same handle, so a navigation
// between the check and the fill cannot redirect the value.
async function guardedFill(page, locator, value, login, pr) {
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

function saveState(host, state) {
  const path = statePath(host);
  mkdirSync(join(home(), 'state'), { recursive: true });
  writeFileSync(path, JSON.stringify(state), { mode: 0o600 });
  chmodSync(path, 0o600);
}

// Signs in on `origin` and saves the browser state for that host. Returns once
// signed in; throws a SigninError with code 4 when Sean must finish by hand.
export async function signIn({ browser, login, origin, pr = null, headed = false }) {
  const host = new URL(origin).hostname;
  if (!hostAllowed(host, login.hosts, pr)) {
    throw new SigninError(`${host} is not an allowed sign-in host for this login.`, 2);
  }
  const file = statePath(host);
  const options = { viewport: { width: 1280, height: 800 } };
  if (existsSync(file)) options.storageState = file;
  const context = await browser.newContext(options);
  try {
    const page = await context.newPage();
    if (options.storageState) {
      await page.goto(origin, { waitUntil: 'load', timeout: 45000 });
      await page.waitForTimeout(2000);
      if (await isSignedIn(page)) return { host, reused: true };
    }
    try {
      await netlifyFlow(page, login, origin, pr);
    } catch (err) {
      // Headed: Sean may finish by hand. A refused host still stops the run.
      if (!headed || err.code === 2) throw err;
    }
    const ok = headed
      ? await waitForSignedIn(page, HEADED_WAIT_MS)
      : await waitForSignedIn(page, 3000);
    if (!ok) {
      const reason = await blockedReason(page);
      throw new SigninError('Sign-in did not complete.', 4, { needs: 'sean', reason });
    }
    saveState(host, await context.storageState());
    return { host, reused: false };
  } finally {
    await context.close();
  }
}
