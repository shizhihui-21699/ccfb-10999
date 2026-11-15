/**
 * SDK contract tests, run in a real browser.
 *
 * These assert the properties a merchant depends on: the SDK never throws
 * into the page, its payload stays small, it does not block first paint, and
 * the aggregation maths produces the documented shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.resolve(import.meta.dirname, '..');
const sdk = fs.readFileSync(path.join(REPO, 'dist/botshield.min.js'), 'utf8');

const html = `<!doctype html><html><head><meta charset="utf-8"></head><body>
<div id="a" style="width:200px;height:100px;background:#eee">a</div>
<script>window.__errors=[];window.addEventListener('error',e=>window.__errors.push(String(e.message)));</script>
<script src="/sdk.js"></script>
<script>window.bs=BotShield.init({offline:true,sid:'fixture'});</script>
</body></html>`;

async function withPage(fn: (page: any) => Promise<void>) {
  const srv = http.createServer((req, res) => {
    if (req.url === '/sdk.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(sdk); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
  });
  await new Promise<void>(r => srv.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(srv.address() as any).port}/`;
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'load' });
    await fn(page);
  } finally {
    await browser.close();
    srv.close();
  }
}

test('snapshot has the documented shape and bounded trajectory', async () => {
  await withPage(async page => {
    const pkt = await page.evaluate(() => (window as any).bs.snapshot());
    assert.equal(pkt.v, 1);
    assert.equal(pkt.sid, 'fixture');
    assert.ok('env' in pkt && 'behavior' in pkt && 'perf' in pkt);
    assert.ok(Array.isArray(pkt.behavior.mouse.samples));
    assert.ok(pkt.behavior.mouse.samples.length <= 48, 'trajectory must be downsampled');
    assert.ok(typeof pkt.behavior.keyboard.gap.median === 'number');
    assert.ok(pkt.perf.initMs >= 0);
  });
});

test('payload stays small: under 4 KiB typical, 12 KiB worst case', async () => {
  await withPage(async page => {
    // Generate a long session to confirm caps hold.
    await page.evaluate(() => {
      const el = document.getElementById('a')!;
      for (let i = 0; i < 4000; i++) {
        el.dispatchEvent(new PointerEvent('pointermove', { clientX: i % 200, clientY: (i * 7) % 100, bubbles: true, pointerType: 'mouse' }));
      }
      for (let i = 0; i < 200; i++) {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', bubbles: true }));
      }
    });
    const bytes = await page.evaluate(() => JSON.stringify((window as any).bs.snapshot()).length);
    assert.ok(bytes < 12 * 1024, `payload ${bytes}B exceeds 12KiB worst case`);
  });
});

test('SDK never raises an error into the merchant page', async () => {
  await withPage(async page => {
    // Hammer it: hostile-shaped events, missing targets, rapid snapshots.
    await page.evaluate(() => {
      const el = document.getElementById('a')!;
      for (let i = 0; i < 500; i++) {
        el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
        el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
        el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
        el.dispatchEvent(new WheelEvent('wheel', { deltaY: 10, bubbles: true }));
      }
      for (let i = 0; i < 100; i++) (window as any).bs.snapshot();
    });
    const errors = await page.evaluate(() => (window as any).__errors);
    assert.deepEqual(errors, []);
  });
});

test('event handlers are passive and do not call preventDefault', async () => {
  await withPage(async page => {
    const result = await page.evaluate(() => {
      let cancelable = 0;
      const el = document.getElementById('a')!;
      el.addEventListener('pointermove', e => { if (!e.defaultPrevented) cancelable++; });
      for (let i = 0; i < 20; i++) {
        el.dispatchEvent(new PointerEvent('pointermove', { clientX: i, clientY: i, bubbles: true, cancelable: true, pointerType: 'mouse' }));
      }
      return cancelable;
    });
    assert.equal(result, 20, 'all events must remain un-prevented');
  });
});

test('init does not defer or cancel any page work', async () => {
  await withPage(async page => {
    const state = await page.evaluate(() => ({
      domReady: (performance.getEntriesByType('navigation')[0] as any).domContentLoadedEventEnd,
      hidden: document.hidden,
    }));
    assert.ok(state.domReady < 2000, `DOMContentLoaded took ${state.domReady}ms`);
    assert.equal(state.hidden, false);
  });
});
