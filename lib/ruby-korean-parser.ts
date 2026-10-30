// ============================================================================
// Japanese Furigana / Gikun / Bouten AST Pre-Parser, Korean Paragraph Normalizer
// & Dialogue/Scene-Locked Sliding Window Chunker
// ============================================================================

export type GikunCategory =
  | 'reading_aid'
  | 'bouten'
  | 'nomenclature'
  | 'litrpg_term'
  | 'deictic'
  | 'subtext';

export interface RubyGikunParseItem {
  base: string;
  ruby: string;
  category: GikunCategory;
  renderedTag: string;
}

export interface RubyGikunParseResult {
  parsedText: string;
  foundCount: number;
  items: RubyGikunParseItem[];
}

/**
 * Step 0.1: Deterministic Japanese Furigana, Gikun, and Bouten AST Pre-Parser.
 * Classifies Japanese ruby annotations into 6 linguistic types before Pass 1 translation
 * to eliminate bracketed artifacts in dialogue and enable natural Russian stylistic fusion.
 */
export function parseRubyAndGikunMarkup(sourceText: string): RubyGikunParseResult {
  if (!sourceText || typeof sourceText !== 'string') {
    return { parsedText: '', foundCount: 0, items: [] };
  }

  const items: RubyGikunParseItem[] = [];
  let working = sourceText;

  // 1. Bouten standalone notation: 《《text》》
  working = working.replace(/《《([^》\n]+)》》/g, (_, emphText) => {
    const renderedTag = `<emph text="${emphText}"/>`;
    items.push({
      base: emphText,
      ruby: 'bouten',
      category: 'bouten',
      renderedTag,
    });
    return renderedTag;
  });

  // 2. HTML <ruby> tags: <ruby><rb>Base</rb><rt>Ruby</rt></ruby> or <ruby>Base<rt>Ruby</rt></ruby>
  working = working.replace(
    /<ruby>(?:<rb>)?([^<]+)(?:<\/rb>)?<rt>([^<]+)<\/rt><\/ruby>/gi,
    (_, base, ruby) => {
      const parsed = classifyRubyItem(base.trim(), ruby.trim());
      items.push(parsed);
      return parsed.renderedTag;
    }
  );

  // 3. Syosetu / Kakuyomu ruby: ｜Base《Ruby》 or Base《Ruby》
  working = working.replace(
    /(?:｜([^\s《\n]+)|([一-龯々〆ヵヶa-zA-Z0-9]+))《([^》\n]+)》/g,
    (_, base1, base2, ruby) => {
      const base = (base1 || base2 || '').trim();
      const parsed = classifyRubyItem(base, (ruby || '').trim());
      items.push(parsed);
      return parsed.renderedTag;
    }
  );

  // 4. Kanji + Parentheses notation: 漢字(ふりがな/カタカナ)
  working = working.replace(
    /([一-龯々〆ヵヶ]{1,8})\(([ぁ-んァ-ヶーa-zA-Z0-9・•●]+)\)/g,
    (_, base, ruby) => {
      const parsed = classifyRubyItem(base.trim(), ruby.trim());
      items.push(parsed);
      return parsed.renderedTag;
    }
  );

  return {
    parsedText: working,
    foundCount: items.length,
    items,
  };
}

function classifyRubyItem(base: string, ruby: string): RubyGikunParseItem {
  // A. Bouten: ruby is a bullet/dot (・, •, ●)
  if (/^[・•●]+$/.test(ruby)) {
    const renderedTag = `<emph text="${base}"/>`;
    return { base, ruby, category: 'bouten', renderedTag };
  }

  // B. Deictic / Alias Gikun: pronoun in ruby refering to noun in base
  const deicticPattern = /^(?:ここ|ぼくたち|僕たち|わたし|私|あいつ|そこ|あれ|オレたち|俺たち|あんた|お前|きみ|君)$/;
  if (deicticPattern.test(ruby)) {
    const renderedTag = `<gikun type="deictic" spoken="${ruby}" referent="${base}"/>`;
    return { base, ruby, category: 'deictic', renderedTag };
  }

  // C. LitRPG Game Gikun: terms like クラス, スキル, ステータス, レベル, 職業, 技能
  const litrpgPattern = /クラス|スキル|ステータス|レベル|職業|技能|魔法|属性|ダンジョン/;
  if (litrpgPattern.test(ruby) || litrpgPattern.test(base)) {
    const renderedTag = `<gikun type="litrpg_term" spoken="${ruby}" meaning="${base}"/>`;
    return { base, ruby, category: 'litrpg_term', renderedTag };
  }

  // C2. Subtext Slang Gikun: terms like 本気《マジ》, 強敵《とも》, リアル, ガチ, ウソ
  const subtextSlangPattern = /^(?:マジ|ガチ|リアル|ウソ|とも|やつ|ヤツ|オトコ|オンナ)$/;
  if (subtextSlangPattern.test(ruby)) {
    const renderedTag = `<gikun type="subtext" spoken="${ruby}" hidden="${base}"/>`;
    return { base, ruby, category: 'subtext', renderedTag };
  }

  // D. Nomenclature / Chuunibyou Gikun: Kanji base + Katakana loanword
  const hasKanji = /[一-龯々〆ヵヶ]/.test(base);
  const isKatakana = /^[ァ-ヶー・\s]+$/.test(ruby);
  if (hasKanji && isKatakana) {
    const renderedTag = `<gikun type="nomenclature" spoken="${ruby}" meaning="${base}"/>`;
    return { base, ruby, category: 'nomenclature', renderedTag };
  }

  // E. Standard phonetic reading aid: pure Hiragana matching phonetic helper
  const isHiragana = /^[ぁ-んー\s]+$/.test(ruby);
  if (hasKanji && isHiragana && ruby.length <= base.length * 4) {
    return { base, ruby, category: 'reading_aid', renderedTag: base };
  }

  // F. Synonymous / Subtext Gikun: oxymoronic or contextual subtext
  const renderedTag = `<gikun type="subtext" spoken="${ruby}" hidden="${base}"/>`;
  return { base, ruby, category: 'subtext', renderedTag };
}

export interface KoreanParagraphNormalizeResult {
  normalizedText: string;
  groupedParagraphCount: number;
  originalLineCount: number;
  paragraphIndexMap: number[]; // maps each new paragraph index to original line index
}

/**
 * Normalizes fragmented Korean single-sentence mobile web-novel paragraphs into cohesive narrative units.
 * Preserves Dialogue lines (—, ", 「), scene dividers (---, ***), and system status boxes ([...]).
 */
export function normalizeKoreanOneLineParagraphs(rawText: string): KoreanParagraphNormalizeResult {
  if (!rawText || typeof rawText !== 'string') {
    return { normalizedText: '', groupedParagraphCount: 0, originalLineCount: 0, paragraphIndexMap: [] };
  }

  const lines = rawText.replace(/\r\n/g, '\n').split('\n');
  const normalizedParagraphs: string[] = [];
  const paragraphIndexMap: number[] = [];

  let pendingNarrative: string[] = [];
  let pendingStartIndex = -1;

  const flushNarrative = () => {
    if (pendingNarrative.length > 0) {
      normalizedParagraphs.push(pendingNarrative.join(' '));
      paragraphIndexMap.push(pendingStartIndex >= 0 ? pendingStartIndex : 0);
      pendingNarrative = [];
      pendingStartIndex = -1;
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) {
      flushNarrative();
      continue;
    }

    const isDivider = line === '---' || line === '***' || line === '◇◇◇';
    const isSystemFrame =
      (line.startsWith('[') && line.endsWith(']')) ||
      (line.startsWith('【') && line.endsWith('】'));
    const isDialogue =
      /^[—\-"“'«‘「『]/.test(line) ||
      (line.endsWith('다."') || line.endsWith('다.’') || line.endsWith('요."'));

    if (isDivider || isSystemFrame || isDialogue) {
      flushNarrative();
      normalizedParagraphs.push(line);
      paragraphIndexMap.push(idx);
    } else {
      if (pendingStartIndex === -1) {
        pendingStartIndex = idx;
      }
      pendingNarrative.push(line);
      // Group up to 3 sentences or ~220 characters
      if (pendingNarrative.length >= 3 || pendingNarrative.join(' ').length >= 220) {
        flushNarrative();
      }
    }
  }

  flushNarrative();

  return {
    normalizedText: normalizedParagraphs.join('\n\n'),
    groupedParagraphCount: normalizedParagraphs.length,
    originalLineCount: lines.length,
    paragraphIndexMap,
  };
}

export interface ChapterChunkItem {
  chunkIndex: number;
  totalChunks: number;
  text: string;
  readOnlyPrecedingContext: string;
  readOnlyLookahead: string;
  startParagraphIndex: number;
  endParagraphIndex: number;
}

/**
 * Dialogue- and Scene-Aware Sliding Window Chunker (SceneDialogueChunker).
 * Enforces Dialogue Lock (never split mid-conversation), Frame Lock (never split [...] or dividers),
 * and provisions read-only preceding context + lookahead sentences.
 */
export function chunkChapterWithSceneAndDialogueLocks(
  chapterText: string,
  options?: {
    maxTokens?: number; // default ~1800 words/tokens
    precedingContextParagraphs?: number; // default 3
    lookaheadSentences?: number; // default 2
  }
): ChapterChunkItem[] {
  if (!chapterText || !chapterText.trim()) {
    return [];
  }

  const maxTokens = options?.maxTokens || 1800;
  const contextCount = options?.precedingContextParagraphs || 3;
  const lookaheadCount = options?.lookaheadSentences || 2;

  const paragraphs = chapterText
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (paragraphs.length === 0) return [];

  // Approximate tokens by word count
  const estimateTokens = (text: string) => Math.ceil((text.match(/\S+/g) || []).length * 1.3);

  const chunks: Array<{
    paragraphs: string[];
    startIdx: number;
    endIdx: number;
  }> = [];

  let currentChunk: string[] = [];
  let currentTokens = 0;
  let currentStart = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const p = paragraphs[i];
    const pTokens = estimateTokens(p);

    const isDialogue = /^[—\-"“'«‘「『]/.test(p);
    const nextP = i + 1 < paragraphs.length ? paragraphs[i + 1] : undefined;
    const nextIsDialogue = nextP ? /^[—\-"“'«‘「『]/.test(nextP) : false;
    const isDivider = p === '---' || p === '***' || p === '◇◇◇';
    const isSystemFrame =
      (p.startsWith('[') && p.endsWith(']')) ||
      (p.startsWith('【') && p.endsWith('】'));

    currentChunk.push(p);
    currentTokens += pTokens;

    // Check if we should split:
    // 1. Exceeded maxTokens
    // 2. NOT in Dialogue Lock (if this is dialogue and next is dialogue, keep together)
    // 3. NOT in Frame Lock
    const canSplit = !(isDialogue && nextIsDialogue) && !isSystemFrame && !isDivider;

    if (currentTokens >= maxTokens && canSplit && i < paragraphs.length - 1) {
      chunks.push({
        paragraphs: [...currentChunk],
        startIdx: currentStart,
        endIdx: i,
      });
      currentChunk = [];
      currentTokens = 0;
      currentStart = i + 1;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push({
      paragraphs: [...currentChunk],
      startIdx: currentStart,
      endIdx: paragraphs.length - 1,
    });
  }

  // Build final ChapterChunkItem with preceding context & lookahead
  return chunks.map((c, cIdx) => {
    // Preceding context from previous chunk
    let precedingContext = '';
    if (cIdx > 0) {
      const prevChunkParas = chunks[cIdx - 1].paragraphs;
      const sliceCount = Math.min(contextCount, prevChunkParas.length);
      precedingContext = prevChunkParas.slice(-sliceCount).join('\n\n');
    }

    // Lookahead sentences from next chunk
    let lookahead = '';
    if (cIdx < chunks.length - 1) {
      const nextChunkFirstParas = chunks[cIdx + 1].paragraphs.slice(0, 2).join(' ');
      const sentences = nextChunkFirstParas
        .split(/(?<=[.!?。！？])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      lookahead = sentences.slice(0, lookaheadCount).join(' ');
    }

    return {
      chunkIndex: cIdx + 1,
      totalChunks: chunks.length,
      text: c.paragraphs.join('\n\n'),
      readOnlyPrecedingContext: precedingContext
        ? `[READ_ONLY_PRECEDING_CONTEXT - DO NOT TRANSLATE]:\n${precedingContext}`
        : '',
      readOnlyLookahead: lookahead
        ? `[READ_ONLY_LOOKAHEAD - DO NOT TRANSLATE]:\n${lookahead}`
        : '',
      startParagraphIndex: c.startIdx,
      endParagraphIndex: c.endIdx,
    };
  });
}
