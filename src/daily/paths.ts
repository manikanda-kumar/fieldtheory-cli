import fs from 'node:fs';
import path from 'node:path';
import { dataDir, libraryDir } from '../paths.js';

function ensureDirSync(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

/** Root for daily synthesis state: ~/.fieldtheory/bookmarks/daily/. */
export function dailyDir(): string {
  return path.join(dataDir(), 'daily');
}

export function ensureDailyDir(): string {
  const dir = dailyDir();
  ensureDirSync(dir);
  return dir;
}

/** Watermark + run metadata for daily synthesis. */
export function dailyMetaPath(): string {
  return path.join(dailyDir(), 'meta.json');
}

/** Markdown output directory for daily digests. */
export function dailyLibraryDir(): string {
  return path.join(libraryDir(), 'daily');
}

export function ensureDailyLibraryDir(): string {
  const dir = dailyLibraryDir();
  ensureDirSync(dir);
  return dir;
}

export function dailyDigestPath(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Invalid digest date: ${date}`);
  }
  return path.join(dailyLibraryDir(), `${date}.md`);
}
