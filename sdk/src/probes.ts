/**
 * Static environment probes.
 * Every probe is individually guarded: a throwing or blocked API must never
 * break the host page. Heavy probes run after DOM ready via collectEnv().
 */
import type { EnvSignals } from './types.js';
import { fnv1a, isNative } from './util.js';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const EMPTY_SCREEN = { w: 0, h: 0, availW: 0, availH: 0, colorDepth: 0 };

// ---------------------------------------------------------------------------
// Headless / automation global scans
// ---------------------------------------------------------------------------

const AUTOMATION_RE =
  /^(__playwright|__pw_|puppeteer|_phantom|__nightmare|nightmare|_selenium|__selenium|callSelenium|domAutomation|domAutomationController|cdc_|__webdriver|webdriver|driver-evaluate|driver_eval|\$chrome_asyncScriptInfo|__fxdriver|__driver)/i;

function scanAutomationGlobals(): { automation: string[]; cdc: string[] } {
  const automation: string[] = [];
  const cdc: string[] = [];
  safe(() => {
    const keys = Object.keys(window as unknown as Record<string, unknown>);
    for (const k of keys) {
      if (AUTOMATION_RE.test(k)) {
        if (/^cdc_|\$cdc_/.test(k)) cdc.push(k);
        else automation.push(k);
      }
      if (automation.length >= 10 && cdc.length >= 10) break;
    }
    // document-level ChromeDriver hook
    const doc = document as unknown as Record<string, unknown>;
    for (const k of Object.keys(doc)) {
      if (/\$chrome_asyncScriptInfo|^cdc_/.test(k)) cdc.push(k);
    }
  }, undefined);
  return { automation: automation.slice(0, 10), cdc: cdc.slice(0, 10) };
}

function scanHeadlessFlags(env: {
  ua: string;
  webdriver: boolean;
  glVendor: string;
  glRenderer: string;
  hasChrome: boolean;
  outerDiff: number;
  pluginCount: number;
  notifPermission: string;
  notifSupported: boolean;
  langs: string[];
}): string[] {
  const f: string[] = [];
  if (/headless/i.test(env.ua)) f.push('ua-headless');
  if (env.webdriver) f.push('webdriver-true');
  if (/swiftshader|software|llvmpipe|mesa|basic/i.test(`${env.glVendor} ${env.glRenderer}`))
    f.push('swiftshader-gl');
  if (!env.hasChrome && /chrome|crios|headlesschrome/i.test(env.ua)) f.push('missing-chrome-object');
  if (env.outerDiff === 0 && /chrome/i.test(env.ua)) f.push('outer-inner-diff-zero');
  if (env.pluginCount === 0 && /chrome|safari|firefox/i.test(env.ua)) f.push('plugins-empty');
  if (env.notifSupported && env.notifPermission === 'denied') f.push('notification-denied-default');
  if (env.langs.length === 0) f.push('languages-empty');
  // Error stack traces automation injection in some drivers.
  safe(() => {
    throw new Error('bg-stack-probe');
  }, undefined);
  let stack = '';
  try {
    throw new Error('bg-stack-probe');
  } catch (e) {
    stack = (e as Error).stack || '';
  }
  if (/puppeteer/i.test(stack)) f.push('stack-puppeteer');
  if (/playwright/i.test(stack)) f.push('stack-playwright');
  if (/selenium|webdriver/i.test(stack)) f.push('stack-selenium');
  return f;
}

// ---------------------------------------------------------------------------
// Native function integrity
// ---------------------------------------------------------------------------

function checkNatives(): string[] {
  const out: string[] = [];
  const w = window as unknown as Record<string, unknown>;
  const nav = navigator as unknown as Record<string, unknown>;

  const fnChecks: Array<[string, unknown]> = [
    ['Function.prototype.toString', Function.prototype.toString],
    ['window.fetch', w.fetch],
    ['XMLHttpRequest', w.XMLHttpRequest],
    ['WebSocket', w.WebSocket],
    ['Notification', w.Notification],
    ['Element.prototype.getBoundingClientRect', Element.prototype.getBoundingClientRect],
    ['HTMLCanvasElement.prototype.toDataURL', HTMLCanvasElement.prototype.toDataURL],
    ['HTMLCanvasElement.prototype.getContext', HTMLCanvasElement.prototype.getContext],
    ['navigator.permissions.query', (nav.permissions as Permissions | undefined)?.query],
  ];
  const gl = (w.WebGLRenderingContext as { prototype?: { getParameter?: unknown } } | undefined)?.prototype;
  if (gl?.getParameter) fnChecks.push(['WebGLRenderingContext.prototype.getParameter', gl.getParameter]);

  for (const [name, fn] of fnChecks) {
    if (fn !== undefined && !isNative(fn)) out.push(name);
  }

  const getterCheck = (obj: unknown, prop: string, label: string): void => {
    const d = Object.getOwnPropertyDescriptor(obj as object, prop);
    if (d && d.get !== undefined && !isNative(d.get)) out.push(label);
  };
  for (const p of ['webdriver', 'languages', 'plugins', 'hardwareConcurrency', 'deviceMemory', 'userAgent']) {
    getterCheck(Navigator.prototype, p, `navigator.${p}`);
  }
  getterCheck(nav, 'userAgentData', 'navigator.userAgentData');
  getterCheck(Window.prototype, 'outerWidth', 'window.outerWidth');
  getterCheck(Window.prototype, 'outerHeight', 'window.outerHeight');
  return out.slice(0, 15);
}

// ---------------------------------------------------------------------------
// Fingerprint probes
// ---------------------------------------------------------------------------

function webglInfo(): EnvSignals['webgl'] {
  return safe(() => {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return { vendor: '', renderer: '', debugInfo: false };
    const vendor = String(gl.getParameter(gl.VENDOR) || '');
    const renderer = String(gl.getParameter(gl.RENDERER) || '');
    const dbg = gl.getExtension('WEBGL_DEBUG_Renderer_Info'.toLowerCase());
    if (dbg) {
      return {
        vendor: String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) || vendor),
        renderer: String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || renderer),
        debugInfo: true,
      };
    }
    return { vendor, renderer, debugInfo: false };
  }, { vendor: '', renderer: '', debugInfo: false });
}

function canvasFp(): EnvSignals['canvas'] {
  return safe(() => {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 60;
    const ctx = c.getContext('2d');
    if (!ctx) return { hash: '', blocked: true };
    ctx.textBaseline = 'top';
    ctx.font = "16px 'Arial'";
    ctx.fillStyle = '#f60';
    ctx.fillRect(10, 10, 100, 30);
    ctx.fillStyle = '#069';
    ctx.fillText('BotGuard,fp!#%', 8, 18);
    ctx.fillStyle = 'rgba(102,204,0,0.7)';
    ctx.fillText('BotGuard,fp!#%', 10, 34);
    ctx.beginPath();
    ctx.arc(200, 30, 18, 0, Math.PI * 2);
    ctx.fill();
    const url = c.toDataURL();
    return { hash: fnv1a(url), blocked: false };
  }, { hash: '', blocked: true });
}

async function audioFp(): Promise<EnvSignals['audio']> {
  try {
    const AC = window.OfflineAudioContext ??
      (window as unknown as { webkitOfflineAudioContext?: typeof OfflineAudioContext }).webkitOfflineAudioContext;
    if (!AC) return { fingerprint: -1, supported: false };
    const ctx = new AC(1, 5000, 44100);
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 1000;
    const comp = ctx.createDynamicsCompressor();
    osc.connect(comp);
    comp.connect(ctx.destination);
    osc.start(0);
    const buf = await ctx.startRendering();
    const data = buf.getChannelData(0);
    // Sum a handful of late samples where compressor dynamics have settled.
    let sum = 0;
    for (const i of [4500, 4501, 4502, 4600, 4700, 4800, 4900]) sum += Math.abs(data[i] || 0);
    return { fingerprint: Math.round(sum * 1e9), supported: true };
  } catch {
    return { fingerprint: -1, supported: false };
  }
}

const FONT_STACK = [
  'Arial', 'Helvetica', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana',
  'Trebuchet MS', 'Comic Sans MS', 'Impact', 'Segoe UI', 'Apple Color Emoji',
  'Segoe UI Emoji', 'MS Gothic', 'Noto Sans CJK JP',
];

function fontCount(): number {
  return safe(() => {
    const c = document.createElement('canvas');
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    const probe = 'mmmmmmmmmmlli';
    ctx.font = "72px monospace";
    const base = ctx.measureText(probe).width;
    let n = 0;
    for (const font of FONT_STACK) {
      ctx.font = `72px '${font}', monospace`;
      if (ctx.measureText(probe).width !== base) n++;
    }
    return n;
  }, 0);
}

const PERM_NAMES = ['notifications', 'geolocation', 'camera', 'microphone', 'persistent-storage'];

async function permissionMap(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!navigator.permissions?.query) return out;
  await Promise.all(
    PERM_NAMES.map(async (name) => {
      try {
        // Camera/mic use the modern {name} descriptor; cast keeps tsc happy.
        const s = await navigator.permissions.query({ name: name as PermissionName });
        out[name] = s.state;
      } catch {
        out[name] = 'unsupported';
      }
    }),
  );
  return out;
}

function cssProbes(): string[] {
  return safe(() => {
    const out: string[] = [];
    const host = document.createElement('div');
    host.id = '__bg_css_host';
    host.style.cssText = 'position:fixed;left:-9999px;top:-9999px;width:1px;height:1px';
    const style = document.createElement('style');
    style.textContent =
      '@media all and (-webkit-min-device-pixel-ratio:0) and (min-resolution:.001dpcm)' +
      '{#__bg_css_host{width:13px !important}}';
    document.documentElement.append(style, host);
    if (host.offsetWidth === 13) out.push('chrome-webkit-css-hack');
    if (CSS.supports('-webkit-backdrop-filter', 'blur(1px)')) out.push('backdrop-filter');
    host.remove();
    style.remove();
    return out;
  }, []);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function snapshotPerf(): EnvSignals['perf'] {
  return safe(() => {
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    if (nav) {
      return {
        domContentLoaded: Math.round(nav.domContentLoadedEventEnd),
        loadEvent: Math.round(nav.loadEventEnd),
        ttfb: Math.round(nav.responseStart),
      };
    }
    const t = performance.timing;
    return {
      domContentLoaded: t.domContentLoadedEventEnd - t.navigationStart,
      loadEvent: t.loadEventEnd - t.navigationStart,
      ttfb: t.responseStart - t.navigationStart,
    };
  }, { domContentLoaded: 0, loadEvent: 0, ttfb: 0 });
}

export async function collectEnv(): Promise<EnvSignals> {
  const n = navigator;
  const scr = safe(() => screen, undefined);
  const gl = webglInfo();
  const globals = scanAutomationGlobals();
  const notifSupported = typeof Notification !== 'undefined';
  const outerDiff = safe(() => window.outerWidth - window.innerWidth, 0);
  const pluginNames = safe(
    () => Array.from(n.plugins || []).slice(0, 10).map((p) => p.name),
    [] as string[],
  );
  const mediaCount = await safe(async () => {
    const list = await n.mediaDevices?.enumerateDevices();
    return list ? list.length : 0;
  }, Promise.resolve(0));

  const env: EnvSignals = {
    ua: n.userAgent,
    platform: safe(() => n.userAgentData?.platform || n.platform || '', ''),
    language: n.language,
    languages: safe(() => Array.from(n.languages || []), []),
    cores: n.hardwareConcurrency || 0,
    deviceMemory: (n as unknown as { deviceMemory?: number }).deviceMemory ?? -1,
    dpr: safe(() => window.devicePixelRatio || 0, 0),
    screen: scr
      ? {
          w: scr.width,
          h: scr.height,
          availW: scr.availWidth,
          availH: scr.availHeight,
          colorDepth: scr.colorDepth,
        }
      : { ...EMPTY_SCREEN },
    viewport: { w: window.innerWidth, h: window.innerHeight },
    timezone: safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone || '', ''),
    timezoneOffset: new Date().getTimezoneOffset(),
    touch: {
      ontouchstart: safe(() => 'ontouchstart' in window, false),
      maxTouchPoints: n.maxTouchPoints || 0,
      coarsePointer: safe(() => matchMedia('(pointer: coarse)').matches, false),
    },
    webgl: gl,
    canvas: canvasFp(),
    audio: await audioFp(),
    fonts: { count: fontCount() },
    permissions: await permissionMap(),
    plugins: { length: pluginNames.length, names: pluginNames },
    mediaDevices: mediaCount,
    webdriver: n.webdriver === true,
    cdcVars: globals.cdc,
    tamperedNatives: checkNatives(),
    headlessFlags: [],
    automationGlobals: globals.automation,
    chrome: {
      present: safe(() => !!window.chrome, false),
      runtime: safe(() => !!(window.chrome && window.chrome.runtime), false),
      app: safe(() => !!(window.chrome && (window.chrome as unknown as { app?: unknown }).app), false),
      csi: safe(() => typeof (window.chrome as unknown as { csi?: unknown })?.csi === 'function', false),
      loadTimes: safe(
        () => typeof (window.chrome as unknown as { loadTimes?: unknown })?.loadTimes === 'function',
        false,
      ),
    },
    notification: {
      permission: notifSupported ? Notification.permission : 'unsupported',
      supported: notifSupported,
    },
    iframe: {
      outerInnerDiff: outerDiff,
      screenEqualsViewport: safe(
        () => !!scr && scr.width === window.innerWidth && scr.height === window.innerHeight,
        false,
      ),
    },
    cssProbes: cssProbes(),
    perf: snapshotPerf(),
  };

  env.headlessFlags = scanHeadlessFlags({
    ua: env.ua,
    webdriver: env.webdriver,
    glVendor: gl.vendor,
    glRenderer: gl.renderer,
    hasChrome: env.chrome.present,
    outerDiff,
    pluginCount: env.plugins.length,
    notifPermission: env.notification.permission,
    notifSupported,
    langs: env.languages,
  });
  return env;
}
