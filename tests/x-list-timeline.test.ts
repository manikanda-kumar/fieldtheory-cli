import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyListTimelineEntry, dropQuotedOriginals, isWithinSinceHours, mergeTimelineKind, shouldStopAfterPage } from '../src/x-list-timeline.js';

test('classifyListTimelineEntry marks direct tweet entries as list tweets', () => {
  assert.equal(classifyListTimelineEntry('tweet-123'), 'list-tweet');
});

test('classifyListTimelineEntry marks list conversation modules as conversation context', () => {
  assert.equal(classifyListTimelineEntry('list-conversation-123'), 'conversation-context');
});

test('classifyListTimelineEntry falls back to unknown for unrecognized tweet-bearing entries', () => {
  assert.equal(classifyListTimelineEntry('list-recap-123'), 'unknown');
});

test('mergeTimelineKind keeps direct list tweet classification when duplicate context appears later', () => {
  assert.equal(mergeTimelineKind('list-tweet', 'conversation-context'), 'list-tweet');
});

test('mergeTimelineKind upgrades unknown with conversation context', () => {
  assert.equal(mergeTimelineKind('unknown', 'conversation-context'), 'conversation-context');
});

test('isWithinSinceHours keeps tweets inside the requested recent window', () => {
  const nowMs = Date.parse('2026-06-04T12:00:00.000Z');

  assert.equal(isWithinSinceHours('Thu Jun 04 01:00:00 +0000 2026', 12, nowMs), true);
  assert.equal(isWithinSinceHours('Wed Jun 03 23:59:59 +0000 2026', 12, nowMs), false);
});

test('isWithinSinceHours keeps tweets without a valid timestamp so prototypes do not silently drop malformed data', () => {
  const nowMs = Date.parse('2026-06-04T12:00:00.000Z');

  assert.equal(isWithinSinceHours(null, 12, nowMs), true);
  assert.equal(isWithinSinceHours('not a date', 12, nowMs), true);
});

test('shouldStopAfterPage stops once direct list tweets are older than the requested window', () => {
  const nowMs = Date.parse('2026-06-04T12:00:00.000Z');

  assert.equal(shouldStopAfterPage([
    { timelineKind: 'list-tweet', postedAt: 'Wed Jun 03 23:00:00 +0000 2026' },
    { timelineKind: 'conversation-context', postedAt: 'Thu Jun 04 11:00:00 +0000 2026' },
  ], 12, nowMs), true);
});

test('shouldStopAfterPage continues when a page still has recent direct list tweets', () => {
  const nowMs = Date.parse('2026-06-04T12:00:00.000Z');

  assert.equal(shouldStopAfterPage([
    { timelineKind: 'list-tweet', postedAt: 'Thu Jun 04 01:00:00 +0000 2026' },
  ], 12, nowMs), false);
});

test('dropQuotedOriginals removes originals that are already preserved inside quote tweets', () => {
  const deduped = dropQuotedOriginals([
    { id: 'quote', quotedTweetId: 'original' },
    { id: 'original' },
    { id: 'unrelated' },
  ]);

  assert.deepEqual(deduped.map((item) => item.id), ['quote', 'unrelated']);
});

test('dropQuotedOriginals keeps originals when the quote tweet is not present', () => {
  const deduped = dropQuotedOriginals([
    { id: 'original' },
    { id: 'unrelated' },
  ]);

  assert.deepEqual(deduped.map((item) => item.id), ['original', 'unrelated']);
});
