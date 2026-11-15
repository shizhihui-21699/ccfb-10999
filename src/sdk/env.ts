/**
 * Environment fingerprint collector.
 *
 * Runs synchronously once at startup with only cheap reads; the expensive
 * probes (WebGL context creation, canvas text metrics) are deferred to an
 * idle callback so they never compete with the merchant's page work.
 *
 * Every read is individually guarded: a tampered or throwing getter yields
 * a `null` / sentinel rather than breaking collection. Tampering itself is
 * recorded as evidence (own-property descriptors, non-native getters).
 */

interface AnyObj { [k: string]: any }

const hasOwn = (o: AnyObj, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isNative = (fn: any): boolean => {
  try {
    return /\[native code\]\s*\}/.test(Function.prototype.toString.call(fn));
  } catch {
    return false;
  }
};

export interface EnvCollector {
  facts: AnyObj;
  finalize: (cb: () => void) => void;
}

export function collectEnv(): EnvCollector {
  const n: AnyObj = navigator;
  const w: AnyObj = window;
  const d: any = document;
  const facts: AnyObj = {
    // identity strings
    ua: (() => { try { return String(n.userAgent); } catch { return ''; } })(),
    platform: safe(() => String(n.platform)),
    vendor: safe(() => String(n.vendor)),
    languages: safe(() => Array.from(n.languages || [n.language as string]).slice(0, 8).map(String)),
  };

  // --- contradictions between UA string and structured client hints ---
  const ua = facts.ua as string;
  const uaIsMobile = /Mobile|Android|iPhone|iPad|iPod/i.test(ua);
  const uaIsIOS = /iPhone|iPad|iPod/i.test(ua);
  facts.uaMobileString = uaIsMobile;
  facts.uaIOS = uaIsIOS;

  try {
    const ud = n.userAgentData;
    facts.uaBrands = ud ? Array.from((ud.brands || []) as Array<{ brand: string; version: string }>).slice(0, 6).map((b) => b.brand + '/' + b.version) : [];
    facts.uaMobile = ud ? !!ud.mobile : null;
    facts.uaPlatform = ud ? safe(() => String(ud.platform)) : null;
    facts.hasUAData = !!ud;
  } catch {
    facts.uaBrands = [];
    facts.uaMobile = null;
    facts.uaPlatform = null;
    facts.hasUAData = false;
  }

  // --- automation flags, including cross-realm check ---
  facts.webdriver = safe(() => (n.webdriver === true ? true : n.webdriver === false ? false : null));
  facts.webdriverOwnProp = hasOwn(n, 'webdriver');
  // The iframe cross-check forces a fresh document to be created, which is
  // the single most expensive synchronous probe (~1.8ms here). It is a strong
  // signal but nothing depends on it being ready before first paint, so it
  // is filled in during the deferred phase.
  facts.iframeWebdriver = null;

  // own-property tampering on navigator: native browsers expose these on
  // Navigator.prototype, so an own property means an override script ran.
  const TAMPER_KEYS = ['webdriver', 'plugins', 'mimeTypes', 'languages', 'platform', 'userAgent', 'hardwareConcurrency', 'deviceMemory', 'maxTouchPoints', 'vendor', 'userAgentData', 'permissions'];
  const ownProps: string[] = [];
  const nonNative: string[] = [];
  for (const k of TAMPER_KEYS) {
    if (!hasOwn(n, k)) continue;
    ownProps.push(k);
    try {
      const desc = Object.getOwnPropertyDescriptor(n, k);
      if (desc && desc.get && !isNative(desc.get)) nonNative.push(k);
    } catch { /* ignore */ }
  }
  facts.navOwnTampered = ownProps;
  facts.navNonNative = nonNative;
  facts.permissionsQueryTampered = safe(() => {
    const q = n.permissions && n.permissions.query;
    return q ? !isNative(q) : null;
  });
  facts.funcToStringTampered = safe(() => !isNative(w.setTimeout));
  facts.suspiciousGlobals = safe(() => {
    const names = ['__playwright__', '__playwright', '__pw_manual', '__pwInitScripts', '__nightmare', '_phantom', 'callPhantom', 'callSelenium', '_selenium', '__webdriver_evaluate', '__webdriver_script_fn', '__fxdriver_evaluate', '__driver_evaluate', 'domAutomation', 'domAutomationController', 'spawn', '__lastWatirAlert', '__webview_execute'];
    const hit: string[] = [];
    for (const k of names) if (k in w) hit.push(k);
    try {
      for (const k of Object.getOwnPropertyNames(w)) {
        if (/^(cdc_|$cdc_|$wdc_|__puppeteer|__playwright)/.test(k)) hit.push(k.slice(0, 24));
      }
    } catch { /* ignore */ }
    return hit.slice(0, 8);
  });

  // --- rendering stack ---
  facts.webdriverDesc = safe(() => {
    const proto = Object.getPrototypeOf(n);
    const desc = Object.getOwnPropertyDescriptor(proto, 'webdriver');
    return desc ? 'proto:' + (desc.get ? 'getter' : 'value') : 'absent';
  });

  // --- capability facts ---
  facts.maxTouchPoints = safe(() => Number(n.maxTouchPoints) || 0);
  facts.touchSupported = safe(() => 'ontouchstart' in w);
  facts.pointerCoarse = safe(() => !!w.matchMedia('(pointer: coarse)').matches);
  facts.pointerFine = safe(() => !!w.matchMedia('(pointer: fine)').matches);
  facts.hoverNone = safe(() => !!w.matchMedia('(hover: none)').matches);
  facts.pluginsN = safe(() => Number(n.plugins && n.plugins.length) || 0);
  facts.mimeN = safe(() => Number(n.mimeTypes && n.mimeTypes.length) || 0);
  facts.pluginNames = safe(() => Array.from((n.plugins || []) as ArrayLike<any>).slice(0, 6).map((p: any) => String(p.name)));
  facts.pdfViewerEnabled = safe(() => (typeof n.pdfViewerEnabled === 'boolean' ? n.pdfViewerEnabled : null));
  facts.chromeKeys = safe(() => {
    const c = w.chrome;
    return c ? Object.getOwnPropertyNames(c).slice(0, 8) : null;
  });
  facts.notifPermission = safe(() => (typeof Notification !== 'undefined' ? Notification.permission : null));
  facts.hardwareConcurrency = safe(() => Number(n.hardwareConcurrency) || null);
  facts.deviceMemory = safe(() => Number(n.deviceMemory) || null);
  facts.connection = safe(() => {
    const c = n.connection;
    return c ? { et: c.effectiveType, dl: c.downlink, rtt: c.rtt } : null;
  });

  // --- geometry: the window frame is one of the strongest headless tells ---
  facts.screenW = safe(() => screen.width); facts.screenH = safe(() => screen.height);
  facts.availW = safe(() => screen.availWidth); facts.availH = safe(() => screen.availHeight);
  facts.colorDepth = safe(() => screen.colorDepth);
  facts.innerW = safe(() => w.innerWidth); facts.innerH = safe(() => w.innerHeight);
  facts.outerW = safe(() => w.outerWidth); facts.outerH = safe(() => w.outerHeight);
  facts.screenX = safe(() => w.screenX); facts.screenY = safe(() => w.screenY);
  facts.dpr = safe(() => Number(w.devicePixelRatio) || 1);
  facts.vvScale = safe(() => (w.visualViewport ? w.visualViewport.scale : null));
  facts.orientation = safe(() => (screen.orientation ? String(screen.orientation.type) : null));

  // --- clock ---
  // Intl.DateTimeFormat triggers a one-off ICU initialisation costing ~5ms on
  // a cold page (measured), which would dominate the synchronous path for a
  // signal that is only corroborating evidence. Timezone and locale are
  // therefore filled in during the deferred phase; the raw offset is cheap.
  facts.tz = null;
  facts.locale = null;
  facts.cal = null;
  facts.tzOffset = safe(() => new Date().getTimezoneOffset());

    // Deferred heavy probes. WebGL and canvas metrics are the only allocations
  // in the hot path, so they run in idle time and are merged before send.
  const deferred: Array<() => void> = [];

  deferred.push(() => {
    const gl = safe(() => {
      const canvas = d.createElement('canvas');
      const ctx = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!ctx) return null;
      const ext = ctx.getExtension('WEBGL_debug_renderer_info');
      return {
        vendor: ext ? ctx.getParameter(ext.UNMASKED_VENDOR_WEBGL) : ctx.getParameter(ctx.VENDOR),
        renderer: ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER),
        maxViewport: ctx.getParameter(ctx.MAX_VIEWPORT_DIMS),
        exts: ctx.getSupportedExtensions() ? ctx.getSupportedExtensions()!.length : 0,
      };
    });
    if (gl) {
      facts.glVendor = String(gl.vendor || '');
      facts.glRenderer = String(gl.renderer || '');
      facts.glExts = gl.exts;
      facts.glMaxViewport = gl.maxViewport ? Math.max(gl.maxViewport[0], gl.maxViewport[1]) : null;
    } else {
      facts.glVendor = null; facts.glRenderer = null; facts.glExts = null; facts.glMaxViewport = null;
    }
  });

  deferred.push(() => {
    const opts = safe(() => Intl.DateTimeFormat().resolvedOptions());
    if (opts) {
      facts.tz = String(opts.timeZone || '');
      facts.locale = String(opts.locale || '');
      facts.cal = String(opts.calendar || '');
    }
  });

  deferred.push(() => {
    facts.iframeWebdriver = safe(() => {
      const f = d.createElement('iframe');
      f.style.display = 'none';
      (d.body || d.documentElement).appendChild(f);
      const v = f.contentWindow.navigator.webdriver;
      f.parentNode.removeChild(f);
      return v === true ? true : v === false ? false : null;
    });
  });

  deferred.push(() => {
    facts.canvasMetrics = safe(() => {
      const c = d.createElement('canvas').getContext('2d');
      if (!c) return null;
      const m = (font: string, text: string) => { c.font = font; return Math.round(c.measureText(text).width * 100) / 100; };
      return {
        serif: m('16px serif', 'mmmmmmmmmmlli'),
        sans: m('16px sans-serif', 'mmmmmmmmmmlli'),
        mono: m('16px monospace', 'mmmmmmmmmmlli'),
        emoji: m('16px sans-serif', '\u{1F600}'),
        cjk: m('16px sans-serif', '汉字测醧'),
      };
    });
  });

  deferred.push(() => {
    facts.audio = safe(() => {
      const AC = w.AudioContext || w.webkitAudioContext;
      if (!AC) return null;
      const c = new AC();
      const out = { sr: c.sampleRate, ch: c.destination.maxChannelCount, lat: Math.round((c.baseLatency || 0) * 10000) / 10000 };
      // Release the context immediately; keeping it alive would burn audio
      // resources for a probe that runs once.
      safe(() => c.close());
      return out;
    });
  });

  const finalize = (cb: () => void) => {
    let done = 0;
    const total = deferred.length;
    const run = (fn: () => void) => {
      try { fn(); } finally { if (++done === total) cb(); }
    };
    // Wait until the first paint has had a chance to happen before touching
    // GPU or audio. Creating a WebGL context during load competes with the
    // merchant's own first paint, which is exactly the kind of jank the SDK
    // promises not to add. The scheduler below therefore nests one idle
    // callback after a post-load tick.
    const schedule = () => {
      const idle = (w.requestIdleCallback as any);
      for (const fn of deferred) {
        if (idle) idle(() => run(fn), { timeout: 1200 });
        else setTimeout(() => run(fn), 200);
      }
    };
    const afterPaint = () => {
      if (w.requestAnimationFrame) w.requestAnimationFrame(() => setTimeout(schedule, 0));
      else setTimeout(schedule, 0);
    };
    if (d.readyState === 'complete') afterPaint();
    else w.addEventListener('load', afterPaint, { once: true });
  };

  return { facts, finalize };
}

function safe<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}
