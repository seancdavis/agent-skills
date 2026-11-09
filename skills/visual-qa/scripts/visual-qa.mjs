#!/usr/bin/env node
// visual-qa — before/after QA of a PR's deploy preview, driven from the CLI.
//
// Why this exists: the session that watches a PR needs one tool that checks the
// setup, remembers which previews exist, keeps the approved-author list, and
// (in later subcommands) gates, signs in, and captures. Each command prints one
// JSON object. Exit codes: 0 done, 1 error, 2 bad usage or refused, 3 blocked,
// 4 Sean needs to finish sign-in. Secrets are never printed.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  approveAuthor,
  loadConfig,
  rememberPreview,
  saveConfig,
  validateConfig,
} from './config.mjs';
import { launchBrowser, playwrightStatus, readSecrets, signIn, SigninError } from './signin.mjs';

const USAGE = `Usage:
  visual-qa.mjs setup --check
  visual-qa.mjs remember-preview <check> --covers <text> [--production <url>] [--login <name>] [--url <template>] [--repo owner/name]
  visual-qa.mjs approve-author <login>`;

const VALUED = ['covers', 'production', 'login', 'url', 'repo'];
const BOOLEAN = ['check'];

class UsageError extends Error {}

export function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    if (BOOLEAN.includes(key)) out[key] = true;
    else if (VALUED.includes(key)) {
      if (argv[i + 1] === undefined) throw new UsageError(`${a} needs a value.`);
      out[key] = argv[++i];
    } else throw new UsageError(`Unknown flag ${a}.`);
  }
  if (out.repo !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(out.repo)) {
    throw new UsageError('--repo must look like owner/name.');
  }
  return out;
}

function defaultRepo() {
  const res = spawnSync('gh', ['repo', 'view', '--json', 'nameWithOwner'], { encoding: 'utf8' });
  if (res.status !== 0) throw new UsageError('Could not read the repo; pass --repo owner/name.');
  return JSON.parse(res.stdout).nameWithOwner;
}

async function setupCheck() {
  const config = loadConfig();
  const problems = validateConfig(config);
  const report = { ...playwrightStatus(), config: problems.length === 0, logins: {} };
  if (problems.length) report.problems = problems;
  const names = Object.keys(config.logins);
  if (names.length === 0) report.config = false;
  let browser = null;
  for (const name of names) {
    const login = config.logins[name];
    const entry = { secrets: false, signedIn: false };
    report.logins[name] = entry;
    try {
      readSecrets(login);
      entry.secrets = true;
    } catch (err) {
      entry.error = err.message;
      continue;
    }
    if (!report.playwright || !report.chromium) continue;
    try {
      browser ??= await launchBrowser();
      await signIn({ browser, login, origin: login.production });
      entry.signedIn = true;
    } catch (err) {
      if (err instanceof SigninError && err.code === 4) {
        entry.needs = 'sean';
        entry.reason = err.payload.reason;
        report.needsSean = true;
      } else entry.error = err.message;
    }
  }
  if (browser) await browser.close();
  const ok =
    report.playwright &&
    report.chromium &&
    report.config &&
    names.length > 0 &&
    names.every((n) => report.logins[n].secrets && report.logins[n].signedIn);
  return { code: ok ? 0 : report.needsSean ? 4 : 1, out: report };
}

function rememberPreviewCommand(args) {
  const [check, ...extra] = args._;
  if (!check || extra.length) throw new UsageError('remember-preview takes exactly <check>.');
  if (!args.covers) throw new UsageError('--covers is required.');
  const repo = args.repo ?? defaultRepo();
  const next = rememberPreview(loadConfig(), repo, check, {
    covers: args.covers,
    production: args.production,
    login: args.login,
    url: args.url,
  });
  const problems = validateConfig(next);
  if (problems.length) return { code: 2, out: { refused: true, problems } };
  saveConfig(next);
  return { code: 0, out: { repo, check, saved: next.repos[repo].previews[check] } };
}

function approveAuthorCommand(args) {
  const [login, ...extra] = args._;
  if (!login || extra.length) throw new UsageError('approve-author takes exactly <login>.');
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) {
    throw new UsageError('That does not look like a GitHub login.');
  }
  let next;
  try {
    next = approveAuthor(loadConfig(), login);
  } catch (err) {
    return { code: 2, out: { refused: true, reason: err.message } };
  }
  saveConfig(next);
  return { code: 0, out: { approvedAuthors: next.approvedAuthors } };
}

// Later slices add previews, gate, approve-pr, capture, signin, record, status here.
const COMMANDS = {
  setup: (args) => {
    if (!args.check) throw new UsageError('setup needs --check.');
    return setupCheck();
  },
  'remember-preview': rememberPreviewCommand,
  'approve-author': approveAuthorCommand,
};

async function main() {
  const [name, ...rest] = process.argv.slice(2);
  try {
    if (!name || !(name in COMMANDS)) throw new UsageError('Unknown or missing command.');
    const { code, out } = await COMMANDS[name](parseArgs(rest));
    console.log(JSON.stringify(out, null, 2));
    process.exit(code);
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`${err.message}\n${USAGE}`);
      process.exit(2);
    }
    const code = err instanceof SigninError ? err.code : 1;
    console.log(JSON.stringify(err.payload ?? { error: err.message }));
    process.exit(code);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
