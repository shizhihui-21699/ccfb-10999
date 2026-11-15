import { createApp } from '../server/src/index.ts';
import type { Server } from 'node:http';

let server: Server | null = null;

export default async function globalSetup(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server = createApp().listen(8790, '127.0.0.1');
    server.once('listening', () => resolve());
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // A collector is already running (e.g. manual `npm run start:server`);
        // the suite talks to it over HTTP, so nothing else to do.
        server = null;
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

export async function globalTeardown(): Promise<void> {
  if (!server) return; // reused an external server; leave it alone
  await new Promise<void>((resolve, reject) => {
    server!.close((err) => (err ? reject(err) : resolve()));
  });
}
