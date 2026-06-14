import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractYoutubeBootstrapConfig,
  extractInitialPlayerResponse,
  extractYoutubeiTranscriptConfig,
  fetchWebCaptionTranscript,
} from '../src/youtube/captions.js';

const watchHtmlWithBootstrap = (playerResponse = '{}') => `
<!DOCTYPE html>
<html>
<script nonce="abc">ytcfg.set({"INNERTUBE_API_KEY":"key123","INNERTUBE_CONTEXT":{"client":{"hl":"en","gl":"US","visitorData":"visitor"}},"INNERTUBE_CONTEXT_CLIENT_NAME":1,"INNERTUBE_CONTEXT_CLIENT_VERSION":"2.2024","INNERTUBE_CLIENT_VERSION":"2.2024","VISITOR_DATA":"visitor","PAGE_CL":123,"PAGE_BUILD_LABEL":"yt.win-2024"});</script>
<script nonce="abc">var ytInitialPlayerResponse = ${playerResponse};</script>
<script nonce="abc">"getTranscriptEndpoint":{"params":"params123"}</script>
<body>watch page</body>
</html>
`;

const youtubeiPayload = {
  actions: [
    {
      updateEngagementPanelAction: {
        content: {
          transcriptRenderer: {
            content: {
              transcriptSearchPanelRenderer: {
                body: {
                  transcriptSegmentListRenderer: {
                    initialSegments: [
                      {
                        transcriptSegmentRenderer: {
                          startMs: 1000,
                          durationMs: 2000,
                          snippet: { runs: [{ text: 'First line' }] },
                        },
                      },
                      {
                        transcriptSegmentRenderer: {
                          startMs: 3500,
                          durationMs: 1500,
                          snippet: { runs: [{ text: 'Second line' }] },
                        },
                      },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    },
  ],
};

const captionTracksPlayerResponse = {
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=es',
          languageCode: 'es',
          kind: 'asr',
          label: 'Spanish',
        },
        {
          baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en',
          languageCode: 'en',
          kind: '',
          label: 'English',
        },
      ],
      automaticCaptions: {
        'en-US': [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en-US&kind=asr',
            languageCode: 'en-US',
            kind: 'asr',
            label: 'English (auto-generated)',
          },
        ],
      },
    },
  },
};

test('extractYoutubeBootstrapConfig parses ytcfg.set payload', () => {
  const html = watchHtmlWithBootstrap();
  const config = extractYoutubeBootstrapConfig(html);
  assert.equal(config?.INNERTUBE_API_KEY, 'key123');
  assert.equal(config?.VISITOR_DATA, 'visitor');
});

test('extractInitialPlayerResponse parses ytInitialPlayerResponse', () => {
  const html = watchHtmlWithBootstrap('{"videoDetails":{"videoId":"abc"}}');
  const response = extractInitialPlayerResponse(html);
  assert.equal((response?.videoDetails as Record<string, unknown>)?.videoId, 'abc');
});

test('extractYoutubeiTranscriptConfig requires transcript endpoint params', () => {
  const htmlWithoutParams = watchHtmlWithBootstrap().replace(/"getTranscriptEndpoint":\{[^}]+\}/, '');
  assert.equal(extractYoutubeiTranscriptConfig(htmlWithoutParams), null);
});

test('fetchWebCaptionTranscript returns youtubei segments when endpoint succeeds', async () => {
  const html = watchHtmlWithBootstrap();
  const transcript = await fetchWebCaptionTranscript('abc', async (url, init) => {
    if (url.includes('/youtubei/v1/get_transcript')) {
      assert.equal(init?.method, 'POST');
      assert.equal(init?.headers?.['X-Youtube-Client-Name'], '1');
      assert.ok(init?.body);
      return JSON.stringify(youtubeiPayload);
    }
    return html;
  });
  assert.equal(transcript?.source, 'youtubei');
  assert.deepEqual(transcript?.segments, [
    { tSec: 1, durationSec: 2, text: 'First line' },
    { tSec: 3.5, durationSec: 1.5, text: 'Second line' },
  ]);
});

test('fetchWebCaptionTranscript falls back from youtubei to caption tracks', async () => {
  const html = watchHtmlWithBootstrap(JSON.stringify(captionTracksPlayerResponse));
  const transcript = await fetchWebCaptionTranscript('abc', async (url) => {
    if (url.includes('/youtubei/v1/get_transcript')) {
      return JSON.stringify({ actions: [] });
    }
    if (url.includes('/api/timedtext')) {
      return url.includes('lang=en&')
        ? '<transcript><text start="1" dur="2">English track</text></transcript>'
        : '';
    }
    return html;
  });
  assert.equal(transcript?.source, 'captionTracks');
  assert.equal(transcript?.segments.length, 1);
  assert.equal(transcript?.segments[0].text, 'English track');
});

test('fetchWebCaptionTranscript prefers manual English over auto-generated captions', async () => {
  const response = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en-GB',
            languageCode: 'en-GB',
            kind: '',
            label: 'English (United Kingdom)',
          },
        ],
        automaticCaptions: {
          en: [
            {
              baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en&kind=asr',
              languageCode: 'en',
              kind: 'asr',
              label: 'English (auto-generated)',
            },
          ],
        },
      },
    },
  };
  const html = watchHtmlWithBootstrap(JSON.stringify(response));
  const calls: string[] = [];
  const transcript = await fetchWebCaptionTranscript('abc', async (url) => {
    if (url.includes('/api/timedtext')) {
      calls.push(url);
      return url.includes('en-GB')
        ? '<transcript><text start="0" dur="1">Manual</text></transcript>'
        : '';
    }
    if (url.includes('/youtubei/v1/get_transcript')) return JSON.stringify({ actions: [] });
    return html;
  });
  assert.equal(transcript?.segments[0].text, 'Manual');
  assert.ok(calls[0]?.includes('en-GB'), 'manual English track should be requested first');
});

test('fetchWebCaptionTranscript parses json3 caption format', async () => {
  const response = {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [
          {
            baseUrl: 'https://www.youtube.com/api/timedtext?v=abc&lang=en',
            languageCode: 'en',
            kind: '',
            label: 'English',
          },
        ],
      },
    },
  };
  const html = watchHtmlWithBootstrap(JSON.stringify(response));
  const transcript = await fetchWebCaptionTranscript('abc', async (url) => {
    if (url.includes('/youtubei/v1/get_transcript')) return JSON.stringify({ actions: [] });
    if (url.includes('fmt=json3')) {
      return JSON.stringify({
        events: [
          { tStartMs: 100, dDurationMs: 900, segs: [{ utf8: 'Hello ' }, { utf8: 'world' }] },
        ],
      });
    }
    return html;
  });
  assert.equal(transcript?.segments[0].tSec, 0.1);
  assert.equal(transcript?.segments[0].text, 'Hello world');
});

test('fetchWebCaptionTranscript returns null when no captions are available', async () => {
  const html = watchHtmlWithBootstrap('{}');
  const transcript = await fetchWebCaptionTranscript('abc', async (url) => {
    if (url.includes('/youtubei/v1/get_transcript')) return JSON.stringify({ actions: [] });
    return html;
  });
  assert.equal(transcript, null);
});
