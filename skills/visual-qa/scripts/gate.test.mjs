import { test } from 'node:test';
import assert from 'node:assert';
import {
  approvePr,
  classifyAuthors,
  decide,
  diffRange,
  findPreviewCheck,
  normalizeApproval,
  parseVerdict,
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

test('diffRange: no record, ahead, diverged', () => {
  assert.strictEqual(diffRange({ clearedSha: undefined, compareStatus: null }), 'full');
  assert.strictEqual(diffRange({ clearedSha: HEAD, compareStatus: 'ahead' }), 'since');
  assert.strictEqual(diffRange({ clearedSha: HEAD, compareStatus: 'diverged' }), 'full');
  assert.strictEqual(diffRange({ clearedSha: HEAD, compareStatus: null }), 'full');
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
});
