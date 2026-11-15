/**
 * Size budget guard.
 *
 * The 20 KiB ceiling is a product requirement, so it is enforced here as a
 * test rather than trusted to a build log someone may not read.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const REPO = path.resolve(import.meta.dirname, '..');
const LIMIT = 20 * 1024;

test('minified bundle is under the 20 KiB budget', () => {
  const code = fs.readFileSync(path.join(REPO, 'dist/botshield.min.js'));
  assert.ok(code.length <= LIMIT, `bundle ${code.length}B exceeds ${LIMIT}B`);
});

test('gzip transfer size is under 8 KiB', () => {
  const code = fs.readFileSync(path.join(REPO, 'dist/botshield.min.js'));
  const gz = zlib.gzipSync(code, { level: 9 }).length;
  assert.ok(gz <= 8 * 1024, `gzip ${gz}B exceeds 8KiB`);
});

test('size report on disk agrees with the built file', () => {
  const report = JSON.parse(fs.readFileSync(path.join(REPO, 'dist/size.json'), 'utf8'));
  const code = fs.readFileSync(path.join(REPO, 'dist/botshield.min.js'));
  assert.equal(report.minifiedBytes, code.length);
  assert.equal(report.withinLimit, true);
});

test('bundle contains no eval and no external network URLs', () => {
  const code = fs.readFileSync(path.join(REPO, 'dist/botshield.min.js'), 'utf8');
  assert.ok(!/\beval\s*\(/.test(code), 'bundle must not use eval');
  assert.ok(!/new Function\s*\(/.test(code), 'bundle must not use Function constructor');
  assert.ok(!/https?:\/\//.test(code), 'bundle must not hard-code remote URLs');
});
