// config — where visual-qa keeps its files, and the rules for what it may touch.
//
// Why this exists: the sign-in code types a test user's password into a browser,
// so the question "is this host one we may type on?" needs one small, tested
// answer. Everything private (vault, item, Keychain service, previews, approved
// authors) lives in `config.json` under home(), never in the repo. This module
// loads, validates, and saves that file and does the host matching. Pure
// functions only, apart from the load and save.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const HOST_CHARS = /^[a-z0-9.-]+$/;
// One rule for login names, shared with the state-file path in signin.mjs.
export const LOGIN_NAME = /^[a-z0-9][a-z0-9_-]*$/;

export function home() {
  return process.env.VISUAL_QA_HOME || join(homedir(), '.claude', 'visual-qa');
}

// Where a recorded run's screenshots and demo are copied so Sean can find them
// without digging through home(). VISUAL_QA_RECORDINGS overrides it (the tests
// use it).
export function recordingsDir() {
  return process.env.VISUAL_QA_RECORDINGS || join(homedir(), 'Documents', '__recordings__');
}

export function emptyConfig() {
  return { logins: {}, repos: {}, approvedAuthors: [] };
}

export function loadConfig() {
  const path = join(home(), 'config.json');
  if (!existsSync(path)) return emptyConfig();
  const parsed = JSON.parse(readFileSync(path, 'utf8'));
  return { ...emptyConfig(), ...parsed };
}

export function saveConfig(config) {
  mkdirSync(home(), { recursive: true });
  writeFileSync(join(home(), 'config.json'), `${JSON.stringify(config, null, 2)}\n`, {
    mode: 0o600,
  });
}

function validHostPattern(pattern) {
  if (typeof pattern !== 'string') return false;
  const parts = pattern.split('{pr}');
  if (parts.length > 2) return false;
  return parts.every((p) => p === '' || HOST_CHARS.test(p)) && pattern !== '';
}

function httpsUrl(value) {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

export function validateConfig(config) {
  const problems = [];
  const logins = config?.logins ?? {};
  for (const [name, login] of Object.entries(logins)) {
    if (!LOGIN_NAME.test(name)) {
      problems.push(
        `login ${name}: name may use only lowercase letters, digits, "_" and "-", and must not start with "_" or "-".`,
      );
    }
    if (login.flow !== 'netlify') problems.push(`login ${name}: flow must be "netlify".`);
    for (const field of ['keychainService', 'vault', 'item']) {
      if (typeof login[field] !== 'string' || !login[field]) {
        problems.push(`login ${name}: ${field} is required.`);
      }
    }
    const hosts = login.hosts;
    if (!Array.isArray(hosts) || hosts.length === 0) {
      problems.push(`login ${name}: hosts must be a non-empty list.`);
    } else {
      for (const h of hosts) {
        if (!validHostPattern(h)) problems.push(`login ${name}: bad host pattern "${h}".`);
      }
    }
    if (!httpsUrl(login.production)) {
      problems.push(`login ${name}: production must be an https URL.`);
    } else if (Array.isArray(hosts)) {
      const host = new URL(login.production).hostname;
      const plain = hosts.filter((h) => typeof h === 'string' && !h.includes('{pr}'));
      if (!plain.includes(host)) {
        problems.push(`login ${name}: production host must match a hosts entry without {pr}.`);
      }
    }
  }
  for (const [repo, entry] of Object.entries(config?.repos ?? {})) {
    for (const [key, preview] of Object.entries(entry.previews ?? {})) {
      const where = `repo ${repo}, preview ${key}`;
      if (preview.production != null && !httpsUrl(preview.production)) {
        problems.push(`${where}: production must be an https URL or null.`);
      }
      if (preview.login != null && !(preview.login in logins)) {
        problems.push(`${where}: login "${preview.login}" does not exist.`);
      }
      if (preview.url != null && !httpsUrl(preview.url.replace('{pr}', '1'))) {
        problems.push(`${where}: url must be an https URL template.`);
      }
    }
  }
  for (const author of config?.approvedAuthors ?? []) {
    if (author.endsWith('[bot]')) problems.push(`approvedAuthors: "${author}" is a bot.`);
  }
  return problems;
}

// True only when the host, lowercased, equals a pattern exactly after `{pr}` is
// replaced by the PR number. Without a PR number, `{pr}` patterns never match.
export function hostAllowed(host, patterns, pr) {
  if (typeof host !== 'string') return false;
  const h = host.toLowerCase();
  return (patterns ?? []).some((pattern) => {
    if (pattern.includes('{pr}')) {
      if (pr == null) return false;
      return h === pattern.replace('{pr}', String(pr));
    }
    return h === pattern;
  });
}

// A secret may be typed only on https, on the default port, on an allowed host.
export function secretOriginAllowed(urlString, patterns, pr) {
  let url;
  try {
    url = new URL(urlString);
  } catch {
    return false;
  }
  return url.protocol === 'https:' && url.port === '' && hostAllowed(url.hostname, patterns, pr);
}

function originOf(url) {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

// Which configured production site a URL belongs to, or null. A deploy preview
// never matches: only the `production` origins count.
export function productionTarget(config, url) {
  const origin = originOf(url);
  if (!origin) return null;
  for (const [name, login] of Object.entries(config?.logins ?? {})) {
    if (originOf(login.production) === origin) return { origin, login: name };
  }
  for (const entry of Object.values(config?.repos ?? {})) {
    for (const preview of Object.values(entry.previews ?? {})) {
      if (preview.production && originOf(preview.production) === origin) {
        return { origin, login: preview.login ?? null };
      }
    }
  }
  return null;
}

export function rememberPreview(config, repo, check, { covers, production, login, url }) {
  const next = structuredClone(config);
  next.repos ??= {};
  next.repos[repo] ??= { previews: {} };
  next.repos[repo].previews ??= {};
  const entry = { covers, production: production ?? null, login: login ?? null };
  if (url) entry.url = url;
  next.repos[repo].previews[check] = entry;
  return next;
}

export function approveAuthor(config, login) {
  if (login.endsWith('[bot]')) {
    throw new Error(`"${login}" is a bot; bots are approved per PR, not saved.`);
  }
  const next = structuredClone(config);
  const list = next.approvedAuthors ?? [];
  if (!list.includes(login)) list.push(login);
  next.approvedAuthors = list;
  return next;
}
