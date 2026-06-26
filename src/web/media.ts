import path from 'node:path';
import { pathExists, readJson } from '../fs.js';
import type { MediaFetchManifest } from '../bookmark-media.js';
import { bookmarkMediaDir, bookmarkMediaManifestPath } from '../paths.js';
import { HttpError } from './http.js';

export interface WebMediaAsset {
  url: string;
  sourceUrl: string;
  contentType?: string;
  bytes?: number;
}

export interface WebMediaIndex {
  assetsByBookmarkId: Map<string, WebMediaAsset[]>;
  filesByName: Map<string, { path: string; contentType?: string }>;
}

export async function loadWebMediaIndex(options: {
  mediaDir?: string;
  manifestPath?: string;
} = {}): Promise<WebMediaIndex> {
  const mediaDir = options.mediaDir ?? bookmarkMediaDir();
  const manifestPath = options.manifestPath ?? bookmarkMediaManifestPath();
  const assetsByBookmarkId = new Map<string, WebMediaAsset[]>();
  const filesByName = new Map<string, { path: string; contentType?: string }>();

  if (!(await pathExists(manifestPath))) return { assetsByBookmarkId, filesByName };
  const manifest = await readJson<MediaFetchManifest>(manifestPath);

  for (const entry of manifest.entries) {
    if (entry.status !== 'downloaded' || !entry.localPath) continue;
    const resolved = path.resolve(entry.localPath);
    const resolvedMediaDir = path.resolve(mediaDir);
    if (!resolved.startsWith(`${resolvedMediaDir}${path.sep}`)) continue;
    const filename = path.basename(resolved);
    const asset = {
      url: `/media/${encodeURIComponent(filename)}`,
      sourceUrl: entry.sourceUrl,
      contentType: entry.contentType,
      bytes: entry.bytes,
    };
    assetsByBookmarkId.set(entry.bookmarkId, [...(assetsByBookmarkId.get(entry.bookmarkId) ?? []), asset]);
    filesByName.set(filename, { path: resolved, contentType: entry.contentType });
  }

  return { assetsByBookmarkId, filesByName };
}

export function resolveMediaFile(index: WebMediaIndex, filename: string): { path: string; contentType?: string } | null {
  if (filename.includes('/') || filename.includes('\\')) throw new HttpError(403, 'Invalid media path');
  return index.filesByName.get(filename) ?? null;
}