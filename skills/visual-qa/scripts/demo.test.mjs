import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  DEFAULT_STYLE,
  DemoRecorder,
  ffmpegStatus,
  isCaption,
  layoutFor,
  loadStyle,
  mergeStyle,
  planDemo,
  usedFiles,
  validateTimeline,
} from './demo.mjs';

const T = DEFAULT_STYLE.timing;
const close = (a, b) => Math.abs(a - b) < 1e-9;

// ---------- style ----------

test('mergeStyle keeps the defaults and applies nested overrides', () => {
  const { style, problems } = mergeStyle({
    padding: 40,
    timing: { afterClick: 3 },
    ripple: '#fff',
  });
  assert.deepEqual(problems, []);
  assert.equal(style.padding, 40);
  assert.equal(style.timing.afterClick, 3);
  assert.equal(style.timing.fade, T.fade);
  assert.equal(style.ripple, '#fff');
  assert.equal(DEFAULT_STYLE.padding, 80);
});

test('mergeStyle refuses unknown keys, wrong types, and out-of-range values', () => {
  const bad = [
    { sparkle: true },
    { padding: -1 },
    { padding: '80' },
    { padding: Number.NaN },
    { background: ['#000'] },
    { background: '#000' },
    { window: 'none' },
    { caption: { size: 1e6 } },
    { fps: 24.5 },
    { fps: 120 },
    { quality: 0.2 },
  ];
  for (const override of bad) {
    assert.ok(mergeStyle(override).problems.length > 0, JSON.stringify(override));
  }
});

test('loadStyle uses the defaults when there is no file, and reads one when there is', () => {
  assert.deepEqual(loadStyle(join(tmpdir(), 'no-such-style.json')).style, DEFAULT_STYLE);
  const file = join(mkdtempSync(join(tmpdir(), 'vqa-style-')), 'style.json');
  writeFileSync(file, JSON.stringify({ captionSpace: 140 }));
  assert.equal(loadStyle(file).style.captionSpace, 140);
  writeFileSync(file, '{not json');
  assert.ok(loadStyle(file).problems.length > 0);
});

test('isCaption takes one short line of text', () => {
  assert.equal(isCaption('Opens the run'), true);
  assert.equal(isCaption(''), false);
  assert.equal(isCaption('   '), false);
  assert.equal(isCaption('a\nb'), false);
  assert.equal(isCaption('x'.repeat(91)), false);
  assert.equal(isCaption(3), false);
});

// ---------- timeline ----------

const timeline = {
  version: 1,
  viewport: { width: 1200, height: 800 },
  title: 'deploy-preview-7--app.example.test',
  events: [
    { kind: 'cursor', at: [700, 300] },
    { kind: 'show', file: '000-start.png' },
    { kind: 'hold', for: 'start' },
    { kind: 'caption', text: 'Opens its preview' },
    { kind: 'move', to: [100, 300] },
    { kind: 'show', file: '001-hover.png' },
    { kind: 'hold', for: 'hover' },
    { kind: 'click' },
    { kind: 'show', file: '002-result.png', fade: true },
    { kind: 'hold', for: 'afterClick' },
    { kind: 'show', file: '003-idle.png' },
    { kind: 'move', to: [100, 300] },
    { kind: 'scroll', files: ['004-scroll.png', '005-scroll.png'] },
    { kind: 'hold', for: 'end' },
  ],
};

test('validateTimeline accepts a recorded timeline', () => {
  assert.deepEqual(validateTimeline(timeline), []);
});

test('validateTimeline refuses paths, unknown kinds, bad points, and bad captions', () => {
  const swap = (event) => ({ ...timeline, events: [event] });
  assert.ok(validateTimeline(swap({ kind: 'show', file: '../run.json' })).length > 0);
  assert.ok(validateTimeline(swap({ kind: 'show', file: '/etc/passwd' })).length > 0);
  assert.ok(
    validateTimeline(swap({ kind: 'scroll', files: ['000-a.png', 'x/../y.png'] })).length > 0,
  );
  assert.ok(validateTimeline(swap({ kind: 'scroll', files: [] })).length > 0);
  assert.ok(validateTimeline(swap({ kind: 'eval' })).length > 0);
  assert.ok(validateTimeline(swap({ kind: 'move', to: [1, 'x'] })).length > 0);
  assert.ok(validateTimeline(swap({ kind: 'hold', for: 'forever' })).length > 0);
  assert.ok(validateTimeline(swap({ kind: 'caption', text: 'x'.repeat(200) })).length > 0);
  assert.ok(validateTimeline({ ...timeline, viewport: { width: 10, height: 10 } }).length > 0);
  assert.ok(validateTimeline(null).length > 0);
});

test('planDemo times moves, clicks, fades, captions, and scrolls from the style', () => {
  const plan = planDemo(timeline);
  assert.deepEqual(plan.start, [700, 300]);

  const move = T.moveBase + 600 * T.movePerPx;
  assert.equal(plan.moves.length, 2);
  assert.ok(close(plan.moves[0].t0, T.start));
  assert.ok(close(plan.moves[0].t1, T.start + move));
  assert.deepEqual(plan.moves[0].from, [700, 300]);

  const clickAt = T.start + move + T.hover;
  assert.ok(close(plan.clicks[0].t, clickAt));
  assert.deepEqual(plan.clicks[0].at, [100, 300]);

  assert.equal(plan.captions[0].text, 'Opens its preview');
  assert.ok(close(plan.captions[0].t, T.start));

  const result = plan.screens.find((s) => s.file === '002-result.png');
  assert.equal(result.fade, T.fade);
  assert.ok(close(result.t, clickAt + T.click));
  assert.equal(plan.screens.find((s) => s.file === '003-idle.png').fade, 0);

  // The scroll starts from the screen showing before it and ends on its last frame.
  assert.deepEqual(plan.scrolls[0].files, ['003-idle.png', '004-scroll.png', '005-scroll.png']);
  const last = plan.screens[plan.screens.length - 1];
  assert.equal(last.file, '005-scroll.png');
  assert.ok(close(last.t, plan.scrolls[0].t1));
  assert.ok(close(plan.length, plan.scrolls[0].t1 + T.end));
});

test('planDemo re-paces the same keyframes with a different style', () => {
  const slow = mergeStyle({ timing: { afterClick: T.afterClick + 2 } }).style;
  assert.ok(close(planDemo(timeline, slow).length, planDemo(timeline).length + 2));
});

test('usedFiles lists every keyframe the plan draws, once', () => {
  assert.deepEqual(usedFiles(planDemo(timeline)).sort(), [
    '000-start.png',
    '001-hover.png',
    '002-result.png',
    '003-idle.png',
    '004-scroll.png',
    '005-scroll.png',
  ]);
});

test('layoutFor makes even dimensions and leaves caption room only when needed', () => {
  const withCaptions = layoutFor({ width: 1201, height: 797 }, DEFAULT_STYLE, true);
  const without = layoutFor({ width: 1201, height: 797 }, DEFAULT_STYLE, false);
  assert.equal(withCaptions.W % 2, 0);
  assert.equal(withCaptions.H % 2, 0);
  assert.ok(withCaptions.H > without.H);
  assert.ok(withCaptions.captionY > withCaptions.screenY + 797);
});

test('ffmpegStatus reports whether ffmpeg runs', () => {
  assert.deepEqual(
    ffmpegStatus(() => ({ status: 0 })),
    { ffmpeg: true },
  );
  assert.deepEqual(
    ffmpegStatus(() => ({ status: null, error: new Error('ENOENT') })),
    {
      ffmpeg: false,
    },
  );
});

// ---------- recording ----------

function fakePage() {
  const page = new EventEmitter();
  page.moves = [];
  page.shots = [];
  page.mouse = { move: async (x, y) => page.moves.push([x, y]) };
  page.screenshot = async ({ path }) => {
    page.shots.push(path);
    writeFileSync(path, 'png');
  };
  page.waitForLoadState = async () => {};
  page.waitForTimeout = async () => {};
  page.locator = () => ({
    first: () => ({
      scrollIntoViewIfNeeded: async () => {},
      boundingBox: async () => ({ x: 90, y: 280, width: 20, height: 40 }),
    }),
  });
  return page;
}

test('DemoRecorder takes idle, hover, and result keyframes around a click', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vqa-demo-'));
  const page = fakePage();
  const rec = new DemoRecorder({
    page,
    dir,
    viewport: { width: 1200, height: 800 },
    title: 'example.test',
    caption: 'The list',
  });
  const click = { do: 'click', target: 'text=Row', caption: 'Opens the row' };
  const click2 = { do: 'click', target: 'text=Back' };
  await rec.start();
  await rec.before(click);
  await rec.after(click);
  await rec.before({ do: 'wait', ms: 10 });
  await rec.after({ do: 'wait', ms: 10 });
  await rec.before(click2);
  await rec.after(click2);
  await rec.before({ do: 'screenshot', name: 'done' });
  await rec.after({ do: 'screenshot', name: 'done' });
  const saved = await rec.finish();

  const kinds = saved.events.map((e) => (e.kind === 'show' ? `show:${e.file}` : e.kind));
  assert.deepEqual(kinds, [
    'cursor',
    'caption',
    'show:000-start.png',
    'hold',
    'caption',
    'move',
    'show:001-hover.png',
    'hold',
    'click',
    // The wait after the first click doesn't take its own keyframe: the click's
    // result is taken once, when the next click needs it.
    'show:002-result.png',
    'hold',
    'show:003-idle.png',
    'move',
    'show:004-hover.png',
    'hold',
    'click',
    'show:005-result.png',
    'hold',
    'hold',
    'hold',
  ]);
  assert.deepEqual(saved.events[5].to, [100, 300]);
  assert.equal(saved.events.find((e) => e.file === '002-result.png').fade, true);
  assert.equal(saved.events.find((e) => e.file === '003-idle.png').fade, undefined);
  // The mouse is parked off the page before the start and idle shots.
  assert.deepEqual(page.moves, [
    [-1, -1],
    [100, 300],
    [-1, -1],
    [100, 300],
  ]);
  assert.deepEqual(validateTimeline(saved), []);
  assert.ok(existsSync(join(dir, 'timeline.json')));
  assert.deepEqual(JSON.parse(readFileSync(join(dir, 'timeline.json'), 'utf8')), saved);
});

test('DemoRecorder keeps keyframe names inside its folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vqa-demo-'));
  const page = fakePage();
  const rec = new DemoRecorder({ page, dir, viewport: { width: 800, height: 600 }, title: 't' });
  await rec.start();
  for (const path of page.shots) assert.ok(path.startsWith(dir));
  assert.match(page.shots[0], /000-start\.png$/);
});
