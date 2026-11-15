/**
 * Performance verification, isolating sources of cost.
 *
 * Three arms on otherwise-identical pages:
 *   A. no SDK
 *   B. SDK loaded (external script) but not initialised  -> parse/eval cost
 *   C. SDK loaded and initialised                        -> + startup cost
 *
 * Each arm runs several times; medians are reported because a single
 * navigation is dominated by startup noise. Also measures per-event handler
 * cost and the snapshot cost separately.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const sdk = fs.readFileSync(path.join(REPO, 'dist/botshield.min.js'), 'utf8');

const body = `<div id="hero" style="height:600px;background:linear-gradient(135deg,#f60,#fa0)"><h1>Promo</h1></div>
<div id="c" style="width:300px;height:120px;background:#eee">card</div>
<script>window.__lt=[];new PerformanceObserver(l=>{for(const e of l.getEntries())window.__lt.push(e.duration)}).observe({type:'longtask',buffered:true});</script>`;

const page = (arm: 'none' | 'load' | 'init') => `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font:16px sans-serif}</style></head><body>${body}
${arm === 'none' ? '' : '<script src="/sdk.js"></script>'}
${arm === 'init' ? "<script>window.__t0=performance.now();window.bs=BotShield.init({offline:true});window.__initMs=performance.now()-window.__t0;</script>" : ''}
</body></html>`;

const srv = http.createServer((req, res) => {
  const u = new URL(req.url || '/', 'http://x');
  if (u.pathname === '/sdk.js') {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-store' });
    res.end(sdk);
    return;
  }
  const arm = (u.searchParams.get('arm') || 'none') as any;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page(arm));
});
await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${srv.address().port}/`;

const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

async function arm(runs: number) {
  const domReady: number[] = [];
  const load: number[] = [];
  const tbt: number[] = [];
  const init: number[] = [];
  let handlerMs = 0;
  let clickMs = 0;
  let snapshotMs: number | null = null;

  for (let i = 0; i < runs; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const kind = i % 3;
    await page.goto(`${base}?arm=${['none', 'load', 'init'][kind]}`, { waitUntil: 'load' });
    const m = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0] as any;
      const lt = (window as any).__lt as number[];
      return {
        domReady: nav.domContentLoadedEventEnd,
        load: nav.loadEventEnd,
        tbt: lt.reduce((a, d) => a + Math.max(0, d - 50), 0),
        longTasks: lt.length,
        init: (window as any).__initMs ?? null,
      };
    });
    domReady.push(m.domReady); load.push(m.load); tbt.push(m.tbt);
    if (m.init != null) init.push(m.init);

    // Handler cost, measured inside the page so transport is excluded.
    handlerMs = await page.evaluate(() => {
      const el = document.getElementById('c')!;
      const t0 = performance.now();
      for (let i = 0; i < 20000; i++) {
        el.dispatchEvent(new PointerEvent('pointermove', { clientX: 100 + (i % 400), clientY: 100 + (i % 300), bubbles: true, pointerType: 'mouse' }));
      }
      return performance.now() - t0;
    });
    clickMs = await page.evaluate(() => {
      const el = document.getElementById('c')!;
      const t0 = performance.now();
      el.dispatchEvent(new PointerEvent('pointerdown', { clientX: 9, clientY: 9, bubbles: true, pointerType: 'mouse' }));
      el.dispatchEvent(new PointerEvent('pointerup', { clientX: 9, clientY: 9, bubbles: true, pointerType: 'mouse' }));
      return performance.now() - t0;
    });
    snapshotMs = await page.evaluate(() => {
      const w: any = window;
      if (!w.bs) return null;
      const t0 = performance.now();
      for (let i = 0; i < 500; i++) w.bs.snapshot();
      return (performance.now() - t0) / 500;
    });
    await ctx.close();
  }
  return { domReady, load, tbt, init, handlerMs, clickMs, snapshotMs };
}

const RUNS = 9;
const none = await arm(RUNS);
const load = await arm(RUNS);
const init = await arm(RUNS);
await browser.close();
srv.close();

const report = {
  runsPerArm: RUNS,
  domReadyMedianMs: {
    noSdk: +median(none.domReady).toFixed(1),
    sdkParsedNotInit: +median(load.domReady).toFixed(1),
    sdkInit: +median(init.domReady).toFixed(1),
  },
  initSyncMedianMs: +median(init.init).toFixed(2),
  tbtMs: { noSdk: median(none.tbt), sdkInit: median(init.tbt) },
  longTaskCounts: { noSdk: none.tbt.length, sdkInit: init.tbt.length },
  handler: {
    baseline20kMs: +none.handlerMs.toFixed(1),
    withSdk20kMs: +init.handlerMs.toFixed(1),
    overheadUsPerEvent: +(((init.handlerMs - none.handlerMs) / 20000) * 1000).toFixed(2),
  },
  clickDispatchMs: { baseline: +none.clickMs.toFixed(3), withSdk: +init.clickMs.toFixed(3) },
  snapshotAvgMs: init.snapshotMs == null ? null : +init.snapshotMs.toFixed(4),
};
fs.writeFileSync(path.join(REPO, 'data/results/perf.json'), JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
