/**
 * Shared wire protocol between the collection SDK and the scoring server.
 * Single source of truth; imported type-only on both sides (zero runtime cost
 * in the bundled SDK).
 */

export interface BotGuardConfig {
  /** Collection endpoint that accepts POSTed JSON reports. */
  endpoint: string;
  /** Flush interval in ms (default 5000). */
  flushInterval?: number;
  /** Max mouse samples retained in the ring buffer (default 800). */
  maxMouseSamples?: number;
  /** Max keyboard samples retained (default 200). */
  maxKeySamples?: number;
  /** Sample one of every N mousemove events at most (default 2). */
  mouseSampleEvery?: number;
  /** Auto-flush on pagehide (default true). */
  flushOnUnload?: boolean;
  /** Extra fields merged into every report (campaign id, placement, ...). */
  extra?: Record<string, unknown>;
  /** Disable automatic start; call window.BotGuard.start() manually. */
  manualStart?: boolean;
}

/** Static / quasi-static browser environment fingerprints. */
export interface EnvSignals {
  ua: string;
  platform: string;
  language: string;
  languages: string[];
  cores: number;
  /** -1 when unsupported */
  deviceMemory: number;
  dpr: number;
  screen: { w: number; h: number; availW: number; availH: number; colorDepth: number };
  viewport: { w: number; h: number };
  timezone: string;
  timezoneOffset: number;
  touch: { ontouchstart: boolean; maxTouchPoints: number; coarsePointer: boolean };
  webgl: { vendor: string; renderer: string; debugInfo: boolean };
  canvas: { hash: string; blocked: boolean };
  audio: { fingerprint: number; supported: boolean };
  fonts: { count: number };
  permissions: Record<string, string>;
  plugins: { length: number; names: string[] };
  mediaDevices: number;
  webdriver: boolean;
  cdcVars: string[];
  tamperedNatives: string[];
  headlessFlags: string[];
  automationGlobals: string[];
  chrome: { present: boolean; runtime: boolean; app: boolean; csi: boolean; loadTimes: boolean };
  notification: { permission: string; supported: boolean };
  iframe: { outerInnerDiff: number; screenEqualsViewport: boolean };
  cssProbes: string[];
  perf: { domContentLoaded: number; loadEvent: number; ttfb: number };
}

/** [t, x, y, button, movementX, movementY, isTrusted] */
export type MouseSample = [number, number, number, number, number, number, boolean];
/** [t, type(0=down 1=up 2=press), keyLength, codeHash, isTrusted, timeSincePrevOrDwell] */
export type KeySample = [number, number, number, number, boolean, number];
/** [t, scrollX, scrollY, isTrusted] */
export type ScrollSample = [number, number, number, boolean];
/** [t, x, y, button, detail, isTrusted] */
export type ClickSample = [number, number, number, number, number, boolean];
/** [t, x, y, radiusX, isTrusted] */
export type TouchSample = [number, number, number, number, boolean];

export interface FocusEvent {
  t: number;
  type: 'focus' | 'blur' | 'visibility';
  hidden: boolean;
  isTrusted: boolean;
}

export interface BehaviorSignals {
  mouse: {
    count: number;
    untrustedRatio: number;
    stationaryRatio: number;
    straightLineRatio: number;
    intervalCV: number;
    intervalMean: number;
    intervalStd: number;
    speedMean: number;
    speedCV: number;
    angleMean: number;
    jerkStd: number;
    samples: MouseSample[];
  };
  click: { count: number; untrustedRatio: number; duplicateRatio: number; samples: ClickSample[] };
  keyboard: {
    count: number;
    untrustedRatio: number;
    intervalMean: number;
    intervalStd: number;
    intervalCV: number;
    dwellMean: number;
    samples: KeySample[];
  };
  scroll: { count: number; untrustedRatio: number; uniformDeltaRatio: number; samples: ScrollSample[] };
  touch: { count: number; samples: TouchSample[] };
  focus: FocusEvent[];
  hiddenTime: number;
  sessionDuration: number;
}

export interface BotGuardReport {
  v: number;
  sessionId: string;
  pageUrl: string;
  ts: number;
  seq: number;
  env: EnvSignals;
  behavior: BehaviorSignals;
  extra?: Record<string, unknown>;
}
