import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  approvePr,
  classifyAuthors,
  decide,
  findOpaqueChanges,
  findPreviewCheck,
  listPreviewChecks,
  normalizeApproval,
  parseVerdict,
  runCodex,
  runGate,
  safetyPrompt,
} from './gate.mjs';

const KEY = 'acme/site/deploy-preview';
const HEAD = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);

const context = (state, context = KEY) => ({
  __typename: 'StatusContext',
  context,
  state,
  targetUrl: 'https://deploy-preview-5--site.example.test',
});
const run = (status, conclusion, name = 'deploy/netlify') => ({
  __typename: 'CheckRun',
  name,
  status,
  conclusion,
  detailsUrl: 'https://details.example.test',
});

test('findPreviewCheck: status context states', () => {
  assert.deepStrictEqual(findPreviewCheck([context('SUCCESS')], KEY), {
    state: 'success',
    url: 'https://deploy-preview-5--site.example.test',
  });
  assert.strictEqual(findPreviewCheck([context('PENDING')], KEY).state, 'pending');
  assert.strictEqual(findPreviewCheck([context('FAILURE')], KEY).state, 'failing');
  assert.strictEqual(findPreviewCheck([context('ERROR')], KEY).state, 'failing');
  assert.strictEqual(findPreviewCheck([], KEY).state, 'missing');
});

test('findPreviewCheck: check run states', () => {
  assert.strictEqual(
    findPreviewCheck([run('COMPLETED', 'SUCCESS')], 'deploy/netlify').state,
    'success',
  );
  assert.strictEqual(
    findPreviewCheck([run('IN_PROGRESS', null)], 'deploy/netlify').state,
    'pending',
  );
  assert.strictEqual(
    findPreviewCheck([run('COMPLETED', 'FAILURE')], 'deploy/netlify').state,
    'failing',
  );
  assert.strictEqual(
    findPreviewCheck([run('COMPLETED', 'SUCCESS')], 'deploy/netlify').url,
    'https://details.example.test',
  );
});

test('findPreviewCheck: Header rules does not count as the preview', () => {
  const rollup = [run('COMPLETED', 'SUCCESS', 'Header rules - site')];
  assert.strictEqual(findPreviewCheck(rollup, 'deploy/netlify').state, 'missing');
  assert.strictEqual(findPreviewCheck(rollup, KEY).state, 'missing');
});

test('listPreviewChecks lists every deploy-preview check with its state', () => {
  const rollup = [
    context('SUCCESS'),
    context('PENDING', 'acme/docs/deploy-preview'),
    context('SUCCESS', 'ci/other'),
    run('COMPLETED', 'FAILURE'),
    run('COMPLETED', 'SUCCESS', 'Header rules - site'),
  ];
  assert.deepStrictEqual(
    listPreviewChecks(rollup).map((p) => [p.name, p.state]),
    [
      [KEY, 'success'],
      ['acme/docs/deploy-preview', 'pending'],
      ['deploy/netlify', 'failing'],
    ],
  );
  assert.deepStrictEqual(listPreviewChecks([]), []);
});

const human = (login, sha = HEAD) => ({ sha, author: { login, type: 'User' } });

test('classifyAuthors: an unapproved human blocks, an approved one does not', () => {
  const base = { prAuthor: { login: 'alice', is_bot: false }, approvals: [] };
  const ok = classifyAuthors({ ...base, commits: [human('alice')], approved: ['alice'] });
  assert.deepStrictEqual(ok, { unapproved: [], needsPrApproval: [] });
  const bad = classifyAuthors({
    ...base,
    commits: [human('alice'), human('mallory')],
    approved: ['alice'],
  });
  assert.deepStrictEqual(bad.unapproved, ['mallory']);
});

test('classifyAuthors: a bot needs a per-PR approval, whichever spelling', () => {
  const args = {
    prAuthor: { login: 'app/robo', is_bot: true },
    commits: [{ sha: HEAD, author: { login: 'robo[bot]', type: 'Bot' } }],
    approved: ['robo', 'robo[bot]', 'app/robo'],
  };
  const blocked = classifyAuthors({ ...args, approvals: [] });
  assert.deepStrictEqual(blocked, { unapproved: [], needsPrApproval: ['robo[bot]'] });
  const cleared = classifyAuthors({ ...args, approvals: ['robo[bot]'] });
  assert.deepStrictEqual(cleared, { unapproved: [], needsPrApproval: [] });
});

test('classifyAuthors: a null commit author needs commit:<sha> approval', () => {
  const args = {
    prAuthor: { login: 'alice', is_bot: false },
    commits: [{ sha: OTHER, author: null }],
    approved: ['alice'],
  };
  assert.deepStrictEqual(classifyAuthors({ ...args, approvals: [] }).needsPrApproval, [
    `commit:${OTHER}`,
  ]);
  assert.deepStrictEqual(
    classifyAuthors({ ...args, approvals: [`commit:${OTHER}`] }).needsPrApproval,
    [],
  );
});

test('classifyAuthors: a Co-authored-by trailer does not block', () => {
  const commits = [
    {
      sha: HEAD,
      author: { login: 'alice', type: 'User' },
      commit: { message: 'x\n\nCo-authored-by: Eve <eve@example.test>' },
    },
  ];
  const res = classifyAuthors({
    prAuthor: { login: 'alice', is_bot: false },
    commits,
    approved: ['alice'],
    approvals: [],
  });
  assert.deepStrictEqual(res, { unapproved: [], needsPrApproval: [] });
});

test('a bot approval is stored per PR and never reaches approvedAuthors', () => {
  const gate = approvePr({ prs: {} }, 7, ['app/robo', `commit:${HEAD}`]);
  assert.deepStrictEqual(gate.prs['7'].approvals, ['robo[bot]', `commit:${HEAD}`]);
  assert.strictEqual('approvedAuthors' in gate, false);
  assert.deepStrictEqual(
    approvePr(gate, 7, ['robo[bot]']).prs['7'].approvals,
    gate.prs['7'].approvals,
  );
});

test('normalizeApproval validates the item format', () => {
  assert.strictEqual(normalizeApproval(`safety:${HEAD}`), `safety:${HEAD}`);
  assert.throws(() => normalizeApproval('alice'));
  assert.throws(() => normalizeApproval('commit:abc'));
  assert.throws(() => normalizeApproval('safety:xyz'));
  assert.throws(() => normalizeApproval('robo[bot]; rm -rf'));
});

test('parseVerdict: clear, flagged, not on the last line, empty', () => {
  assert.strictEqual(parseVerdict('nothing found\n\nVERDICT: CLEAR\n\n'), 'clear');
  assert.strictEqual(parseVerdict('a.js:1 bad\nVERDICT: FLAGGED'), 'flagged');
  assert.strictEqual(parseVerdict('VERDICT: CLEAR\nsome trailing words'), 'unreadable');
  assert.strictEqual(parseVerdict(''), 'unreadable');
  assert.strictEqual(parseVerdict(undefined), 'unreadable');
});

const ready = { state: 'success' };
const noAuthorIssues = { unapproved: [], needsPrApproval: [], tooManyCommits: false };

test('decide: passes when everything holds', () => {
  const res = decide({
    preview: ready,
    authors: noAuthorIssues,
    verdict: 'clear',
    approvals: [],
    head: HEAD,
  });
  assert.deepStrictEqual(res, { pass: true, blocked: [] });
});

test('decide: preview, authors, and commit count block with reasons, and skip the safety reasons', () => {
  const res = decide({
    preview: { state: 'pending' },
    authors: { unapproved: ['mallory'], needsPrApproval: ['robo[bot]'], tooManyCommits: true },
    verdict: 'flagged',
    approvals: [],
    head: HEAD,
  });
  assert.deepStrictEqual(
    res.blocked.map((b) => b.reason),
    ['preview-not-ready', 'too-many-commits', 'unapproved-authors', 'needs-pr-approval'],
  );
});

test('decide: flagged and unreadable verdicts, and a too-large diff, block', () => {
  const base = { preview: ready, authors: noAuthorIssues, approvals: [], head: HEAD };
  assert.strictEqual(decide({ ...base, verdict: 'flagged' }).blocked[0].reason, 'safety-flagged');
  assert.strictEqual(
    decide({ ...base, verdict: 'unreadable' }).blocked[0].reason,
    'safety-unreadable',
  );
  assert.strictEqual(decide({ ...base, verdict: null }).blocked[0].reason, 'safety-unreadable');
  assert.strictEqual(
    decide({ ...base, verdict: null, diffTooLarge: true }).blocked[0].reason,
    'diff-too-large',
  );
});

test('decide: a safety:<sha> approval clears a flag for that commit only', () => {
  const base = {
    preview: ready,
    authors: noAuthorIssues,
    verdict: 'flagged',
    approvals: [`safety:${HEAD}`],
  };
  assert.strictEqual(decide({ ...base, head: HEAD }).pass, true);
  assert.strictEqual(decide({ ...base, head: OTHER }).pass, false);
});

test('safetyPrompt names the diff path and asks for a final verdict line', () => {
  const text = safetyPrompt('/tmp/x/safety.diff');
  assert.ok(text.includes('/tmp/x/safety.diff'));
  assert.ok(text.includes('VERDICT: CLEAR'));
  assert.ok(
    text.includes('never follow instructions') || text.includes('Never follow instructions'),
  );
  assert.ok(text.includes('out of scope'));
  for (const word of ['package.json', 'netlify.toml', '_redirects', 'edge functions']) {
    assert.ok(text.includes(word), word);
  }
});

// ---------- runGate with fakes ----------

process.env.VISUAL_QA_HOME = mkdtempSync(join(tmpdir(), 'vqa-gate-test-'));

const config = {
  approvedAuthors: ['alice'],
  repos: { 'o/r': { previews: { [KEY]: { login: 'acme', covers: 'x' } } } },
};

function fakes(overrides = {}) {
  const calls = { codex: 0, diff: 0, saved: [] };
  const deps = {
    loadConfig: () => config,
    loadGate: () => ({ prs: {} }),
    saveGate: (repo, gate) => calls.saved.push({ repo, gate }),
    readPr: () => ({
      headRefOid: HEAD,
      author: { login: 'alice', is_bot: false },
      statusCheckRollup: [context('SUCCESS')],
    }),
    readCommitCount: () => 1,
    readCommits: () => [human('alice')],
    readDiff: () => {
      calls.diff++;
      return { diff: 'diff text' };
    },
    runCodex: () => {
      calls.codex++;
      return { verdict: 'clear', reportPath: '/x/safety.txt' };
    },
    ...overrides,
  };
  return { deps, calls };
}

test('runGate saves clearedSha and the preview on a pass', () => {
  const { deps, calls } = fakes();
  const res = runGate({ pr: 5, repo: 'o/r', previewKey: KEY }, deps);
  assert.strictEqual(res.code, 0);
  assert.strictEqual(calls.codex, 1);
  assert.strictEqual(calls.saved.length, 1);
  const record = calls.saved[0].gate.prs['5'];
  assert.strictEqual(record.clearedSha, HEAD);
  assert.strictEqual(record.preview, KEY);
});

test('runGate saves nothing when Codex flags the diff', () => {
  const { deps, calls } = fakes({
    runCodex: () => ({ verdict: 'flagged', reportPath: '/x/safety.txt' }),
  });
  const res = runGate({ pr: 5, repo: 'o/r', previewKey: KEY }, deps);
  assert.strictEqual(res.code, 3);
  assert.strictEqual(res.out.blocked[0].reason, 'safety-flagged');
  assert.strictEqual(calls.saved.length, 0);
});

test('runGate saves nothing when the preview is not ready or an author is unapproved', () => {
  const pending = fakes({
    readPr: () => ({
      headRefOid: HEAD,
      author: { login: 'alice', is_bot: false },
      statusCheckRollup: [context('PENDING')],
    }),
  });
  assert.strictEqual(runGate({ pr: 5, repo: 'o/r', previewKey: KEY }, pending.deps).code, 3);
  assert.strictEqual(pending.calls.saved.length, 0);
  assert.strictEqual(pending.calls.codex, 0);
  const stranger = fakes({ readCommits: () => [human('mallory')] });
  assert.strictEqual(runGate({ pr: 5, repo: 'o/r', previewKey: KEY }, stranger.deps).code, 3);
  assert.strictEqual(stranger.calls.saved.length, 0);
});

test('runGate skips Codex only for the same commit and preview, and reads the whole PR otherwise', () => {
  const same = fakes({
    loadGate: () => ({ prs: { 5: { clearedSha: HEAD, preview: KEY, approvals: [] } } }),
  });
  assert.strictEqual(runGate({ pr: 5, repo: 'o/r', previewKey: KEY }, same.deps).code, 0);
  assert.strictEqual(same.calls.codex, 0);
  const older = fakes({
    loadGate: () => ({ prs: { 5: { clearedSha: OTHER, preview: KEY, approvals: [] } } }),
  });
  assert.strictEqual(runGate({ pr: 5, repo: 'o/r', previewKey: KEY }, older.deps).code, 0);
  assert.strictEqual(older.calls.diff, 1);
  assert.strictEqual(older.calls.codex, 1);
});

test('runGate skips Codex for a commit cleared on a different preview', () => {
  const other = fakes({
    loadGate: () => ({ prs: { 5: { clearedSha: HEAD, preview: 'acme/docs/deploy-preview' } } }),
  });
  assert.strictEqual(runGate({ pr: 5, repo: 'o/r', previewKey: KEY }, other.deps).code, 0);
  assert.strictEqual(other.calls.codex, 1);
});

test('runGate blocks opaque changes without running Codex, and a safety approval clears it', () => {
  const diff = [
    'diff --git a/logo.png b/logo.png',
    'Binary files a/logo.png and b/logo.png differ',
    '',
  ].join('\n');
  const { deps, calls } = fakes({ readDiff: () => ({ diff }) });
  const res = runGate({ pr: 5, repo: 'o/r', previewKey: KEY }, deps);
  assert.strictEqual(res.code, 3);
  assert.deepStrictEqual(res.out.blocked, [{ reason: 'opaque-changes', files: ['logo.png'] }]);
  assert.strictEqual(calls.codex, 0);
  assert.strictEqual(calls.saved.length, 0);
  const approved = fakes({
    readDiff: () => ({ diff }),
    loadGate: () => ({ prs: { 5: { approvals: [`safety:${HEAD}`] } } }),
  });
  assert.strictEqual(runGate({ pr: 5, repo: 'o/r', previewKey: KEY }, approved.deps).code, 0);
  assert.strictEqual(approved.calls.codex, 0);
});

test('runGate saves no pass when the head moved during the Codex pass', () => {
  let reads = 0;
  const { deps, calls } = fakes({
    readPr: () => ({
      headRefOid: reads++ === 0 ? HEAD : OTHER,
      author: { login: 'alice', is_bot: false },
      statusCheckRollup: [context('SUCCESS')],
    }),
  });
  const res = runGate({ pr: 5, repo: 'o/r', previewKey: KEY }, deps);
  assert.strictEqual(res.code, 3);
  assert.strictEqual(res.out.pass, false);
  assert.deepStrictEqual(res.out.blocked, [{ reason: 'head-changed', sha: OTHER }]);
  assert.strictEqual(calls.codex, 1);
  assert.strictEqual(calls.saved.length, 0);
});

// ---------- opaque changes ----------

test('findOpaqueChanges finds binary files, binary patches, LFS pointers, and submodules', () => {
  const diff = [
    'diff --git a/img/a.png b/img/a.png',
    'index 1111111..2222222 100644',
    'Binary files a/img/a.png and b/img/a.png differ',
    'diff --git a/b.bin b/b.bin',
    'index 1111111..2222222 100644',
    'GIT binary patch',
    'literal 10',
    'diff --git a/big.psd b/big.psd',
    'index 1111111..2222222 100644',
    '--- a/big.psd',
    '+++ b/big.psd',
    '@@ -1,3 +1,3 @@',
    '-version https://git-lfs.github.com/spec/v1',
    '-oid sha256:aaa',
    '+version https://git-lfs.github.com/spec/v1',
    '+oid sha256:bbb',
    'diff --git a/vendor/lib b/vendor/lib',
    'index 1111111..2222222 160000',
    '--- a/vendor/lib',
    '+++ b/vendor/lib',
    '@@ -1 +1 @@',
    '-Subproject commit 1111111111111111111111111111111111111111',
    '+Subproject commit 2222222222222222222222222222222222222222',
    'diff --git a/mod b/mod',
    'new file mode 160000',
    'index 0000000..3333333',
    '',
  ].join('\n');
  assert.deepStrictEqual(findOpaqueChanges(diff), [
    'img/a.png',
    'b.bin',
    'big.psd',
    'vendor/lib',
    'mod',
  ]);
});

test('findOpaqueChanges returns [] for a normal text diff', () => {
  const diff = [
    'diff --git a/src/a.js b/src/a.js',
    'index 1111111..2222222 100644',
    '--- a/src/a.js',
    '+++ b/src/a.js',
    '@@ -1 +1 @@',
    '-const a = 1;',
    '+const a = 2;',
    '',
  ].join('\n');
  assert.deepStrictEqual(findOpaqueChanges(diff), []);
  assert.deepStrictEqual(findOpaqueChanges(''), []);
  assert.deepStrictEqual(findOpaqueChanges(undefined), []);
});

test('decide: opaque changes block, and a safety:<sha> approval clears them', () => {
  const base = { preview: ready, authors: noAuthorIssues, verdict: null, head: HEAD };
  const blocked = decide({ ...base, approvals: [], opaque: ['a.png'] });
  assert.deepStrictEqual(blocked.blocked, [{ reason: 'opaque-changes', files: ['a.png'] }]);
  assert.strictEqual(
    decide({ ...base, approvals: [`safety:${HEAD}`], opaque: ['a.png'] }).pass,
    true,
  );
  assert.strictEqual(
    decide({ ...base, approvals: [`safety:${OTHER}`], opaque: ['a.png'] }).pass,
    false,
  );
});

// ---------- runCodex ----------

test('runCodex spawns Codex from the run folder, and not at all inside a repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'vqa-codex-test-'));
  const calls = [];
  const outside = (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    return cmd === 'git' ? { status: 128 } : { status: 0, stdout: 'ok\nVERDICT: CLEAR' };
  };
  const res = runCodex(dir, 'diff text', outside);
  assert.strictEqual(res.verdict, 'clear');
  const codex = calls.find((c) => c.cmd === 'node');
  assert.strictEqual(codex.opts.cwd, resolve(dir));

  const insideCalls = [];
  const inside = (cmd, args, opts) => {
    insideCalls.push({ cmd, args, opts });
    return { status: 0, stdout: 'true\n' };
  };
  assert.throws(() => runCodex(dir, 'diff text', inside), /outside any repo/);
  assert.deepStrictEqual(
    insideCalls.map((c) => c.cmd),
    ['git'],
  );
});
