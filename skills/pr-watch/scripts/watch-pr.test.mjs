import { test } from 'node:test';
import assert from 'node:assert';
import {
  allClosed,
  diffSnapshots,
  normalize,
  parseArgs,
  runLoop,
  summarizeChecks,
  toStored,
} from './watch-pr.mjs';

const ME = 'sean';

function makeView(overrides = {}) {
  return {
    number: 7,
    url: 'https://github.com/o/r/pull/7',
    state: 'OPEN',
    isDraft: true,
    reviewDecision: '',
    mergeable: 'MERGEABLE',
    mergeStateStatus: 'CLEAN',
    autoMergeRequest: null,
    statusCheckRollup: [],
    comments: [],
    reviews: [],
    headRefOid: 'abc',
    ...overrides,
  };
}

// The stored snapshot for a view, as the previous poll would have saved it.
const stored = (view, lines = []) => toStored(undefined, normalize(view, lines));
const diff = (prevView, nextView, prevLines = [], nextLines = []) =>
  diffSnapshots(stored(prevView, prevLines), normalize(nextView, nextLines), ME);

const run = (name, status, conclusion = null) => ({
  __typename: 'CheckRun',
  name,
  status,
  conclusion,
});
const ctx = (context, state) => ({ __typename: 'StatusContext', context, state });
const comment = (id, login, assoc = 'NONE') => ({
  id,
  author: { login },
  authorAssociation: assoc,
});

test('no change produces no events', () => {
  const view = makeView({
    comments: [comment('c1', 'bob')],
    statusCheckRollup: [run('a', 'COMPLETED', 'SUCCESS')],
  });
  assert.deepEqual(diff(view, view), []);
});

test('first poll with no saved snapshot is a baseline', () => {
  const view = makeView({ comments: [comment('c1', 'bob')] });
  assert.deepEqual(diffSnapshots(undefined, normalize(view, []), ME), []);
});

test('pending to failing emits checks with the failed names', () => {
  const prev = makeView({
    statusCheckRollup: [run('build', 'IN_PROGRESS'), run('lint', 'IN_PROGRESS')],
  });
  const next = makeView({
    statusCheckRollup: [
      run('build', 'COMPLETED', 'FAILURE'),
      ctx('ci/old', 'ERROR'),
      run('lint', 'IN_PROGRESS'),
    ],
  });
  assert.deepEqual(diff(prev, next), [
    { pr: 7, type: 'checks', from: 'pending', to: 'failing', failed: ['build', 'ci/old'] },
  ]);
});

test('pending to pending emits nothing, even when more checks appear', () => {
  const prev = makeView({ statusCheckRollup: [run('a', 'IN_PROGRESS')] });
  const next = makeView({ statusCheckRollup: [run('a', 'IN_PROGRESS'), run('b', 'QUEUED')] });
  assert.deepEqual(diff(prev, next), []);
});

test('a change to pending emits nothing but is saved', () => {
  const prev = makeView({ statusCheckRollup: [run('a', 'COMPLETED', 'SUCCESS')] });
  const next = makeView({ statusCheckRollup: [run('a', 'IN_PROGRESS')] });
  assert.deepEqual(diff(prev, next), []);
  assert.equal(toStored(stored(prev), normalize(next, [])).checks, 'pending');
});

test('pending to passing emits checks', () => {
  const prev = makeView({ statusCheckRollup: [run('a', 'IN_PROGRESS')] });
  const next = makeView({ statusCheckRollup: [run('a', 'COMPLETED', 'SUCCESS')] });
  assert.deepEqual(diff(prev, next), [
    { pr: 7, type: 'checks', from: 'pending', to: 'passing', failed: [] },
  ]);
});

test('a new issue comment emits one event', () => {
  const next = makeView({ comments: [comment('c1', 'coderabbitai[bot]', 'NONE')] });
  assert.deepEqual(diff(makeView(), next), [
    {
      pr: 7,
      type: 'comment',
      kind: 'issue',
      id: 'c1',
      author: 'coderabbitai[bot]',
      association: 'NONE',
    },
  ]);
});

test('a new line comment emits one event', () => {
  const lines = [{ id: 99, user: { login: 'bob' }, author_association: 'MEMBER' }];
  assert.deepEqual(diff(makeView(), makeView(), [], lines), [
    { pr: 7, type: 'comment', kind: 'line', id: '99', author: 'bob', association: 'MEMBER' },
  ]);
});

test('a new COMMENTED review emits a review-kind comment event', () => {
  const next = makeView({
    reviews: [
      { id: 'r1', author: { login: 'bob' }, authorAssociation: 'MEMBER', state: 'COMMENTED' },
    ],
  });
  assert.deepEqual(diff(makeView(), next), [
    { pr: 7, type: 'comment', kind: 'review', id: 'r1', author: 'bob', association: 'MEMBER' },
  ]);
});

test('a new review in another state emits a review event, and PENDING is skipped', () => {
  const next = makeView({
    reviews: [
      { id: 'r1', author: { login: 'bob' }, state: 'CHANGES_REQUESTED' },
      { id: 'r2', author: { login: 'amy' }, state: 'PENDING' },
    ],
  });
  assert.deepEqual(diff(makeView(), next), [
    { pr: 7, type: 'review', id: 'r1', author: 'bob', state: 'CHANGES_REQUESTED' },
  ]);
});

test('seen comments are not reported again', () => {
  const view = makeView({ comments: [comment('c1', 'bob')] });
  const prev = toStored(stored(makeView()), normalize(view, []));
  assert.deepEqual(diffSnapshots(prev, normalize(view, []), ME), []);
});

test('comments and reviews by selfLogin emit nothing and are recorded as seen', () => {
  const next = makeView({
    comments: [comment('c1', ME)],
    reviews: [{ id: 'r1', author: { login: ME }, state: 'COMMENTED' }],
  });
  const lines = [{ id: 5, user: { login: ME }, author_association: 'OWNER' }];
  assert.deepEqual(diff(makeView(), next, [], lines), []);
  const saved = toStored(stored(makeView()), normalize(next, lines));
  assert.deepEqual(saved.seen, { issue: ['c1'], line: ['5'], review: ['r1'] });
});

test('stored snapshots hold IDs, never bodies', () => {
  const view = makeView({ comments: [{ ...comment('c1', 'bob'), body: 'secret text' }] });
  assert.ok(!JSON.stringify(stored(view)).includes('secret text'));
});

test('UNKNOWN mergeability emits nothing and keeps the previous value', () => {
  const next = normalize(makeView({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }), []);
  const prev = stored(makeView());
  assert.deepEqual(diffSnapshots(prev, next, ME), []);
  const saved = toStored(prev, next);
  assert.equal(saved.mergeable, 'MERGEABLE');
  assert.equal(saved.mergeStateStatus, 'CLEAN');
});

test('UNKNOWN with no previous value stores what came back', () => {
  const next = normalize(makeView({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }), []);
  assert.equal(toStored(undefined, next).mergeStateStatus, 'UNKNOWN');
});

test('review decision, merge state, draft, auto-merge, and state each emit their event', () => {
  const next = makeView({
    reviewDecision: 'APPROVED',
    mergeStateStatus: 'BEHIND',
    isDraft: false,
    autoMergeRequest: { enabledAt: 'now' },
    state: 'MERGED',
  });
  assert.deepEqual(diff(makeView(), next), [
    { pr: 7, type: 'review_decision', from: '', to: 'APPROVED' },
    { pr: 7, type: 'merge_state', from: 'CLEAN', to: 'BEHIND' },
    { pr: 7, type: 'draft', to: false },
    { pr: 7, type: 'auto_merge', to: true },
    { pr: 7, type: 'state', to: 'MERGED' },
  ]);
});

test('summarizeChecks precedence for check runs', () => {
  assert.deepEqual(summarizeChecks([]), { checks: 'none', failed: [] });
  assert.deepEqual(summarizeChecks(null), { checks: 'none', failed: [] });
  assert.equal(
    summarizeChecks([
      run('a', 'COMPLETED', 'SUCCESS'),
      run('b', 'COMPLETED', 'SKIPPED'),
      run('c', 'COMPLETED', 'NEUTRAL'),
    ]).checks,
    'passing',
  );
  assert.equal(
    summarizeChecks([run('a', 'COMPLETED', 'SUCCESS'), run('b', 'QUEUED')]).checks,
    'pending',
  );
  assert.deepEqual(summarizeChecks([run('a', 'IN_PROGRESS'), run('b', 'COMPLETED', 'TIMED_OUT')]), {
    checks: 'failing',
    failed: ['b'],
  });
  for (const conclusion of ['FAILURE', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']) {
    assert.equal(summarizeChecks([run('a', 'COMPLETED', conclusion)]).checks, 'failing');
  }
});

test('summarizeChecks precedence for status contexts', () => {
  assert.equal(summarizeChecks([ctx('a', 'SUCCESS')]).checks, 'passing');
  assert.equal(summarizeChecks([ctx('a', 'SUCCESS'), ctx('b', 'PENDING')]).checks, 'pending');
  assert.equal(summarizeChecks([ctx('a', 'EXPECTED')]).checks, 'pending');
  assert.deepEqual(summarizeChecks([ctx('a', 'PENDING'), ctx('b', 'FAILURE')]), {
    checks: 'failing',
    failed: ['b'],
  });
  assert.deepEqual(summarizeChecks([ctx('a', 'ERROR'), run('b', 'COMPLETED', 'FAILURE')]).failed, [
    'a',
    'b',
  ]);
});

test('allClosed is true only when every PR is merged or closed', () => {
  const prs = (...states) => Object.fromEntries(states.map((state, i) => [i, { state }]));
  assert.equal(allClosed(prs('MERGED', 'CLOSED')), true);
  assert.equal(allClosed(prs('MERGED', 'OPEN')), false);
  assert.equal(allClosed(prs('OPEN')), false);
});

// A fake clock: sleeping advances time, nothing really waits.
function fakeClock() {
  let t = 0;
  return { now: () => t, sleep: async (ms) => void (t += ms) };
}

function scripted(results) {
  const queue = [...results];
  let calls = 0;
  return {
    poll: async () => {
      calls++;
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    calls: () => calls,
  };
}

const quiet = { events: [], prs: { 7: { state: 'OPEN' } }, allClosed: false };

test('runLoop returns the first poll with events', async () => {
  const event = { pr: 7, type: 'draft', to: false };
  const p = scripted([quiet, quiet, { ...quiet, events: [event] }]);
  const result = await runLoop({ poll: p.poll, ...fakeClock(), intervalMs: 10, maxWaitMs: 0 });
  assert.deepEqual(result.events, [event]);
  assert.equal(p.calls(), 3);
});

test('runLoop returns immediately when everything is closed', async () => {
  const p = scripted([{ events: [], prs: {}, allClosed: true }]);
  const result = await runLoop({ poll: p.poll, ...fakeClock(), intervalMs: 10, maxWaitMs: 0 });
  assert.equal(result.allClosed, true);
  assert.equal(p.calls(), 1);
});

test('runLoop times out with a single timeout event and the last prs', async () => {
  const p = scripted(Array(20).fill(quiet));
  const result = await runLoop({ poll: p.poll, ...fakeClock(), intervalMs: 10, maxWaitMs: 35 });
  assert.deepEqual(result, { events: [{ type: 'timeout' }], prs: quiet.prs, allClosed: false });
});

test('runLoop throws after 5 consecutive failures', async () => {
  const p = scripted(Array(10).fill(new Error('gh down')));
  await assert.rejects(
    runLoop({ poll: p.poll, ...fakeClock(), intervalMs: 10, maxWaitMs: 0 }),
    /gh down/,
  );
  assert.equal(p.calls(), 5);
});

test('a success resets the failure count', async () => {
  const boom = new Error('gh down');
  const event = { pr: 7, type: 'draft', to: false };
  const p = scripted([
    boom,
    boom,
    boom,
    boom,
    quiet,
    boom,
    boom,
    boom,
    boom,
    { ...quiet, events: [event] },
  ]);
  const result = await runLoop({ poll: p.poll, ...fakeClock(), intervalMs: 10, maxWaitMs: 0 });
  assert.deepEqual(result.events, [event]);
  assert.equal(p.calls(), 10);
});

test('parseArgs treats --once as a flag, so the PR number is not swallowed', () => {
  const args = parseArgs(['--once', '55', '--state-file', 'x.json']);
  assert.equal(args.once, true);
  assert.deepEqual(args.prs, [55]);
  assert.equal(args['state-file'], 'x.json');
});

test('parseArgs handles --set-mode and rejects bad input', () => {
  const args = parseArgs(['--set-mode', '12', 'no-reviewers']);
  assert.equal(args.mode, 'no-reviewers');
  assert.deepEqual(args.prs, [12]);
  assert.throws(() => parseArgs(['--set-mode', '12']));
  assert.throws(() => parseArgs(['--set-mode', '12', 'sometimes']));
  assert.throws(() => parseArgs(['abc']));
  assert.throws(() => parseArgs(['0']));
  assert.throws(() => parseArgs(['1', '--repo', 'no-slash']));
  assert.throws(() => parseArgs(['1', '--repo', 'a/b; rm -rf']));
  assert.throws(() => parseArgs([]));
  assert.throws(() => parseArgs(['1', '--bogus']));
  assert.equal(
    parseArgs(['1', '--repo', 'o/r.x-y', '--interval', '30', '--max-wait', '900']).maxWaitMs,
    900000,
  );
});
