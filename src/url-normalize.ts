const TRACKING_PARAM_EXACT_NAMES = new Set([
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
]);

const NON_EXTERNAL_X_HOSTS = new Set([
  'x.com',
  'www.x.com',
  'twitter.com',
  'www.twitter.com',
  'mobile.twitter.com',
  't.co',
  'www.t.co',
]);

export interface XBookmarkDedupeInput {
  tweetId: string;
  links?: string[];
}

export function normalizeBookmarkUrl(input: string): string {
  const url = cleanUrl(input);
  url.hash = '';
  return url.toString();
}

/**
 * Display-safe cleanup: same tracking-param and casing rules as the dedupe key,
 * but fragments survive because they carry meaning for readers (section anchors).
 */
export function cleanDisplayUrl(input: string): string {
  try {
    return cleanUrl(input).toString();
  } catch {
    return input;
  }
}

function cleanUrl(input: string): URL {
  const url = new URL(input);

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();

  if (
    (url.protocol === 'http:' && url.port === '80')
    || (url.protocol === 'https:' && url.port === '443')
  ) {
    url.port = '';
  }

  const query = new URLSearchParams();
  for (const [name, value] of url.searchParams) {
    if (!isTrackingQueryParam(name)) {
      query.append(name, value);
    }
  }
  const normalizedQuery = query.toString();
  url.search = normalizedQuery ? `?${normalizedQuery}` : '';

  return url;
}

export function dedupeKeyForUrl(input: string): string {
  return `url:${normalizeBookmarkUrl(input)}`;
}

/** Status URLs from X, Twitter, and their common subdomains share one tweet id. */
export function xStatusIdFromUrl(input: string): string | null {
  try {
    const url = new URL(input);
    const host = url.hostname.toLowerCase();
    if (!NON_EXTERNAL_X_HOSTS.has(host)) return null;
    return url.pathname.match(/^\/[^/]+\/status\/(\d+)(?:\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
}

export function dedupeKeyForXBookmark(bookmark: XBookmarkDedupeInput): string {
  const externalLinks = new Set<string>();

  for (const link of bookmark.links ?? []) {
    const normalized = normalizeClearExternalLink(link);
    if (normalized) {
      externalLinks.add(normalized);
    }
  }

  if (externalLinks.size === 1) {
    const [externalLink] = externalLinks;
    return `url:${externalLink}`;
  }

  return `x:${bookmark.tweetId}`;
}

function isTrackingQueryParam(name: string): boolean {
  const normalizedName = name.toLowerCase();
  return normalizedName.startsWith('utm_') || TRACKING_PARAM_EXACT_NAMES.has(normalizedName);
}

function normalizeClearExternalLink(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }

  if (NON_EXTERNAL_X_HOSTS.has(url.hostname.toLowerCase())) {
    return null;
  }

  return normalizeBookmarkUrl(input);
}
