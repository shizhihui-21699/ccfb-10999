/**
 * Regression tests for the scoring engine.
 *
 * These are synthetic fixtures, not captured packets: each asserts that one
 * specific rule fires (or deliberately does not) so a future weight tweak
 * cannot silently break the explanation an analyst relies on.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { score } from '../src/server/score/engine.ts';
import type { FeaturePacket } from '../src/shared/types.ts';

const baseEnv = (over: any = {}): any => ({
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36',
  uaBrands: ['Not-A.Brand/99', 'Google Chrome/157', 'Chromium/157'],
  uaMobile: false, uaPlatform: 'macOS', hasUAData: true,
  platform: 'MacIntel', vendor: 'Google Inc.',
  languages: ['zh-CN', 'zh'], language: 'zh-CN',
  webdriver: false, webdriverDesc: 'proto:getter', iframeWebdriver: false,
  maxTouchPoints: 0, touchSupported: false, pointerCoarse: false, pointerFine: true, hoverNone: false,
  pluginsN: 5, mimeN: 2, pluginNames: ['PDF Viewer', 'Chrome PDF Viewer'], pdfViewerEnabled: true,
  chromeKeys: ['loadTimes', 'csi', 'app'], notifPermission: 'default',
  screenW: 2560, screenH: 1440, availW: 2560, availH: 1380, colorDepth: 24,
  innerW: 1000, innerH: 693, outerW: 1000, outerH: 780, screenX: 40, screenY: 60,
  dpr: 2, vvScale: 1,
  hardwareConcurrency: 14, deviceMemory: 8,
  conn: { et: '4g', dl: 1.5, rtt: 100 },
  tz: 'Asia/Shanghai', locale: 'zh-CN', cal: 'gregory',
  glVendor: 'Google Inc. (Apple)',
  glRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)',
  glExts: 39, glMaxViewport: 16384,
  canvasMetrics: { serif: 138.62, sans: 148.42, mono: 125.23, emoji: 20, cjk: 64 },
  navOwnTampered: [], navNonNative: [], suspiciousGlobals: [],
  permissionsQueryTampered: false, funcToStringTampered: false,
  ...over,
});

const humanMouse = (over: any = {}): any => ({
  samples: [{ t: 1200, x: 300, y: 200 }, { t: 1220, x: 360, y: 235 }, { t: 1250, x: 415, y: 268 }],
  moveCount: 40, pathLen: 520, straightness: 0.55, segCV: 0.55, dtCV: 2.1,
  zeroDt: 0, intCoord: 1, dirRate: 0.32,
  teleportClicks: 0, teleportRatio: 0, clickDwellMean: 92, clickDwellCV: 0.3,
  ...over,
});

const humanKeys = (over: any = {}): any => ({
  keys: 12,
  gap: { median: 180, cv: 0.5, zeroRatio: 0, n: 11, min: 60 },
  dwell: { median: 90, cv: 0.3, zeroRatio: 0, n: 12 },
  corrections: 0, paste: 0, ...over,
});

const packet = (env: any, behavior: any): FeaturePacket => ({
  v: 1, sid: 'test', ts: 0, dur: 5000,
  page: { host: 'shop.example', path: '/', ref: '' },
  env, perf: { dropped: 0, initMs: 2 },
  behavior: {
    events: {}, pointerTypes: { mouse: 40 }, firstInteractionMs: 1200,
    clicks: 1, touchStarts: 0, touchMoves: 0, touchMulti: 0, touchDwellMedian: null, touchDwellMin: null,
    untrustedRatio: 0,
    mouse: humanMouse(), keyboard: humanKeys(),
    scroll: { events: 0, deltaCV: null, gapCV: null, medianGap: 0 },
    focus: { blur: 0, hidden: 0 },
    ...behavior,
  },
});

test('clean human session scores zero and is allowed', () => {
  const r = score(packet(baseEnv(), {}));
  assert.equal(r.score, 0);
  assert.equal(r.verdict, 'allow');
  assert.equal(r.deterministic, false);
  assert.equal(r.families.every(f => f.points === 0), true);
});

test('headless UA is a deterministic hit and blocks', () => {
  const r = score(packet(baseEnv({
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/159.0.0.0 Safari/537.36',
    uaBrands: ['HeadlessChrome/159', 'Chromium/159'],
  }), {}));
  assert.equal(r.verdict, 'block');
  assert.equal(r.deterministic, true);
  assert.ok(r.top.some(h => h.id === 'auto.headless-ua' && h.certain));
});

test('mobile UA without touch is a contradiction', () => {
  const r = score(packet(baseEnv({
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 0,
  }), {}));
  const h = r.families.find(f => f.id === 'contradiction')!.hits.find(x => x.id === 'contra.mobile-no-touch');
  assert.ok(h, 'contra.mobile-no-touch must fire');
  assert.equal(h!.certain, true);
  assert.match(h!.evidence, /maxTouchPoints=0/);
  assert.notEqual(r.verdict, 'allow');
});

test('iOS UA advertising Client Hints is a contradiction', () => {
  const r = score(packet(baseEnv({
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
    hasUAData: true, uaPlatform: 'iOS',
  }), {}));
  assert.ok(r.top.some(h => h.id === 'contra.ios-with-client-hints'));
});

test('deleting navigator.webdriver is caught via own-property tampering', () => {
  const r = score(packet(baseEnv({
    webdriver: undefined, navOwnTampered: ['webdriver'],
    navNonNative: ['webdriver'],
  }), {}));
  assert.ok(r.top.some(h => h.id === 'auto.webdriver-deleted'));
  assert.ok(r.top.some(h => h.id === 'auto.non-native'));
});

test('perfect straight trajectory is caught but never blocks alone', () => {
  const r = score(packet(baseEnv(), {
    mouse: humanMouse({ straightness: 1, segCV: 0, dirRate: 0, dtCV: 0.02 }),
  }));
  assert.ok(r.top.some(h => h.id === 'mouse.perfect-straight'));
  assert.equal(r.deterministic, false);
  // Behaviour-only evidence must not block a session with a clean environment.
  assert.notEqual(r.verdict, 'block');
});

test('metronomic keyboard is caught, human rhythm is not', () => {
  const bot = score(packet(baseEnv(), {
    keyboard: humanKeys({ gap: { median: 16, cv: 0.02, zeroRatio: 0, n: 40, min: 15 } }),
  }));
  assert.ok(bot.top.some(h => h.id === 'kb.metronome'));

  const human = score(packet(baseEnv(), {
    keyboard: humanKeys({ gap: { median: 190, cv: 0.48, zeroRatio: 0, n: 40, min: 55 } }),
  }));
  assert.equal(human.families.find(f => f.id === 'keyboard')!.points, 0);
});

test('sub-physical touch contact is a deterministic hit', () => {
  const r = score(packet(baseEnv({
    maxTouchPoints: 5, pointerFine: false, pointerCoarse: true,
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Mobile Safari/537.36',
  }), { touchStarts: 1, touchDwellMedian: 12, touchDwellMin: 12, pointerTypes: { touch: 1 } }));
  const h = r.top.find(x => x.id === 'touch.contact-too-short');
  assert.ok(h, 'touch.contact-too-short must fire');
  assert.equal(h!.certain, true);
  assert.notEqual(r.verdict, 'allow');
});

test('behaviour-only evidence cannot produce a block', () => {
  const r = score(packet(baseEnv(), {
    mouse: humanMouse({ straightness: 1, segCV: 0.001, dtCV: 0.001, teleportClicks: 1, teleportRatio: 1, clickDwellMean: 2 }),
    keyboard: humanKeys({ gap: { median: 8, cv: 0.01, zeroRatio: 0.8, n: 30, min: 1 } }),
  }));
  assert.notEqual(r.verdict, 'block');
  assert.equal(r.deterministic, false);
});

test('untrusted synthetic events are flagged as integrity failure', () => {
  const r = score(packet(baseEnv(), { untrustedRatio: 1 }));
  assert.ok(r.top.some(h => h.id === 'integrity.untrusted-events'));
});

test('family caps prevent one group from saturating the score alone', () => {
  // Stack several automation rules whose raw sum exceeds the 100 cap.
  const r = score(packet(baseEnv({
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/159.0.0.0 Safari/537.36',
    uaBrands: ['HeadlessChrome/159'], webdriver: true,
    pluginsN: 0, mimeN: 0, pdfViewerEnabled: false, chromeKeys: null,
    glRenderer: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0)), SwiftShader driver)',
    outerW: 0, outerH: 0,
  }), {}));
  const auto = r.families.find(f => f.id === 'automation')!;
  assert.ok(auto.raw > auto.cap, `raw ${auto.raw} should exceed cap ${auto.cap}`);
  assert.equal(auto.points, auto.cap);
});

test('every hit carries human-readable evidence', () => {
  const r = score(packet(baseEnv({
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1',
    maxTouchPoints: 0, hasUAData: true, pluginsN: 0, pdfViewerEnabled: false, chromeKeys: null,
  }), { mouse: humanMouse({ moveCount: 0, samples: [] }) }));
  assert.ok(r.top.length > 0);
  for (const h of r.top) {
    assert.ok(h.evidence.length > 10, `${h.id} needs evidence, got: ${h.evidence}`);
    assert.ok(!/\[object Object\]/.test(h.evidence), `${h.id} leaked an object: ${h.evidence}`);
    assert.ok(!/已?undefined|NaN/.test(h.evidence), `${h.id} leaked undefined/NaN: ${h.evidence}`);
  }
  assert.ok(r.summary.includes('风险分'));
});
