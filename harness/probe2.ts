import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const ROOT = path.resolve(import.meta.dirname);
const html = fs.readFileSync(path.join(ROOT, 'probe2.html'), 'utf8');
const srv = http.createServer((req, res) => {
  if (req.url === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(html); return; }
  res.writeHead(200, { 'content-type': 'text/plain' }); res.end('ok');
});
await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
const port = (srv.address() as any).port;
const URL = `http://127.0.0.1:${port}/`;

const modes: any[] = [
  { name: 'headless-shell', opts: { headless: true } },
  { name: 'headless-new', opts: { headless: true, channel: 'chromium' } },
  { name: 'headless-new-mobile', opts: { headless: true, channel: 'chromium', userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/159.0.0.0 Mobile Safari/537.36', viewport: { width: 412, height: 915 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true } },
  { name: 'headed-chromium', opts: { headless: false } },
  { name: 'real-chrome-headless', opts: { headless: true, channel: 'chrome' } },
  { name: 'real-chrome-headed', opts: { headless: false, channel: 'chrome' } },
];
const out: any[] = [];
for (const m of modes) {
  let browser;
  const logs: string[] = [];
  try {
    browser = await chromium.launch({ ...m.opts });
    const ctx = await browser.newContext({ ...m.opts });
    const page = await ctx.newPage();
    page.on('pageerror', e => logs.push(e.message));
    const headers: Record<string, string> = {};
    page.on('request', r => { if (r.url().endsWith('/favicon.ico')) return; const h = r.headers(); for (const k of ['user-agent', 'sec-ch-ua', 'sec-ch-ua-mobile', 'sec-ch-ua-platform', 'accept-language', 'sec-fetch-site']) headers[k] = h[k]; });
    await page.goto(URL, { waitUntil: 'load' });
    const env = await page.evaluate(() => (window as any).probe2);
    const isMobile = m.opts.hasTouch;
    if (isMobile) {
      const box = await page.locator('#t').boundingBox();
      if (box) {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + 40, y: box.y + 40 }] });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      }
    } else {
      await page.mouse.click(100, 100);
    }
    await page.waitForTimeout(200);
    const cap = await page.evaluate(() => (window as any).__cap);
    out.push({ mode: m.name, env, headers, cap, logs });
  } catch (e: any) { out.push({ mode: m.name, error: String(e?.message ?? e), logs }); }
  finally { await browser?.close(); }
}
fs.writeFileSync(path.join(ROOT, '../data/probe2.json'), JSON.stringify(out, null, 1));
for (const r of out) {
  console.log('\n=====', r.mode, r.error || '');
  if (!r.env) continue;
  const e = r.env;
  console.log(' hev:', JSON.stringify(e.hev));
  console.log(' media:', JSON.stringify(Object.fromEntries(Object.entries(e.media).filter(([, v]) => v))));
  console.log(' touch:', JSON.stringify(e.touch));
  console.log(' notif:', JSON.stringify(e.notif), 'plugins:', JSON.stringify(e.plugins), 'mimes:', JSON.stringify(e.mimes));
  console.log(' chrome:', JSON.stringify(e.chrome), 'runtimeProps:', JSON.stringify(e.chromeRuntimeProps), 'csi:', e.chromeCsi);
  console.log(' gl1:', JSON.stringify(e.webglParams));
  console.log(' gl2:', JSON.stringify(e.webgl2));
  console.log(' audio:', JSON.stringify(e.audio));
  console.log(' fonts:', JSON.stringify(e.fonts));
  console.log(' geo:', JSON.stringify(e.geo));
  console.log(' misc:', JSON.stringify(e.misc));
  console.log(' timing:', JSON.stringify(e.timing));
  console.log(' cap:', JSON.stringify(r.cap));
  console.log(' headers:', JSON.stringify(r.headers));
  if (r.logs?.length) console.log(' logs:', r.logs.join(' | '));
}
srv.close();
