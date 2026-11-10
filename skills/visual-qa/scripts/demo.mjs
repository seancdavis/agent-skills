// demo — the demo video, drawn from screenshots instead of filmed.
//
// Why this exists: a recording of a headless browser has no cursor, no sign of
// what was clicked, dead time while pages load, and soft text. Instead, while
// the after side runs, DemoRecorder takes a few clean screenshots around each
// step (the page before the cursor arrives, with the target hovered, and once
// the click has settled) and notes where each target sits. renderDemo then
// draws every frame from those stills: a cursor gliding between targets, a
// ripple on each click, crossfades, smooth scrolling, a window frame, and
// captions. Restyling means re-rendering, not re-capturing.
//
// The recorder only runs inside runSide's guarded context, after sign-in, so a
// sign-in is never in the demo. Rendering happens in a separate context in
// which every request is aborted; it reads only the run's own screenshots, and
// captions and titles are drawn as canvas text, never as HTML.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newGuardedContext } from './signin.mjs';

export const CAPTION_MAX = 90;
const RECORD_TIMEOUT_MS = 5000;
const SETTLE_MS = 800;
const HOVER_MS = 150;
const SCROLL_FRAME_PX = 40;
const SCROLL_FRAMES = { min: 8, max: 30 };
const MAX_KEYFRAMES = 600;
const BATCH = 15;
const KEYFRAME = /^\d{3,5}-[a-z]+\.png$/;
const HOLDS = ['start', 'hover', 'afterClick', 'changed', 'screenshot', 'end'];
const KINDS = ['cursor', 'show', 'hold', 'move', 'click', 'caption', 'scroll'];

// Everything about the look and the pacing. Override any of it with a JSON file
// (`~/.claude/visual-qa/demo-style.json`, or `render-demo --style <file>`).
export const DEFAULT_STYLE = {
  fps: 30,
  quality: 0.95,
  padding: 80,
  captionSpace: 110,
  background: ['#0a262e', '#020a0e'],
  window: {
    bar: 34,
    barColor: '#162227',
    titleColor: '#8c9ea4',
    radius: 12,
    shadow: 28,
  },
  caption: {
    size: 30,
    color: '#ecf4f5',
    font: 'system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  },
  cursor: { scale: 1.45 },
  ripple: '#32e6e2',
  timing: {
    start: 1.2,
    hover: 0.35,
    click: 0.12,
    fade: 0.35,
    afterClick: 1.9,
    changed: 0.6,
    screenshot: 1.5,
    end: 2,
    scroll: 1.3,
    moveBase: 0.45,
    movePerPx: 0.00067,
  },
};

// ---------- pure logic ----------

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// Merges a style override onto `base`. Only keys `base` has are allowed, with
// the same types. Returns { style, problems }.
export function mergeStyle(override, base = DEFAULT_STYLE) {
  const problems = [];
  const merge = (over, into, path) => {
    if (!isPlainObject(over)) {
      problems.push(`${path || 'style'} must be an object.`);
      return into;
    }
    const out = { ...into };
    for (const [key, value] of Object.entries(over)) {
      const at = path ? `${path}.${key}` : key;
      if (!(key in into)) {
        problems.push(`Unknown style key ${at}.`);
        continue;
      }
      const current = into[key];
      if (isPlainObject(current)) out[key] = merge(value, current, at);
      else if (Array.isArray(current)) {
        const ok =
          Array.isArray(value) &&
          value.length === current.length &&
          value.every((v) => typeof v === 'string' && v.length <= 100);
        if (ok) out[key] = value;
        else problems.push(`${at} must be a list of ${current.length} color strings.`);
      } else if (typeof current === 'number') {
        if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 10000) {
          out[key] = value;
        } else problems.push(`${at} must be a number from 0 to 10000.`);
      } else if (typeof value === 'string' && value.length <= 200) out[key] = value;
      else problems.push(`${at} must be a string.`);
    }
    return out;
  };
  const style = merge(override ?? {}, base, '');
  if (!Number.isInteger(style.fps) || style.fps < 10 || style.fps > 60) {
    problems.push('fps must be a whole number from 10 to 60.');
  }
  if (style.quality < 0.5 || style.quality > 1) problems.push('quality must be from 0.5 to 1.');
  return { style, problems };
}

// Reads the style override file, if any. Returns { style, problems }.
export function loadStyle(file) {
  if (!file || !existsSync(file)) return mergeStyle({});
  let json;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    return { style: DEFAULT_STYLE, problems: [`Could not read ${file}: ${err.message}`] };
  }
  return mergeStyle(json);
}

export function isCaption(text) {
  return (
    typeof text === 'string' &&
    text.trim().length > 0 &&
    text.length <= CAPTION_MAX &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(text)
  );
}

const isPoint = (p) =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));

// Returns a list of problems; empty when the timeline is safe to render.
export function validateTimeline(json) {
  if (!isPlainObject(json)) return ['The timeline must be a JSON object.'];
  const problems = [];
  const { width, height } = json.viewport ?? {};
  const ok = (n) => Number.isInteger(n) && n >= 200 && n <= 4000;
  if (!ok(width) || !ok(height)) problems.push('viewport needs integer width and height.');
  if (json.title !== undefined && (typeof json.title !== 'string' || json.title.length > 200)) {
    problems.push('title must be a short string.');
  }
  if (!Array.isArray(json.events) || json.events.length > 5000) {
    return [...problems, 'events must be a list of at most 5000.'];
  }
  json.events.forEach((ev, i) => {
    const at = `event ${i}`;
    if (!isPlainObject(ev) || !KINDS.includes(ev.kind))
      return problems.push(`${at}: unknown kind.`);
    if (ev.kind === 'show' && !KEYFRAME.test(ev.file ?? '')) problems.push(`${at}: bad file name.`);
    if (ev.kind === 'scroll') {
      const files = Array.isArray(ev.files) ? ev.files : null;
      if (
        !files ||
        files.length === 0 ||
        files.length > 60 ||
        !files.every((f) => KEYFRAME.test(f))
      ) {
        problems.push(`${at}: scroll needs 1-60 keyframe file names.`);
      }
    }
    if (ev.kind === 'move' && !isPoint(ev.to)) problems.push(`${at}: move needs a point.`);
    if (ev.kind === 'cursor' && !isPoint(ev.at)) problems.push(`${at}: cursor needs a point.`);
    if (ev.kind === 'hold' && !HOLDS.includes(ev.for)) problems.push(`${at}: unknown hold.`);
    if (ev.kind === 'caption' && !isCaption(ev.text)) problems.push(`${at}: bad caption.`);
  });
  return problems;
}

// Turns the recorded events into timed tracks for the renderer. Durations come
// from the style, so the same keyframes can be re-paced.
export function planDemo(timeline, style = DEFAULT_STYLE) {
  const T = style.timing;
  const plan = { start: null, screens: [], moves: [], clicks: [], captions: [], scrolls: [] };
  let t = 0;
  let pos = null;
  let current = null;
  for (const ev of timeline.events) {
    switch (ev.kind) {
      case 'cursor':
        pos = ev.at;
        plan.start ??= ev.at;
        break;
      case 'show':
        plan.screens.push({ t, file: ev.file, fade: ev.fade ? T.fade : 0 });
        current = ev.file;
        break;
      case 'hold':
        t += T[ev.for] ?? 0;
        break;
      case 'move': {
        const from = pos ?? ev.to;
        const dur = T.moveBase + Math.hypot(ev.to[0] - from[0], ev.to[1] - from[1]) * T.movePerPx;
        plan.moves.push({ t0: t, t1: t + dur, from, to: ev.to });
        plan.start ??= from;
        pos = ev.to;
        t += dur;
        break;
      }
      case 'click':
        plan.clicks.push({ t, at: pos });
        t += T.click;
        break;
      case 'caption':
        plan.captions.push({ t, text: ev.text });
        break;
      case 'scroll': {
        const files = current ? [current, ...ev.files] : [...ev.files];
        plan.scrolls.push({ t0: t, t1: t + T.scroll, files });
        plan.screens.push({ t, scroll: plan.scrolls.length - 1, fade: 0 });
        t += T.scroll;
        current = files[files.length - 1];
        plan.screens.push({ t, file: current, fade: 0 });
        break;
      }
      default:
        break;
    }
  }
  plan.length = Math.max(t, 0.5);
  return plan;
}

const even = (n) => n + (n % 2);

// Where the window, the screenshots, and the captions sit on the canvas.
export function layoutFor(viewport, style, hasCaptions) {
  const vw = viewport.width;
  const vh = viewport.height;
  const pad = Math.round(style.padding);
  const winX = pad;
  const winY = Math.round(pad * 0.6);
  const screenY = winY + Math.round(style.window.bar);
  const bottom = hasCaptions ? Math.round(style.captionSpace) : winY;
  return {
    W: even(vw + 2 * pad),
    H: even(screenY + vh + bottom),
    vw,
    vh,
    padding: pad,
    winX,
    winY,
    screenX: winX,
    screenY,
    captionY: screenY + vh + bottom / 2,
  };
}

export function usedFiles(plan) {
  const files = new Set();
  for (const s of plan.screens) if (s.file) files.add(s.file);
  for (const s of plan.scrolls) for (const f of s.files) files.add(f);
  return [...files];
}

export function ffmpegStatus(run = spawnSync) {
  const res = run('ffmpeg', ['-version'], { encoding: 'utf8' });
  return { ffmpeg: res.status === 0 };
}

// ---------- in-page helpers (Playwright sends their source; no outside references) ----------

// The element's scroll container (or the page), where to scroll it so the
// element sits in the middle, and the container's center. With a number `y`,
// scrolls the container there first.
export function scrollRoot(el, y) {
  const scrollable = (n) =>
    /(auto|scroll|overlay)/.test(getComputedStyle(n).overflowY) &&
    n.scrollHeight > n.clientHeight + 1;
  let box = el.parentElement;
  while (box && box !== document.body && box !== document.documentElement && !scrollable(box)) {
    box = box.parentElement;
  }
  if (box === document.body || box === document.documentElement) box = null;
  const root = box ?? document.scrollingElement ?? document.documentElement;
  if (typeof y === 'number') root.scrollTo({ top: y, behavior: 'instant' });
  const rect = box ? box.getBoundingClientRect() : null;
  const top = rect ? rect.top : 0;
  const left = rect ? rect.left : 0;
  const view = box ? box.clientHeight : window.innerHeight;
  const width = box ? box.clientWidth : window.innerWidth;
  const r = el.getBoundingClientRect();
  const want = root.scrollTop + (r.top - top) - (view - Math.min(r.height, view)) / 2;
  const max = root.scrollHeight - root.clientHeight;
  return {
    from: root.scrollTop,
    to: Math.round(Math.max(0, Math.min(max, want))),
    center: [left + width / 2, top + view / 2],
  };
}

// The `scroll` scenario step: brings the target to the middle of its container.
export async function scrollStep(page, target, timeout) {
  const handle = await page.locator(target).first().elementHandle({ timeout });
  try {
    const plan = await handle.evaluate(scrollRoot, null);
    if (plan.to !== plan.from) await handle.evaluate(scrollRoot, plan.to);
  } finally {
    await handle.dispose();
  }
}

// ---------- recording keyframes ----------

// Runs alongside a side's steps: `start()` once the start page loaded,
// `before(step)` and `after(step)` around each step, `finish()` at the end.
// Errors here are the demo's, not the step's: runSide keeps going without it.
export class DemoRecorder {
  constructor({ page, dir, viewport, title, caption }) {
    this.page = page;
    this.dir = dir;
    this.viewport = viewport;
    this.title = title;
    this.caption = caption;
    this.events = [];
    this.count = 0;
    // A keyframe owed once the page settles: 'result' after a click or fill
    // (the mouse is still on the target), 'changed' after a key press,
    // navigation, or wait.
    this.pending = null;
    // The real mouse sits on the page where the drawn cursor is.
    this.mouseOver = false;
    mkdirSync(dir, { recursive: true });
  }

  async shot(label) {
    if (this.count >= MAX_KEYFRAMES) throw new Error('The demo has too many keyframes.');
    const file = `${String(this.count++).padStart(3, '0')}-${label}.png`;
    await this.page.screenshot({ path: join(this.dir, file) });
    return file;
  }

  // Off the page, so nothing is hovered.
  async park() {
    await this.page.mouse.move(-1, -1);
    this.mouseOver = false;
  }

  clamp([x, y]) {
    const { width, height } = this.viewport;
    return [
      Math.round(Math.min(Math.max(x, 0), width - 1)),
      Math.round(Math.min(Math.max(y, 0), height - 1)),
    ];
  }

  async start() {
    await this.park();
    const { width, height } = this.viewport;
    this.events.push({ kind: 'cursor', at: [Math.round(width * 0.62), Math.round(height * 0.42)] });
    if (this.caption) this.events.push({ kind: 'caption', text: this.caption });
    this.events.push({ kind: 'show', file: await this.shot('start') });
    this.events.push({ kind: 'hold', for: 'start' });
  }

  // The keyframe owed from the last step, once its page has settled.
  async settle() {
    if (!this.pending) return;
    await this.page.waitForLoadState('load', { timeout: RECORD_TIMEOUT_MS }).catch(() => {});
    await this.page.waitForTimeout(SETTLE_MS);
    const label = this.pending;
    this.pending = null;
    this.events.push({ kind: 'show', file: await this.shot(label), fade: true });
    this.events.push({ kind: 'hold', for: label === 'result' ? 'afterClick' : 'changed' });
  }

  // The cursor is about to move away: the hover ends as it leaves.
  async leave() {
    if (!this.mouseOver) return;
    await this.park();
    this.events.push({ kind: 'show', file: await this.shot('idle') });
  }

  async before(step) {
    const moves = ['click', 'fill', 'scroll'].includes(step.do);
    if (moves || step.do === 'screenshot') await this.settle();
    if (step.caption) this.events.push({ kind: 'caption', text: step.caption });
    if (step.do === 'click' || step.do === 'fill') await this.point(step.target);
    else if (step.do === 'scroll') await this.scroll(step.target);
  }

  async after(step) {
    if (step.do === 'click' || step.do === 'fill') this.pending = 'result';
    else if (['press', 'goto', 'wait', 'waitFor'].includes(step.do)) this.pending ??= 'changed';
    else if (step.do === 'screenshot') this.events.push({ kind: 'hold', for: 'screenshot' });
  }

  async point(target) {
    const locator = this.page.locator(target).first();
    await locator.scrollIntoViewIfNeeded({ timeout: RECORD_TIMEOUT_MS });
    await this.leave();
    const box = await locator.boundingBox({ timeout: RECORD_TIMEOUT_MS });
    if (!box) return;
    const at = this.clamp([box.x + box.width / 2, box.y + box.height / 2]);
    this.events.push({ kind: 'move', to: at });
    await this.page.mouse.move(at[0], at[1]);
    this.mouseOver = true;
    await this.page.waitForTimeout(HOVER_MS);
    this.events.push({ kind: 'show', file: await this.shot('hover') });
    this.events.push({ kind: 'hold', for: 'hover' });
    this.events.push({ kind: 'click' });
  }

  async scroll(target) {
    await this.leave();
    const handle = await this.page
      .locator(target)
      .first()
      .elementHandle({ timeout: RECORD_TIMEOUT_MS });
    try {
      const plan = await handle.evaluate(scrollRoot, null);
      const distance = plan.to - plan.from;
      if (distance === 0) return;
      this.events.push({ kind: 'move', to: this.clamp(plan.center) });
      const n = Math.min(
        SCROLL_FRAMES.max,
        Math.max(SCROLL_FRAMES.min, Math.round(Math.abs(distance) / SCROLL_FRAME_PX)),
      );
      const files = [];
      for (let i = 1; i <= n; i++) {
        await handle.evaluate(scrollRoot, Math.round(plan.from + (distance * i) / n));
        await this.page.waitForTimeout(40);
        files.push(await this.shot('scroll'));
      }
      this.events.push({ kind: 'scroll', files });
    } finally {
      await handle.dispose();
    }
  }

  async finish() {
    await this.settle();
    this.events.push({ kind: 'hold', for: 'end' });
    const timeline = {
      version: 1,
      viewport: this.viewport,
      title: this.title,
      events: this.events,
    };
    writeFileSync(join(this.dir, 'timeline.json'), `${JSON.stringify(timeline, null, 2)}\n`);
    return timeline;
  }
}

// ---------- rendering ----------

export function readTimeline(dir) {
  const file = join(dir, 'timeline.json');
  if (!existsSync(file)) throw new Error('No demo keyframes; capture with --demo first.');
  const timeline = JSON.parse(readFileSync(file, 'utf8'));
  const problems = validateTimeline(timeline);
  if (problems.length) throw new Error(`The demo timeline is invalid: ${problems[0]}`);
  return timeline;
}

// Runs inside the render page. It must not reference anything outside itself.
/* eslint-disable no-undef */
function compositor({ plan, style, layout, title }) {
  const { W, H, vw, vh, padding, winX, winY, screenX, screenY, captionY } = layout;
  const win = style.window;
  const winH = win.bar + vh;
  const canvas = document.querySelector('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const images = {};
  const clamp01 = (p) => Math.min(Math.max(p, 0), 1);
  const ease = (p) => {
    const q = clamp01(p);
    return q < 0.5 ? 4 * q * q * q : 1 - Math.pow(-2 * q + 2, 3) / 2;
  };
  const easeOut = (p) => 1 - Math.pow(1 - clamp01(p), 3);
  const windowPath = (c) => {
    c.beginPath();
    c.roundRect(winX, winY, vw, winH, win.radius);
  };

  const bg = document.createElement('canvas');
  bg.width = W;
  bg.height = H;
  const b = bg.getContext('2d');
  const gradient = b.createLinearGradient(0, 0, 0, H);
  gradient.addColorStop(0, style.background[0]);
  gradient.addColorStop(1, style.background[1]);
  b.fillStyle = gradient;
  b.fillRect(0, 0, W, H);
  if (win.shadow > 0) {
    b.save();
    b.shadowColor = 'rgba(0, 0, 0, 0.6)';
    b.shadowBlur = win.shadow;
    b.shadowOffsetY = Math.round(win.shadow * 0.6);
    b.fillStyle = '#000';
    windowPath(b);
    b.fill();
    b.restore();
  }
  if (win.bar > 0) {
    b.save();
    windowPath(b);
    b.clip();
    b.fillStyle = win.barColor;
    b.fillRect(winX, winY, vw, win.bar);
    ['#ff5f57', '#febc2e', '#28c840'].forEach((color, i) => {
      b.beginPath();
      b.arc(winX + 20 + i * 20, winY + win.bar / 2, 6, 0, Math.PI * 2);
      b.fillStyle = color;
      b.fill();
    });
    b.font = `14px ${style.caption.font}`;
    b.fillStyle = win.titleColor;
    b.textAlign = 'center';
    b.textBaseline = 'middle';
    b.fillText(title, winX + vw / 2, winY + win.bar / 2);
    b.restore();
  }

  const resolve = (s, t) => {
    if (s.scroll === undefined) return [[s.file, 1]];
    const sc = plan.scrolls[s.scroll];
    const n = sc.files.length;
    const x = ease((t - sc.t0) / (sc.t1 - sc.t0)) * (n - 1);
    const i = Math.floor(x);
    const f = x - i;
    return f > 0 && i + 1 < n
      ? [
          [sc.files[i], 1],
          [sc.files[i + 1], f],
        ]
      : [[sc.files[Math.min(i, n - 1)], 1]];
  };
  const screenLayers = (t) => {
    let i = 0;
    for (let k = 0; k < plan.screens.length && plan.screens[k].t <= t; k++) i = k;
    const s = plan.screens[i];
    if (!s) return [];
    const layers = resolve(s, t);
    if (s.fade > 0 && i > 0 && t - s.t < s.fade) {
      const a = ease((t - s.t) / s.fade);
      return [...resolve(plan.screens[i - 1], s.t), ...layers.map(([f, al]) => [f, al * a])];
    }
    return layers;
  };
  const cursorAt = (t) => {
    let pos = plan.start;
    for (const m of plan.moves) {
      if (t < m.t0) break;
      if (t >= m.t1) {
        pos = m.to;
        continue;
      }
      // A slight arc, like a hand moving a mouse.
      const p = ease((t - m.t0) / (m.t1 - m.t0));
      const [x0, y0] = m.from;
      const [x1, y1] = m.to;
      const cx = (x0 + x1) / 2 - (y1 - y0) * 0.12;
      const cy = (y0 + y1) / 2 + (x1 - x0) * 0.12;
      pos = [
        (1 - p) ** 2 * x0 + 2 * (1 - p) * p * cx + p * p * x1,
        (1 - p) ** 2 * y0 + 2 * (1 - p) * p * cy + p * p * y1,
      ];
      break;
    }
    return pos;
  };
  const drawCursor = ([x, y], pressed) => {
    const k = style.cursor.scale * (pressed ? 0.86 : 1);
    const pts = [
      [0, 0],
      [0, 16.5],
      [4, 12.8],
      [6.9, 19.3],
      [9.3, 18.3],
      [6.6, 11.9],
      [11.8, 11.9],
    ];
    ctx.save();
    ctx.translate(screenX + x, screenY + y);
    ctx.scale(k, k);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
    ctx.closePath();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.35)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetY = 2;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = '#fff';
    ctx.stroke();
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  };
  const drawCaption = (text, alpha) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    let size = style.caption.size;
    ctx.font = `${size}px ${style.caption.font}`;
    while (size > 12 && ctx.measureText(text).width > W - 2 * padding) {
      size -= 1;
      ctx.font = `${size}px ${style.caption.font}`;
    }
    ctx.fillStyle = style.caption.color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, W / 2, captionY);
    ctx.restore();
  };

  const draw = (t) => {
    ctx.globalAlpha = 1;
    ctx.drawImage(bg, 0, 0);
    ctx.save();
    windowPath(ctx);
    ctx.clip();
    for (const [file, alpha] of screenLayers(t)) {
      ctx.globalAlpha = alpha;
      ctx.drawImage(images[file], screenX, screenY, vw, vh);
    }
    ctx.restore();
    let pressed = false;
    for (const c of plan.clicks) {
      const age = t - c.t;
      if (age < 0 || age > 0.6 || !c.at) continue;
      if (age <= 0.14) pressed = true;
      const p = easeOut(age / 0.6);
      const r = 7 + 24 * p;
      ctx.save();
      ctx.beginPath();
      ctx.arc(screenX + c.at[0], screenY + c.at[1], r, 0, Math.PI * 2);
      ctx.globalAlpha = 0.22 * (1 - p);
      ctx.fillStyle = style.ripple;
      ctx.fill();
      ctx.globalAlpha = 0.67 * (1 - p);
      ctx.lineWidth = 3;
      ctx.strokeStyle = style.ripple;
      ctx.stroke();
      ctx.restore();
    }
    const pos = cursorAt(t);
    if (pos) drawCursor(pos, pressed);
    const shown = plan.captions.filter((c) => c.t <= t);
    if (shown.length) {
      const cur = shown[shown.length - 1];
      const a = ease((t - cur.t) / 0.3);
      if (a < 1 && shown.length > 1) drawCaption(shown[shown.length - 2].text, 1 - a);
      drawCaption(cur.text, a);
    }
  };

  window.__demo = {
    images,
    frames(from, to, fps, quality) {
      const out = [];
      for (let i = from; i < to; i++) {
        draw(i / fps);
        out.push(canvas.toDataURL('image/jpeg', quality));
      }
      return out;
    },
  };
}
/* eslint-enable no-undef */

function startFfmpeg(out, fps, run) {
  const proc = run(
    'ffmpeg',
    [
      '-y',
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      String(fps),
      '-c:v',
      'mjpeg',
      '-i',
      '-',
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-movflags',
      '+faststart',
      out,
    ],
    { stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  proc.stderr?.on('data', (d) => {
    stderr = (stderr + d).slice(-500);
  });
  proc.stdin.on('error', () => {});
  const done = new Promise((resolve, reject) => {
    proc.on('error', (err) =>
      reject(
        new Error(
          err.code === 'ENOENT'
            ? "ffmpeg isn't installed. Run `brew install ffmpeg`."
            : err.message,
        ),
      ),
    );
    proc.on('close', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`ffmpeg failed (${code}): ${stderr.split('\n')[0].slice(0, 200)}`)),
    );
  });
  return { proc, done };
}

function write(stream, buffer) {
  return new Promise((resolve) => {
    if (stream.write(buffer)) resolve();
    else stream.once('drain', resolve);
  });
}

// Draws the demo from `dir`'s keyframes and timeline into `out` (an MP4).
export async function renderDemo({ browser, dir, out, style = DEFAULT_STYLE }, deps = {}) {
  const run = deps.spawn ?? spawn;
  const timeline = readTimeline(dir);
  const plan = planDemo(timeline, style);
  const files = usedFiles(plan);
  const missing = files.find((f) => !existsSync(join(dir, f)));
  if (missing) throw new Error(`A demo keyframe is missing: ${missing}`);
  const layout = layoutFor(timeline.viewport, style, plan.captions.length > 0);
  const total = Math.max(1, Math.ceil(plan.length * style.fps));

  const context = await newGuardedContext(browser, { viewport: { width: 64, height: 64 } });
  let ffmpeg = null;
  try {
    // Nothing on this page may load anything: images arrive as data URLs.
    await context.route('**/*', (route) => route.abort());
    const page = await context.newPage();
    await page.setContent('<!doctype html><canvas></canvas>');
    await page.evaluate(compositor, { plan, style, layout, title: timeline.title ?? '' });
    for (const file of files) {
      const src = `data:image/png;base64,${readFileSync(join(dir, file)).toString('base64')}`;
      await page.evaluate(
        async ([name, url]) => {
          const img = new Image();
          img.src = url;
          await img.decode();
          window.__demo.images[name] = img;
        },
        [file, src],
      );
    }
    ffmpeg = startFfmpeg(out, style.fps, run);
    for (let i = 0; i < total; i += BATCH) {
      const urls = await page.evaluate(
        ([from, to, fps, quality]) => window.__demo.frames(from, to, fps, quality),
        [i, Math.min(total, i + BATCH), style.fps, style.quality],
      );
      for (const url of urls) {
        await write(ffmpeg.proc.stdin, Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
      }
    }
    ffmpeg.proc.stdin.end();
    await ffmpeg.done;
  } catch (err) {
    if (ffmpeg) {
      ffmpeg.done.catch(() => {});
      ffmpeg.proc.kill();
    }
    throw err;
  } finally {
    await context.close().catch(() => {});
  }
  return { frames: total, seconds: Math.round(plan.length * 10) / 10 };
}
