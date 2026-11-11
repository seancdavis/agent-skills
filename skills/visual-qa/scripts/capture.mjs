// capture — run a scenario against production and a deploy preview, keep the shots.
//
// Why this exists: the session needs before/after screenshots and a demo video
// without ever recording a sign-in or typing a secret. Sign-in happens in its own
// unrecorded context (signin.mjs, the only file that types a password); each
// scenario then runs in a NEW context that loads only the saved state for its
// own login and host. The demo is drawn from keyframes taken in that context
// (demo.mjs), so it never shows a sign-in either.
// Nothing here fills or types a secret, and a `fill` on a password-like field
// fails the step. Page and console text comes from the PR's code, so it is
// untrusted: it is cut short and reported as data, never acted on.

import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { home, loadConfig, productionTarget, secretOriginAllowed } from './config.mjs';
import {
  CAPTION_MAX,
  DemoRecorder,
  isCaption,
  isViewport,
  loadStyle,
  RECORD_MAX_MS,
  renderDemo,
  scrollStep,
} from './demo.mjs';
import { findPreviewCheck, loadGate, previewUrl, readPr, runDir as gateRunDir } from './gate.mjs';
import { isPrivateHost, launchBrowser, newGuardedContext, signIn, statePath } from './signin.mjs';

export { isPrivateHost };

const STEP_TIMEOUT_MS = 10000;
const LOAD_TIMEOUT_MS = 45000;
const MAX_STEPS = 100;
const MAX_MESSAGES = 5;
const MAX_MESSAGE_CHARS = 200;
const NAME = /^[a-z0-9-]+$/;
const STEP_KINDS = [
  'click',
  'fill',
  'press',
  'waitFor',
  'goto',
  'wait',
  'screenshot',
  'scroll',
  'record',
];
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
  if (json.viewport !== undefined && !isViewport(json.viewport)) {
    problems.push('viewport needs integer width and height.');
  }
  const badCaption = `caption must be 1-${CAPTION_MAX} characters on one line.`;
  if (json.caption !== undefined && !isCaption(json.caption)) problems.push(badCaption);
  if (!Array.isArray(json.steps)) return [...problems, 'steps must be a list.'];
  if (json.steps.length > MAX_STEPS) problems.push(`at most ${MAX_STEPS} steps.`);
  json.steps.forEach((step, i) => {
    const at = `step ${i}`;
    if (!step || typeof step !== 'object') return problems.push(`${at}: must be an object.`);
    if (!STEP_KINDS.includes(step.do)) return problems.push(`${at}: unknown "do".`);
    if (step.caption !== undefined && !isCaption(step.caption)) {
      problems.push(`${at}: ${badCaption}`);
    }
    const needsTarget = ['click', 'fill', 'waitFor', 'scroll'].includes(step.do);
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
    const recordMs = Number.isInteger(step.ms) && step.ms >= 100 && step.ms <= RECORD_MAX_MS;
    if (step.do === 'record' && !recordMs) {
      problems.push(`${at}: record ms must be 100-${RECORD_MAX_MS}.`);
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
    // A `record` step is a wait on both sides; in a demo, its frames are kept.
    case 'wait':
    case 'record':
      return page.waitForTimeout(step.ms);
    case 'scroll':
      return scrollStep(page, step.target, STEP_TIMEOUT_MS);
    case 'screenshot': {
      const file = join(dir, `${prefix}-${step.name}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
      return undefined;
    }
  }
}

// Runs the scenario in a fresh context that loads only the saved state for
// `loginName` on this host (none when the preview has no login). With
// `demoDir`, also takes the demo's keyframes there (see demo.mjs).
// Returns { url, shots, failedStep, consoleErrors, pageErrors, messages, demoError? }.
export async function runSide({
  browser,
  origin,
  scenario,
  dir,
  prefix,
  login,
  loginName,
  demoDir,
  pr = null,
}) {
  const problem = originProblem(origin, login, pr);
  if (problem) throw new StepError(problem);
  const host = new URL(origin).hostname;
  const viewport = scenario.viewport ?? { width: 1280, height: 800 };
  const options = { viewport };
  if (login && loginName && existsSync(statePath(loginName, host))) {
    options.storageState = statePath(loginName, host);
  }
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
  const context = await newGuardedContext(browser, options);
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

  // The demo's keyframes. A failure here drops the demo, never the step: the
  // caller fails the command when --demo was asked for and no demo exists.
  let recorder = demoDir
    ? new DemoRecorder({
        page,
        dir: demoDir,
        viewport,
        title: host,
        caption: scenario.caption,
        timeout: STEP_TIMEOUT_MS,
      })
    : null;
  const demo = async (call) => {
    if (!recorder) return;
    try {
      await call(recorder);
    } catch (err) {
      result.demoError = firstLine(err);
      recorder = null;
    }
  };
  try {
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
      await demo((r) => r.start());
    }
    const steps = result.failedStep ? [] : scenario.steps;
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      await demo((r) => r.before(step));
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
      await demo((r) => r.after(step));
    }
    if (!result.failedStep) await demo((r) => r.finish());
    else if (recorder) {
      result.demoError = `step ${result.failedStep.index} failed; see ${prefix}.failedStep.`;
    }
  } finally {
    await context.close();
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
export function recheckBeforeSignIn({ repo, pr, previewKey, record }, getPr = readPr) {
  const view = getPr(repo, pr);
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

// Exit 1 for --demo with no demo. The run (when there is one) comes along, so a
// failed step's reason and screenshot are still in the output.
function demoMissing(demoError, run = null) {
  const error = `The demo video was not rendered${demoError ? `: ${demoError}` : '.'}`;
  return { code: 1, out: run ? { error, ...run } : { error } };
}

// Draws demo.mp4 next to run.json from the keyframes in `<runBase>/demo`. It is
// drawn to a separate file and moved over demo.mp4 only once whole, so a failed
// re-draw keeps the last good video. Returns { demo } or { demoError }.
async function renderInto({ browser, runBase, style, render }) {
  const out = join(runBase, 'demo.mp4');
  const partial = join(runBase, 'demo.partial.mp4');
  rmSync(partial, { force: true });
  try {
    await render({ browser, dir: join(runBase, 'demo'), out: partial, style });
    if (!existsSync(partial)) return { demoError: 'ffmpeg wrote no file.' };
    renameSync(partial, out);
  } catch (err) {
    rmSync(partial, { force: true });
    return { demoError: firstLine(err) };
  }
  return { demo: out };
}

// The demo's look: `--style <file>` (which must exist), else
// ~/.claude/visual-qa/demo-style.json when there is one, else the defaults.
function demoStyle(styleFile) {
  if (styleFile) return loadStyle(styleFile);
  const saved = join(home(), 'demo-style.json');
  return loadStyle(existsSync(saved) ? saved : null);
}

function sideFiles(side) {
  return side ? side.shots : [];
}

// ---------- capture commands ----------

// Before/after on a PR: production, then the preview.
// `deps` replaces the gh, browser, sign-in, and re-check functions in tests.
export async function runCapture(
  { pr, repo, previewKey, scenarioFile, demo, styleFile },
  deps = {},
) {
  const {
    loadConfig: readConfig = loadConfig,
    readPr: getPr = readPr,
    loadGate: readGate = loadGate,
    launchBrowser: launch = launchBrowser,
    signIn: signInOn = signIn,
    recheck = recheckBeforeSignIn,
    runSide: runOneSide = runSide,
    renderDemo: render = renderDemo,
  } = deps;
  const loaded = loadScenario(scenarioFile);
  if (loaded.problems) return refused(loaded.problems);
  const { scenario } = loaded;
  const look = demo ? demoStyle(styleFile) : null;
  if (look?.problems.length) return refused(look.problems);
  const config = readConfig();
  const entry = config.repos?.[repo]?.previews?.[previewKey];
  if (!entry) {
    return refused([`No config entry for ${previewKey}; run remember-preview.`]);
  }
  const login = entry.login ? config.logins?.[entry.login] : null;
  if (entry.login && !login) return refused([`Login "${entry.login}" is not configured.`]);

  const view = getPr(repo, pr);
  const head = view.headRefOid;
  const record = readGate(repo).prs?.[String(pr)];
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

  let demoError;
  const browser = await launch();
  try {
    if (entry.production) {
      const origin = new URL(entry.production).origin;
      if (login) await signInOn({ browser, login, loginName: entry.login, origin });
      const before = await runOneSide({
        browser,
        origin,
        scenario,
        dir: runBase,
        prefix: 'before',
        login,
        loginName: entry.login,
      });
      run.before = {
        url: before.url,
        shots: before.shots,
        failedStep: before.failedStep,
        consoleErrors: before.consoleErrors,
        pageErrors: before.pageErrors,
        messages: before.messages,
      };
    }
    if (login) {
      const stale = recheck({ repo, pr, previewKey, record }, getPr);
      if (stale) return stale;
      await signInOn({ browser, login, loginName: entry.login, origin: previewOrigin, pr });
    }
    const demoDir = demo ? join(runBase, 'demo') : null;
    if (demoDir) {
      rmSync(demoDir, { recursive: true, force: true });
      rmSync(join(runBase, 'demo.mp4'), { force: true });
    }
    const after = await runOneSide({
      browser,
      origin: previewOrigin,
      scenario,
      dir: runBase,
      prefix: 'after',
      login,
      loginName: entry.login,
      demoDir,
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
    demoError = after.demoError;
    if (demoDir && !demoError) {
      const drawn = await renderInto({ browser, runBase, style: look.style, render });
      run.demo = drawn.demo ?? null;
      demoError = drawn.demoError;
    }
  } finally {
    await browser.close();
  }

  run.files = [...sideFiles(run.before), ...sideFiles(run.after), ...(run.demo ? [run.demo] : [])];
  run.stale = getPr(repo, pr).headRefOid !== head;
  writeRun(runBase, run);
  if (run.stale) return { code: 3, out: run };
  if (demo && !run.demo) return demoMissing(demoError, run);
  return { code: 0, out: run };
}

// Before side only, on a configured production site. No PR, no gate.
export async function runProductionOnly({ url, scenarioFile, demo, styleFile }) {
  const loaded = loadScenario(scenarioFile);
  if (loaded.problems) return refused(loaded.problems);
  const { scenario } = loaded;
  const look = demo ? demoStyle(styleFile) : null;
  if (look?.problems.length) return refused(look.problems);
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
  let drawn = {};
  try {
    if (login) await signIn({ browser, login, loginName: target.login, origin: target.origin });
    side = await runSide({
      browser,
      origin: target.origin,
      scenario,
      dir: runBase,
      prefix: 'before',
      login,
      loginName: target.login,
      demoDir: demo ? join(runBase, 'demo') : null,
    });
    if (demo && !side.demoError) {
      drawn = await renderInto({ browser, runBase, style: look.style, render: renderDemo });
    }
  } finally {
    await browser.close();
  }
  const run = {
    production: true,
    before: {
      url: side.url,
      shots: side.shots,
      failedStep: side.failedStep,
      consoleErrors: side.consoleErrors,
      pageErrors: side.pageErrors,
      messages: side.messages,
    },
    demo: drawn.demo ?? null,
    files: [...side.shots, ...(drawn.demo ? [drawn.demo] : [])],
  };
  writeRun(runBase, run);
  if (demo && !run.demo) return demoMissing(side.demoError ?? drawn.demoError, run);
  return { code: 0, out: run };
}

// Re-draws a run's demo from the keyframes it already has, for a new look or
// pacing. Opens no site: the only page is the local render page.
export async function runRenderDemo({ run, styleFile }, deps = {}) {
  const { launchBrowser: launch = launchBrowser, renderDemo: render = renderDemo } = deps;
  let runBase;
  let runJson;
  try {
    runBase = run ? runFolder(run) : null;
    runJson = runBase ? readRunFile(runBase) : null;
  } catch (err) {
    return refused([err.message]);
  }
  if (!runJson) return refused(['--run must be a scenario folder holding a run.json.']);
  if (!existsSync(join(runBase, 'demo', 'timeline.json'))) {
    return refused(['That run has no demo keyframes; capture with --demo first.']);
  }
  const look = demoStyle(styleFile);
  if (look.problems.length) return refused(look.problems);
  const browser = await launch();
  let drawn;
  try {
    drawn = await renderInto({ browser, runBase, style: look.style, render });
  } finally {
    await browser.close();
  }
  if (!drawn.demo) return demoMissing(drawn.demoError);
  runJson.demo = drawn.demo;
  if (Array.isArray(runJson.files) && !runJson.files.includes(drawn.demo)) {
    runJson.files = [...runJson.files, drawn.demo];
  }
  writeFileSync(join(runBase, 'run.json'), `${JSON.stringify(runJson, null, 2)}\n`);
  return { code: 0, out: { demo: drawn.demo } };
}

// Signs in once and saves state. A preview needs the same gate pass as capture and
// signs in on the gated preview's own URL; `--origin` is for production only.
export async function runSigninCommand({ origin, pr, repo, previewKey, headed }, deps = {}) {
  const {
    loadConfig: readConfig = loadConfig,
    readPr: getPr = readPr,
    loadGate: readGate = loadGate,
    launchBrowser: launch = launchBrowser,
    signIn: signInOn = signIn,
    recheck = recheckBeforeSignIn,
  } = deps;
  const config = readConfig();
  let login;
  let loginName;
  let target;
  let record = null;
  if (previewKey) {
    if (headed) return refused(['--headed is only for production sign-in.']);
    const entry = config.repos?.[repo]?.previews?.[previewKey];
    if (!entry) return refused([`No config entry for ${previewKey}; run remember-preview.`]);
    loginName = entry.login;
    login = entry.login ? config.logins?.[entry.login] : null;
    if (!login) return refused(['That preview has no configured login.']);
    const view = getPr(repo, pr);
    const head = view.headRefOid;
    record = readGate(repo).prs?.[String(pr)];
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
    loginName = production.login;
    login = config.logins?.[production.login];
    if (!login) return refused(['Login is not configured.']);
    target = production.origin;
  }
  const problem = originProblem(target, login, previewKey ? pr : null);
  if (problem) return refused([problem]);
  const browser = await launch({ headed: Boolean(headed) });
  try {
    if (previewKey) {
      const stale = recheck({ repo, pr, previewKey, record }, getPr);
      if (stale) return stale;
    }
    const result = await signInOn({
      browser,
      login,
      loginName,
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

// The real folder a --run path names (a scenario folder, or its run.json), or
// null when it doesn't exist. Links are resolved before the check, so a link
// inside the runs folder can't lead outside it.
function runFolder(run) {
  const given = resolve(run);
  const folder = given.endsWith('.json') ? dirname(given) : given;
  const root = resolve(home(), 'runs');
  const outside = new Error('--run must be inside the visual-qa runs folder.');
  if (!folder.startsWith(root + sep)) throw outside;
  if (!existsSync(folder)) return null;
  const real = realpathSync(folder);
  if (!real.startsWith(realpathSync(root) + sep)) throw outside;
  return real;
}

// The folder's run.json, or null when there is none. Never read or written
// through a link.
function readRunFile(folder) {
  const file = join(folder, 'run.json');
  if (!existsSync(file)) return null;
  if (lstatSync(file).isSymbolicLink()) throw new Error('run.json must not be a link.');
  return JSON.parse(readFileSync(file, 'utf8'));
}

function readRunJson(run) {
  const folder = runFolder(run);
  return folder ? readRunFile(folder) : null;
}

// Why a run may not be recorded as `passed`, or null. It must be the scenario
// folder's run.json, for the current head commit, not stale, with a demo file.
export function passedRunProblem(runJson, head, fileExists = existsSync) {
  if (!runJson) {
    return 'passed needs --run <run dir>/<scenario name>, a folder holding a run.json.';
  }
  if (runJson.sha !== head) return 'That run is for a different commit than the PR head.';
  if (runJson.stale === true) return 'That run is stale: a push landed during capture.';
  if (typeof runJson.demo !== 'string' || !fileExists(runJson.demo)) {
    return 'That run has no demo video; capture with --demo first.';
  }
  return null;
}

// Why a record may not be saved for `sha`, or null. `sha` is the commit the
// session based its decision on: it must be the PR's current head, and when
// --run is given (any status) that run must be for the same commit.
export function recordShaProblem({ sha, head, runJson }) {
  if (!/^[0-9a-f]{40}$/.test(String(sha ?? ''))) {
    return '--sha must be the 40-character commit sha the result was based on.';
  }
  if (sha !== head) return 'The PR moved since this result was decided; re-check the head commit.';
  if (runJson && runJson.sha !== sha) return 'That run is for a different commit than --sha.';
  return null;
}

export function runRecord({ pr, repo, status, reason, run, sha: given }, getPr = readPr) {
  if (!['passed', 'failed', 'skipped'].includes(status)) {
    return refused(['--status must be passed, failed, or skipped.']);
  }
  let runJson = null;
  try {
    if (run) runJson = readRunJson(run);
  } catch (err) {
    return refused([err.message]);
  }
  const head = getPr(repo, pr).headRefOid;
  const shaProblem = recordShaProblem({
    sha: given,
    head,
    runJson,
  });
  if (shaProblem) return refused([shaProblem]);
  const sha = head;
  if (status === 'passed') {
    const problem = passedRunProblem(runJson, sha);
    if (problem) return refused([problem]);
  }
  const files = Array.isArray(runJson?.files)
    ? runJson.files.filter((f) => typeof f === 'string')
    : [];
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
