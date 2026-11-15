import * as esbuild from 'esbuild';
import fs from 'node:fs';
import zlib from 'node:zlib';

const LIMIT = 20 * 1024; // 20 KiB hard budget

const common = {
  entryPoints: ['src/sdk/index.ts'],
  bundle: true,
  format: 'iife',
  target: ['es2020'],
  legalComments: 'none',
  charset: 'utf8',
  write: false,
  minify: true,
};

// Measure what actually ships: minified bytes on disk, then gzipped bytes,
// since the transport cost is what merchants pay for.
async function sizeOf(opts, label) {
  const out = await esbuild.build({ ...common, ...opts });
  const code = out.outputFiles[0].text;
  const bytes = Buffer.byteLength(code);
  const gz = zlib.gzipSync(Buffer.from(code), { level: 9 }).length;
  return { label, code, bytes, gz };
}

const normal = await sizeOf({}, 'min');
const noMin = await sizeOf({ minify: false }, 'raw');

fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/botshield.min.js', normal.code);
fs.writeFileSync('dist/botshield.debug.js', noMin.code);

const report = {
  minifiedBytes: normal.bytes,
  minifiedKiB: +(normal.bytes / 1024).toFixed(2),
  gzipBytes: normal.gz,
  gzipKiB: +(normal.gz / 1024).toFixed(2),
  unminifiedBytes: noMin.bytes,
  limitBytes: LIMIT,
  withinLimit: normal.bytes <= LIMIT,
};
fs.writeFileSync('dist/size.json', JSON.stringify(report, null, 2));

console.log(JSON.stringify(report, null, 2));
if (!report.withinLimit) {
  console.error(`FAIL: bundle ${report.minifiedBytes}B exceeds ${LIMIT}B budget`);
  process.exit(1);
}
