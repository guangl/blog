#!/usr/bin/env node

// The mainland Nginx serves these files through gzip_static. Cloudflare performs
// its own compression, so this runs only in the mainland deployment workflow.
import { gzipSync } from 'node:zlib';
import {
  existsSync, readFileSync, readdirSync, renameSync, statSync,
  unlinkSync, utimesSync, writeFileSync
} from 'node:fs';
import { join, resolve } from 'node:path';

if (process.argv.length !== 3) {
  throw new Error('Usage: node tools/precompress-site.mjs <generated-site-directory>');
}

const directory = resolve(process.argv[2]);
let count = 0;
let rawBytes = 0;
let compressedBytes = 0;

for (const entry of readdirSync(directory, { recursive: true, withFileTypes: true })) {
  if (!entry.isFile() || !/\.(?:html|css|m?js|json|xml|svg|txt)$/i.test(entry.name)) continue;
  const file = join(entry.parentPath, entry.name);
  const data = readFileSync(file);
  const destination = file + '.gz';
  const compressed = gzipSync(data, { level: 9 });
  if (data.length < 256 || compressed.length >= data.length) {
    if (existsSync(destination)) unlinkSync(destination);
    continue;
  }

  const temporary = `${destination}.${process.pid}.tmp`;
  try {
    const metadata = statSync(file);
    writeFileSync(temporary, compressed, { mode: metadata.mode });
    // Keep Last-Modified consistent for compressed and uncompressed responses.
    utimesSync(temporary, metadata.atime, metadata.mtime);
    renameSync(temporary, destination);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
  count += 1;
  rawBytes += data.length;
  compressedBytes += compressed.length;
}

console.log(`Precompressed ${count} files: ${rawBytes} bytes → ${compressedBytes} gzip bytes.`);
