import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname);
const html = fs.readFileSync(path.join(ROOT, 'probe.html'), 'utf8');

// Echo server so we can see what headers each launch mode sends.
const srv = http.createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(html);
    return;
  }
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('ok');
});
await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
const port = (srv.address() as any).port;
const URL = `http://127.0.0.1:${port}/`;

type Mode = { name: string; opts: any; pre?: (page: any) => Promise<void>; interact?: 'cdp' };
const modes: Mode[] = [
  { name: 'headless-default', opts: { headless: true }, interact: 'cdp' },
  {
    name: 'headless-mobile-uatrick',
    opts: { headless: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Mobile/15E148 Safari/604.1', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    interact: 'cdp',
  },
  {
    name: 'headless-stealth',
    opts: { headless: true },
    pre: async page => {
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        Object.defineProperty(navigator, 'plugins', { get: () => [{ name: 'PDF Viewer' }, { name: 'Chrome PDF Viewer' }, { name: 'Chromium PDF Viewer' }] });
        Object.defineProperty(navigator, 'mimeTypes', { get: () => [{ type: 'application/pdf' }] });
        // @ts-ignore
        window.chrome = { app: { isInstalled: false }, runtime: {}, csi: () => {}, loadTimes: () => {} };
        const orig = navigator.permissions.query.bind(navigator.permissions);
        // @ts-ignore
        navigator.permissions.query = p => (p && p.name === 'notifications' ? Promise.resolve({ state: 'prompt', onchange: null }) : orig(p));
        Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
        delete (window as any).__playwright__;
        delete (window as any).__pw_manual;
      });
    },
    interact: 'cdp',
  },
  { name: 'headed-chromium', opts: { headless: false }, interact: 'cdp' },
];

const results: any[] = [];
for (const m of modes) {
  let browser;
  const logs: string[] = [];
  try {
    browser = await chromium.launch({ ...m.opts, args: ['--no-first-run'] });
    const ctx = await browser.newContext({ ...m.opts });
    const page = await ctx.newPage();
    page.on('pageerror', e => logs.push('pageerror: ' + e.message));
    if (m.pre) await m.pre(page);
    const headers: Record<string, string> = {};
    page.on('request', r => {
      if (r.url().endsWith('/favicon.ico')) return;
      const h = r.headers();
      for (const k of ['user-agent', 'accept-language', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'accept', 'accept-encoding', 'sec-gpc', 'dnt', 'priority']) headers[k] = h[k];
    });
    await page.goto(URL, { waitUntil: 'load' });
    const env = await page.evaluate(() => (window as any).probeResults);
    // interaction via CDP input pipeline
    await page.mouse.move(100, 100);
    await page.mouse.move(200, 150, { steps: 10 });
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.press('a');
    await page.keyboard.press('b');
    await page.keyboard.type('hello');
    await page.waitForTimeout(300);
    const evs = await page.evaluate(() => (window as any).__probeEvents);
    results.push({ mode: m.name, env, headers, events: evs.events.slice(-14), trustedSummary: summarize(evs.trusted), logs });
  } catch (e: any) {
    results.push({ mode: m.name, error: String(e?.message ?? e), logs });
  } finally {
    await browser?.close();
  }
}

function summarize(list: any[]) {
  const out: Record<string, { total: number; trusted: number; untrusted: number }> = {};
  for (const x of list) {
    const t = (out[x.type] ||= { total: 0, trusted: 0, untrusted: 0 });
    t.total++;
    if (x.isTrusted) t.trusted++; else t.untrusted++;
  }
  return out;
}

fs.writeFileSync(path.join(ROOT, '../data/probe-results.json'), JSON.stringify(results, null, 2));
for (const r of results) {
  console.log('\n===', r.mode, r.error ? 'ERROR ' + r.error : '===');
  if (r.env) {
    console.log(JSON.stringify({
      webdriver: r.env.webdriver, uaDataMobile: r.env.uaData?.mobile, uaDataPlatform: r.env.uaData?.platform,
      platform: r.env.platform, vendor: r.env.vendor, languages: r.env.languages, maxTouch: r.env.maxTouchPoints,
      touch: r.env.ontouchstart, plugins: r.env.pluginsLen, mime: r.env.mimeLen,
      chrome: r.env.chrome, chromeRuntime: r.env.chromeRuntime, perms: r.env.permissions, notif: r.env.notif?.perm,
      webglRenderer: r.env.webgl?.renderer, webglVendor: r.env.webgl?.vendor,
      screen: r.env.screen, win: r.env.window, tz: r.env.timezone, locale: r.env.locale,
      fonts: r.env.fonts, scan: r.env.scan, leaks: r.env.protoLeaks, nowRes: r.env.nowResolution,
      same: r.env.sameScreenViewport, outerEq: r.env.outerEqualsScreen, idle: r.env.idle,
      hidden: r.env.documentHidden, hc: r.env.hardwareConcurrency, dm: r.env.deviceMemory, conn: r.env.connection,
      attrs: r.env.documentAttrs, media: r.env.media,
    }, null, 1));
    console.log('headers:', JSON.stringify(r.headers));
    console.log('events:', JSON.stringify(r.events));
    console.log('trusted:', JSON.stringify(r.trustedSummary));
  }
  if (r.logs?.length) console.log('logs:', r.logs.join(' | '));
}
srv.close();
