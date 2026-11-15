/**
 * Replay a recorded human trace through Playwright input APIs.
 * Replayed events are trusted (isTrusted=true) and preserve the original
 * timing, so behavioral aggregates match the human recording.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from 'playwright';

interface TraceEvent {
  type: 'move' | 'down' | 'up' | 'wheel' | 'keydown' | 'keyup';
  t: number;
  x?: number;
  y?: number;
  deltaY?: number;
  key?: string;
}

export interface Trace {
  version: number;
  viewport: { w: number; h: number };
  events: TraceEvent[];
}

export function loadTrace(relPath: string): Trace {
  const raw = readFileSync(resolve(process.cwd(), relPath), 'utf8');
  return JSON.parse(raw) as Trace;
}

export async function replayTrace(page: Page, trace: Trace): Promise<void> {
  let prevT = 0;
  const wait = (t: number): Promise<void> =>
    new Promise((r) => setTimeout(r, Math.max(0, t - prevT)));

  for (const ev of trace.events) {
    await wait(ev.t);
    prevT = ev.t;
    switch (ev.type) {
      case 'move':
        if (ev.x !== undefined && ev.y !== undefined) await page.mouse.move(ev.x, ev.y);
        break;
      case 'down':
        if (ev.x !== undefined && ev.y !== undefined) await page.mouse.move(ev.x, ev.y);
        await page.mouse.down();
        break;
      case 'up':
        await page.mouse.up();
        break;
      case 'wheel':
        await page.mouse.wheel(0, ev.deltaY || 0);
        break;
      case 'keydown':
        if (ev.key && ev.key.length === 1) await page.keyboard.down(ev.key);
        break;
      case 'keyup':
        if (ev.key && ev.key.length === 1) await page.keyboard.up(ev.key);
        break;
    }
  }
}
