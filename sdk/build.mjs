/**
 * SDK build: bundle to IIFE (classic <script>) and ESM, minify, and enforce
 * the 20KB size budget on the minified IIFE (gzip and raw reported).
 */
import { gzipSync } from 'node:zlib';
import { statSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, 'dist');
mkdirSync(outDir, { recursive: true });

const common = {
  entryPoints: [resolve(here, 'src/index.ts')],
  bundle: true,
  minify: true,
  target: 'es2019',
  legalComments: 'none',
  sourcemap: false,
  logLevel: 'info',
};

await build({ ...common, format: 'iife', globalName: 'BotGuardSDK', outfile: resolve(outDir, 'botguard.min.js') });
await build({ ...common, format: 'esm', outfile: resolve(outDir, 'botguard.esm.js') });

const iife = resolve(outDir, 'botguard.min.js');
const raw = statSync(iife).size;
const gzipBytes = gzipSync(readFileSync(iife)).length;

const LIMIT = 20 * 1024;
console.log('────────────────────────────────────────────');
console.log(`botguard.min.js  raw : ${(raw / 1024).toFixed(2)} KB`);
console.log(`botguard.min.js  gzip: ${(gzipBytes / 1024).toFixed(2)} KB`);
if (raw > LIMIT) {
  console.error(`❌ SDK exceeds 20KB budget: ${raw} bytes`);
  process.exit(1);
}
console.log(`✅ under 20KB budget (${((raw / LIMIT) * 100).toFixed(1)}% of budget)`);
