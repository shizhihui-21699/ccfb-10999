/**
 * BotShield collector SDK — entry point.
 *
 * Public contract (drop-in for a merchant's page):
 *   const bs = BotShield.init({ endpoint, siteKey, sample? })
 *   bs.snapshot()  -> FeaturePacket
 *   bs.send()      -> Promise<void>     (also fires automatically before unload)
 *   bs.onScore(cb) -> subscribe to the server's verdict (requires endpoint)
 *
 * The SDK is deliberately synchronous at init and never blocks paint: all
 * heavy probes run in requestIdleCallback and all listeners are passive.
 */

import { collectEnv } from './env';
import { collectBehavior } from './behavior';

interface InitOptions {
  endpoint?: string;
  siteKey?: string;
  /** Also POST automatically right before the page unloads. */
  autoSend?: boolean;
  /** Override session id (tests use this for reproducibility). */
  sid?: string;
  /** Disable network entirely; snapshot() still works. */
  offline?: boolean;
  /** Called with the server score when a request completes. */
  onScore?: (r: any) => void;
}

interface Packet {
  v: 1;
  sid: string;
  ts: number;
  dur: number;
  page: { host: string; path: string; ref: string };
  env: any;
  behavior: any;
  perf: { dropped: number; initMs: number };
}

const VERSION = 1;

function hexId(): string {
  try {
    const b = new Uint8Array(16);
    if (crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    let s = '';
    for (let i = 0; i < 16; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16);
    return s;
  } catch {
    return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
}

const initStart = (() => {
  try { return performance.now(); } catch { return 0; }
})();

export function init(opts: InitOptions = {}) {
  const t0 = initStart;
  const sid = opts.sid || hexId();
  const env = collectEnv();
  const beh = collectBehavior();
  let finalized = false;
  let initMs = 0;
  let scoreCb = opts.onScore || null;

  const build = (): Packet => {
    const dur = Math.round((safeNow() - t0) * 10) / 10;
    let host = '', path = '', ref = '';
    try { host = location.hostname; } catch { /* ignore */ }
    try { path = location.pathname.slice(0, 120); } catch { /* ignore */ }
    try { ref = document.referrer ? new URL(document.referrer).hostname : ''; } catch { /* ignore */ }
    return {
      v: VERSION,
      sid,
      ts: Date.now(),
      dur,
      page: { host, path, ref },
      env: env.facts,
      behavior: beh.facts(),
      perf: { dropped: 0, initMs: Math.round(initMs * 100) / 100 },
    };
  };

  const snapshot = () => build();

  const settle = (cb: () => void) => {
    if (finalized) { cb(); return; }
    env.finalize(() => { finalized = true; initMs = safeNow() - t0; cb(); });
  };

  const send = (): Promise<any> => new Promise(resolve => {
    if (opts.offline || !opts.endpoint) { resolve(null); return; }
    // The send path is wrapped so a blocking network call can never surface
    // as an unhandled rejection in the merchant's console.
    const fire = () => {
      let body: string;
      try { body = JSON.stringify(build()); } catch { resolve(null); return; }
      try {
        const url = opts.endpoint as string;
        if (navigator.sendBeacon && body.length < 60000) {
          const ok = navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
          if (ok) { resolve(null); return; }
        }
        const xhr = new XMLHttpRequest();
        xhr.open('POST', url, true);
        xhr.setRequestHeader('content-type', 'application/json');
        xhr.onload = () => {
          try {
            const r = JSON.parse(xhr.responseText);
            if (scoreCb) scoreCb(r);
            resolve(r);
          } catch { resolve(null); }
        };
        xhr.onerror = () => resolve(null);
        xhr.send(body);
      } catch { resolve(null); }
    };
    settle(fire);
    // settle() only defers by an idle tick; if the page is unloading, the
    // browser may never run it, so also flush on pagehide and mark finalized.
  });

  const autoSend = opts.autoSend !== false && !opts.offline && !!opts.endpoint;
  if (autoSend) {
    try {
      window.addEventListener('pagehide', () => { send(); }, { once: true });
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') send();
      }, { once: true });
    } catch { /* ignore */ }
  }

  return {
    sid,
    snapshot,
    send,
    envReady: (cb: () => void) => settle(cb),
    onScore: (cb: (r: any) => void) => { scoreCb = cb; },
  };
}

function safeNow(): number {
  try { return performance.now(); } catch { return Date.now() - initStart; }
}

// UMD-ish global for script-tag usage, without pulling in a bundler shim.
try {
  if (typeof window !== 'undefined') {
    (window as any).BotShield = { init };
  }
} catch { /* ignore */ }
