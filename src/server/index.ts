import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { score } from './score/engine.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');

const page = (sdkTag: string) => `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>促销活动</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;font:16px/1.5 -apple-system,"PingFang SC",sans-serif;background:#f7f7f9;color:#222}
  header{padding:18px 20px;background:linear-gradient(135deg,#ff5c39,#ff8a3d);color:#fff}
  main{max-width:720px;margin:0 auto;padding:20px}
  .card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,.06)}
  input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;border:1px solid #ddd;border-radius:8px;margin:8px 0}
  button{width:100%;padding:14px;font-size:17px;border:0;border-radius:8px;background:#ff5c39;color:#fff;margin-top:8px}
  #verdict{margin-top:16px;padding:12px;border-radius:8px;background:#eef;white-space:pre-wrap;font-size:13px;display:none}
  .spacer{height:1200px}
</style></head>
<body>
<header><strong>限时秒杀</strong> · 每人限领一次</header>
<main>
  <div class="card">
    <label for="phone">手机号</label>
    <input id="phone" inputmode="numeric" autocomplete="tel" placeholder="请输入手机号">
    <button id="claim">领取优惠券</button>
    <div id="verdict"></div>
  </div>
  <div class="spacer"></div>
</main>
${sdkTag}
</body></html>`;

function json(res: http.ServerResponse, code: number, obj: any) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  if (url.pathname === '/sdk.js') {
    const p = path.join(ROOT, 'dist/botshield.min.js');
    if (!fs.existsSync(p)) { res.writeHead(404); res.end('build first'); return; }
    res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
    res.end(fs.readFileSync(p));
    return;
  }
  if (url.pathname === '/api/collect' && req.method === 'POST') {
    let body = '';
    req.on('data', d => { body += d; if (body.length > 512 * 1024) req.destroy(); });
    req.on('end', () => {
      let packet: any;
      try { packet = JSON.parse(body); } catch { json(res, 400, { error: 'bad json' }); return; }
      let result;
      try { result = score(packet); } catch (e: any) { json(res, 500, { error: String(e?.message ?? e) }); return; }
      const tag = packet.sid ? packet.sid.slice(0, 8) : '?';
      console.log(`[score] sid=${tag} score=${result.score} band=${result.band} conf=${result.confidence} ` +
        `families=${result.families.filter(f => f.points > 0).map(f => f.id + ':' + f.points).join(',') || '-'} ` +
        `top=${result.top.slice(0, 3).map(h => h.id).join(',')}`);
      if (process.env.BD_DUMP) {
        fs.mkdirSync(path.join(ROOT, 'data/packets'), { recursive: true });
        fs.writeFileSync(path.join(ROOT, `data/packets/${packet.sid}.json`), JSON.stringify(packet, null, 1));
      }
      json(res, 200, result);
    });
    return;
  }
  if (url.pathname === '/' || url.pathname === '/demo') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page('<script src="/sdk.js"></script>\n<script>window.bs=BotShield.init({endpoint:"/api/collect",siteKey:"demo"});</script>'));
    return;
  }
  if (url.pathname === '/nojs') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end('<html><body><h1>no js</h1></body></html>');
    return;
  }
  if (url.pathname === '/health') { json(res, 200, { ok: true }); return; }
  res.writeHead(404); res.end('not found');
});

const port = Number(process.env.PORT || 8787);
server.listen(port, '127.0.0.1', () => {
  console.log(`bot-detection demo on http://127.0.0.1:${port}`);
});
