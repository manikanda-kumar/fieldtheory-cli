import fs from 'node:fs';
import path from 'node:path';
import { dataDir, libraryDir } from '../paths.js';

function ensureDirSync(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

function safePathSegment(value: string, label: string): string {
  if (!value || value === '.' || value === '..' || path.isAbsolute(value) || value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return value;
}

/** Root for local project scanner data: ~/.fieldtheory/bookmarks/projects/. */
export function projectsDir(): string {
  return path.join(dataDir(), 'projects');
}

export function ensureProjectsDir(): string {
  const dir = projectsDir();
  ensureDirSync(dir);
  return dir;
}

/** JSONL cache of scanned project records. */
export function projectsCachePath(): string {
  return path.join(projectsDir(), 'projects.jsonl');
}

/** Sync metadata for the local project scanner. */
export function projectsMetaPath(): string {
  return path.join(projectsDir(), 'meta.json');
}

/** Markdown output directory for per-project pages. */
export function projectsLibraryDir(): string {
  return path.join(libraryDir(), 'projects');
}

export function ensureProjectsLibraryDir(): string {
  const dir = projectsLibraryDir();
  ensureDirSync(dir);
  return dir;
}

export function projectMarkdownPath(repo: string): string {
  return path.join(projectsLibraryDir(), `${safePathSegment(repo, 'project repo')}.md`);
}

export function projectsActiveMarkdownPath(): string {
  return path.join(libraryDir(), 'projects-active.md');
}
