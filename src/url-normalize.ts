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
  const url = new URL(input);

  url.protocol = url.protocol.toLowerCase();
  url.hostname = url.hostname.toLowerCase();
  url.hash = '';

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

  return url.toString();
}

export function dedupeKeyForUrl(input: string): string {
  return `url:${normalizeBookmarkUrl(input)}`;
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
