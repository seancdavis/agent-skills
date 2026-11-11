import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  renderDemo,
  scrollStep,
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
    // Keys every object has, which a plain `in` check would let through.
    JSON.parse('{"__proto__": {"padding": 1}}'),
    { toString: 'x' },
    { timing: { constructor: 1 } },
  ];
  for (const override of bad) {
    assert.ok(mergeStyle(override).problems.length > 0, JSON.stringify(override));
  }
});

test('loadStyle uses the defaults with no file, refuses a missing one, and reads one', () => {
  assert.deepEqual(loadStyle(null), { style: DEFAULT_STYLE, problems: [] });
  const missing = loadStyle(join(tmpdir(), 'no-such-style.json'));
  assert.match(missing.problems[0], /No style file at/);
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

const withClip = {
  ...timeline,
  events: [
    { kind: 'show', file: '000-start.png' },
    { kind: 'hold', for: 'start' },
    {
      kind: 'clip',
      files: ['001-clip.jpg', '002-clip.jpg', '003-clip.jpg'],
      times: [0, 0.4, 1.1],
      seconds: 2,
    },
    { kind: 'hold', for: 'end' },
  ],
};

test('validateTimeline takes a clip of real frames and refuses a bad one', () => {
  assert.deepEqual(validateTimeline(withClip), []);
  const clip = withClip.events[2];
  const swap = (change) => ({ ...timeline, events: [{ ...clip, ...change }] });
  assert.ok(validateTimeline(swap({ files: [], times: [] })).length > 0);
  assert.ok(validateTimeline(swap({ times: [0, 0.4] })).length > 0);
  assert.ok(validateTimeline(swap({ times: [0, 1.1, 0.4] })).length > 0);
  assert.ok(validateTimeline(swap({ times: [0, 0.4, 2.5] })).length > 0);
  assert.ok(validateTimeline(swap({ seconds: 0 })).length > 0);
  assert.ok(validateTimeline(swap({ seconds: 11 })).length > 0);
  assert.ok(
    validateTimeline(swap({ files: ['001-clip.jpg', '../x.jpg', '003-clip.jpg'] })).length > 0,
  );
  assert.ok(
    validateTimeline(swap({ files: ['001-clip.gif', '002-clip.jpg', '003-clip.jpg'] })).length > 0,
  );
});

test('planDemo plays a clip for its own length and ends on its last frame', () => {
  const plan = planDemo(withClip);
  assert.deepEqual(plan.clips, [
    { t0: T.start, files: ['001-clip.jpg', '002-clip.jpg', '003-clip.jpg'], times: [0, 0.4, 1.1] },
  ]);
  assert.deepEqual(plan.screens[1], { t: T.start, clip: 0, fade: 0 });
  assert.deepEqual(plan.screens[2], { t: T.start + 2, file: '003-clip.jpg', fade: 0 });
  assert.ok(close(plan.length, T.start + 2 + T.end));
  // Slower pacing doesn't stretch the real footage.
  const slow = mergeStyle({ timing: { start: T.start + 1 } }).style;
  assert.ok(close(planDemo(withClip, slow).screens[2].t - planDemo(withClip, slow).clips[0].t0, 2));
  assert.deepEqual(usedFiles(plan).sort(), [
    '000-start.png',
    '001-clip.jpg',
    '002-clip.jpg',
    '003-clip.jpg',
  ]);
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
  page.waits = 0;
  page.timeouts = [];
  page.scrolledTo = [];
  page.disposed = 0;
  page.mouse = { move: async (x, y) => page.moves.push([x, y]) };
  page.screenshot = async ({ path }) => {
    page.shots.push(path);
    writeFileSync(path, 'png');
  };
  page.waitForLoadState = async () => page.waits++;
  page.waitForTimeout = async () => page.waits++;
  // A screencast that, once started, repaints at whatever `page.paints` says:
  // seconds after the start, one frame each.
  page.paints = [];
  page.cdp = [];
  page.context = () => ({
    newCDPSession: async () => {
      const session = new EventEmitter();
      session.send = async (method) => {
        page.cdp.push(method);
        if (method !== 'Page.startScreencast') return;
        const base = Date.now() / 1000;
        page.paints.forEach((s, k) =>
          session.emit('Page.screencastFrame', {
            data: Buffer.from(`frame${k}`).toString('base64'),
            metadata: { timestamp: base + s },
            sessionId: k,
          }),
        );
      };
      session.detach = async () => page.cdp.push('detach');
      return session;
    },
  });
  // A list scrolled from 0 to 320 to center the target; its middle is (600, 400).
  const handle = {
    evaluate: async (_fn, y) => {
      if (typeof y === 'number') page.scrolledTo.push(y);
      return { from: 0, to: 320, center: [600, 400] };
    },
    dispose: async () => page.disposed++,
  };
  page.locator = () => ({
    first: () => ({
      scrollIntoViewIfNeeded: async ({ timeout }) => page.timeouts.push(timeout),
      boundingBox: async ({ timeout }) => {
        page.timeouts.push(timeout);
        return { x: 90, y: 280, width: 20, height: 40 };
      },
      elementHandle: async ({ timeout }) => {
        page.timeouts.push(timeout);
        return handle;
      },
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
    timeout: 1234,
  });
  const click = { do: 'click', target: 'text=Row', caption: 'Opens the row' };
  const click2 = { do: 'click', target: 'text=Back' };
  const shot = { do: 'screenshot', name: 'done', caption: 'Back on the list' };
  await rec.start();
  await rec.before(click);
  await rec.after(click);
  await rec.before({ do: 'wait', ms: 10 });
  await rec.after({ do: 'wait', ms: 10 });
  await rec.before(click2);
  await rec.after(click2);
  // The scenario's screenshot is taken with no extra wait, as on the before side.
  const waits = page.waits;
  await rec.before(shot);
  assert.equal(page.waits, waits);
  await rec.after(shot);
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
    'caption',
    'hold',
    'hold',
  ]);
  assert.equal(saved.events.at(-3).text, 'Back on the list');
  // The recorder looks for targets as long as it was told to.
  assert.ok(page.timeouts.length > 0);
  assert.ok(page.timeouts.every((t) => t === 1234));
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

test('DemoRecorder keeps about 30 real frames a second during a record step', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vqa-demo-'));
  const page = fakePage();
  // 60 repaints a second for 2 s, then one more after the step ends.
  page.paints = [...Array.from({ length: 120 }, (_, k) => k / 60), 2.5];
  const rec = new DemoRecorder({ page, dir, viewport: { width: 1200, height: 800 }, title: 't' });
  const click = { do: 'click', target: 'text=Deploy' };
  const record = { do: 'record', ms: 2000, caption: 'The preview loads' };
  await rec.start();
  await rec.before(click);
  await rec.after(click);
  const shots = page.shots.length;
  await rec.before(record);
  await rec.after(record);
  const saved = await rec.finish();

  // The clip is the click's result: no settled keyframe is taken before it.
  assert.equal(page.shots.length, shots);
  assert.ok(!saved.events.some((e) => e.file?.endsWith('-result.png')));
  const clip = saved.events.find((e) => e.kind === 'clip');
  assert.equal(clip.seconds, 2);
  assert.ok(clip.files.length >= 55 && clip.files.length <= 61, String(clip.files.length));
  assert.ok(clip.times.every((s) => s <= 2));
  assert.ok(clip.times.slice(1).every((s, k) => s - clip.times[k] >= 0.9 / 30 - 1e-9));
  assert.ok(clip.files.every((f) => /^\d{3}-clip\.jpg$/.test(f)));
  assert.equal(readFileSync(join(dir, clip.files[0]), 'utf8'), 'frame0');
  assert.deepEqual(page.cdp.slice(0, 1), ['Page.startScreencast']);
  assert.ok(page.cdp.includes('Page.stopScreencast'));
  assert.ok(page.cdp.includes('detach'));
  // The caption shows from the clip's start; the mouse stayed on the target.
  const at = saved.events.findIndex((e) => e.kind === 'clip');
  assert.equal(saved.events[at - 1].text, 'The preview loads');
  assert.deepEqual(page.moves.at(-1), [100, 300]);
  assert.deepEqual(validateTimeline(saved), []);
});

test('DemoRecorder holds one still for a record step on a page that never repaints', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vqa-demo-'));
  const page = fakePage();
  const rec = new DemoRecorder({ page, dir, viewport: { width: 1200, height: 800 }, title: 't' });
  await rec.start();
  await rec.before({ do: 'record', ms: 500 });
  await rec.after({ do: 'record', ms: 500 });
  const saved = await rec.finish();
  const clip = saved.events.find((e) => e.kind === 'clip');
  assert.deepEqual(clip, { kind: 'clip', files: ['001-clip.png'], times: [0], seconds: 0.5 });
  assert.deepEqual(validateTimeline(saved), []);
});

test('DemoRecorder keeps keyframe names inside its folder', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'vqa-demo-'));
  const page = fakePage();
  const rec = new DemoRecorder({ page, dir, viewport: { width: 800, height: 600 }, title: 't' });
  await rec.start();
  for (const path of page.shots) assert.ok(path.startsWith(dir));
  assert.match(page.shots[0], /000-start\.png$/);
});

test('scrollStep and DemoRecorder scroll the target to the middle of its list', async () => {
  const page = fakePage();
  await scrollStep(page, 'text=Published', 10000);
  assert.deepEqual(page.scrolledTo, [320]);
  assert.equal(page.disposed, 1);

  const dir = mkdtempSync(join(tmpdir(), 'vqa-demo-'));
  const scrolling = fakePage();
  const rec = new DemoRecorder({ page: scrolling, dir, viewport: { width: 1200, height: 800 } });
  await rec.start();
  await rec.before({ do: 'scroll', target: 'text=Published' });
  const saved = await rec.finish();
  // 320 px in steps of about 40 px: 8 frames, the last one at the target.
  assert.deepEqual(scrolling.scrolledTo, [40, 80, 120, 160, 200, 240, 280, 320]);
  const scroll = saved.events.find((e) => e.kind === 'scroll');
  assert.equal(scroll.files.length, 8);
  assert.ok(scroll.files.every((f) => /^\d{3}-scroll\.png$/.test(f)));
  assert.deepEqual(saved.events.find((e) => e.kind === 'move').to, [600, 400]);
  assert.equal(scrolling.disposed, 1);
  assert.deepEqual(validateTimeline(saved), []);
});

// ---------- rendering ----------

function demoRun() {
  const dir = mkdtempSync(join(tmpdir(), 'vqa-render-'));
  writeFileSync(join(dir, 'timeline.json'), JSON.stringify(timeline));
  for (const file of usedFiles(planDemo(timeline))) writeFileSync(join(dir, file), 'png');
  return dir;
}

// A browser whose render page hands back one tiny JPEG per frame asked for.
function fakeRenderBrowser() {
  const seen = { routes: [], closed: false, html: null };
  const page = {
    setContent: async (html) => {
      seen.html = html;
    },
    evaluate: async (_fn, arg) => {
      if (Array.isArray(arg) && typeof arg[0] === 'number') {
        const [from, to] = arg;
        return Array.from({ length: to - from }, () => 'data:image/jpeg;base64,/9j/');
      }
      return undefined;
    },
  };
  const context = {
    route: async (pattern, handler) => seen.routes.push(handler),
    routeWebSocket: async () => {},
    newPage: async () => page,
    close: async () => {
      seen.closed = true;
    },
  };
  return { browser: { newContext: async () => context }, seen };
}

// ffmpeg that takes every frame, or stops with `code` once it has `stopAt` frames.
function fakeFfmpeg({ stopAt = Infinity, code = 1 } = {}) {
  const proc = new EventEmitter();
  proc.frames = 0;
  proc.killed = false;
  proc.stderr = new EventEmitter();
  proc.stdin = new EventEmitter();
  proc.stdin.write = () => {
    proc.frames++;
    if (proc.frames < stopAt) return true;
    setImmediate(() => {
      proc.stderr.emit('data', 'Invalid data found when processing input\n');
      proc.emit('close', code);
    });
    return false;
  };
  proc.stdin.end = () => setImmediate(() => proc.emit('close', 0));
  proc.kill = () => {
    proc.killed = true;
  };
  return proc;
}

test('renderDemo sends every frame to ffmpeg from a page that loads nothing', async () => {
  const dir = demoRun();
  const { browser, seen } = fakeRenderBrowser();
  const proc = fakeFfmpeg();
  let args;
  const out = join(dir, 'demo.mp4');
  const res = await renderDemo(
    { browser, dir, out },
    {
      spawn: (cmd, rest) => {
        args = [cmd, ...rest];
        return proc;
      },
    },
  );
  assert.equal(res.frames, Math.ceil(planDemo(timeline).length * DEFAULT_STYLE.fps));
  assert.equal(proc.frames, res.frames);
  assert.equal(args[0], 'ffmpeg');
  assert.equal(args.at(-1), out);
  assert.equal(seen.closed, true);
  // The render page's own route, registered after the network guard's, aborts
  // even a public request.
  let aborted = false;
  seen.routes.at(-1)({
    request: () => ({ url: () => 'https://example.com/x.png' }),
    abort: () => {
      aborted = true;
    },
    continue: () => {},
  });
  assert.equal(aborted, true);
});

test('renderDemo fails instead of waiting forever when ffmpeg stops early', async () => {
  for (const [code, message] of [
    [1, /ffmpeg failed \(1\): Invalid data/],
    [0, /stopped before the last frame/],
  ]) {
    const dir = demoRun();
    const { browser, seen } = fakeRenderBrowser();
    const proc = fakeFfmpeg({ stopAt: 3, code });
    await assert.rejects(
      renderDemo({ browser, dir, out: join(dir, 'demo.mp4') }, { spawn: () => proc }),
      message,
    );
    assert.equal(proc.frames, 3);
    assert.equal(proc.killed, true);
    assert.equal(seen.closed, true);
  }
});

test('renderDemo refuses a run with a missing keyframe before opening a page', async () => {
  const dir = demoRun();
  rmSync(join(dir, '002-result.png'));
  const { browser, seen } = fakeRenderBrowser();
  await assert.rejects(
    renderDemo({ browser, dir, out: join(dir, 'demo.mp4') }, { spawn: () => fakeFfmpeg() }),
    /keyframe is missing: 002-result\.png/,
  );
  assert.equal(seen.html, null);
});
