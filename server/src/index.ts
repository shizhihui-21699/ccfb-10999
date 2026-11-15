/**
 * Minimal zero-dependency collection server.
 *
 * Routes:
 *   POST /api/report        — ingest one SDK report, score it, keep the result
 *   GET  /api/results       — all scored results (testbed)
 *   GET  /api/results/:id   — result by sessionId
 *   GET  /healthz
 *   static file serving for the test harness under /
 *
 * Persistence is intentionally in-memory: this is a testbed, not production
 * storage. Swap store.ts for a database implementation behind the same API.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { BotGuardReport } from '../../shared/protocol.ts';
import { scoreReport } from './scorer.ts';
import type { ScoreResult } from './types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const WORKSPACE = resolve(here, '../..');
const STATIC_ROOTS = [resolve(WORKSPACE, 'tests/harness'), resolve(WORKSPACE, 'sdk/dist')];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
};

interface StoredResult {
  result: ScoreResult;
  report: BotGuardReport;
  receivedAt: string;
}

const store = new Map<string, StoredResult[]>();

export function getStore(): Map<string, StoredResult[]> {
  return store;
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const urlPath = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  const rel = normalize(urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, ''));
  for (const root of STATIC_ROOTS) {
    const full = join(root, rel);
    if (!full.startsWith(root)) continue;
    try {
      const data = await readFile(full);
      res.writeHead(200, { 'content-type': MIME[extname(full)] || 'application/octet-stream' });
      res.end(data);
      return;
    } catch {
      // try next root
    }
  }
  json(res, 404, { error: 'not found', path: urlPath });
}

export function createApp() {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      if (req.method === 'POST' && url.pathname === '/api/report') {
        const raw = await readBody(req);
        let report: BotGuardReport;
        try {
          report = JSON.parse(raw);
        } catch {
          return json(res, 400, { error: 'invalid JSON' });
        }
        if (!report || typeof report.sessionId !== 'string' || !report.env) {
          return json(res, 422, { error: 'report missing required fields' });
        }
        const result = scoreReport(report);
        const list = store.get(report.sessionId) ?? [];
        list.push({ result, report, receivedAt: new Date().toISOString() });
        store.set(report.sessionId, list);
        return json(res, 200, { ok: true, score: result.score, verdict: result.verdict });
      }

      if (req.method === 'GET' && url.pathname === '/api/results') {
        const all = [...store.values()].flat();
        return json(res, 200, { count: all.length, results: all.map((s) => s.result) });
      }

      const m = url.pathname.match(/^\/api\/results\/([^/]+)$/);
      if (req.method === 'GET' && m) {
        const list = store.get(m[1]);
        if (!list) return json(res, 404, { error: 'unknown session' });
        return json(res, 200, { sessionId: m[1], reports: list });
      }

      if (req.method === 'GET' && url.pathname === '/healthz') {
        return json(res, 200, { ok: true, sessions: store.size });
      }

      if (req.method === 'GET') return await serveStatic(req, res);
      json(res, 405, { error: 'method not allowed' });
    } catch (err) {
      json(res, 500, { error: 'internal error', detail: (err as Error).message });
    }
  });
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.env.PORT || 8790);
  createApp().listen(port, () => {
    console.log(`BotGuard collector listening on http://127.0.0.1:${port}`);
  });
}
