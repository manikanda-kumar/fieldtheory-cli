import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitHubRepositoryPayload, GitHubStarApiItem, GitHubStarRecord } from './types.js';

const execFileAsync = promisify(execFile);
const GITHUB_API_BASE = 'https://api.github.com';
const STAR_ACCEPT = 'application/vnd.github.star+json';

export interface GitHubStarsClientOptions {
  fetchImpl?: typeof fetch;
  runGhApi?: (pathWithQuery: string) => Promise<unknown>;
  token?: string;
  env?: NodeJS.ProcessEnv;
  sleepMs?: (ms: number) => Promise<void>;
  now?: () => string;
}

export interface FetchGitHubStarsOptions extends GitHubStarsClientOptions {
  lastStarredAt?: string | null;
  rebuild?: boolean;
  limit?: number;
  perPage?: number;
}

export interface FetchGitHubStarsResult {
  records: GitHubStarRecord[];
  newestStarredAt: string | null;
  skipped: number;
}

export interface FetchGitHubStarsPageResult {
  records: GitHubStarRecord[];
  skipped: number;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function defaultRunGhApi(pathWithQuery: string): Promise<unknown> {
  const { stdout } = await execFileAsync('gh', [
    'api',
    pathWithQuery,
    '-H',
    `Accept: ${STAR_ACCEPT}`,
  ]);
  return JSON.parse(stdout);
}

function tokenFromOptions(options: GitHubStarsClientOptions): string | undefined {
  return options.token ?? options.env?.GITHUB_TOKEN ?? options.env?.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
}

function repoFromApiItem(item: unknown): { repo: GitHubRepositoryPayload; starredAt: string | null } | null {
  if (!item || typeof item !== 'object') return null;
  const shaped = item as GitHubStarApiItem & GitHubRepositoryPayload;
  if (shaped.repo) return { repo: shaped.repo, starredAt: shaped.starred_at ?? null };
  if (typeof shaped.full_name === 'string' && typeof shaped.html_url === 'string') {
    return { repo: shaped, starredAt: null };
  }
  return null;
}

export function normalizeGitHubStarItem(item: unknown, syncedAt: string): GitHubStarRecord | null {
  const parsed = repoFromApiItem(item);
  if (!parsed) return null;
  const { repo, starredAt } = parsed;
  if (!repo.id || !repo.full_name || !repo.html_url) return null;
  const [ownerFromName, nameFromFullName] = repo.full_name.split('/');
  const owner = repo.owner?.login ?? ownerFromName;
  const name = repo.name ?? nameFromFullName;
  if (!owner || !name) return null;

  return {
    id: repo.id,
    fullName: repo.full_name,
    owner,
    name,
    htmlUrl: repo.html_url,
    description: repo.description ?? null,
    homepageUrl: repo.homepage || null,
    language: repo.language ?? null,
    topics: Array.isArray(repo.topics) ? repo.topics.filter((topic): topic is string => typeof topic === 'string') : [],
    stargazersCount: Number(repo.stargazers_count ?? 0),
    forksCount: Number(repo.forks_count ?? 0),
    openIssuesCount: Number(repo.open_issues_count ?? 0),
    isArchived: Boolean(repo.archived),
    isFork: Boolean(repo.fork),
    defaultBranch: repo.default_branch ?? null,
    pushedAt: repo.pushed_at ?? null,
    updatedAt: repo.updated_at ?? null,
    starredAt,
    syncedAt,
  };
}

async function fetchViaToken(
  page: number,
  perPage: number,
  options: GitHubStarsClientOptions,
): Promise<unknown[]> {
  const token = tokenFromOptions(options);
  if (!token) {
    throw new Error('GitHub authentication not found. Run gh auth login or set GITHUB_TOKEN.');
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const url = new URL('/user/starred', GITHUB_API_BASE);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));
  url.searchParams.set('sort', 'created');
  url.searchParams.set('direction', 'desc');

  const attempts = 3;
  const sleep = options.sleepMs ?? defaultSleep;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: {
        Accept: STAR_ACCEPT,
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    const rateLimitRemaining = response.headers.get('x-ratelimit-remaining');
    const isRateLimited = response.status === 429 || (response.status === 403 && rateLimitRemaining === '0');
    if (isRateLimited || response.status >= 500) {
      if (attempt === attempts - 1) {
        throw new Error(`GitHub API ${response.status}: ${isRateLimited ? 'rate limited' : response.statusText}`);
      }
      await sleep(1_000 * 2 ** attempt);
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      const body = await response.text().catch(() => '');
      throw new Error(`GitHub API ${response.status}: ${body || response.statusText}. Run gh auth login again or set a valid GITHUB_TOKEN.`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`GitHub API ${response.status}: ${body || response.statusText}`);
    }

    const json = await response.json();
    return Array.isArray(json) ? json : [];
  }

  throw new Error('Unexpected end of GitHub token fetch.');
}

export async function fetchGitHubStarsPage(
  page: number,
  perPage = 100,
  options: GitHubStarsClientOptions = {},
): Promise<FetchGitHubStarsPageResult> {
  const syncedAt = options.now?.() ?? new Date().toISOString();
  const pathWithQuery = `user/starred?per_page=${perPage}&page=${page}&sort=created&direction=desc`;
  const token = tokenFromOptions(options);
  const runGhApi = options.runGhApi ?? defaultRunGhApi;

  let rawItems: unknown[] | null = null;
  try {
    const ghResult = await runGhApi(pathWithQuery);
    rawItems = Array.isArray(ghResult) ? ghResult : [];
  } catch (error) {
    if (!token) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('ENOENT')) {
        throw new Error('GitHub authentication not found. Run gh auth login or set GITHUB_TOKEN.');
      }
      throw new Error(`GitHub CLI authentication failed: ${message}. Run gh auth login or set GITHUB_TOKEN.`);
    }
  }

  if (!rawItems) {
    rawItems = await fetchViaToken(page, perPage, options);
  }

  const records = rawItems
    .map((item) => normalizeGitHubStarItem(item, syncedAt))
    .filter((record): record is GitHubStarRecord => record !== null);

  return { records, skipped: rawItems.length - records.length };
}

export async function fetchGitHubStars(
  options: FetchGitHubStarsOptions = {},
): Promise<FetchGitHubStarsResult> {
  const perPage = options.perPage ?? 100;
  const records: GitHubStarRecord[] = [];
  let page = 1;
  let newestStarredAt: string | null = null;
  let skipped = 0;
  const cutoff = options.rebuild ? null : options.lastStarredAt ?? null;

  while (true) {
    const { records: pageRecords, skipped: pageSkipped } = await fetchGitHubStarsPage(page, perPage, options);
    skipped += pageSkipped;
    if (pageRecords.length === 0) break;

    let reachedCutoff = false;
    for (const record of pageRecords) {
      if (!newestStarredAt && record.starredAt) newestStarredAt = record.starredAt;
      if (cutoff && record.starredAt && record.starredAt <= cutoff) {
        reachedCutoff = true;
        continue;
      }
      records.push(record);
      if (options.limit && records.length >= options.limit) break;
    }

    if (options.limit && records.length >= options.limit) break;
    if (reachedCutoff) break;
    if (pageRecords.length < perPage) break;
    page += 1;
  }

  return { records, newestStarredAt, skipped };
}
