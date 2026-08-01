#!/usr/bin/env node
/** Copy non-TS RSS assets into dist/ after tsc. */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src', 'rss', 'default-feeds.json');
const destDir = path.join(root, 'dist', 'rss');
const dest = path.join(destDir, 'default-feeds.json');

await mkdir(destDir, { recursive: true });
await copyFile(src, dest);
console.log(`copied ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
