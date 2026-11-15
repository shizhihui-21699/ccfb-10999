/**
 * BotGuard collection SDK — public entry point.
 *
 * Guarantees:
 *  - passive listeners + ring buffers + idle-time aggregation: no blocking work
 *    on input paths;
 *  - zero runtime dependencies;
 *  - every probe is exception-isolated.
 */
import { BehaviorCollector } from './behavior.js';
import { collectEnv, snapshotPerf } from './probes.js';
import { send } from './transport.js';
import type { BotGuardConfig, BotGuardReport, EnvSignals } from './types.js';
import { idle, on, uuid } from './util.js';

const VERSION = 1;
const DEFAULTS = {
  flushInterval: 5000,
  maxMouseSamples: 800,
  maxKeySamples: 200,
  mouseSampleEvery: 2,
  flushOnUnload: true,
};

class BotGuard {
  private cfg: Required<Omit<BotGuardConfig, 'extra' | 'manualStart' | 'endpoint'>> &
    Pick<BotGuardConfig, 'extra' | 'endpoint'>;
  private collector: BehaviorCollector;
  private env: EnvSignals | null = null;
  private sessionId = uuid();
  private seq = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private started = false;
  private disposed: Array<() => void> = [];

  constructor(config: BotGuardConfig) {
    this.cfg = { ...DEFAULTS, ...config };
    this.collector = new BehaviorCollector({
      maxMouse: this.cfg.maxMouseSamples,
      maxKeys: this.cfg.maxKeySamples,
      mouseSampleEvery: this.cfg.mouseSampleEvery,
    });
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.collector.attach();

    // Environment collection is the heaviest step (canvas/audio/fonts);
    // defer it until the browser is idle.
    idle(() => {
      void collectEnv().then((env) => {
        this.env = env;
        this.flush();
      });
    });

    this.timer = setInterval(() => this.flush(), this.cfg.flushInterval);
    if (this.cfg.flushOnUnload) {
      this.disposed.push(on(window, 'pagehide', () => this.flush(true)));
      this.disposed.push(on(document, 'visibilitychange', () => {
        if (document.hidden) this.flush(true);
      }));
    }
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.collector.dispose();
    for (const d of this.disposed) d();
    this.disposed = [];
    this.started = false;
  }

  /** Stable per-page-load identifier; test harnesses use it to fetch scores. */
  getSessionId(): string {
    return this.sessionId;
  }

  /** Build the report in idle time and dispatch it. */
  flush(finalBeacon = false): void {
    idle(() => {
      const behavior = this.collector.aggregate();
      const report: BotGuardReport = {
        v: VERSION,
        sessionId: this.sessionId,
        pageUrl: location.href,
        ts: Math.round(performance.now()),
        seq: this.seq++,
        env: this.env ?? this.placeholderEnv(),
        behavior,
        ...(this.cfg.extra ? { extra: this.cfg.extra } : {}),
      };
      // Refresh cheap timing snapshot on later flushes.
      if (this.env) this.env.perf = snapshotPerf();
      const ok = send(this.cfg.endpoint, JSON.stringify(report), finalBeacon);
      if (!ok && !finalBeacon) setTimeout(() => send(this.cfg.endpoint, JSON.stringify(report), false), 1000);
    });
  }

  /** First flush can happen before the idle env probes finish. */
  private placeholderEnv(): EnvSignals {
    return {
      ua: navigator.userAgent,
      platform: navigator.platform || '',
      language: navigator.language,
      languages: Array.from(navigator.languages || []),
      cores: navigator.hardwareConcurrency || 0,
      deviceMemory: -1,
      dpr: window.devicePixelRatio || 0,
      screen: {
        w: screen.width,
        h: screen.height,
        availW: screen.availWidth,
        availH: screen.availHeight,
        colorDepth: screen.colorDepth,
      },
      viewport: { w: innerWidth, h: innerHeight },
      timezone: '',
      timezoneOffset: new Date().getTimezoneOffset(),
      touch: {
        ontouchstart: 'ontouchstart' in window,
        maxTouchPoints: navigator.maxTouchPoints || 0,
        coarsePointer: matchMedia('(pointer: coarse)').matches,
      },
      webgl: { vendor: '', renderer: '', debugInfo: false },
      canvas: { hash: '', blocked: true },
      audio: { fingerprint: -1, supported: false },
      fonts: { count: 0 },
      permissions: {},
      plugins: { length: 0, names: [] },
      mediaDevices: 0,
      webdriver: navigator.webdriver === true,
      cdcVars: [],
      tamperedNatives: [],
      headlessFlags: [],
      automationGlobals: [],
      chrome: { present: false, runtime: false, app: false, csi: false, loadTimes: false },
      notification: { permission: 'unsupported', supported: false },
      iframe: { outerInnerDiff: 0, screenEqualsViewport: false },
      cssProbes: [],
      perf: { domContentLoaded: 0, loadEvent: 0, ttfb: 0 },
    };
  }
}

declare global {
  interface Window {
    BotGuard?: {
      start: () => void;
      stop: () => void;
      flush: (finalBeacon?: boolean) => void;
      getSessionId: () => string;
    };
  }
}

export function init(config: BotGuardConfig): BotGuard {
  const guard = new BotGuard(config);
  window.BotGuard = {
    start: () => guard.start(),
    stop: () => guard.stop(),
    flush: (b?: boolean) => guard.flush(b),
    getSessionId: () => guard.getSessionId(),
  };
  if (!config.manualStart) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => guard.start(), { once: true });
    } else {
      guard.start();
    }
  }
  return guard;
}

export type { BotGuardConfig, BotGuardReport } from './types.js';
