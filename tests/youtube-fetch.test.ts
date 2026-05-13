import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchVideo, NoTranscriptError, parseTimedTextTranscript, parseVttTranscript } from '../src/youtube/fetch.js';
import { SummarizeUnavailableError } from '../src/youtube/summarize-bridge.js';

test('parseVttTranscript parses cue timings and text', () => {
  assert.deepEqual(parseVttTranscript(`WEBVTT\n\n00:00:01.000 --> 00:00:03.500\nHello world\n\n00:00:04.000 --> 00:00:05.000\nNext`), [
    { tSec: 1, durationSec: 2.5, text: 'Hello world' },
    { tSec: 4, durationSec: 1, text: 'Next' },
  ]);
});

test('parseTimedTextTranscript parses YouTube timedtext XML', () => {
  assert.deepEqual(parseTimedTextTranscript('<transcript><text start="1.5" dur="2">Hello &amp; bye</text></transcript>'), [
    { tSec: 1.5, durationSec: 2, text: 'Hello & bye' },
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
