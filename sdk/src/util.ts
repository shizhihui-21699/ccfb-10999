/** Small shared helpers — kept dependency-free and tree-shake friendly. */

/** Fixed-capacity ring buffer; overwrites oldest entries, never allocates past cap. */
export class RingBuffer<T> {
  private buf: T[] = [];
  private head = 0;
  readonly cap: number;

  constructor(cap: number) {
    this.cap = Math.max(1, cap);
  }

  push(item: T): void {
    if (this.buf.length < this.cap) {
      this.buf.push(item);
    } else {
      this.buf[this.head] = item;
      this.head = (this.head + 1) % this.cap;
    }
  }

  /** Items in chronological order (oldest → newest). */
  toArray(): T[] {
    if (this.buf.length < this.cap) return this.buf.slice();
    return this.buf.slice(this.head).concat(this.buf.slice(0, this.head));
  }

  get length(): number {
    return this.buf.length;
  }

  clear(): void {
    this.buf = [];
    this.head = 0;
  }
}

export function mean(xs: number[]): number {
  if (!xs.length) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function std(xs: number[], m?: number): number {
  if (xs.length < 2) return 0;
  const mu = m ?? mean(xs);
  let s = 0;
  for (const x of xs) s += (x - mu) * (x - mu);
  return Math.sqrt(s / (xs.length - 1));
}

/** Coefficient of variation; 0 when mean is 0. */
export function cv(xs: number[]): number {
  const m = mean(xs);
  if (m === 0) return 0;
  return std(xs, m) / m;
}

/** FNV-1a 32-bit hash — small, good enough for canvas/audio fingerprints. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback (insecure contexts): time + random, still unique enough per session.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    return (ch === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const NATIVE_RE = /\{\s*\[native code\]\s*\}/;

/** True when a function's source still looks like a browser built-in. */
export function isNative(fn: unknown): boolean {
  if (typeof fn !== 'function') return false;
  try {
    return NATIVE_RE.test(Function.prototype.toString.call(fn));
  } catch {
    return false;
  }
}

/** Wrap addEventListener in passive mode where applicable to avoid blocking scrolling. */
export function on(
  target: EventTarget,
  type: string,
  handler: EventListenerOrEventListenerObject,
  passive = false,
): () => void {
  target.addEventListener(type, handler, passive ? { passive: true, capture: true } : { capture: true });
  return () => target.removeEventListener(type, handler, { capture: true });
}

/** Run work during idle time without delaying input/paint; rAF fallback. */
export function idle(cb: () => void): void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  if (ric) ric(cb);
  else setTimeout(cb, 0);
}
