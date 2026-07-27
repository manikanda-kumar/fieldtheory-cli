import { spawn } from 'node:child_process';

export type SyncAllSource = 'following' | 'x' | 'tweetsmash' | 'x-list' | 'raindrop' | 'github-stars' | 'projects' | 'youtube';

export interface SyncAllOptions {
  dryRun?: boolean;
  only?: string;
  skip?: string[];
  xList?: string;
  playlist?: string;
  youtubeLimit?: number;
  noSynthesis?: boolean;
  classify?: boolean;
  /** Extra attempts for network-backed steps after the first failure. */
  retries?: number;
  /** Base backoff before the first retry; each further wait triples it. */
  retryDelayMs?: number;
}

export interface SyncAllStep {
  id: string;
  label: string;
  source?: SyncAllSource;
  command: string[];
  enabled: boolean;
  reason?: string;
  required?: boolean;
  /** Network-backed steps are retried; local ones fail fast. */
  retryable?: boolean;
}

export interface SyncAllStepResult extends SyncAllStep {
  status: 'planned' | 'skipped' | 'ok' | 'failed';
  exitCode?: number | null;
  error?: string;
  attempts?: number;
}

export interface SyncAllResult {
  dryRun: boolean;
  steps: SyncAllStepResult[];
  ok: boolean;
}

export interface SyncAllRunner {
  run(command: string[]): Promise<{ exitCode: number | null }>;
}

const ALL_SOURCES: SyncAllSource[] = ['following', 'x', 'tweetsmash', 'x-list', 'raindrop', 'github-stars', 'projects', 'youtube'];

export function parseSyncAllSources(value: string | undefined): Set<SyncAllSource> | null {
  if (!value?.trim()) return null;
  const parsed = value.split(',').map((entry) => entry.trim()).filter(Boolean);
  const sources = new Set<SyncAllSource>();
  for (const entry of parsed) {
    if (!isSyncAllSource(entry)) throw new Error(`Unknown sync source: ${entry}`);
    sources.add(entry);
  }
  return sources;
}

export function buildSyncAllPlan(options: SyncAllOptions): SyncAllStep[] {
  const only = parseSyncAllSources(options.only);
  const skip = new Set<SyncAllSource>();
  for (const entry of options.skip ?? []) {
    for (const source of entry.split(',').map((part) => part.trim()).filter(Boolean)) {
      if (!isSyncAllSource(source)) throw new Error(`Unknown sync source: ${source}`);
      skip.add(source);
    }
  }
  const enabled = (source: SyncAllSource): boolean => (!only || only.has(source)) && !skip.has(source);
  const classify = Boolean(options.classify && !options.noSynthesis);

  const steps: SyncAllStep[] = [
    {
      id: 'following',
      label: 'Sync X following roster',
      source: 'following',
      command: ['sync-following'],
      enabled: enabled('following'),
      retryable: true,
    },
    {
      id: 'x',
      label: 'Sync X bookmarks',
      source: 'x',
      command: ['sync'],
      enabled: enabled('x'),
      retryable: true,
    },
    {
      id: 'tweetsmash',
      label: 'Enrich X bookmarks via Tweetsmash',
      source: 'tweetsmash',
      // Index rebuild runs later in the pipeline; skip the per-step rebuild.
      command: ['sync-tweetsmash', '--no-index'],
      retryable: true,
      enabled: enabled('tweetsmash') && Boolean(process.env.TWEETSMASH_API_KEY),
      reason: process.env.TWEETSMASH_API_KEY ? undefined : 'set TWEETSMASH_API_KEY to include',
    },
    {
      id: 'x-classify',
      // Regex-only and fill-only: cheap, offline, and never overwrites an
      // existing label. Without it the X-only table drifts to zero categories
      // (2026-07-26: 0/10,648) and ft categories / ft search --category /
      // the viz dashboard go blank while canonical stays classified.
      label: 'Classify X bookmarks (regex)',
      source: 'x',
      command: ['classify', '--regex'],
      enabled: enabled('x') && classify,
      reason: classify ? undefined : 'pass --classify to include',
    },
    {
      id: 'x-list',
      label: 'Fetch X list digest',
      source: 'x-list',
      command: options.xList ? ['x-list', options.xList, '--since-hours', '24'] : ['x-list', '--since-hours', '24'],
      enabled: enabled('x-list') && Boolean(options.xList),
      retryable: true,
      reason: options.xList ? undefined : 'pass --x-list <id> to include',
    },
    {
      id: 'raindrop',
      label: 'Sync Raindrop bookmarks',
      source: 'raindrop',
      command: ['sync-raindrop', ...(classify ? ['--classify'] : [])],
      enabled: enabled('raindrop'),
      retryable: true,
    },
    {
      id: 'github-stars',
      label: 'Sync GitHub stars',
      source: 'github-stars',
      command: ['sync-github-stars', ...(classify ? ['--classify'] : [])],
      enabled: enabled('github-stars'),
      retryable: true,
    },
    {
      id: 'projects',
      label: 'Sync local projects',
      source: 'projects',
      command: ['sync-projects'],
      enabled: enabled('projects'),
    },
    {
      id: 'youtube',
      label: 'Sync YouTube playlist',
      source: 'youtube',
      command: options.playlist
        ? ['sync-youtube', '--playlist', options.playlist, '--limit', String(options.youtubeLimit ?? 8)]
        : ['sync-youtube', '--limit', String(options.youtubeLimit ?? 8)],
      enabled: enabled('youtube') && Boolean(options.playlist),
      retryable: true,
      reason: options.playlist ? undefined : 'pass --playlist <url-or-id> to include',
    },
    {
      id: 'canonical-index',
      label: 'Rebuild unified canonical index',
      command: ['index'],
      enabled: true,
      required: true,
    },
    {
      id: 'canonical-md',
      label: 'Export canonical Markdown library',
      command: ['md', '--canonical'],
      enabled: !options.noSynthesis,
      reason: options.noSynthesis ? 'disabled by --no-synthesis' : undefined,
    },
    {
      id: 'daily',
      label: 'Write daily digest and interests profile',
      command: ['daily', '--write'],
      enabled: !options.noSynthesis,
      reason: options.noSynthesis ? 'disabled by --no-synthesis' : undefined,
    },
  ];

  if (only) {
    for (const step of steps) {
      if (step.source && !only.has(step.source)) step.reason = `not selected by --only ${options.only}`;
    }
  }
  for (const step of steps) {
    if (step.source && skip.has(step.source)) step.reason = `skipped by --skip ${step.source}`;
  }
  return steps;
}

export const DEFAULT_SYNC_ALL_RETRIES = 2;
export const DEFAULT_SYNC_ALL_RETRY_DELAY_MS = 20_000;

export async function runSyncAll(
  options: SyncAllOptions,
  runner: SyncAllRunner = defaultSyncAllRunner(),
  sleep: (ms: number) => Promise<void> = defaultSleep,
): Promise<SyncAllResult> {
  const plan = buildSyncAllPlan(options);
  const steps: SyncAllStepResult[] = [];
  const retries = resolveRetries(options);
  const retryDelayMs = resolveRetryDelayMs(options);

  for (const step of plan) {
    if (!step.enabled) {
      steps.push({ ...step, status: 'skipped' });
      continue;
    }
    if (options.dryRun) {
      steps.push({ ...step, status: 'planned' });
      continue;
    }
    // Transient network faults (`Error: fetch failed`) killed whole steps on
    // 2026-07-20/24/27; each one succeeded on a manual re-run minutes later.
    const maxAttempts = step.retryable ? retries + 1 : 1;
    let outcome: SyncAllStepResult | null = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await runner.run(step.command);
        outcome = {
          ...step,
          status: result.exitCode === 0 ? 'ok' : 'failed',
          exitCode: result.exitCode,
          attempts: attempt,
        };
      } catch (error) {
        outcome = {
          ...step,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
          attempts: attempt,
        };
      }
      if (outcome.status === 'ok' || attempt === maxAttempts) break;
      // Backoff triples per attempt: 20s, then 60s.
      await sleep(retryDelayMs * 3 ** (attempt - 1));
    }
    steps.push(outcome as SyncAllStepResult);
  }

  return { dryRun: Boolean(options.dryRun), steps, ok: !steps.some((step) => step.status === 'failed') };
}

function resolveRetries(options: SyncAllOptions): number {
  const value = options.retries ?? numberFromEnv(process.env.FT_SYNC_RETRIES);
  if (value == null || !Number.isFinite(value) || value < 0) return DEFAULT_SYNC_ALL_RETRIES;
  return Math.floor(value);
}

function resolveRetryDelayMs(options: SyncAllOptions): number {
  const value = options.retryDelayMs ?? numberFromEnv(process.env.FT_SYNC_RETRY_DELAY_MS);
  if (value == null || !Number.isFinite(value) || value < 0) return DEFAULT_SYNC_ALL_RETRY_DELAY_MS;
  return value;
}

function numberFromEnv(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function formatSyncAllResult(result: SyncAllResult): string {
  const lines = [result.dryRun ? 'Sync-all dry run:' : 'Sync-all complete:'];
  for (const step of result.steps) {
    const icon = step.status === 'ok' ? '✓' : step.status === 'failed' ? '!' : step.status === 'skipped' ? '-' : '•';
    const command = step.command.filter(Boolean).join(' ');
    const tries = (step.attempts ?? 1) > 1 ? ` after ${step.attempts} attempts` : '';
    const suffix = step.status === 'failed'
      ? ` failed${step.exitCode != null ? ` (${step.exitCode})` : ''}${step.error ? `: ${step.error}` : ''}${tries}`
      : step.status === 'ok' ? tries
      : step.reason ? ` — ${step.reason}` : '';
    lines.push(`  ${icon} ${step.label}${command ? `  ft ${command}` : ''}${suffix}`);
  }
  if (!result.ok) lines.push('  Some sources failed; later steps still ran where possible.');
  return lines.join('\n');
}

function isSyncAllSource(value: string): value is SyncAllSource {
  return ALL_SOURCES.includes(value as SyncAllSource);
}

function defaultSyncAllRunner(): SyncAllRunner {
  const executable = process.argv[1];
  return {
    run(command: string[]) {
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [executable, ...command], { stdio: 'inherit', env: process.env });
        child.on('error', reject);
        child.on('close', (exitCode) => resolve({ exitCode }));
      });
    },
  };
}
