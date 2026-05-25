// Test if Node.js ESM cache is bypassed by query strings in file:// URLs
import { pathToFileURL } from 'node:url';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testFile = join(__dirname, '_test_cache.mjs');

// Create a test module that exports the current timestamp
writeFileSync(testFile, `export default ${Date.now()};`, 'utf8');

const url1 = pathToFileURL(testFile).href;
const m1 = await import(url1);

// Wait a moment then try again with a query string
await new Promise(r => setTimeout(r, 100));
writeFileSync(testFile, `export default ${Date.now()};`, 'utf8');

const url2 = pathToFileURL(testFile).href + '?v=2';
const m2 = await import(url2);

const url3 = pathToFileURL(testFile).href + '?v=3';
const m3 = await import(url3);

console.log('url1:', url1);
console.log('url2:', url2);
console.log('m1.default:', m1.default);
console.log('m2.default:', m2.default, '(new file content loaded?)');
console.log('m3.default:', m3.default, '(same as m2 = cache hit; different from m2 = new load)');
console.log('m1 === m2 (same module)?', m1.default === m2.default);
console.log('m2 === m3 (same module)?', m2.default === m3.default);

import { unlinkSync } from 'node:fs';
try { unlinkSync(testFile); } catch {}
