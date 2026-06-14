import type { TranscriptSegment } from './summarize-bridge.js';

const WATCH_PAGE_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

const GET_TRANSCRIPT_ENDPOINT_REGEX = /"getTranscriptEndpoint":\{"params":"([^"]+)"\}/;

export interface WebCaptionTranscript {
  segments: TranscriptSegment[];
  source: 'youtubei' | 'captionTracks';
}

interface YoutubeCaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind: string;
  label: string;
  automatic: boolean;
}

interface YoutubeCaptionLine {
  startMs: number | null;
  endMs: number | null;
  text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return null;
}

function getNestedProperty(object: unknown, path: string[]): unknown {
  let current: unknown = object;
  for (const key of path) {
    if (!isRecord(current) || !(key in current)) {
      return null;
    }
    current = current[key];
  }
  return current;
}

function getArrayProperty(object: unknown, path: string[]): unknown[] | null {
  const value = getNestedProperty(object, path);
  return Array.isArray(value) ? value : null;
}

export function extractYoutubeBootstrapConfig(html: string): Record<string, unknown> | null {
  const match = html.match(/ytcfg\.set\((\{[\s\S]*?\})\);?\s*[\n<]/);
  if (!match) return null;
  try {
    return JSON.parse(match[1] ?? '{}') as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function extractInitialPlayerResponse(html: string): Record<string, unknown> | null {
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});?\s*[\n<]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1] ?? '{}') as Record<string, unknown>;
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

interface YoutubeiTranscriptConfig {
  apiKey: string;
  context: Record<string, unknown>;
  params: string;
  visitorData: string | null;
  clientName: string | null;
  clientVersion: string | null;
}

export function extractYoutubeiTranscriptConfig(html: string): YoutubeiTranscriptConfig | null {
  const bootstrapConfig = extractYoutubeBootstrapConfig(html);
  if (!bootstrapConfig) return null;

  const parametersMatch = html.match(GET_TRANSCRIPT_ENDPOINT_REGEX);
  if (!parametersMatch) return null;

  const apiKey = stringValue(bootstrapConfig.INNERTUBE_API_KEY);
  const context = isRecord(bootstrapConfig.INNERTUBE_CONTEXT) ? bootstrapConfig.INNERTUBE_CONTEXT : null;
  if (!apiKey || !context) return null;

  const visitorData =
    stringValue(bootstrapConfig.VISITOR_DATA) ??
    stringValue(getNestedProperty(context, ['client', 'visitorData']));
  const clientName =
    typeof bootstrapConfig.INNERTUBE_CONTEXT_CLIENT_NAME === 'number'
      ? String(bootstrapConfig.INNERTUBE_CONTEXT_CLIENT_NAME)
      : stringValue(bootstrapConfig.INNERTUBE_CONTEXT_CLIENT_NAME);
  const clientVersion = stringValue(bootstrapConfig.INNERTUBE_CLIENT_VERSION);

  return {
    apiKey,
    context,
    params: parametersMatch[1] ?? '',
    visitorData,
    clientName,
    clientVersion,
  };
}

async function fetchTranscriptFromYoutubeiEndpoint(
  fetchText: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<string>,
  config: YoutubeiTranscriptConfig,
  originalUrl: string,
): Promise<WebCaptionTranscript | null> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': WATCH_PAGE_HEADERS['User-Agent'],
    Accept: 'application/json',
    Origin: 'https://www.youtube.com',
    Referer: originalUrl,
    'X-Goog-AuthUser': '0',
    'X-Youtube-Bootstrap-Logged-In': 'false',
  };
  if (config.clientName) headers['X-Youtube-Client-Name'] = config.clientName;
  if (config.clientVersion) headers['X-Youtube-Client-Version'] = config.clientVersion;
  if (config.visitorData) headers['X-Goog-Visitor-Id'] = config.visitorData;

  const contextRecord = config.context as Record<string, unknown> & { client?: unknown };
  const existingClient = isRecord(contextRecord.client) ? contextRecord.client : {};
  const body = JSON.stringify({
    context: {
      ...contextRecord,
      client: { ...existingClient, originalUrl },
    },
    params: config.params,
  });

  try {
    const response = await fetchText(
      `https://www.youtube.com/youtubei/v1/get_transcript?key=${encodeURIComponent(config.apiKey)}`,
      { method: 'POST', headers, body },
    );
    const parsed: unknown = JSON.parse(response);
    return extractTranscriptFromYoutubeiPayload(parsed);
  } catch {
    return null;
  }
}

function extractTranscriptFromYoutubeiPayload(data: unknown): WebCaptionTranscript | null {
  if (!isRecord(data)) return null;

  const actions = getArrayProperty(data, ['actions']);
  if (!actions || actions.length === 0) return null;

  const updatePanel = getNestedProperty(actions[0], ['updateEngagementPanelAction']);
  const content = getNestedProperty(updatePanel, ['content']);
  const transcriptRenderer = getNestedProperty(content, ['transcriptRenderer']);
  const segmentListNode = getNestedProperty(transcriptRenderer, ['content']);
  const searchPanelRenderer = getNestedProperty(segmentListNode, ['transcriptSearchPanelRenderer']);
  const body = getNestedProperty(searchPanelRenderer, ['body']);
  const segmentBody = getNestedProperty(body, ['transcriptSegmentListRenderer']);
  const segmentList = getArrayProperty(segmentBody, ['initialSegments']);
  if (!segmentList || segmentList.length === 0) return null;

  const segments: TranscriptSegment[] = [];
  for (const segment of segmentList) {
    const renderer = getNestedProperty(segment, ['transcriptSegmentRenderer']);
    const snippet = getNestedProperty(renderer, ['snippet']);
    const runs = getArrayProperty(snippet, ['runs']);
    if (!runs) continue;

    const text = runs
      .map((run) => (isRecord(run) && typeof run.text === 'string' ? run.text : ''))
      .join('')
      .trim();
    if (!text) continue;

    const startMs = parseTimestampToMs((renderer as Record<string, unknown>).startMs, false);
    const durationMs = parseTimestampToMs((renderer as Record<string, unknown>).durationMs, false);
    if (startMs != null) {
      segments.push({
        tSec: startMs / 1000,
        durationSec: durationMs != null ? durationMs / 1000 : 0,
        text,
      });
    }
  }

  return segments.length > 0 ? { segments, source: 'youtubei' } : null;
}

function trackLabel(track: unknown): string {
  if (!isRecord(track)) return '';
  if (typeof track.label === 'string') return track.label.trim();
  const name = track.name;
  if (!isRecord(name)) return '';
  if (typeof name.simpleText === 'string') return name.simpleText.trim();
  if (!Array.isArray(name.runs)) return '';
  return name.runs
    .map((run) => (isRecord(run) && typeof run.text === 'string' ? run.text : ''))
    .join('')
    .trim();
}

function normalizeTrack(value: unknown, automaticGroup: boolean): YoutubeCaptionTrack | null {
  if (!isRecord(value)) return null;
  const baseUrl =
    typeof value.baseUrl === 'string'
      ? value.baseUrl
      : typeof value.url === 'string'
        ? value.url
        : null;
  if (!baseUrl) return null;
  const languageCode =
    typeof value.languageCode === 'string' ? value.languageCode.toLowerCase() : '';
  const kind = typeof value.kind === 'string' ? value.kind.toLowerCase() : '';
  const label = trackLabel(value);
  return {
    baseUrl,
    languageCode,
    kind,
    label,
    automatic: automaticGroup || kind === 'asr' || label.toLowerCase().includes('auto-generated'),
  };
}

function rankCaptionTracks(
  captionTracks: unknown[],
  automaticCaptionTracks: unknown[],
): YoutubeCaptionTrack[] {
  const tracks = [
    ...captionTracks.map((track) => normalizeTrack(track, false)),
    ...automaticCaptionTracks.map((track) => normalizeTrack(track, true)),
  ].filter((track): track is YoutubeCaptionTrack => track !== null);

  return tracks.slice().sort((left: YoutubeCaptionTrack, right: YoutubeCaptionTrack) => {
    const english = (track: YoutubeCaptionTrack) =>
      track.languageCode === 'en' || track.languageCode.startsWith('en-');
    const namedEnglish = (track: YoutubeCaptionTrack) =>
      track.label.toLowerCase().includes('english');
    const leftScore = [left.automatic ? 1 : 0, english(left) ? 0 : 1, namedEnglish(left) ? 0 : 1];
    const rightScore = [right.automatic ? 1 : 0, english(right) ? 0 : 1, namedEnglish(right) ? 0 : 1];
    for (let i = 0; i < leftScore.length; i += 1) {
      const diff = leftScore[i] - rightScore[i];
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

function captionTrackUrls(baseUrl: string): string[] {
  const urls: string[] = [];
  try {
    const url = new URL(baseUrl);
    url.searchParams.set('fmt', 'json3');
    url.searchParams.set('alt', 'json');
    urls.push(url.toString());
    url.searchParams.delete('fmt');
    url.searchParams.delete('alt');
    urls.push(url.toString());
  } catch {
    const separator = baseUrl.includes('?') ? '&' : '?';
    urls.push(`${baseUrl}${separator}fmt=json3&alt=json`);
    urls.push(baseUrl);
  }
  return urls;
}

function normalizeCaptionText(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseTimestampStringToMs(value: string): number | null {
  const trimmed = value.trim();
  const parts = trimmed.split(':').map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3) return null;
  const secondsParts = parts[parts.length - 1].split('.');
  const seconds = Number(secondsParts[0]);
  const msPart = secondsParts[1] ? Number(`0.${secondsParts[1]}`) * 1000 : 0;
  const minutes = Number(parts[parts.length - 2]);
  const hours = parts.length === 3 ? Number(parts[0]) : 0;
  if ([hours, minutes, seconds, msPart].some((n) => !Number.isFinite(n))) return null;
  return Math.round(hours * 3600000 + minutes * 60000 + seconds * 1000 + msPart);
}

function parseTimestampToMs(value: unknown, allowSeconds = false): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return allowSeconds ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return allowSeconds ? Math.round(parsed * 1000) : Math.round(parsed);
    return parseTimestampStringToMs(value);
  }
  return null;
}

function transcriptFromLines(lines: YoutubeCaptionLine[]): WebCaptionTranscript | null {
  const normalized = lines.filter((line) => line.text.length > 0);
  if (normalized.length === 0) return null;
  const segments: TranscriptSegment[] = [];
  for (const line of normalized) {
    if (line.startMs == null) continue;
    segments.push({
      tSec: line.startMs / 1000,
      durationSec: line.endMs != null ? (line.endMs - line.startMs) / 1000 : 0,
      text: line.text,
    });
  }
  return segments.length > 0 ? { segments, source: 'captionTracks' } : null;
}

function parseJson3Captions(raw: string): WebCaptionTranscript | null {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.events)) return null;
    const lines: YoutubeCaptionLine[] = [];
    for (const event of parsed.events) {
      if (!isRecord(event) || !Array.isArray(event.segs)) continue;
      const text = normalizeCaptionText(
        event.segs
          .map((segment) => (isRecord(segment) && typeof segment.utf8 === 'string' ? segment.utf8 : ''))
          .join(''),
      );
      if (!text) continue;
      const startMs = parseTimestampToMs(event.tStartMs, false);
      const durationMs = parseTimestampToMs(event.dDurationMs, false);
      lines.push({
        startMs,
        endMs: startMs != null && durationMs != null ? startMs + durationMs : null,
        text,
      });
    }
    return transcriptFromLines(lines);
  } catch {
    return null;
  }
}

function parseXmlCaptions(raw: string): WebCaptionTranscript | null {
  const pattern = /<text([^>]*)>([\s\S]*?)<\/text>/gi;
  const lines: YoutubeCaptionLine[] = [];
  let match: RegExpExecArray | null = pattern.exec(raw);
  while (match) {
    const attributes = match[1] ?? '';
    const text = normalizeCaptionText(match[2] ?? '');
    if (text) {
      const startValue = /\bstart\s*=\s*(['"])([^'"]+)\1/i.exec(attributes)?.[2];
      const durationValue = /\bdur\s*=\s*(['"])([^'"]+)\1/i.exec(attributes)?.[2];
      const startMs = startValue ? parseTimestampToMs(startValue, true) : null;
      const durationMs = durationValue ? parseTimestampToMs(durationValue, true) : null;
      lines.push({
        startMs,
        endMs: startMs != null && durationMs != null ? startMs + durationMs : null,
        text,
      });
    }
    match = pattern.exec(raw);
  }
  return transcriptFromLines(lines);
}

function parseCaptionPayload(raw: string): WebCaptionTranscript | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('{')) {
    const json = parseJson3Captions(trimmed);
    if (json) return json;
  }
  return parseXmlCaptions(trimmed) ?? parseJson3Captions(trimmed);
}

async function fetchCaptionTrack(
  fetchText: (url: string) => Promise<string>,
  track: YoutubeCaptionTrack,
): Promise<WebCaptionTranscript | null> {
  for (const url of captionTrackUrls(track.baseUrl)) {
    try {
      const raw = await fetchText(url);
      const parsed = parseCaptionPayload(raw);
      if (parsed) return parsed;
    } catch {
      // Try the next representation.
    }
  }
  return null;
}

async function fetchTranscriptFromCaptionTracks(
  fetchText: (url: string) => Promise<string>,
  html: string,
): Promise<WebCaptionTranscript | null> {
  const playerResponse = extractInitialPlayerResponse(html);
  const captions = isRecord(playerResponse?.captions)
    ? (playerResponse.captions as Record<string, unknown>)
    : null;
  const renderer =
    (isRecord(captions?.playerCaptionsTracklistRenderer)
      ? captions.playerCaptionsTracklistRenderer
      : null) ??
    (isRecord(playerResponse?.playerCaptionsTracklistRenderer)
      ? playerResponse.playerCaptionsTracklistRenderer
      : null);
  if (!isRecord(renderer)) return null;

  const captionTracks = Array.isArray(renderer.captionTracks) ? renderer.captionTracks : [];
  const automaticTracks = Array.isArray(renderer.automaticCaptions)
    ? renderer.automaticCaptions
    : [];
  const ranked = rankCaptionTracks(captionTracks, automaticTracks);
  if (ranked.length === 0) return null;

  for (const track of ranked) {
    const result = await fetchCaptionTrack(fetchText, track);
    if (result) return result;
  }
  return null;
}

export async function fetchWebCaptionTranscript(
  videoId: string,
  fetchText: (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<string>,
): Promise<WebCaptionTranscript | null> {
  const videoUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  let html: string;
  try {
    html = await fetchText(videoUrl, { headers: WATCH_PAGE_HEADERS });
  } catch {
    return null;
  }
  if (!html || html.length < 100) return null;

  const config = extractYoutubeiTranscriptConfig(html);
  if (config) {
    const transcript = await fetchTranscriptFromYoutubeiEndpoint(fetchText, config, videoUrl);
    if (transcript) return transcript;
  }

  return fetchTranscriptFromCaptionTracks(
    (url) => fetchText(url, { headers: WATCH_PAGE_HEADERS }),
    html,
  );
}
