import type { HeroStateLedger } from './qa-linter.ts';
import type { CsiCulturalNote } from './delta-diting.ts';

// ============================================================================
// MODULE 5: Pure TypeScript EPUB 3 Book Compiler, Unpacker, Sanitizer & ZIP
// (Zero External Dependencies)
// ============================================================================

export interface Epub3ChapterInput {
  number: number;
  titleRus: string;
  titleEng?: string;
  contentRus: string;
  summary?: string;
  summaryRus?: string;
  csiNotes?: CsiCulturalNote[];
}

export interface Epub3BuildOptions {
  bookId?: string;
  titleRus?: string;
  titleEng?: string;
  novelTitle?: string;
  author: string;
  translator?: string;
  genreTitle?: string;
  genreLabel?: string;
  heroLedger?: HeroStateLedger;
  synopsisRus?: string;
  includeCsiFootnotes?: boolean;
  chapters: Epub3ChapterInput[];
}

export interface Epub3ArchivePackage {
  filename: string;
  bytes: Uint8Array;
  byteSize: number;
  chapterCount: number;
  totalWords: number;
  tocPreview: Array<{ number: number; titleRus: string; words: number; csiCount: number }>;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function applyBookMicroTypography(line: string): string {
  return line
    .replace(/^—\s+/, '—\u00A0')
    .replace(/(\d+)\s+(ли|цзинь|чжан|лян|му)(?![а-яёa-z])/gi, '$1\u00A0$2');
}

function renderChapterBodyToXhtml(
  rusText: string,
  csiNotes: CsiCulturalNote[] = [],
  includeCsiFootnotes = true
): string {
  const lines = rusText.replace(/\r\n/g, '\n').split('\n');
  const htmlBlocks: string[] = [];
  let inSystemBox = false;
  let systemLines: string[] = [];
  let standaloneBracketLines: string[] = [];

  const flushStandaloneBrackets = () => {
    if (standaloneBracketLines.length === 0) return;
    if (standaloneBracketLines.length === 1) {
      htmlBlocks.push(
        `<div class="system-box"><p class="system-line">${escapeXml(standaloneBracketLines[0])}</p></div>`
      );
    } else {
      htmlBlocks.push(
        `<div class="system-box">\n${standaloneBracketLines
          .map((sl) => `  <p class="system-line">${escapeXml(sl)}</p>`)
          .join('\n')}\n</div>`
      );
    }
    standaloneBracketLines = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    if (trimmed === '---') {
      flushStandaloneBrackets();
      if (inSystemBox) {
        if (systemLines.length > 0) {
          htmlBlocks.push(
            `<div class="system-box">\n${systemLines
              .map((sl) => `  <p class="system-line">${escapeXml(sl)}</p>`)
              .join('\n')}\n</div>`
          );
          systemLines = [];
        }
        inSystemBox = false;
      } else {
        inSystemBox = true;
      }
      continue;
    }

    if (inSystemBox) {
      systemLines.push(trimmed);
    } else if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      standaloneBracketLines.push(trimmed);
    } else {
      flushStandaloneBrackets();
      htmlBlocks.push(`<p>${escapeXml(applyBookMicroTypography(trimmed))}</p>`);
    }
  }

  flushStandaloneBrackets();
  if (systemLines.length > 0) {
    htmlBlocks.push(
      `<div class="system-box">\n${systemLines
        .map((sl) => `  <p class="system-line">${escapeXml(sl)}</p>`)
        .join('\n')}\n</div>`
    );
  }

  if (includeCsiFootnotes && csiNotes.length > 0) {
    const noteItems = csiNotes
      .map(
        (n) =>
          `<div class="csi-item"><p><strong>${escapeXml(n.sourcePhrase)}</strong> → <em>${escapeXml(n.adaptedRus)}</em> (${escapeXml(n.categoryLabel)})</p><p class="csi-rationale">${escapeXml(n.rationale)}</p></div>`
      )
      .join('\n');
    htmlBlocks.push(
      `<aside class="csi-notes"><h3>Примечания переводчика и локализатора (CSI)</h3>\n${noteItems}\n</aside>`
    );
  }

  return htmlBlocks.join('\n');
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Packs an array of `{ path, content }` into an uncompressed ZIP archive (`Uint8Array`)
 * compliant with EPUB 3 Open Container Format (OCF), where `mimetype` is the first entry at offset 0.
 */
export function createStoredZipArchive(
  files: Array<{ path: string; data: Uint8Array }>
): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.path);
    const dataBytes = file.data;
    const crc = crc32(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // signature
    lv.setUint16(4, 20, true); // version needed (2.0)
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // compression method: 0 (STORE)
    lv.setUint16(10, 0, true); // mod time
    lv.setUint16(12, 0x5421, true); // mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // extra length 0 (critical for EPUB `mimetype`)
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    // Central directory header (46 bytes + filename)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0x5421, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + dataBytes.length;
  }

  const centralSize = centralParts.reduce((acc, p) => acc + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const totalSize = offset + centralSize + eocd.length;
  const out = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of localParts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  out.set(eocd, cursor);
  return out;
}

/**
 * Compiles translated chapters into a complete, standards-compliant EPUB 3 archive (`.epub`).
 */
export function buildEpub3Archive(options: Epub3BuildOptions): Epub3ArchivePackage {
  const encoder = new TextEncoder();
  const sorted = [...options.chapters].sort((a, b) => a.number - b.number);
  const includeCsi = options.includeCsiFootnotes ?? true;
  const titleRus = options.titleRus || options.novelTitle || 'Веб-новелла';
  const titleEng = options.titleEng || options.novelTitle || 'Web Novel';
  const bookId = options.bookId || `kanon-epub-${Date.now()}`;
  const genreTitle = options.genreTitle || options.genreLabel || 'Сянься / ЛитРПГ';

  const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;

  const stylesCss = `body {
  font-family: Georgia, "Times New Roman", serif;
  line-height: 1.7;
  margin: 5%;
  color: #111827;
}
h1, h2, h3 {
  font-family: "Helvetica Neue", Arial, sans-serif;
  line-height: 1.3;
  margin-top: 1.5em;
  margin-bottom: 0.6em;
}
p {
  margin: 0 0 0.9em 0;
  text-indent: 1.2em;
  text-align: justify;
}
.system-box {
  margin: 1.25em 0;
  padding: 0.9em 1.2em;
  border: 1px solid #d97706;
  background-color: #fffbeb;
  border-radius: 6px;
  font-family: "Courier New", monospace;
}
.system-line {
  text-indent: 0;
  margin: 0.25em 0;
  font-size: 0.92em;
  color: #92400e;
}
.csi-notes {
  margin-top: 2em;
  padding-top: 1em;
  border-top: 1px solid #e5e7eb;
  font-size: 0.88em;
}
.csi-item {
  margin-bottom: 0.75em;
}
.csi-rationale {
  text-indent: 0;
  color: #4b5563;
}`;

  const heroPassportHtml = options.heroLedger
    ? `<div class="system-box">
      <p class="system-line"><strong>[Паспорт состояния героя — Гл. ${options.heroLedger.lastUpdatedChapter}]</strong></p>
      <p class="system-line">Протагонист: ${escapeXml(options.heroLedger.protagonistName)}</p>
      <p class="system-line">Ступень культивации: ${escapeXml(options.heroLedger.cultivationRealm)}</p>
      <p class="system-line">Ресурсы: ${escapeXml(options.heroLedger.resources.join(' · '))}</p>
      <p class="system-line">Локация: ${escapeXml(options.heroLedger.activeLocation)}</p>
    </div>`
    : '';

  const titlePageXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru" lang="ru">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(titleRus)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section>
    <h1>${escapeXml(titleRus)}</h1>
    <p style="text-indent:0;"><strong>Оригинальное название:</strong> ${escapeXml(titleEng)}</p>
    <p style="text-indent:0;"><strong>Автор:</strong> ${escapeXml(options.author)}</p>
    ${options.translator ? `<p style="text-indent:0;"><strong>Перевод:</strong> ${escapeXml(options.translator)}</p>` : ''}
    <p style="text-indent:0;"><strong>Жанровый канон:</strong> ${escapeXml(genreTitle)}</p>
    ${heroPassportHtml}
    ${
      options.synopsisRus
        ? `<div class="system-box"><p class="system-line">${escapeXml(options.synopsisRus)}</p></div>`
        : ''
    }
  </section>
</body>
</html>`;

  const chapterFiles: Array<{
    id: string;
    href: string;
    number: number;
    titleRus: string;
    words: number;
    csiCount: number;
    xhtml: string;
  }> = [];

  let totalWords = 0;

  sorted.forEach((ch, idx) => {
    const fileId = `chap-${idx + 1}`;
    const href = `chapter-${idx + 1}.xhtml`;
    const heading = ch.titleRus.trim() || `Глава ${ch.number}`;
    const words = ch.contentRus.trim() ? ch.contentRus.trim().split(/\s+/).length : 0;
    totalWords += words;
    const csiList = ch.csiNotes || [];

    const bodyHtml = renderChapterBodyToXhtml(ch.contentRus, csiList, includeCsi);
    const xhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="ru" lang="ru">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(heading)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <section>
    <h2>${escapeXml(heading)}</h2>
    ${bodyHtml}
  </section>
</body>
</html>`;

    chapterFiles.push({
      id: fileId,
      href,
      number: ch.number,
      titleRus: heading,
      words,
      csiCount: csiList.length,
      xhtml,
    });
  });

  const navItems = [
    `<li><a href="titlepage.xhtml">Титульный лист</a></li>`,
    ...chapterFiles.map(
      (cf) => `<li><a href="${cf.href}">${escapeXml(cf.titleRus)}</a></li>`
    ),
  ].join('\n        ');

  const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="ru" lang="ru">
<head>
  <meta charset="UTF-8"/>
  <title>Оглавление — ${escapeXml(titleRus)}</title>
  <link rel="stylesheet" type="text/css" href="styles.css"/>
</head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Оглавление</h1>
    <ol>
        ${navItems}
    </ol>
  </nav>
</body>
</html>`;

  const manifestItems = [
    `<item id="css" href="styles.css" media-type="text/css"/>`,
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    `<item id="titlepage" href="titlepage.xhtml" media-type="application/xhtml+xml"/>`,
    ...chapterFiles.map(
      (cf) =>
        `<item id="${cf.id}" href="${cf.href}" media-type="application/xhtml+xml"/>`
    ),
  ].join('\n    ');

  const spineItems = [
    `<itemref idref="titlepage"/>`,
    ...chapterFiles.map((cf) => `<itemref idref="${cf.id}"/>`),
  ].join('\n    ');

  const modifiedIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="ru">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(titleRus)}</dc:title>
    <dc:creator>${escapeXml(options.author)}</dc:creator>
    <dc:language>ru</dc:language>
    <meta property="dcterms:modified">${modifiedIso}</meta>
  </metadata>
  <manifest>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`;

  const archiveEntries: Array<{ path: string; data: Uint8Array }> = [
    { path: 'mimetype', data: encoder.encode('application/epub+zip') },
    { path: 'META-INF/container.xml', data: encoder.encode(containerXml) },
    { path: 'OEBPS/styles.css', data: encoder.encode(stylesCss) },
    { path: 'OEBPS/nav.xhtml', data: encoder.encode(navXhtml) },
    { path: 'OEBPS/titlepage.xhtml', data: encoder.encode(titlePageXhtml) },
    ...chapterFiles.map((cf) => ({
      path: `OEBPS/${cf.href}`,
      data: encoder.encode(cf.xhtml),
    })),
    { path: 'OEBPS/content.opf', data: encoder.encode(contentOpf) },
  ];

  const bytes = createStoredZipArchive(archiveEntries);
  const firstNum = sorted[0]?.number ?? 1;
  const lastNum = sorted[sorted.length - 1]?.number ?? 1;
  const slug = titleEng
    .replace(/[^a-zA-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');

  return {
    filename: `${slug || 'Novel'}_Ch_${firstNum}_${lastNum}_EPUB3.epub`,
    bytes,
    byteSize: bytes.byteLength,
    chapterCount: sorted.length,
    totalWords,
    tocPreview: chapterFiles.map((cf) => ({
      number: cf.number,
      titleRus: cf.titleRus,
      words: cf.words,
      csiCount: cf.csiCount,
    })),
  };
}

export interface SanitizeChapterResult {
  cleanedText: string;
  removedLinesCount: number;
  removedSamples: string[];
}

/**
 * Raw Chapter Sanitizer (Q6: C + `dyad-apps/Perevod/sanitizer_patterns.txt` + `mt_check/extract.py`):
 * 1. Converts HTML block tags (`<p>`, `<br>`, `<div>`) into paragraph breaks and strips inline HTML tags.
 * 2. Unescapes HTML entities (`&nbsp;`, `&quot;`, `&mdash;`, `&#39;`, `&amp;`).
 * 3. Removes `TL Note:`, `Editor's Note:`, Patreon/Discord/Ko-fi promos, and scraper watermarks (`Rulate.ru`, `Webnovel`, etc.).
 * 4. Preserves ЛитРПГ `[System: ...]` brackets and `---` scene dividers.
 */
export function sanitizeRawChapterText(rawText: string): SanitizeChapterResult {
  if (!rawText || typeof rawText !== 'string') {
    return { cleanedText: '', removedLinesCount: 0, removedSamples: [] };
  }

  // Step 1: Unpack HTML block tags if the input came from HTML/EPUB/Web scraper
  let text = rawText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/<(?:br|hr)\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|blockquote)>/gi, '\n\n')
    .replace(/<(?:p|div|section|article|h[1-6]|li|blockquote)(?:\s[^>]*)?>/gi, '')
    .replace(/<\/?(?:span|b|strong|i|em|u|a|font|small|sup|sub)(?:\s[^>]*)?>/gi, '');

  // Step 2: Decode common HTML entities
  text = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00A0/g, ' ')
    .replace(/&mdash;/gi, '—')
    .replace(/&ndash;/gi, '–')
    .replace(/&hellip;/gi, '...')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&laquo;/gi, '«')
    .replace(/&raquo;/gi, '»')
    .replace(/&amp;/gi, '&');

  // Step 3: Line-by-line watermark, translator note, and promo filter
  const junkLinePatterns: RegExp[] = [
    /^\s*(?:\[|\(|【)?\s*(?:TL\s*Note|T\/N|TN|Translator'?s?\s*Note|Editor'?s?\s*Note|ED\s*Note|A\/N|Author'?s?\s*Note|Примечание\s+(?:переводчика|редактора|автора)|П\.?\s*П\.?)\s*[:：\-]/i,
    /^\s*(?:Translated|Edited|Proofread)\s+by\s*[:：]/i,
    /(?:patreon\.com|ko-fi\.com|discord\.gg|paypal\.me|boosty\.to)/i,
    /(?:прочитано\s+на\s+rulate\.ru|перевод\s+выполнен\s+с\s+сайта|read\s+latest\s+chapters?\s+at|visit\s+wuxiaworld|webnovel\.com|royalroad\.com)/i,
    /^\s*(?:please\s+support\s+the\s+(?:author|translator)|don't\s+forget\s+to\s+vote\s+power\s+stones)/i,
    /^\s*[=*~_]{4,}\s*$/,
  ];

  const lines = text.split('\n');
  const keptLines: string[] = [];
  const removedSamples: string[] = [];
  let removedLinesCount = 0;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      keptLines.push('');
      continue;
    }

    // Always keep canonical scene divider `---`
    if (trimmed === '---') {
      keptLines.push('---');
      continue;
    }

    const isJunk = junkLinePatterns.some((re) => re.test(trimmed));
    if (isJunk) {
      removedLinesCount++;
      if (removedSamples.length < 10) {
        removedSamples.push(trimmed.slice(0, 120));
      }
      continue;
    }

    keptLines.push(trimmed);
  }

  const cleanedText = keptLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return {
    cleanedText,
    removedLinesCount,
    removedSamples,
  };
}

export interface ImportedEpubChapter {
  number: number;
  titleEng: string;
  engText: string;
  wordCountEng: number;
  href: string;
}

export interface EpubImportResult {
  bookTitle: string;
  author: string;
  chapters: ImportedEpubChapter[];
  totalRemovedJunkLines: number;
}

/**
 * Low-level ZIP Central Directory reader.
 * Extracts raw entries (`{ path, compressionMethod, compressedData }`) from a `.epub` or `.zip` buffer.
 */
function readZipEntriesRaw(zipBytes: Uint8Array): Array<{
  path: string;
  compressionMethod: number;
  compressedData: Uint8Array;
  uncompressedSize: number;
}> {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder('utf-8');

  // Locate End of Central Directory (EOCD) signature 0x06054b50 scanning backwards
  let eocdOffset = -1;
  const minEocdSearch = Math.max(0, zipBytes.byteLength - 65557);
  for (let i = zipBytes.byteLength - 22; i >= minEocdSearch; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error('Не найден заголовок EOCD ZIP-архива (файл повреждён или не является .epub/.zip)');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries: Array<{
    path: string;
    compressionMethod: number;
    compressedData: Uint8Array;
    uncompressedSize: number;
  }> = [];

  let ptr = cdOffset;
  for (let idx = 0; idx < totalEntries && ptr + 46 <= zipBytes.byteLength; idx++) {
    const sig = view.getUint32(ptr, true);
    if (sig !== 0x02014b50) break;

    const compressionMethod = view.getUint16(ptr + 10, true);
    const compressedSize = view.getUint32(ptr + 20, true);
    const uncompressedSize = view.getUint32(ptr + 24, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);

    const path = decoder.decode(zipBytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (localHeaderOffset + 30 > zipBytes.byteLength) continue;
    const localSig = view.getUint32(localHeaderOffset, true);
    if (localSig !== 0x04034b50) continue;

    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const dataEnd = Math.min(zipBytes.byteLength, dataStart + compressedSize);

    entries.push({
      path,
      compressionMethod,
      compressedData: zipBytes.subarray(dataStart, dataEnd),
      uncompressedSize,
    });
  }

  return entries;
}

/**
 * Inflates raw DEFLATE bytes in Browser (`DecompressionStream('deflate-raw')`) or Node.js.
 */
async function inflateRawBytesAsync(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(new Uint8Array(compressed));
    writer.close();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    let totalLen = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        totalLen += value.byteLength;
      }
    }
    const out = new Uint8Array(totalLen);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  }
  throw new Error('DecompressionStream deflate-raw is not available in this environment');
}

function parseEpubDecodedFileMap(fileMap: Map<string, string>): EpubImportResult {
  // 1. Find OPF path via META-INF/container.xml or fallback scan
  let opfPath = '';
  const containerXml = fileMap.get('META-INF/container.xml') || '';
  const rootfileMatch = containerXml.match(/full-path=["']([^"']+\.opf)["']/i);
  if (rootfileMatch && rootfileMatch[1]) {
    opfPath = rootfileMatch[1];
  } else {
    for (const key of fileMap.keys()) {
      if (key.toLowerCase().endsWith('.opf')) {
        opfPath = key;
        break;
      }
    }
  }

  const opfContent = opfPath ? fileMap.get(opfPath) || '' : '';
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const titleMatch = opfContent.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
  const creatorMatch = opfContent.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i);
  const bookTitle = titleMatch ? sanitizeRawChapterText(titleMatch[1]).cleanedText : 'Импортированная новелла';
  const author = creatorMatch ? sanitizeRawChapterText(creatorMatch[1]).cleanedText : 'Unknown Author';

  // 2. Map manifest id -> href
  const manifestMap = new Map<string, string>();
  const itemRegex = /<item\b([^>]+)\/?>/gi;
  let itemMatch: RegExpExecArray | null;
  while ((itemMatch = itemRegex.exec(opfContent)) !== null) {
    const attrs = itemMatch[1];
    const idM = attrs.match(/\bid=["']([^"']+)["']/i);
    const hrefM = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (idM && hrefM) {
      manifestMap.set(idM[1], hrefM[1]);
    }
  }

  // 3. Collect ordered spine hrefs
  const orderedHrefs: string[] = [];
  const itemrefRegex = /<itemref\b[^>]*\bidref=["']([^"']+)["'][^>]*\/?>/gi;
  let refMatch: RegExpExecArray | null;
  while ((refMatch = itemrefRegex.exec(opfContent)) !== null) {
    const href = manifestMap.get(refMatch[1]);
    if (href) {
      orderedHrefs.push(href);
    }
  }

  // Fallback if spine is empty: take all .xhtml / .html files sorted naturally
  if (orderedHrefs.length === 0) {
    for (const key of Array.from(fileMap.keys()).sort()) {
      if (/\.(?:xhtml|html|htm)$/i.test(key)) {
        orderedHrefs.push(key);
      }
    }
  }

  const chapters: ImportedEpubChapter[] = [];
  let totalRemovedJunkLines = 0;

  for (const rawHref of orderedHrefs) {
    const cleanHref = rawHref.split('#')[0];
    // Skip navigation / cover / titlepage files
    if (/(?:^|\/)(?:nav|toc|titlepage|cover)\.(?:xhtml|html|htm)$/i.test(cleanHref)) {
      continue;
    }

    const fullPath = fileMap.has(opfDir + cleanHref) ? opfDir + cleanHref : cleanHref;
    const rawHtml = fileMap.get(fullPath);
    if (!rawHtml) continue;

    // Extract heading from <h1>, <h2>, or <title>
    const hMatch =
      rawHtml.match(/<h[12][^>]*>([\s\S]*?)<\/h[12]>/i) ||
      rawHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const extractedTitle = hMatch
      ? sanitizeRawChapterText(hMatch[1]).cleanedText.replace(/\n+/g, ' ').trim()
      : '';

    // Strip <head>...</head>, <style>...</style>, <nav>...</nav>, and first <h1>/<h2> if already extracted as title
    let bodyHtml = rawHtml
      .replace(/<head[\s\S]*?<\/head>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<nav[\s\S]*?<\/nav>/gi, '');

    if (hMatch && /<h[12]/i.test(hMatch[0])) {
      bodyHtml = bodyHtml.replace(hMatch[0], '');
    }

    const sanitized = sanitizeRawChapterText(bodyHtml);
    totalRemovedJunkLines += sanitized.removedLinesCount;

    if (!sanitized.cleanedText || sanitized.cleanedText.length < 15) continue;

    const chapNum = chapters.length + 1;
    const titleEng = extractedTitle || `Chapter ${chapNum}`;
    const wordCountEng = sanitized.cleanedText.split(/\s+/).filter(Boolean).length;

    chapters.push({
      number: chapNum,
      titleEng,
      engText: sanitized.cleanedText,
      wordCountEng,
      href: fullPath,
    });
  }

  return {
    bookTitle,
    author,
    chapters,
    totalRemovedJunkLines,
  };
}

/**
 * Unpacks an `.epub` binary buffer into clean chapters synchronously (for STORED EPUBs)
 * or asynchronously via `parseEpubArchiveToChaptersAsync` (for STORED + DEFLATE EPUBs).
 */
export function parseEpubArchiveToChapters(epubBytes: Uint8Array): EpubImportResult {
  const entries = readZipEntriesRaw(epubBytes);
  const decoder = new TextDecoder('utf-8');
  const fileMap = new Map<string, string>();

  for (const entry of entries) {
    if (entry.compressionMethod === 0) {
      fileMap.set(entry.path, decoder.decode(entry.compressedData));
    }
  }

  return parseEpubDecodedFileMap(fileMap);
}

export async function parseEpubArchiveToChaptersAsync(epubBytes: Uint8Array): Promise<EpubImportResult> {
  const entries = readZipEntriesRaw(epubBytes);
  const decoder = new TextDecoder('utf-8');
  const fileMap = new Map<string, string>();

  for (const entry of entries) {
    if (entry.compressionMethod === 0) {
      fileMap.set(entry.path, decoder.decode(entry.compressedData));
    } else if (entry.compressionMethod === 8) {
      try {
        const inflated = await inflateRawBytesAsync(entry.compressedData);
        fileMap.set(entry.path, decoder.decode(inflated));
      } catch {
        // Skip unreadable entry
      }
    }
  }

  return parseEpubDecodedFileMap(fileMap);
}

export interface ChaptersZipArchivePackage {
  filename: string;
  bytes: Uint8Array;
  byteSize: number;
  chapterCount: number;
  fileList: string[];
}

/**
 * Compiles translated chapters into a `.zip` archive where each chapter is a standalone
 * UTF-8 LF `.txt` or `.md` file (`Chapter_0001.txt`, `Chapter_0002.txt`, ...) for Ranobelib / Author.Today / Boosty (`Q11: B`).
 */
export function buildChaptersZipArchive(
  novelName: string,
  chapters: Array<{ number: number; titleRus: string; contentRus: string }>,
  format: 'txt' | 'md' = 'txt'
): ChaptersZipArchivePackage {
  const encoder = new TextEncoder();
  const sorted = [...chapters].sort((a, b) => a.number - b.number);
  const ext = format === 'md' ? 'md' : 'txt';
  const files: Array<{ path: string; data: Uint8Array }> = [];
  const fileList: string[] = [];

  for (const ch of sorted) {
    const padded = String(ch.number).padStart(4, '0');
    const cleanHeading = (ch.titleRus || `Глава ${ch.number}`).replace(/\r\n/g, '\n').trim();
    const cleanBody = (ch.contentRus || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    const fileContent =
      format === 'md'
        ? `# ${cleanHeading}\n\n${cleanBody}\n`
        : `${cleanHeading}\n\n${cleanBody}\n`;

    const filePath = `Chapter_${padded}.${ext}`;
    fileList.push(filePath);
    files.push({
      path: filePath,
      data: encoder.encode(fileContent),
    });
  }

  const manifestJson = JSON.stringify(
    {
      novelName,
      exportedAt: new Date().toISOString(),
      chapterCount: sorted.length,
      format: ext,
      files: fileList,
    },
    null,
    2
  );
  files.push({
    path: '00_MANIFEST.json',
    data: encoder.encode(manifestJson),
  });

  const bytes = createStoredZipArchive(files);
  const firstNum = sorted[0]?.number ?? 1;
  const lastNum = sorted[sorted.length - 1]?.number ?? 1;
  const slug = novelName
    .replace(/[^a-zA-Z0-9а-яА-ЯёЁ]+/g, '_')
    .replace(/^_|_$/g, '');

  return {
    filename: `${slug || 'Novel'}_Chapters_${firstNum}_${lastNum}_${ext.toUpperCase()}.zip`,
    bytes,
    byteSize: bytes.byteLength,
    chapterCount: sorted.length,
    fileList,
  };
}
