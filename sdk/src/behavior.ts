/**
 * Behavioural collection: mouse, keyboard, click, scroll, touch, focus.
 *
 * Non-blocking strategy:
 *  - every listener is passive + capture, never preventDefault-able work;
 *  - high-frequency mousemove is thinned and stored in a fixed ring buffer;
 *  - aggregation (loops over the buffers) runs in requestIdleCallback only;
 *  - key VALUES are never recorded — only timing and a length-bucketed hash.
 */
import type {
  BehaviorSignals,
  ClickSample,
  FocusEvent,
  KeySample,
  MouseSample,
  ScrollSample,
  TouchSample,
} from './types.js';
import { RingBuffer, cv, mean, std } from './util.js';

interface Limits {
  maxMouse: number;
  maxKeys: number;
  mouseSampleEvery: number;
}

export class BehaviorCollector {
  private start = performance.now();
  private disposers: Array<() => void> = [];

  private mouse = new RingBuffer<MouseSample>(this.limits.maxMouse);
  private keys = new RingBuffer<KeySample>(this.limits.maxKeys);
  private scroll = new RingBuffer<ScrollSample>(50);
  private clicks = new RingBuffer<ClickSample>(50);
  private touches = new RingBuffer<TouchSample>(50);
  private focusEvents: FocusEvent[] = [];

  private mouseSeen = 0;
  private untrusted = { mouse: 0, key: 0, scroll: 0, click: 0 };
  private lastKeyT = 0;
  private hiddenSince = 0;
  private hiddenTime = 0;

  constructor(private limits: Limits) {}

  private t(): number {
    return Math.round(performance.now() - this.start);
  }

  attach(): void {
    const d = this.disposers;
    d.push(this.onMouse());
    d.push(this.onKeys());
    d.push(this.onClicks());
    d.push(this.onScroll());
    d.push(this.onTouch());
    d.push(this.onFocus());
  }

  dispose(): void {
    for (const fn of this.disposers) fn();
    this.disposers = [];
  }

  // -------------------------------------------------------------------------
  private onMouse(): () => void {
    const handler = (e: MouseEvent): void => {
      if (++this.mouseSeen % this.limits.mouseSampleEvery !== 0) return;
      if (!e.isTrusted) this.untrusted.mouse++;
      this.mouse.push([
        this.t(),
        Math.round(e.clientX),
        Math.round(e.clientY),
        e.button,
        Math.round(e.movementX || 0),
        Math.round(e.movementY || 0),
        e.isTrusted,
      ]);
    };
    window.addEventListener('mousemove', handler, { passive: true, capture: true });
    return () => window.removeEventListener('mousemove', handler, { capture: true });
  }

  private onClicks(): () => void {
    const handler = (e: MouseEvent): void => {
      if (!e.isTrusted) this.untrusted.click++;
      this.clicks.push([this.t(), Math.round(e.clientX), Math.round(e.clientY), e.button, e.detail || 0, e.isTrusted]);
    };
    const opts = { passive: true, capture: true };
    window.addEventListener('click', handler, opts);
    return () => window.removeEventListener('click', handler, { capture: true });
  }

  private onKeys(): () => void {
    const down = new Map<string, number>();
    const handler = (e: KeyboardEvent): void => {
      if (!e.isTrusted) this.untrusted.key++;
      const t = this.t();
      const type = e.type === 'keydown' ? 0 : e.type === 'keyup' ? 1 : 2;
      // Never store the actual key/value: length bucket + cheap hash of code.
      const codeHash = e.code ? this.hash(e.code) : 0;
      const since = this.lastKeyT ? t - this.lastKeyT : 0;
      this.lastKeyT = t;
      if (e.type === 'keydown' && e.code) down.set(e.code, t);
      let dwell = 0;
      if (e.type === 'keyup' && e.code) {
        const s = down.get(e.code);
        if (s !== undefined) {
          dwell = t - s;
          down.delete(e.code);
        }
      }
      this.keys.push([t, type, e.key ? e.key.length : 0, codeHash, e.isTrusted, e.type === 'keyup' ? dwell : since]);
    };
    const opts = { passive: true, capture: true };
    window.addEventListener('keydown', handler, opts);
    window.addEventListener('keyup', handler, opts);
    return () => {
      window.removeEventListener('keydown', handler, { capture: true });
      window.removeEventListener('keyup', handler, { capture: true });
    };
  }

  private onScroll(): () => void {
    const handler = (e: Event): void => {
      if (!e.isTrusted) this.untrusted.scroll++;
      this.scroll.push([this.t(), Math.round(window.scrollX), Math.round(window.scrollY), e.isTrusted]);
    };
    window.addEventListener('scroll', handler, { passive: true, capture: true });
    return () => window.removeEventListener('scroll', handler, { capture: true });
  }

  private onTouch(): () => void {
    const handler = (e: TouchEvent): void => {
      const t = this.t();
      for (const touch of Array.from(e.changedTouches).slice(0, 3)) {
        this.touches.push([t, Math.round(touch.clientX), Math.round(touch.clientY), Math.round(touch.radiusX || 0), e.isTrusted]);
      }
    };
    const opts = { passive: true, capture: true };
    window.addEventListener('touchstart', handler, opts);
    window.addEventListener('touchmove', handler, opts);
    return () => {
      window.removeEventListener('touchstart', handler, { capture: true });
      window.removeEventListener('touchmove', handler, { capture: true });
    };
  }

  private onFocus(): () => void {
    const vis = (): void => {
      const hidden = document.hidden;
      if (hidden) this.hiddenSince = performance.now();
      else if (this.hiddenSince) {
        this.hiddenTime += performance.now() - this.hiddenSince;
        this.hiddenSince = 0;
      }
      this.focusEvents.push({ t: this.t(), type: 'visibility', hidden, isTrusted: true });
    };
    const blur = (e: Event): void => {
      this.focusEvents.push({ t: this.t(), type: 'blur', hidden: document.hidden, isTrusted: e.isTrusted });
    };
    const focus = (e: Event): void => {
      this.focusEvents.push({ t: this.t(), type: 'focus', hidden: document.hidden, isTrusted: e.isTrusted });
    };
    document.addEventListener('visibilitychange', vis, { passive: true, capture: true });
    window.addEventListener('blur', blur, { passive: true, capture: true });
    window.addEventListener('focus', focus, { passive: true, capture: true });
    return () => {
      document.removeEventListener('visibilitychange', vis, { capture: true });
      window.removeEventListener('blur', blur, { capture: true });
      window.removeEventListener('focus', focus, { capture: true });
    };
  }

  private hash(s: string): number {
    let h = 0;
    for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    return Math.abs(h) % 1024;
  }

  // -------------------------------------------------------------------------
  /** Compute all aggregates; intended to run inside requestIdleCallback. */
  aggregate(): BehaviorSignals {
    const mouse = this.mouse.toArray();
    const clicks = this.clicks.toArray();
    const keys = this.keys.toArray();
    const scrolls = this.scroll.toArray();
    const touch = this.touches.toArray();

    return {
      mouse: this.aggMouse(mouse),
      click: this.aggClick(clicks),
      keyboard: this.aggKeys(keys),
      scroll: this.aggScroll(scrolls),
      touch: { count: touch.length, samples: touch },
      focus: this.focusEvents.slice(-30),
      hiddenTime: Math.round(this.hiddenTime),
      sessionDuration: this.t(),
    };
  }

  private aggMouse(s: MouseSample[]): BehaviorSignals['mouse'] {
    const intervals: number[] = [];
    const speeds: number[] = [];
    let stationary = 0;
    let straight = 0;
    const angles: number[] = [];
    const accels: number[] = [];
    let prevV = 0;

    for (let i = 1; i < s.length; i++) {
      const [t1, x1, y1] = s[i];
      const [t0, x0, y0] = s[i - 1];
      const dt = t1 - t0;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const dist = Math.hypot(dx, dy);
      if (dt > 0) {
        intervals.push(dt);
        const v = dist / dt;
        speeds.push(v);
        accels.push(v - prevV);
        prevV = v;
      }
      if (dist === 0) stationary++;
      // Three-point straightness: middle point within 1px of the chord.
      if (i >= 2) {
        const [, ax, ay] = s[i - 2];
        const chord = Math.hypot(x1 - ax, y1 - ay);
        if (chord > 4) {
          const cross = Math.abs((x1 - ax) * (y0 - ay) - (y1 - ay) * (x0 - ax));
          const distToLine = cross / chord;
          if (distToLine < 1) straight++;
        }
        angles.push(Math.atan2(dy, dx));
      }
    }
    const jerkStd = std(accels.length >= 2 ? this.deltas(accels) : []);
    const denom = Math.max(1, s.length - 1);
    return {
      count: s.length,
      untrustedRatio: this.ratio(this.untrusted.mouse, s.length),
      stationaryRatio: stationary / denom,
      straightLineRatio: straight / Math.max(1, s.length - 2),
      intervalCV: cv(intervals),
      intervalMean: mean(intervals),
      intervalStd: std(intervals),
      speedMean: mean(speeds),
      speedCV: cv(speeds),
      angleMean: mean(angles),
      jerkStd,
      samples: s.slice(-300),
    };
  }

  private aggClick(s: ClickSample[]): BehaviorSignals['click'] {
    let dup = 0;
    for (let i = 1; i < s.length; i++) {
      if (s[i][1] === s[i - 1][1] && s[i][2] === s[i - 1][2]) dup++;
    }
    return {
      count: s.length,
      untrustedRatio: this.ratio(this.untrusted.click, s.length),
      duplicateRatio: s.length > 1 ? dup / (s.length - 1) : 0,
      samples: s,
    };
  }

  private aggKeys(s: KeySample[]): BehaviorSignals['keyboard'] {
    const rhythm: number[] = [];
    const dwells: number[] = [];
    for (let i = 0; i < s.length; i++) {
      const k = s[i];
      if (k[1] === 1 && k[5] > 0) dwells.push(k[5]); // keyup carries dwell
      if (i > 0 && k[1] === 0) {
        const gap = k[0] - s[i - 1][0];
        if (gap > 0) rhythm.push(gap);
      }
    }
    return {
      count: s.length,
      untrustedRatio: this.ratio(this.untrusted.key, s.length),
      intervalMean: mean(rhythm),
      intervalStd: std(rhythm),
      intervalCV: cv(rhythm),
      dwellMean: mean(dwells),
      samples: s.slice(-100),
    };
  }

  private aggScroll(s: ScrollSample[]): BehaviorSignals['scroll'] {
    let uniform = 0;
    for (let i = 2; i < s.length; i++) {
      const d1 = s[i - 1][2] - s[i - 2][2];
      const d2 = s[i][2] - s[i - 1][2];
      if (d1 !== 0 && d1 === d2) uniform++;
    }
    return {
      count: s.length,
      untrustedRatio: this.ratio(this.untrusted.scroll, s.length),
      uniformDeltaRatio: s.length > 2 ? uniform / (s.length - 2) : 0,
      samples: s,
    };
  }

  private deltas(xs: number[]): number[] {
    const out: number[] = [];
    for (let i = 1; i < xs.length; i++) out.push(xs[i] - xs[i - 1]);
    return out;
  }

  private ratio(untrusted: number, total: number): number {
    return total ? untrusted / total : 0;
  }
}
