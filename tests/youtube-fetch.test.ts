import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fetchVideo, NoTranscriptError, parseTimedTextTranscript, parseVttTranscript } from '../src/youtube/fetch.js';
import { SummarizeUnavailableError } from '../src/youtube/summarize-bridge.js';

test('parseVttTranscript parses cue timings and text', () => {
  assert.deepEqual(parseVttTranscript(`WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello world\n\n00:00:04.000 --> 00:00:05.000\nNext`), [
    { tSec: 1, durationSec: 2.5, text: 'Hello world' },
    { tSec: 4, durationSec: 1, text: 'Next' },
  ]);
});

test('parseVttTranscript removes rolling auto-caption overlap and cue tags', () => {
  assert.deepEqual(parseVttTranscript(`WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<c>Agents need memory</c>\n\n00:00:03.000 --> 00:00:05.000\nAgents need memory and tools\n\n00:00:05.000 --> 00:00:07.000\nand tools for long tasks`), [
    { tSec: 1, durationSec: 2, text: 'Agents need memory' },
    { tSec: 3, durationSec: 2, text: 'and tools' },
    { tSec: 5, durationSec: 2, text: 'for long tasks' },
  ]);
});

test('parseTimedTextTranscript parses YouTube timedtext XML', () => {
  assert.deepEqual(parseTimedTextTranscript('<transcript><text start="1.5" dur="2">Hello &amp; bye</text></transcript>'), [
    { tSec: 1.5, durationSec: 2, text: 'Hello & bye' },
  ]);
});

test('parseTimedTextTranscript removes rolling overlap', () => {
  assert.deepEqual(parseTimedTextTranscript('<transcript><text start="1" dur="2">hello brave world</text><text start="3" dur="2">brave world today</text></transcript>'), [
    { tSec: 1, durationSec: 2, text: 'hello brave world' },
    { tSec: 3, durationSec: 2, text: 'today' },
  ]);
});

test('fetchVideo uses timedtext transcript before summarize fallback', async () => {
  const result = await fetchVideo('v1', {
    hasCommand: () => false,
    fetchText: async (url) => url.includes('timedtext')
      ? '<transcript><text start="0" dur="1">Timed transcript</text></transcript>'
      : JSON.stringify({ title: 'Fallback title', author_name: 'Channel' }),
  });

  assert.equal(result.meta.title, 'Fallback title');
  assert.equal(result.meta.channel, 'Channel');
  assert.equal(result.transcriptText, 'Timed transcript');
  assert.equal(result.frames, null);
  assert.match(result.contentHash, /^[a-f0-9]{64}$/);
});

test('fetchVideo prefers web caption extraction over timedtext and summarize', async () => {
  const bootstrap = JSON.stringify({
    INNERTUBE_API_KEY: 'key123',
    INNERTUBE_CONTEXT: { client: { visitorData: 'visitor' } },
    INNERTUBE_CONTEXT_CLIENT_NAME: 1,
    INNERTUBE_CONTEXT_CLIENT_VERSION: '2.2024',
    INNERTUBE_CLIENT_VERSION: '2.2024',
    VISITOR_DATA: 'visitor',
  });
  const watchHtml = `<!DOCTYPE html><html><script>ytcfg.set(${bootstrap});</script><script>"getTranscriptEndpoint":{"params":"params123"}</script><body></body></html>`;
  const summarizeCalls: string[] = [];

  const result = await fetchVideo('v1', {
    hasCommand: () => false,
    fetchText: async (url, init) => {
      if (url === 'https://www.youtube.com/watch?v=v1') return watchHtml;
      if (url.includes('/youtubei/v1/get_transcript')) {
        assert.equal(init?.method, 'POST');
        return JSON.stringify({
          actions: [{
            updateEngagementPanelAction: {
              content: {
                transcriptRenderer: {
                  content: {
                    transcriptSearchPanelRenderer: {
                      body: {
                        transcriptSegmentListRenderer: {
                          initialSegments: [{
                            transcriptSegmentRenderer: {
                              startMs: 1200,
                              durationMs: 1800,
                              snippet: { runs: [{ text: 'Web caption line' }] },
                            },
                          }],
                        },
                      },
                    },
                  },
                },
              },
            },
          }],
        });
      }
      if (url.includes('timedtext')) return '<transcript><text start="0" dur="1">Timed fallback</text></transcript>';
      return JSON.stringify({ title: 'Fallback title' });
    },
    runSummarize: async () => {
      summarizeCalls.push('summarize');
      return { transcript: { text: 'Summarize fallback', segments: [] }, slides: [], meta: {} };
    },
  });

  assert.equal(result.transcriptText, 'Web caption line');
  assert.deepEqual(result.segments, [{ tSec: 1.2, durationSec: 1.8, text: 'Web caption line' }]);
  assert.equal(summarizeCalls.length, 0, 'summarize bridge should not be invoked when web captions succeed');
});

test('fetchVideo passes yt-dlp browser cookies and impersonation to metadata and subtitles', async () => {
  const commands: Array<{ command: string; args: string[] }> = [];
  const result = await fetchVideo('v1', {
    ytDlp: { cookiesFromBrowser: 'chrome', impersonate: 'chrome' },
    hasCommand: (command) => command === 'yt-dlp',
    fetchText: async () => '',
    runCommand: async (command, args) => {
      commands.push({ command, args });
      if (args.includes('-J')) return JSON.stringify({ title: 'Yt title', duration: 12 });
      return 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFrom yt-dlp';
    },
  });

  assert.equal(result.meta.title, 'Yt title');
  assert.equal(result.transcriptText, 'From yt-dlp');
  assert.equal(commands.length, 2);
  for (const command of commands) {
    assert.equal(command.command, 'yt-dlp');
    assert.deepEqual(command.args.slice(0, 4), ['--cookies-from-browser', 'chrome', '--impersonate', 'chrome']);
  }
});

test('fetchVideo lets yt-dlp download subtitle files when direct timedtext fetch is blocked', async () => {
  const commands: Array<{ command: string; args: string[] }> = [];
  const result = await fetchVideo('v1', {
    ytDlp: { cookiesFromBrowser: 'chrome', impersonate: 'chrome' },
    hasCommand: (command) => command === 'yt-dlp',
    fetchText: async () => '',
    runCommand: async (command, args) => {
      commands.push({ command, args });
      if (args.includes('-J')) return JSON.stringify({ title: 'Yt title', duration: 12 });
      const outputIndex = args.indexOf('--output');
      assert.notEqual(outputIndex, -1);
      const outputTemplate = args[outputIndex + 1];
      const subtitlePath = outputTemplate.replace('%(id)s', 'v1').replace('%(ext)s', 'en.vtt');
      await mkdir(path.dirname(subtitlePath), { recursive: true });
      await writeFile(subtitlePath, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nDownloaded by yt-dlp\n\n00:00:05.000 --> 00:00:06.500\nSecond chapter source\n');
      return '';
    },
  });

  assert.equal(result.transcriptText, 'Downloaded by yt-dlp Second chapter source');
  assert.deepEqual(result.segments.map((segment) => segment.tSec), [1, 5]);
  assert.ok(commands[1].args.includes('--write-subs'));
  assert.ok(commands[1].args.includes('--write-auto-sub'));
  assert.ok(commands[1].args.includes('--output'));
});

test('fetchVideo falls back to summarize when timedtext and yt-dlp transcripts are unavailable', async () => {
  const result = await fetchVideo('v2', {
    hasCommand: () => false,
    fetchText: async () => '',
    runSummarize: async () => ({
      transcript: { text: 'Whisper text', segments: [{ tSec: 2, durationSec: 3, text: 'Whisper text' }] },
      slides: [{ tSec: 10, imagePath: '/tmp/slide.png' }],
      meta: { title: 'Summarized', channel: 'Speaker', durationSec: 9 },
    }),
    wantFrames: true,
  });

  assert.equal(result.transcriptText, 'Whisper text');
  assert.deepEqual(result.frames, [{ tSec: 10, imagePath: '/tmp/slide.png' }]);
});

test('fetchVideo keeps a short untimestamped summarize transcript as one segment', async () => {
  const result = await fetchVideo('v2', {
    hasCommand: () => false,
    fetchText: async () => '',
    runSummarize: async () => ({
      transcript: { text: 'Plain transcript from summarize', segments: [] },
      slides: [],
      meta: { title: 'Summarized', durationSec: 42 },
    }),
  });

  assert.equal(result.transcriptText, 'Plain transcript from summarize');
  assert.deepEqual(result.segments, [{ tSec: 0, durationSec: 42, text: 'Plain transcript from summarize' }]);
});

test('fetchVideo chunks a long untimestamped summarize transcript into spread segments', async () => {
  const sentences = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} explains a distinct point.`).join(' ');
  const result = await fetchVideo('v2', {
    hasCommand: () => false,
    fetchText: async () => '',
    runSummarize: async () => ({
      transcript: { text: sentences, segments: [] },
      slides: [],
      meta: { title: 'Summarized', durationSec: 1200 },
    }),
  });

  assert.ok(result.segments.length > 1, 'expected multiple segments');
  assert.equal(result.segments[0].tSec, 0);
  // Timestamps strictly increase and stay within the duration.
  for (let i = 1; i < result.segments.length; i += 1) {
    assert.ok(result.segments[i].tSec > result.segments[i - 1].tSec);
    assert.ok(result.segments[i].tSec <= 1200);
  }
  // No text is lost across chunking.
  assert.equal(result.segments.map((s) => s.text).join(' '), sentences);
});

test('fetchVideo preserves OCR text from summarized slides when frames are requested', async () => {
  const result = await fetchVideo('v2', {
    hasCommand: () => false,
    fetchText: async () => '',
    runSummarize: async () => ({
      transcript: { text: 'Slide talk', segments: [{ tSec: 2, durationSec: 3, text: 'Slide talk' }] },
      slides: [{ tSec: 10, imagePath: '/tmp/slide.png', ocrText: 'Architecture diagram' }],
      meta: { title: 'Summarized', channel: 'Speaker', durationSec: 9 },
    }),
    wantFrames: true,
  });

  assert.deepEqual(result.frames, [{ tSec: 10, imagePath: '/tmp/slide.png', ocrText: 'Architecture diagram' }]);
});

test('fetchVideo retries yt-dlp subtitle download after a 429 with backoff', async () => {
  const delays: number[] = [];
  let subtitleAttempts = 0;
  const result = await fetchVideo('v1', {
    ytDlp: { cookiesFromBrowser: 'chrome', impersonate: 'chrome' },
    hasCommand: (command) => command === 'yt-dlp',
    fetchText: async () => '',
    retry: { baseDelayMs: 10, sleep: async (ms) => { delays.push(ms); } },
    runCommand: async (command, args) => {
      if (args.includes('-J')) return JSON.stringify({ title: 'Yt title', duration: 12 });
      subtitleAttempts += 1;
      if (subtitleAttempts === 1) throw new Error('yt-dlp exited with 1: HTTP Error 429: Too Many Requests');
      return 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nRecovered after retry';
    },
  });

  assert.equal(result.transcriptText, 'Recovered after retry');
  assert.equal(subtitleAttempts, 2);
  assert.equal(delays.length, 1);
});

test('fetchVideo rejects YouTube boilerplate so a stub never overwrites a good note', async () => {
  await assert.rejects(
    fetchVideo('v9', {
      hasCommand: () => false,
      fetchText: async () => '',
      runSummarize: async () => ({
        transcript: { text: 'Enjoy the videos and music you love, upload original content, and share it all with friends, family, and the world on YouTube.', segments: [] },
        slides: [],
        meta: { title: '- YouTube' },
      }),
    }),
    NoTranscriptError,
  );
});

test('fetchVideo throws NoTranscriptError when no transcript source works', async () => {
  await assert.rejects(
    fetchVideo('v3', {
      hasCommand: () => false,
      fetchText: async () => '',
      runSummarize: async () => { throw new SummarizeUnavailableError(); },
    }),
    NoTranscriptError,
  );
});

test('fetchVideo content hash changes when transcript text changes at same length', async () => {
  const baseOptions = {
    hasCommand: () => false,
    fetchText: async (url: string) => url.includes('timedtext')
      ? '<transcript><text start="0" dur="1">abc</text></transcript>'
      : JSON.stringify({ title: 'Same title' }),
  };
  const first = await fetchVideo('same', baseOptions);
  const second = await fetchVideo('same', {
    ...baseOptions,
    fetchText: async (url) => url.includes('timedtext')
      ? '<transcript><text start="0" dur="1">xyz</text></transcript>'
      : JSON.stringify({ title: 'Same title' }),
  });

  assert.notEqual(first.contentHash, second.contentHash);
});
