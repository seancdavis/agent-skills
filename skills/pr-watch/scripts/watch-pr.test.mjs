import { test } from 'node:test';
import assert from 'node:assert';
import {
  allClosed,
  diffSnapshots,
  findPreviews,
  normalize,
  parseArgs,
  publicView,
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
    headRefOid: 'abc',
    ...overrides,
  };
}

// `lists` is the REST comment lists by kind; any kind left out is empty.
const norm = (view, lists = {}) => normalize(view, lists, 'o/r');
// The stored snapshot for a view, as the previous poll would have saved it.
const stored = (view, lists) => toStored(undefined, norm(view, lists));
const diff = (prevView, nextView, prevLists, nextLists) =>
  diffSnapshots(stored(prevView, prevLists), norm(nextView, nextLists), ME);

const run = (name, status, conclusion = null) => ({
  __typename: 'CheckRun',
  name,
  status,
  conclusion,
});
const ctx = (context, state) => ({ __typename: 'StatusContext', context, state });
// A REST comment or review, as GitHub's API returns it.
const rest = (id, login, extra = {}) => ({
  id,
  node_id: `N_${id}`,
  user: { login, type: login.endsWith('[bot]') ? 'Bot' : 'User' },
  author_association: 'NONE',
  ...extra,
});

test('no change produces no events', () => {
  const view = makeView({ statusCheckRollup: [run('a', 'COMPLETED', 'SUCCESS')] });
  const lists = { issue: [rest(1, 'bob')] };
  assert.deepEqual(diff(view, view, lists, lists), []);
});

test('first poll with no saved snapshot is a baseline', () => {
  assert.deepEqual(diffSnapshots(undefined, norm(makeView(), { issue: [rest(1, 'bob')] }), ME), []);
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
  assert.equal(toStored(stored(prev), norm(next)).checks, 'pending');
});

test('pending to passing emits checks', () => {
  const prev = makeView({ statusCheckRollup: [run('a', 'IN_PROGRESS')] });
  const next = makeView({ statusCheckRollup: [run('a', 'COMPLETED', 'SUCCESS')] });
  assert.deepEqual(diff(prev, next), [
    { pr: 7, type: 'checks', from: 'pending', to: 'passing', failed: [] },
  ]);
});

test('a new issue comment emits one event naming its fetch path and author type', () => {
  const view = makeView();
  assert.deepEqual(diff(view, view, {}, { issue: [rest(11, 'coderabbitai[bot]')] }), [
    {
      pr: 7,
      type: 'comment',
      kind: 'issue',
      id: '11',
      author: 'coderabbitai[bot]',
      authorType: 'Bot',
      fetch: 'repos/o/r/issues/comments/11',
      association: 'NONE',
    },
  ]);
});

test('a new line comment emits one event', () => {
  const lines = { line: [rest(99, 'bob', { author_association: 'MEMBER' })] };
  assert.deepEqual(diff(makeView(), makeView(), {}, lines), [
    {
      pr: 7,
      type: 'comment',
      kind: 'line',
      id: '99',
      author: 'bob',
      authorType: 'User',
      fetch: 'repos/o/r/pulls/comments/99',
      association: 'MEMBER',
    },
  ]);
});

test('a new COMMENTED review emits a review-kind comment event', () => {
  const reviews = {
    review: [rest(21, 'bob', { author_association: 'MEMBER', state: 'COMMENTED' })],
  };
  assert.deepEqual(diff(makeView(), makeView(), {}, reviews), [
    {
      pr: 7,
      type: 'comment',
      kind: 'review',
      id: '21',
      author: 'bob',
      authorType: 'User',
      fetch: 'repos/o/r/pulls/7/reviews/21',
      association: 'MEMBER',
    },
  ]);
});

test('a new review in another state emits a review event, and PENDING is skipped', () => {
  const reviews = {
    review: [
      rest(21, 'bob', { state: 'CHANGES_REQUESTED' }),
      rest(22, 'amy', { state: 'PENDING' }),
    ],
  };
  assert.deepEqual(diff(makeView(), makeView(), {}, reviews), [
    {
      pr: 7,
      type: 'review',
      id: '21',
      author: 'bob',
      authorType: 'User',
      fetch: 'repos/o/r/pulls/7/reviews/21',
      state: 'CHANGES_REQUESTED',
    },
  ]);
});

test('seen comments are not reported again', () => {
  const lists = { issue: [rest(1, 'bob')] };
  const prev = toStored(stored(makeView()), norm(makeView(), lists));
  assert.deepEqual(diffSnapshots(prev, norm(makeView(), lists), ME), []);
});

test('comments saved under GraphQL node IDs by older runs are still seen', () => {
  const prev = { ...stored(makeView()), seen: { issue: ['N_1'], line: [], review: ['N_2'] } };
  const lists = { issue: [rest(1, 'bob')], review: [rest(2, 'amy', { state: 'APPROVED' })] };
  assert.deepEqual(diffSnapshots(prev, norm(makeView(), lists), ME), []);
});

test('comments and reviews by selfLogin emit nothing and are recorded as seen', () => {
  const lists = {
    issue: [rest(1, ME)],
    line: [rest(5, ME, { author_association: 'OWNER' })],
    review: [rest(2, ME, { state: 'COMMENTED' })],
  };
  assert.deepEqual(diff(makeView(), makeView(), {}, lists), []);
  const saved = toStored(stored(makeView()), norm(makeView(), lists));
  assert.deepEqual(saved.seen, { issue: ['1'], line: ['5'], review: ['2'] });
});

test('stored snapshots and events hold IDs and logins, never bodies', () => {
  const lists = { issue: [rest(1, 'bob', { body: 'secret text' })] };
  assert.ok(!JSON.stringify(stored(makeView(), lists)).includes('secret text'));
  assert.ok(!JSON.stringify(diff(makeView(), makeView(), {}, lists)).includes('secret text'));
});

test('stored snapshots list each commenter once', () => {
  const lists = {
    issue: [rest(1, 'coderabbitai[bot]'), rest(2, 'bob')],
    review: [rest(3, 'coderabbitai[bot]', { state: 'COMMENTED' })],
  };
  assert.deepEqual(stored(makeView(), lists).commenters, ['coderabbitai[bot]', 'bob']);
});

test('UNKNOWN mergeability emits nothing and keeps the previous value', () => {
  const next = norm(makeView({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }));
  const prev = stored(makeView());
  assert.deepEqual(diffSnapshots(prev, next, ME), []);
  const saved = toStored(prev, next);
  assert.equal(saved.mergeable, 'MERGEABLE');
  assert.equal(saved.mergeStateStatus, 'CLEAN');
});

test('UNKNOWN with no previous value stores what came back', () => {
  const next = norm(makeView({ mergeable: 'UNKNOWN', mergeStateStatus: 'UNKNOWN' }));
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

test('runLoop never sleeps past the deadline when the interval is longer', async () => {
  const clock = fakeClock();
  const p = scripted(Array(5).fill(quiet));
  const result = await runLoop({ poll: p.poll, ...clock, intervalMs: 100, maxWaitMs: 30 });
  assert.deepEqual(result.events, [{ type: 'timeout' }]);
  assert.equal(clock.now(), 30);
  assert.equal(p.calls(), 2);
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

const PREVIEW = 'o/site/deploy-preview';
const previewCtx = (state = 'SUCCESS', context = PREVIEW) => ({
  ...ctx(context, state),
  targetUrl: 'https://deploy-preview-7--site.example.app',
});
const previewEvent = (sha = 'abc') => ({
  pr: 7,
  type: 'preview',
  name: PREVIEW,
  url: 'https://deploy-preview-7--site.example.app',
  sha,
});

test('findPreviews lists passed deploy-preview contexts and the deploy/netlify check run', () => {
  const rollup = [
    previewCtx(),
    previewCtx('PENDING', 'o/other/deploy-preview'),
    previewCtx('FAILURE', 'o/bad/deploy-preview'),
    ctx('o/site/lint', 'SUCCESS'),
    run('Header rules - site', 'COMPLETED', 'SUCCESS'),
    run('Pages changed - site', 'COMPLETED', 'SUCCESS'),
    run('Redirect rules - site', 'COMPLETED', 'SUCCESS'),
    { ...run('deploy/netlify', 'COMPLETED', 'SUCCESS'), detailsUrl: 'https://d--x.app' },
    run('deploy/netlify', 'IN_PROGRESS'),
  ];
  assert.deepEqual(findPreviews(rollup), [
    { name: PREVIEW, url: 'https://deploy-preview-7--site.example.app' },
    { name: 'deploy/netlify', url: 'https://d--x.app' },
  ]);
  assert.deepEqual(findPreviews(null), []);
});

test('a passing preview emits once, and not again on the next poll with the same head', () => {
  const pending = makeView({ statusCheckRollup: [previewCtx('PENDING')] });
  const live = makeView({ statusCheckRollup: [previewCtx()] });
  assert.deepEqual(diff(pending, live), [
    previewEvent(),
    { pr: 7, type: 'checks', from: 'pending', to: 'passing', failed: [] },
  ]);
  const saved = toStored(stored(pending), norm(live));
  assert.deepEqual(diffSnapshots(saved, norm(live), ME), []);
});

test('a new head commit reports the preview again', () => {
  const live = makeView({ statusCheckRollup: [previewCtx()] });
  const pushed = makeView({ statusCheckRollup: [previewCtx()], headRefOid: 'def' });
  assert.deepEqual(diff(live, pushed), [previewEvent('def')]);
  const saved = toStored(stored(live), norm(pushed));
  assert.deepEqual(saved.previews, {
    sha: 'def',
    ready: [{ name: PREVIEW, url: 'https://deploy-preview-7--site.example.app' }],
  });
});

test('stored ready previews are the ones ready now, and reset on a new head', () => {
  const both = makeView({
    statusCheckRollup: [previewCtx(), previewCtx('SUCCESS', 'o/two/deploy-preview')],
  });
  const saved = toStored(undefined, norm(both));
  assert.deepEqual(
    saved.previews.ready.map((p) => p.name),
    [PREVIEW, 'o/two/deploy-preview'],
  );
  const one = toStored(saved, norm(makeView({ statusCheckRollup: [previewCtx()] })));
  assert.deepEqual(
    one.previews.ready.map((p) => p.name),
    [PREVIEW],
  );
  const next = toStored(one, norm(makeView({ headRefOid: 'def' })));
  assert.deepEqual(next.previews, { sha: 'def', ready: [] });
});

test('a preview that fails and then succeeds on the same commit reports again', () => {
  const live = makeView({ statusCheckRollup: [previewCtx()] });
  const failed = makeView({ statusCheckRollup: [previewCtx('FAILURE')] });
  const afterFail = toStored(stored(live), norm(failed));
  assert.deepEqual(afterFail.previews, { sha: 'abc', ready: [] });
  assert.deepEqual(
    diffSnapshots(afterFail, norm(live), ME).filter((e) => e.type === 'preview'),
    [previewEvent()],
  );
});

test('pending and failing previews and rules check runs emit nothing', () => {
  const before = makeView();
  const after = makeView({
    statusCheckRollup: [
      previewCtx('PENDING'),
      previewCtx('FAILURE', 'o/bad/deploy-preview'),
      run('Header rules - site', 'COMPLETED', 'SUCCESS'),
    ],
  });
  assert.deepEqual(
    diff(before, after).filter((e) => e.type === 'preview'),
    [],
  );
});

test('a first poll emits nothing but publicView lists the preview', () => {
  const view = makeView({ statusCheckRollup: [previewCtx()] });
  assert.deepEqual(diffSnapshots(undefined, norm(view), ME), []);
  assert.deepEqual(publicView({ mode: 'reviewers', snapshot: stored(view) }).previews, [
    { name: PREVIEW, url: 'https://deploy-preview-7--site.example.app' },
  ]);
});

test('stored state from before previews existed does not crash', () => {
  const old = stored(makeView());
  delete old.previews;
  const live = makeView({ statusCheckRollup: [previewCtx()] });
  assert.deepEqual(
    diffSnapshots(old, norm(live), ME).filter((e) => e.type === 'preview'),
    [previewEvent()],
  );
  assert.deepEqual(toStored(old, norm(live)).previews.ready.length, 1);
  assert.deepEqual(publicView({ mode: 'reviewers', snapshot: old }).previews, []);
});
