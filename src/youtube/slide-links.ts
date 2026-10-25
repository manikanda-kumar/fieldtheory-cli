import fs from 'node:fs/promises';
import path from 'node:path';
import { writeMd } from '../fs.js';
import { dataDir, youtubeLibraryDir } from '../paths.js';

/**
 * Slide thumbnails live under the data directory while notes live under the
 * library directory. A note must embed them relative to itself, otherwise a
 * synced library only renders on the machine that captured the frames.
 */
const ARTIFACT_MARKER = '/youtube/artifacts/';

/** Inline image links only; notes never wrap these destinations in `<>`. */
const IMAGE_LINK = /(!\[[^\]]*\]\()([^)\s]+)(\))/g;

/**
 * Markdown destination for a slide image. Remote URLs are already portable and
 * must survive byte for byte: signed URLs carry query strings, fragments and
 * percent-escapes that re-encoding would corrupt. Absolute local paths are
 * rewritten relative to the note that embeds them; everything else is escaped
 * so spaces and parentheses do not end the inline link.
 */
export function slideImageTarget(imagePath: string, notePath?: string): string {
  if (isRemoteDestination(imagePath)) return imagePath;
  if (!notePath || !path.isAbsolute(imagePath) || !path.isAbsolute(notePath)) {
    return escapeMarkdownDestination(imagePath);
  }
  const relative = path.relative(path.dirname(notePath), imagePath).split(path.sep).join('/');
  return escapeMarkdownDestination(relative.startsWith('../') ? relative : `./${relative}`);
}

function isRemoteDestination(destination: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(destination) || destination.startsWith('//');
}

function escapeMarkdownDestination(destination: string): string {
  return encodeURI(destination)
    .replace(/#/g, '%23')
    .replace(/\?/g, '%3F')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

export interface SlideLinkRepairOptions {
  /** Explicit notes to repair instead of scanning the YouTube library. */
  notePaths?: string[];
  /** Maximum notes to rewrite in one run; repeated runs continue past them. */
  limit: number;
  /** Rewrite files. False keeps the run read-only and only reports. */
  write: boolean;
}

export interface SlideLinkRepairResult {
  notesScanned: number;
  /** Notes that contained at least one rewritable absolute link. */
  notesChanged: number;
  /** Links that now use a relative destination (or would, without `write`). */
  linksRewritten: number;
  /** Notes actually written; zero in a read-only run. */
  notesWritten: number;
  /** Links persisted in written notes; zero in a read-only run. */
  linksWritten: number;
  /** Rewritable notes left for a later run because they exceeded `limit`. */
  notesDeferred: number;
  /** Absolute links whose artifact is missing locally or escapes the artifacts root; left untouched. */
  unresolvedLinks: number;
  examples: Array<{ notePath: string; from: string; to: string }>;
  unresolvedSamples: string[];
}

/**
 * Rewrite legacy absolute slide links in existing notes to the portable form
 * the renderer now writes. Only links whose artifact resolves under the current
 * data directory are touched, so a missing capture is reported instead of
 * silently turned into a broken relative link.
 */
export async function repairYoutubeSlideLinks(options: SlideLinkRepairOptions): Promise<SlideLinkRepairResult> {
  const notePaths = options.notePaths?.length
    ? [...options.notePaths].sort()
    : await listNoteFiles(youtubeLibraryDir());
  const result: SlideLinkRepairResult = {
    notesScanned: 0,
    notesChanged: 0,
    linksRewritten: 0,
    notesWritten: 0,
    linksWritten: 0,
    notesDeferred: 0,
    unresolvedLinks: 0,
    examples: [],
    unresolvedSamples: [],
  };

  for (const notePath of notePaths) {
    result.notesScanned += 1;
    const markdown = await fs.readFile(notePath, 'utf8');
    if (!markdown.includes(ARTIFACT_MARKER)) continue;

    const eligible = !options.write || result.notesWritten < options.limit;
    let linksRewritten = 0;
    const pieces: string[] = [];
    let cursor = 0;
    for (const match of markdown.matchAll(IMAGE_LINK)) {
      const prefix = match[1];
      const destination = match[2];
      const start = match.index ?? 0;
      pieces.push(markdown.slice(cursor, start));
      cursor = start + match[0].length;
      if (isRemoteDestination(destination) || !destination.startsWith('/') || !destination.includes(ARTIFACT_MARKER)) {
        pieces.push(match[0]);
        continue;
      }
      const artifactPath = artifactTarget(destination);
      if (!artifactPath || !(await fileExists(artifactPath))) {
        result.unresolvedLinks += 1;
        if (result.unresolvedSamples.length < 5) result.unresolvedSamples.push(`${notePath}: ${destination}`);
        pieces.push(match[0]);
        continue;
      }
      const target = slideImageTarget(artifactPath, notePath);
      if (target === destination) {
        pieces.push(match[0]);
        continue;
      }
      linksRewritten += 1;
      if (eligible && result.examples.length < 3) result.examples.push({ notePath, from: destination, to: target });
      pieces.push(`${prefix}${target})`);
    }
    if (linksRewritten === 0) continue;
    pieces.push(markdown.slice(cursor));
    const repaired = pieces.join('');

    result.notesChanged += 1;
    result.linksRewritten += linksRewritten;
    // Bounded runs touch the same notes first, so repeating the command keeps
    // moving through the backlog instead of re-reporting finished work.
    if (!options.write) continue;
    if (result.notesWritten >= options.limit) {
      result.notesDeferred += 1;
      continue;
    }
    await writeMd(notePath, repaired);
    result.notesWritten += 1;
    result.linksWritten += linksRewritten;
  }
  return result;
}

/**
 * Resolve an absolute artifact destination against this machine's artifacts
 * root. A destination such as `.../artifacts/../../etc/passwd` must not become
 * eligible just because that file exists outside the root.
 */
function artifactTarget(destination: string): string | undefined {
  const marker = destination.indexOf(ARTIFACT_MARKER);
  if (marker < 0) return undefined;
  const root = path.join(dataDir(), 'youtube', 'artifacts');
  const target = path.resolve(root, destination.slice(marker + ARTIFACT_MARKER.length));
  return target.startsWith(root + path.sep) ? target : undefined;
}

async function listNoteFiles(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await listNoteFiles(entryPath));
    else if (entry.isFile() && entry.name.endsWith('.md')) files.push(entryPath);
  }
  return files;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch {
    return false;
  }
}
