/**
 * Type definitions for the X/Twitter following roster.
 *
 * Following records are synced from the GraphQL `Following` endpoint using the
 * same browser session cookie auth path as `ft sync`. Each record represents
 * one account the logged-in user follows, with optional LLM classification
 * (domains, expertise) and bookmark overlap counts.
 */

export interface FollowingRecord {
  userId: string;
  handle: string;
  name: string;
  bio?: string;
  profileImageUrl?: string;
  followerCount?: number;
  followingCount?: number;
  verified?: boolean;
  syncedAt: string;
  // classification (nullable until classified)
  domains?: string[];
  primaryDomain?: string;
  expertise?: string[];
  expertiseSummary?: string;
  /** Count of user's bookmarks from this handle (filled from bookmarks.db). */
  bookmarkOverlap?: number;
  /** Marks that this account was observed during an authoritative crawl. */
  seenInCrawlAt?: string;
}

export interface FollowingMeta {
  /** Saved pagination cursor for incremental sync. */
  cursor?: string;
  lastUpdated: string;
  count: number;
  /** The user ID whose following list was synced. */
  viewerId?: string;
  /** True only after X's Following timeline has been read to its end. */
  snapshotComplete?: boolean;
  /** Stable marker shared by all pages of an interrupted/resumed crawl. */
  crawlStartedAt?: string;
}

export interface FollowingSyncOptions {
  /** Max pages to fetch (default: unlimited). */
  maxPages?: number;
  /** Stop after this many new records (default: unlimited). */
  targetAdds?: number;
  /** Delay between page requests in ms. Default: 600. */
  delayMs?: number;
  /** Max runtime in minutes. Default: 30. */
  maxMinutes?: number;
  /** Browser id (e.g. 'chrome', 'firefox', 'brave'). */
  browser?: string;
  /** Chrome-family user-data-dir override. */
  chromeUserDataDir?: string;
  /** Chrome-family profile directory name (e.g. "Default"). */
  chromeProfileDirectory?: string;
  /** Firefox profile directory override. */
  firefoxProfileDir?: string;
  /** Direct csrf token override; skips all cookie extraction. */
  csrfToken?: string;
  /** Direct cookie header override; skips all cookie extraction. */
  cookieHeader?: string;
  /** Override the GraphQL Following query id. */
  queryId?: string;
  /** Full re-crawl (ignore saved cursor). */
  rebuild?: boolean;
  /** Resume from saved cursor. */
  continue?: boolean;
  /** Run classification after sync. */
  classify?: boolean;
  /** Progress callback. */
  onProgress?: (status: FollowingSyncProgress) => void;
  /** Injectable transport seam for tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock seam for snapshot lifecycle tests. */
  now?: () => Date;
}

export interface FollowingSyncProgress {
  page: number;
  totalFetched: number;
  newAdded: number;
  running: boolean;
  done: boolean;
  stopReason?: string;
}

export interface FollowingSyncResult {
  added: number;
  totalFollowing: number;
  pages: number;
  stopReason: string;
  cachePath: string;
  metaPath: string;
  snapshotComplete: boolean;
  pruned: number;
}
