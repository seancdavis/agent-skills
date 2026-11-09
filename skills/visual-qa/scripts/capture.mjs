// capture — run a scenario against production and a deploy preview, keep the shots.
//
// Why this exists: the session needs before/after screenshots and a demo video
// without ever recording a sign-in or typing a secret. Sign-in happens in its own
// unrecorded context (signin.mjs, the only file that types a password); each
// scenario then runs in a NEW context that loads only its own host's saved state.
// Nothing here fills or types a secret, and a `fill` on a password-like field
// fails the step. Page and console text comes from the PR's code, so it is
// untrusted: it is cut short and reported as data, never acted on.

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { home, loadConfig, productionTarget, secretOriginAllowed } from './config.mjs';
import { findPreviewCheck, loadGate, previewUrl, readPr, runDir as gateRunDir } from './gate.mjs';
import { blockPrivateNetwork, isPrivateHost, launchBrowser, signIn, statePath } from './signin.mjs';

export { isPrivateHost };

const STEP_TIMEOUT_MS = 10000;
const LOAD_TIMEOUT_MS = 45000;
const MAX_STEPS = 100;
const MAX_MESSAGES = 5;
const MAX_MESSAGE_CHARS = 200;
const NAME = /^[a-z0-9-]+$/;
const STEP_KINDS = ['click', 'fill', 'press', 'waitFor', 'goto', 'wait', 'screenshot'];
const SECRET_AUTOCOMPLETE = ['current-password', 'new-password', 'one-time-code'];

// ---------- pure logic ----------

export function isSafeName(name) {
  return typeof name === 'string' && NAME.test(name);
}

function isSitePath(path) {
  return (
    typeof path === 'string' &&
    path.startsWith('/') &&
    !path.startsWith('//') &&
    // eslint-disable-next-line no-control-regex
    !/[\\\u0000-\u001f]/.test(path)
  );
}

// Returns a list of problems; empty when the scenario is safe to run.
export function validateScenario(json) {
  const problems = [];
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return ['Scenario must be a JSON object.'];
  }
  if (!isSafeName(json.name)) problems.push('name must match ^[a-z0-9-]+$.');
  if (!isSitePath(json.start)) problems.push('start must be a path starting with a single "/".');
  if (json.viewport !== undefined) {
    const { width, height } = json.viewport ?? {};
    const ok = (n) => Number.isInteger(n) && n >= 200 && n <= 4000;
    if (!ok(width) || !ok(height)) problems.push('viewport needs integer width and height.');
  }
  if (!Array.isArray(json.steps)) return [...problems, 'steps must be a list.'];
  if (json.steps.length > MAX_STEPS) problems.push(`at most ${MAX_STEPS} steps.`);
  json.steps.forEach((step, i) => {
    const at = `step ${i}`;
    if (!step || typeof step !== 'object') return problems.push(`${at}: must be an object.`);
    if (!STEP_KINDS.includes(step.do)) return problems.push(`${at}: unknown "do".`);
    const needsTarget = ['click', 'fill', 'waitFor'].includes(step.do);
    if (needsTarget && (typeof step.target !== 'string' || !step.target)) {
      problems.push(`${at}: ${step.do} needs a target selector.`);
    }
    if (step.do === 'fill' && typeof step.value !== 'string') {
      problems.push(`${at}: fill needs a string value.`);
    }
    if (step.do === 'press' && !/^[A-Za-z0-9+]{1,30}$/.test(step.key ?? '')) {
      problems.push(`${at}: press needs a key name.`);
    }
    if (step.do === 'goto' && !isSitePath(step.path)) {
      problems.push(`${at}: goto path must start with a single "/".`);
    }
    if (step.do === 'wait' && !(Number.isInteger(step.ms) && step.ms >= 0 && step.ms <= 10000)) {
      problems.push(`${at}: wait ms must be 0-10000.`);
    }
    if (step.do === 'screenshot' && !isSafeName(step.name)) {
      problems.push(`${at}: screenshot name must match ^[a-z0-9-]+$.`);
    }
  });
  return problems;
}

// A field that holds a secret: filling it from a scenario is never allowed.
export function isSecretField({ type, autocomplete } = {}) {
  if (String(type ?? '').toLowerCase() === 'password') return true;
  const tokens = String(autocomplete ?? '')
    .toLowerCase()
    .split(/\s+/);
  return tokens.some((t) => SECRET_AUTOCOMPLETE.includes(t));
}

// The password may be typed on a preview only when its login's gate passed for
// this exact head commit and for this preview (`previewKey`). A preview with no
// login types nothing.
export function mayTypePassword({ preview, previewKey, record, head }) {
  if (!preview?.login) return true;
  return (
    Boolean(head) &&
    Boolean(previewKey) &&
    Boolean(record) &&
    record.clearedSha === head &&
    record.preview === previewKey
  );
}

// Console and page text comes from the PR's code. Long token-like runs, URL
// query strings, and fragments are removed, then it is cut short.
export function redactMessage(text, max = MAX_MESSAGE_CHARS) {
  return String(text ?? '')
    .replace(/(https?:\/\/[^\s?#]*)[?#]\S*/gi, '$1')
    .replace(/[A-Za-z0-9+/=_.-]{24,}/g, '[redacted]')
    .slice(0, max);
}

// The preview's origin, from the config `url` template or the check's URL.
// Only https on the default port is accepted. Returns { origin } or { problem }.
export function resolvePreviewOrigin(entry, check, pr) {
  let url;
  try {
    url = new URL(previewUrl(entry, check, pr));
  } catch {
    return { problem: 'The preview URL is missing or not a URL.' };
  }
  if (url.protocol !== 'https:' || url.port !== '') {
    return { problem: 'The preview URL must be https on the default port.' };
  }
  return { origin: url.origin };
}

// Why a side's origin may not be visited, or null. With a login the origin must
// pass the full secret-origin check; without one it is still https, default port.
export function originProblem(origin, login, pr) {
  if (login) {
    return secretOriginAllowed(origin, login.hosts, pr)
      ? null
      : `${new URL(origin).hostname} is not an allowed https sign-in origin for this PR.`;
  }
  const url = new URL(origin);
  return url.protocol === 'https:' && url.port === '' ? null : 'Origins must be https, no port.';
}

export function withCurrent(latest, head) {
  return { ...latest, current: latest?.sha === head };
}

function firstLine(err, max = MAX_MESSAGE_CHARS) {
  return String(err?.message ?? err)
    .split('\n')[0]
    .slice(0, max);
}

// ---------- running a scenario on one side ----------

class StepError extends Error {}

async function doStep(page, step, { origin, dir, prefix, shots }) {
  const t = { timeout: STEP_TIMEOUT_MS };
  switch (step.do) {
    case 'click':
      return page.locator(step.target).first().click(t);
    case 'fill': {
      // One element handle, so the check and the fill are about the same field.
      const handle = await page.locator(step.target).first().elementHandle(t);
      try {
        const attrs = await handle.evaluate((el) => ({
          type: el.getAttribute('type'),
          autocomplete: el.getAttribute('autocomplete'),
        }));
        if (isSecretField(attrs)) throw new StepError('fill refused: secret field');
        return await handle.fill(step.value, t);
      } finally {
        await handle.dispose();
      }
    }
    case 'press':
      return page.keyboard.press(step.key);
    case 'waitFor':
      return page.locator(step.target).first().waitFor(t);
    case 'goto': {
      const url = `${origin}${step.path}`;
      if (new URL(url).origin !== origin) throw new StepError('goto left the site');
      return page.goto(url, { waitUntil: 'load', timeout: STEP_TIMEOUT_MS });
    }
    case 'wait':
      return page.waitForTimeout(step.ms);
    case 'screenshot': {
      const file = join(dir, `${prefix}-${step.name}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
      return undefined;
    }
  }
}

// Runs the scenario in a fresh context that loads only `host`'s saved state.
// Returns { url, shots, failedStep, consoleErrors, pageErrors, messages, videoError? }.
async function runSide({ browser, origin, scenario, dir, prefix, login, videoTo, pr = null }) {
  const problem = originProblem(origin, login, pr);
  if (problem) throw new StepError(problem);
  const host = new URL(origin).hostname;
  const viewport = scenario.viewport ?? { width: 1280, height: 800 };
  const options = { viewport };
  if (login && existsSync(statePath(host))) options.storageState = statePath(host);
  const tmpVideo = join(dir, '.video-tmp');
  if (videoTo) options.recordVideo = { dir: tmpVideo, size: viewport };
  mkdirSync(dir, { recursive: true });

  const result = {
    url: `${origin}${scenario.start}`,
    shots: [],
    failedStep: null,
    consoleErrors: 0,
    pageErrors: 0,
    messages: [],
  };
  const note = (text) => {
    if (result.messages.length < MAX_MESSAGES) result.messages.push(redactMessage(text));
  };
  const context = await browser.newContext(options);
  await blockPrivateNetwork(context);
  const page = await context.newPage();
  page.setDefaultTimeout(STEP_TIMEOUT_MS);
  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    result.consoleErrors++;
    note(msg.text());
  });
  page.on('pageerror', (err) => {
    result.pageErrors++;
    note(String(err?.message ?? err));
  });
  const onSite = () => {
    try {
      return new URL(page.url()).hostname === host;
    } catch {
      return false;
    }
  };
  const fail = async (index, name, reason, shoot) => {
    result.failedStep = { index, do: name, reason };
    if (!shoot) return;
    const file = join(dir, `${prefix}-${String(index).padStart(2, '0')}-failed.png`);
    try {
      await page.screenshot({ path: file });
      result.shots.push(file);
    } catch {
      // The page may be gone; the failure is already recorded.
    }
  };

  let video = null;
  try {
    video = page.video();
    try {
      await page.goto(result.url, { waitUntil: 'load', timeout: LOAD_TIMEOUT_MS });
      await page.waitForTimeout(1500);
    } catch (err) {
      await fail(0, 'start', firstLine(err), onSite());
    }
    if (!result.failedStep && !onSite()) await fail(0, 'start', 'left the site', false);
    if (!result.failedStep) {
      const start = join(dir, `${prefix}-00-start.png`);
      await page.screenshot({ path: start });
      result.shots.push(start);
    }
    const steps = result.failedStep ? [] : scenario.steps;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      try {
        await doStep(page, step, { origin, dir, prefix, shots: result.shots });
      } catch (err) {
        await fail(i + 1, step.do, firstLine(err), onSite());
        break;
      }
      if (!onSite()) {
        await fail(i + 1, step.do, 'left the site', false);
        break;
      }
    }
  } finally {
    await context.close();
    if (videoTo && video) {
      try {
        await video.saveAs(videoTo);
      } catch (err) {
        // The caller fails the command when --demo was asked for and no video exists.
        result.videoError = firstLine(err);
      }
    }
    rmSync(tmpVideo, { recursive: true, force: true });
  }
  return result;
}

function loadScenario(file) {
  let json;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { problems: [`Could not read the scenario: ${firstLine(err, 100)}`] };
  }
  const problems = validateScenario(json);
  return problems.length ? { problems } : { scenario: json };
}

function refused(problems) {
  return { code: 2, out: { refused: true, problems } };
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace(/\..*$/, '');
}

function writeRun(dir, run) {
  const path = join(dir, 'run.json');
  run.files = [...run.files, path];
  writeFileSync(path, `${JSON.stringify(run, null, 2)}\n`);
}

// Run immediately before a preview sign-in. Reads the PR's head commit and the
// preview check again: the password is typed only if the head is still the
// commit the gate cleared and the preview check is a success. The seconds
// between this check and the typing are a race we accept.
function recheckBeforeSignIn({ repo, pr, previewKey, record }) {
  const view = readPr(repo, pr);
  const head = view.headRefOid;
  if (!record || record.clearedSha !== head || record.preview !== previewKey) {
    return { code: 3, out: { blocked: true, reason: 'head-changed', sha: head } };
  }
  const check = findPreviewCheck(view.statusCheckRollup, previewKey);
  if (check.state !== 'success') {
    return { code: 3, out: { blocked: true, reason: 'preview-not-ready', state: check.state } };
  }
  return null;
}

function demoMissing(videoError) {
  return {
    code: 1,
    out: {
      error: `The demo video was not saved${videoError ? `: ${videoError}` : '.'}`,
    },
  };
}

function sideFiles(side) {
  return side ? side.shots : [];
}

// ---------- capture commands ----------

// Before/after on a PR: production, then the preview.
export async function runCapture({ pr, repo, previewKey, scenarioFile, demo }) {
  const loaded = loadScenario(scenarioFile);
  if (loaded.problems) return refused(loaded.problems);
  const { scenario } = loaded;
  const config = loadConfig();
  const entry = config.repos?.[repo]?.previews?.[previewKey];
  if (!entry) {
    return refused([`No config entry for ${previewKey}; run remember-preview.`]);
  }
  const login = entry.login ? config.logins?.[entry.login] : null;
  if (entry.login && !login) return refused([`Login "${entry.login}" is not configured.`]);

  const view = readPr(repo, pr);
  const head = view.headRefOid;
  const record = loadGate(repo).prs?.[String(pr)];
  // The gate check comes before any browser is launched.
  if (!mayTypePassword({ preview: entry, previewKey, record, head })) {
    return { code: 3, out: { blocked: true, reason: 'run gate first', sha: head } };
  }
  const check = findPreviewCheck(view.statusCheckRollup, previewKey);
  if (check.state !== 'success') {
    return { code: 3, out: { blocked: true, reason: 'preview-not-ready', state: check.state } };
  }
  const resolved = resolvePreviewOrigin(entry, check, pr);
  if (resolved.problem) return refused([resolved.problem]);
  const previewOrigin = resolved.origin;
  const problems = [
    originProblem(previewOrigin, login, pr),
    entry.production ? originProblem(new URL(entry.production).origin, login, null) : null,
  ].filter(Boolean);
  if (problems.length) return refused(problems);

  const runBase = join(gateRunDir(repo, pr, head), scenario.name);
  mkdirSync(runBase, { recursive: true });
  const run = {
    pr: Number(pr),
    sha: head,
    preview: previewKey,
    before: null,
    after: null,
    demo: null,
    stale: false,
    files: [],
  };

  let videoError;
  const browser = await launchBrowser();
  try {
    if (entry.production) {
      const origin = new URL(entry.production).origin;
      if (login) await signIn({ browser, login, origin });
      const before = await runSide({
        browser,
        origin,
        scenario,
        dir: runBase,
        prefix: 'before',
        login,
      });
      run.before = { url: before.url, shots: before.shots, failedStep: before.failedStep };
    }
    if (login) {
      const stale = recheckBeforeSignIn({ repo, pr, previewKey, record });
      if (stale) return stale;
      await signIn({ browser, login, origin: previewOrigin, pr });
    }
    const videoTo = demo ? join(runBase, 'demo.webm') : null;
    const after = await runSide({
      browser,
      origin: previewOrigin,
      scenario,
      dir: runBase,
      prefix: 'after',
      login,
      videoTo,
      pr,
    });
    run.after = {
      url: after.url,
      shots: after.shots,
      failedStep: after.failedStep,
      consoleErrors: after.consoleErrors,
      pageErrors: after.pageErrors,
      messages: after.messages,
    };
    if (videoTo && existsSync(videoTo)) run.demo = videoTo;
    videoError = after.videoError;
  } finally {
    await browser.close();
  }

  run.files = [...sideFiles(run.before), ...sideFiles(run.after), ...(run.demo ? [run.demo] : [])];
  run.stale = readPr(repo, pr).headRefOid !== head;
  writeRun(runBase, run);
  if (run.stale) return { code: 3, out: run };
  if (demo && !run.demo) return demoMissing(videoError);
  return { code: 0, out: run };
}

// Before side only, on a configured production site. No PR, no gate.
export async function runProductionOnly({ url, scenarioFile, demo }) {
  const loaded = loadScenario(scenarioFile);
  if (loaded.problems) return refused(loaded.problems);
  const { scenario } = loaded;
  const config = loadConfig();
  const target = url ? productionTarget(config, url) : null;
  if (!target) return refused(['That URL is not a configured production site.']);
  const login = target.login ? config.logins?.[target.login] : null;
  if (target.login && !login) return refused([`Login "${target.login}" is not configured.`]);

  const problem = originProblem(target.origin, login, null);
  if (problem) return refused([problem]);

  const runBase = join(home(), 'runs', 'production', timestamp(), scenario.name);
  mkdirSync(runBase, { recursive: true });
  const browser = await launchBrowser();
  let side;
  const videoTo = demo ? join(runBase, 'demo.webm') : null;
  try {
    if (login) await signIn({ browser, login, origin: target.origin });
    side = await runSide({
      browser,
      origin: target.origin,
      scenario,
      dir: runBase,
      prefix: 'before',
      login,
      videoTo,
    });
  } finally {
    await browser.close();
  }
  const run = {
    production: true,
    before: { url: side.url, shots: side.shots, failedStep: side.failedStep },
    demo: videoTo && existsSync(videoTo) ? videoTo : null,
    files: [...side.shots, ...(videoTo && existsSync(videoTo) ? [videoTo] : [])],
  };
  writeRun(runBase, run);
  if (demo && !run.demo) return demoMissing(side.videoError);
  return { code: 0, out: run };
}

// Signs in once and saves state. A preview needs the same gate pass as capture and
// signs in on the gated preview's own URL; `--origin` is for production only.
export async function runSigninCommand({ origin, pr, repo, previewKey, headed }) {
  const config = loadConfig();
  let login;
  let target;
  let record = null;
  if (previewKey) {
    if (headed) return refused(['--headed is only for production sign-in.']);
    const entry = config.repos?.[repo]?.previews?.[previewKey];
    if (!entry) return refused([`No config entry for ${previewKey}; run remember-preview.`]);
    login = entry.login ? config.logins?.[entry.login] : null;
    if (!login) return refused(['That preview has no configured login.']);
    const view = readPr(repo, pr);
    const head = view.headRefOid;
    record = loadGate(repo).prs?.[String(pr)];
    if (!mayTypePassword({ preview: entry, previewKey, record, head })) {
      return { code: 3, out: { blocked: true, reason: 'run gate first', sha: head } };
    }
    const check = findPreviewCheck(view.statusCheckRollup, previewKey);
    if (check.state !== 'success') {
      return { code: 3, out: { blocked: true, reason: 'preview-not-ready', state: check.state } };
    }
    const resolved = resolvePreviewOrigin(entry, check, pr);
    if (resolved.problem) return refused([resolved.problem]);
    target = resolved.origin;
  } else {
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      return refused(['--origin must be a URL.']);
    }
    const production = productionTarget(config, parsed.origin);
    if (!production) return refused(['--origin must be a configured production site.']);
    if (!production.login) return refused(['That production site has no login.']);
    login = config.logins?.[production.login];
    if (!login) return refused(['Login is not configured.']);
    target = production.origin;
  }
  const problem = originProblem(target, login, previewKey ? pr : null);
  if (problem) return refused([problem]);
  const browser = await launchBrowser({ headed: Boolean(headed) });
  try {
    if (previewKey) {
      const stale = recheckBeforeSignIn({ repo, pr, previewKey, record });
      if (stale) return stale;
    }
    const result = await signIn({
      browser,
      login,
      origin: target,
      pr: previewKey ? pr : null,
      headed: Boolean(headed),
    });
    return { code: 0, out: { signedIn: true, host: result.host, reused: result.reused } };
  } finally {
    await browser.close();
  }
}

// ---------- run records ----------

export function latestPath(repo, pr) {
  return join(home(), 'runs', repo.replace('/', '__'), `pr-${pr}`, 'latest.json');
}

function readRunFiles(run) {
  if (!run) return [];
  const base = resolve(run);
  const root = resolve(home(), 'runs') + sep;
  if (!base.startsWith(root)) throw new Error('--run must be inside the visual-qa runs folder.');
  const file = base.endsWith('.json') ? base : join(base, 'run.json');
  if (!existsSync(file)) return [];
  const files = JSON.parse(readFileSync(file, 'utf8')).files;
  return Array.isArray(files) ? files.filter((f) => typeof f === 'string') : [];
}

export function runRecord({ pr, repo, status, reason, run }) {
  if (!['passed', 'failed', 'skipped'].includes(status)) {
    return refused(['--status must be passed, failed, or skipped.']);
  }
  let files;
  try {
    files = readRunFiles(run);
  } catch (err) {
    return refused([err.message]);
  }
  const sha = readPr(repo, pr).headRefOid;
  const latest = {
    sha,
    status,
    reason: reason ? reason.slice(0, 500) : null,
    run: run ? resolve(run) : null,
    files,
  };
  const path = latestPath(repo, pr);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(latest, null, 2)}\n`);
  return { code: 0, out: { pr: Number(pr), ...latest } };
}

export function runStatus({ pr, repo }) {
  const head = readPr(repo, pr).headRefOid;
  const path = latestPath(repo, pr);
  if (!existsSync(path)) {
    return { code: 0, out: { pr: Number(pr), sha: null, status: null, current: false } };
  }
  const latest = JSON.parse(readFileSync(path, 'utf8'));
  return { code: 0, out: { pr: Number(pr), ...withCurrent(latest, head) } };
}
