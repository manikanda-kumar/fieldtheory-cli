import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { repairYoutubeSlideLinks } from '../src/youtube/slide-links.js';

async function withTempRoots<T>(fn: (roots: { dataDir: string; libraryDir: string }) => Promise<T>): Promise<T> {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'ft-slide-links-'));
  const previous = { FT_DATA_DIR: process.env.FT_DATA_DIR, FT_LIBRARY_DIR: process.env.FT_LIBRARY_DIR };
  process.env.FT_DATA_DIR = path.join(tmp, 'data');
  process.env.FT_LIBRARY_DIR = path.join(tmp, 'library');
  try {
    return await fn({ dataDir: process.env.FT_DATA_DIR, libraryDir: process.env.FT_LIBRARY_DIR });
  } finally {
    if (previous.FT_DATA_DIR === undefined) delete process.env.FT_DATA_DIR;
    else process.env.FT_DATA_DIR = previous.FT_DATA_DIR;
    if (previous.FT_LIBRARY_DIR === undefined) delete process.env.FT_LIBRARY_DIR;
    else process.env.FT_LIBRARY_DIR = previous.FT_LIBRARY_DIR;
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

const LEGACY_NOTE = `---
source: youtube
videoId: v1
notesSource: transcript
---

# A Talk

Summary prose with a [source link](https://example.com/a) and \`inline code\`.

## Chapters

- [00:10](https://youtu.be/v1?t=10) **Intro** — Summary text.
  [![Slide at 00:10](/home/u/.fieldtheory/bookmarks/youtube/artifacts/v1/youtube-v1/slide_0001_10.00s.png)](https://youtu.be/v1?t=10)
  [![Slide at 00:20](/Users/manik/.fieldtheory/bookmarks/youtube/artifacts/v1/youtube-v1/slide_0002_20.00s.png)](https://youtu.be/v1?t=20)
  [![Slide at 00:30](/Users/manik/.ft-bookmarks/youtube/artifacts/v1/youtube-v1/slide_0003_30.00s.png)](https://youtu.be/v1?t=30)
  [![Remote slide](//cdn.example.com/youtube/artifacts/v1/youtube-v1/slide_0001_10.00s.png)](https://youtu.be/v1?t=10)

## Audio overview

- /home/u/.fieldtheory/bookmarks/youtube/artifacts/v1/v1.overview.mp3
`;

test('repairYoutubeSlideLinks rewrites resolvable artifact links and reports missing ones', async () => {
  await withTempRoots(async ({ dataDir, libraryDir }) => {
    const slideDir = path.join(dataDir, 'youtube', 'artifacts', 'v1', 'youtube-v1');
    await fs.mkdir(slideDir, { recursive: true });
    await fs.writeFile(path.join(slideDir, 'slide_0001_10.00s.png'), 'png');
    await fs.writeFile(path.join(slideDir, 'slide_0003_30.00s.png'), 'png');
    const notePath = path.join(libraryDir, 'youtube', '2026-10', 'v1.md');
    await fs.mkdir(path.dirname(notePath), { recursive: true });
    await fs.writeFile(notePath, LEGACY_NOTE, 'utf8');

    const dryRun = await repairYoutubeSlideLinks({ notePaths: [notePath], limit: 10, write: false });
    assert.equal(dryRun.notesScanned, 1);
    assert.equal(dryRun.notesChanged, 1);
    assert.equal(dryRun.linksRewritten, 2);
    assert.equal(dryRun.notesWritten, 0);
    assert.equal(dryRun.unresolvedLinks, 1);
    assert.match(dryRun.unresolvedSamples[0], /slide_0002_20\.00s\.png/);
    assert.equal(await fs.readFile(notePath, 'utf8'), LEGACY_NOTE);

    const written = await repairYoutubeSlideLinks({ notePaths: [notePath], limit: 10, write: true });
    assert.equal(written.notesWritten, 1);
    assert.equal(written.linksRewritten, 2);
    const repaired = await fs.readFile(notePath, 'utf8');

    // Both the orb and macOS home prefixes map to the local artifact root.
    const expected = (name: string) => `../../../data/youtube/artifacts/v1/youtube-v1/${name}`;
    assert.ok(repaired.includes(expected('slide_0001_10.00s.png')));
    assert.ok(repaired.includes(expected('slide_0003_30.00s.png')));
    // The missing capture stays absolute instead of becoming a dangling relative link.
    assert.ok(repaired.includes('/Users/manik/.fieldtheory/bookmarks/youtube/artifacts/v1/youtube-v1/slide_0002_20.00s.png'));
    // Prose, frontmatter and non-image artifact paths are untouched.
    assert.ok(repaired.includes('# A Talk'));
    assert.ok(repaired.includes('[source link](https://example.com/a)'));
    assert.ok(repaired.includes('- /home/u/.fieldtheory/bookmarks/youtube/artifacts/v1/v1.overview.mp3'));
    // A remote URL must survive even when its suffix matches a local capture.
    assert.ok(repaired.includes('![Remote slide](//cdn.example.com/youtube/artifacts/v1/youtube-v1/slide_0001_10.00s.png)'));

    // Every rewritten link resolves from where the note lives.
    for (const name of ['slide_0001_10.00s.png', 'slide_0003_30.00s.png']) {
      const resolved = path.resolve(path.dirname(notePath), expected(name));
      assert.equal(await fs.readFile(resolved, 'utf8'), 'png');
    }

    const again = await repairYoutubeSlideLinks({ notePaths: [notePath], limit: 10, write: true });
    assert.equal(again.notesChanged, 0);
    assert.equal(again.linksRewritten, 0);
    assert.equal(await fs.readFile(notePath, 'utf8'), repaired);
  });
});

test('repairYoutubeSlideLinks is bounded by --limit and resumes on the next run', async () => {
  await withTempRoots(async ({ dataDir, libraryDir }) => {
    const noteDir = path.join(libraryDir, 'youtube', '2026-10');
    await fs.mkdir(noteDir, { recursive: true });
    for (const videoId of ['a', 'b']) {
      const slideDir = path.join(dataDir, 'youtube', 'artifacts', videoId, `youtube-${videoId}`);
      await fs.mkdir(slideDir, { recursive: true });
      await fs.writeFile(path.join(slideDir, 'slide.png'), 'png');
      await fs.writeFile(path.join(noteDir, `${videoId}.md`),
        `# ${videoId}\n\n  [![Slide at 00:01](/home/u/.fieldtheory/bookmarks/youtube/artifacts/${videoId}/youtube-${videoId}/slide.png)](https://youtu.be/${videoId}?t=1)\n`, 'utf8');
    }

    const first = await repairYoutubeSlideLinks({ limit: 1, write: true });
    assert.equal(first.notesScanned, 2);
    assert.equal(first.notesWritten, 1);
    assert.equal(first.linksWritten, 1);
    assert.equal(first.notesDeferred, 1);
    assert.doesNotMatch(await fs.readFile(path.join(noteDir, 'a.md'), 'utf8'), /\(\/home/);
    assert.match(await fs.readFile(path.join(noteDir, 'b.md'), 'utf8'), /\(\/home/);

    const second = await repairYoutubeSlideLinks({ limit: 1, write: true });
    assert.equal(second.notesWritten, 1);
    assert.equal(second.linksWritten, 1);
    assert.doesNotMatch(await fs.readFile(path.join(noteDir, 'b.md'), 'utf8'), /\(\/home/);
  });
});

test('repairYoutubeSlideLinks rejects artifact destinations that escape the artifacts root', async () => {
  await withTempRoots(async ({ dataDir, libraryDir }) => {
    // Exists, but outside <dataDir>/youtube/artifacts, so existence alone must
    // not make the destination eligible.
    const outside = path.join(dataDir, 'outside', 'secret.png');
    await fs.mkdir(path.dirname(outside), { recursive: true });
    await fs.writeFile(outside, 'png');
    const notePath = path.join(libraryDir, 'youtube', '2026-10', 'escape.md');
    await fs.mkdir(path.dirname(notePath), { recursive: true });
    const note = `# Escape\n\n  [![Slide at 00:01](/home/u/.fieldtheory/bookmarks/youtube/artifacts/../../outside/secret.png)](https://youtu.be/v1?t=1)\n`;
    await fs.writeFile(notePath, note, 'utf8');

    const dryRun = await repairYoutubeSlideLinks({ notePaths: [notePath], limit: 10, write: false });
    assert.equal(dryRun.notesChanged, 0);
    assert.equal(dryRun.linksRewritten, 0);
    assert.equal(dryRun.unresolvedLinks, 1);

    const written = await repairYoutubeSlideLinks({ notePaths: [notePath], limit: 10, write: true });
    assert.equal(written.notesWritten, 0);
    assert.equal(await fs.readFile(notePath, 'utf8'), note);
  });
});
