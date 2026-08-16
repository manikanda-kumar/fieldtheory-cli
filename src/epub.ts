/**
 * Minimal EPUB 3 writer.
 *
 * Kindle (Send to Kindle), Apple Books, and every other reader accept a plain
 * EPUB 3 container, so this stays dependency-free: a small ZIP writer over
 * `node:zlib` plus the four package files a reader actually needs
 * (`mimetype`, `META-INF/container.xml`, an OPF, and an EPUB 3 `nav`). A
 * legacy NCX ships alongside the nav so older Kindle firmware still gets a
 * table of contents.
 *
 * Output is byte-deterministic for a given input: the ZIP timestamp comes from
 * the publication date rather than the clock.
 */

import { deflateRawSync } from 'node:zlib';

import { crc32 } from './crc32.js';

export interface EpubChapter {
  /** Manifest id and file name stem; must be unique and URL-safe. */
  id: string;
  /** Chapter title used in the nav/NCX table of contents. */
  title: string;
  /** Body markup (XHTML fragment, already escaped). */
  body: string;
}

export interface EpubOptions {
  title: string;
  author?: string;
  /** BCP-47 language tag. Default: 'en'. */
  language?: string;
  /** Stable unique id (a URN or URL). */
  identifier: string;
  /** Publication date as YYYY-MM-DD; also seeds the deterministic ZIP timestamp. */
  date: string;
  /** Optional stylesheet; a readable default is used when omitted. */
  css?: string;
  /**
   * Chapter a reader should open on ("start reading here"). Defaults to the
   * first chapter. Surfaces as the `bodymatter` landmark and the legacy
   * `<guide>` reference Kindle still reads.
   */
  startChapterId?: string;
  /**
   * Cover image bytes. Without one the Kindle library shows a generic
   * placeholder tile, so consecutive issues are indistinguishable in the grid.
   */
  cover?: EpubCover;
  chapters: EpubChapter[];
}

export interface EpubCover {
  data: Buffer;
  /** `image/png` or `image/jpeg`; Kindle does not reliably render SVG covers. */
  mediaType: 'image/png' | 'image/jpeg';
}

/**
 * Kindle themes (sepia, night) repaint the page but not fixed colors, so this
 * sheet sets no `color` or `background` at all: emphasis comes from borders,
 * size, and weight, which survive every theme. Page margins are left to the
 * device — Kindle applies its own and a body margin stacks on top of them.
 */
const DEFAULT_CSS = `html { -webkit-hyphens: auto; hyphens: auto; }
body { font-family: Georgia, 'Times New Roman', serif; line-height: 1.5; margin: 0; }
h1 { font-size: 1.5em; line-height: 1.25; margin: 1em 0 0.5em; }
h2 { font-size: 1.2em; margin: 1.4em 0 0.4em; }
h3 { font-size: 1.05em; margin: 1.2em 0 0.3em; }
p { margin: 0 0 0.7em; text-align: left; }
ul, ol { margin: 0 0 0.8em 1.1em; padding: 0; }
li { margin: 0 0 0.45em; }
a { color: inherit; text-decoration: underline; }
blockquote { margin: 0.8em 0; padding: 0 0 0 0.9em; border-left: 3px solid #808080; font-style: italic; }
code { font-family: 'Courier New', monospace; font-size: 0.9em; }
hr { border: 0; border-top: 1px solid #808080; margin: 1.2em 0; }
.meta { font-size: 0.85em; font-style: italic; margin: 0 0 0.8em; }
.summary { margin: 0 0 0.9em; }
.reveal { margin: 0.6em 0 1.2em; padding: 0.4em 0.8em; border-left: 3px solid #808080; }
.reveal-label { font-size: 0.8em; text-transform: uppercase; letter-spacing: 0.05em; margin: 0 0 0.3em; }
`;

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function buildEpub(options: EpubOptions): Buffer {
  if (options.chapters.length === 0) throw new Error('EPUB needs at least one chapter');
  const language = options.language ?? 'en';
  const modified = `${options.date}T00:00:00Z`;
  const files: ZipEntry[] = [];

  // The mimetype entry must be first and stored uncompressed.
  files.push({ name: 'mimetype', data: Buffer.from('application/epub+zip', 'utf8'), store: true });
  files.push({ name: 'META-INF/container.xml', data: utf8(containerXml()) });
  files.push({ name: 'OEBPS/style.css', data: utf8(options.css ?? DEFAULT_CSS) });
  if (options.cover) {
    // Already-compressed image formats gain nothing from deflate.
    files.push({ name: `OEBPS/${coverFileName(options.cover)}`, data: options.cover.data, store: true });
  }

  for (const chapter of options.chapters) {
    files.push({ name: `OEBPS/${chapter.id}.xhtml`, data: utf8(chapterXhtml(chapter, language)) });
  }
  files.push({ name: 'OEBPS/nav.xhtml', data: utf8(navXhtml(options, language)) });
  files.push({ name: 'OEBPS/toc.ncx', data: utf8(tocNcx(options)) });
  files.push({ name: 'OEBPS/content.opf', data: utf8(contentOpf(options, language, modified)) });

  return writeZip(files, zipTimestamp(options.date));
}

function utf8(value: string): Buffer {
  return Buffer.from(value, 'utf8');
}

function containerXml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;
}

function chapterXhtml(chapter: EpubChapter, language: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${xmlEscape(language)}" lang="${xmlEscape(language)}">
<head>
  <title>${xmlEscape(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
${chapter.body}
</body>
</html>
`;
}

function navXhtml(options: EpubOptions, language: string): string {
  const items = options.chapters
    .map((chapter) => `      <li><a href="${chapter.id}.xhtml">${xmlEscape(chapter.title)}</a></li>`)
    .join('\n');
  const start = startChapter(options);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${xmlEscape(language)}" lang="${xmlEscape(language)}">
<head>
  <title>Contents</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${items}
    </ol>
  </nav>
  <nav epub:type="landmarks" id="landmarks" hidden="hidden">
    <h1>Landmarks</h1>
    <ol>
      <li><a epub:type="toc" href="nav.xhtml#toc">Contents</a></li>
      <li><a epub:type="bodymatter" href="${start.id}.xhtml">${xmlEscape(start.title)}</a></li>
    </ol>
  </nav>
</body>
</html>
`;
}

function coverFileName(cover: EpubCover): string {
  return cover.mediaType === 'image/jpeg' ? 'cover.jpg' : 'cover.png';
}

/** Where "start reading" points; falls back to the first chapter. */
function startChapter(options: EpubOptions): EpubChapter {
  return options.chapters.find((chapter) => chapter.id === options.startChapterId) ?? options.chapters[0]!;
}

function tocNcx(options: EpubOptions): string {
  const points = options.chapters
    .map((chapter, index) => `    <navPoint id="nav-${chapter.id}" playOrder="${index + 1}">
      <navLabel><text>${xmlEscape(chapter.title)}</text></navLabel>
      <content src="${chapter.id}.xhtml"/>
    </navPoint>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${xmlEscape(options.identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${xmlEscape(options.title)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>
`;
}

function contentOpf(options: EpubOptions, language: string, modified: string): string {
  const manifest = options.chapters
    .map((chapter) => `    <item id="${chapter.id}" href="${chapter.id}.xhtml" media-type="application/xhtml+xml"/>`)
    .join('\n');
  const spine = options.chapters
    .map((chapter) => `    <itemref idref="${chapter.id}"/>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">${xmlEscape(options.identifier)}</dc:identifier>
    <dc:title>${xmlEscape(options.title)}</dc:title>
    <dc:language>${xmlEscape(language)}</dc:language>
    <dc:date>${xmlEscape(options.date)}</dc:date>
${options.author ? `    <dc:creator>${xmlEscape(options.author)}</dc:creator>\n` : ''}    <meta property="dcterms:modified">${xmlEscape(modified)}</meta>
${options.cover ? '    <meta name="cover" content="cover-image"/>\n' : ''}  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="css" href="style.css" media-type="text/css"/>
${options.cover ? `    <item id="cover-image" href="${coverFileName(options.cover)}" media-type="${options.cover.mediaType}" properties="cover-image"/>\n` : ''}${manifest}
  </manifest>
  <spine toc="ncx">
${spine}
  </spine>
  <guide>
    <reference type="toc" title="Contents" href="nav.xhtml"/>
    <reference type="text" title="${xmlEscape(startChapter(options).title)}" href="${startChapter(options).id}.xhtml"/>
  </guide>
</package>
`;
}

// ── ZIP ────────────────────────────────────────────────────────────────────

interface ZipEntry {
  name: string;
  data: Buffer;
  /** Store uncompressed (required for the `mimetype` entry). */
  store?: boolean;
}

/** DOS date/time pair, derived from the digest date so output stays stable. */
function zipTimestamp(date: string): { time: number; date: number } {
  const parsed = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const year = parsed ? Number(parsed[1]) : 1980;
  const month = parsed ? Number(parsed[2]) : 1;
  const day = parsed ? Number(parsed[3]) : 1;
  return {
    time: 0,
    date: ((Math.max(1980, year) - 1980) << 9) | (month << 5) | day,
  };
}

function writeZip(entries: ZipEntry[], stamp: { time: number; date: number }): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const compressed = entry.store ? entry.data : deflateRawSync(entry.data, { level: 9 });
    const method = entry.store ? 0 : 8;
    const crc = crc32(entry.data);

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    name.copy(local, 30);
    locals.push(local, compressed);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);
    centrals.push(central);

    offset += local.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralDirectory, end]);
}
