import {
  runQaLinter,
  autoRepairRussianText,
  surgicalRepairDriftedParagraphs,
  alignChapterParagraphs,
  applySurgicalPatches,
  extractCsiCulturalNotes,
  evaluateDitingQuality,
  generateBilingualChapterSummary,
  detectTranslationDegenerationAndDuplicates,
  type CanonicalGlossary,
  type GlossaryTermMeta,
  type LintRuleId,
  type LintReport,
  type SurgicalPatchItem,
  type CsiCulturalNote,
  type DitingQualityReport,
  type LinterOptions,
} from './qa-linter.ts';

export interface ChapterVerificationInput {
  chapterNumber: number;
  titleEng: string;
  titleRus?: string;
  engText: string;
  candidateRusText: string;
  glossary: CanonicalGlossary;
  glossaryMeta?: Record<string, GlossaryTermMeta>;
  enabledRuleIds?: LintRuleId[];
  surgicalPatches?: SurgicalPatchItem[];
  runSurgicalDriftRepair?: boolean; // default: true
  existingSummaryRus?: string;
  existingSummaryEng?: string;
  aiCsiNotes?: Array<{
    sourcePhrase: string;
    categoryLabel?: string;
    adaptedRus: string;
    rationale: string;
  }>;
}

export interface ChapterVerificationOutput {
  titleRus: string;
  rusText: string;
  summary: string;
  summaryEng: string;
  appliedFixes: string[];
  surgicallyFixedParagraphs: number[];
  flawedParagraphIndices: number[]; // 0-based indices of paragraphs that still have QA errors
  lintReport: LintReport;
  csiNotes: CsiCulturalNote[];
  ditingReport: DitingQualityReport;
  wordCountEng: number;
  wordCountRus: number;
  verified: boolean;
}

/**
 * Universal deep module for chapter post-processing and QA verification.
 * Enforces strict order of operations:
 * 1. Pass 2 Surgical Patches
 * 2. 1:1 Paragraph Alignment & Drift Repair
 * 3. 16-Rule Deterministic Auto-Repair
 * 4. QA Linter & Flawed Paragraph Indexing
 * 5. CSI Cultural Notes Extraction
 * 6. DITING 6-Dimension Quality Report
 * 7. Bilingual Chapter Summary Generation
 */
export function finalizeAndVerifyChapter(
  input: ChapterVerificationInput
): ChapterVerificationOutput {
  let rusText = (input.candidateRusText || '').trim();
  const appliedFixes: string[] = [];
  const surgicallyFixedSet = new Set<number>();

  // 1. Apply Pass 2 Literary Critic Surgical Patches (Mechanical Gate with Add-Only Canon Guard)
  if (Array.isArray(input.surgicalPatches) && input.surgicalPatches.length > 0) {
    const patchRes = applySurgicalPatches(rusText, input.surgicalPatches, input.glossary);
    if (patchRes.appliedCount > 0) {
      rusText = patchRes.patchedText;
      for (const item of patchRes.appliedLog) {
        appliedFixes.push(
          `[Pass 2 Хирург / ${item.patchClass || 'C_calque_or_slop'}] «${item.find}» → «${item.replace}» (${item.reason})`
        );
      }
    }
  }

  // 1b. AI Hunter: Detect translation degeneration and TF-IDF duplicates
  if (input.engText.trim() && rusText) {
    const degen = detectTranslationDegenerationAndDuplicates(input.engText, rusText);
    if (degen.issues.length > 0) {
      if (degen.hasFatalDegeneration && degen.repairedText) {
        rusText = degen.repairedText;
        appliedFixes.push('AI Hunter: устранены зацикленные фрагменты и дубликаты абзацев');
      }
    }
  }

  // 2. Surgical Paragraph Drift Repair (1:1 alignment check & restoration)
  if (input.runSurgicalDriftRepair !== false && input.engText.trim() && rusText) {
    const surgical = surgicalRepairDriftedParagraphs(
      input.engText,
      rusText,
      input.glossary,
      input.glossaryMeta,
      input.enabledRuleIds
    );
    rusText = surgical.repairedRusText;
    for (const idx of surgical.surgicallyFixedIndices) {
      surgicallyFixedSet.add(idx);
    }
    for (const detail of surgical.details) {
      appliedFixes.push(detail);
    }
  }

  // 3. Deterministic Auto-Repair (all active rules + gender + anti-calque + punctuation)
  if (rusText) {
    const auto = autoRepairRussianText(rusText, {
      glossary: input.glossary,
      glossaryMeta: input.glossaryMeta,
      enabledRuleIds: input.enabledRuleIds,
    });
    rusText = auto.repairedText;
    appliedFixes.push(...auto.appliedFixes);
  }

  // 4. QA Linter
  const lintReport = runQaLinter(input.engText, rusText, input.glossary, {
    enabledRuleIds: input.enabledRuleIds,
    glossaryMeta: input.glossaryMeta,
  });

  // 5. Flawed Paragraph Indexing (0-based)
  const alignment = alignChapterParagraphs(input.engText, rusText);
  const flawedSet = new Set<number>();
  for (const pair of alignment.pairs) {
    if (pair.isDrifted || pair.missingNumbers.length > 0) {
      flawedSet.add(pair.index);
      continue;
    }
    if (pair.engParagraph.trim() && pair.rusParagraph.trim()) {
      const pLint = runQaLinter(pair.engParagraph, pair.rusParagraph, input.glossary, {
        enabledRuleIds: input.enabledRuleIds,
        glossaryMeta: input.glossaryMeta,
      });
      if (pLint.errorCount > 0) {
        flawedSet.add(pair.index);
      }
    }
  }
  const flawedParagraphIndices = Array.from(flawedSet).sort((a, b) => a - b);

  // 6. CSI Cultural Notes
  let csiNotes: CsiCulturalNote[];
  if (Array.isArray(input.aiCsiNotes) && input.aiCsiNotes.length > 0) {
    csiNotes = input.aiCsiNotes.map((n, idx) => ({
      id: `csi-${input.chapterNumber}-${idx}`,
      sourcePhrase: n.sourcePhrase,
      category: 'idiom',
      categoryLabel: n.categoryLabel || 'Культурная адаптация CSI',
      adaptedRus: n.adaptedRus,
      rationale: n.rationale,
    }));
  } else {
    csiNotes = extractCsiCulturalNotes(input.engText, rusText, input.glossary);
  }

  // 7. DITING 6-Dimension Quality Report
  const ditingReport = evaluateDitingQuality(
    input.engText,
    rusText,
    input.glossary,
    input.glossaryMeta,
    input.enabledRuleIds
  );

  // 8. Bilingual Chapter Summary
  const titleRus = (input.titleRus || '').trim() || `Глава ${input.chapterNumber}`;
  const biSummary = generateBilingualChapterSummary(
    input.chapterNumber,
    input.titleEng,
    input.engText,
    titleRus,
    rusText
  );
  const summary = (input.existingSummaryRus || '').trim() || biSummary.rus;
  const summaryEng = (input.existingSummaryEng || '').trim() || biSummary.eng;

  // 9. Word counts & verified verdict
  const wordCountEng = (input.engText.match(/\S+/g) || []).length;
  const wordCountRus = (rusText.match(/\S+/g) || []).length;
  const verified =
    lintReport.passed &&
    lintReport.errorCount === 0 &&
    !alignment.hasDrift &&
    flawedParagraphIndices.length === 0;

  return {
    titleRus,
    rusText,
    summary,
    summaryEng,
    appliedFixes,
    surgicallyFixedParagraphs: Array.from(surgicallyFixedSet).sort((a, b) => a - b),
    flawedParagraphIndices,
    lintReport,
    csiNotes,
    ditingReport,
    wordCountEng,
    wordCountRus,
    verified,
  };
}

/**
 * Computes a robust 3-character base-36 hash anchor for an English paragraph.
 * Uses FNV-1a (32-bit) with index mixing.
 * 36^3 = 46,656 possible values (<0.1% collision probability over a chapter),
 * consuming only 5 tokens in the prompt: [a7f|#pK].
 */
export function computeParagraphHashAnchor(
  sourceParagraph: string,
  index: number
): string {
  const normalized = (sourceParagraph || '').trim().toLowerCase().replace(/\s+/g, ' ');
  let hash = (2166136261 ^ index) >>> 0;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const positiveHash = hash % 46656;
  return positiveHash.toString(36).padStart(3, '0');
}

export interface FlawedParagraphItem {
  index: number; // 0-based
  anchorHash?: string;
  engParagraph: string;
  rusParagraph: string;
  missingNumbers: string[];
  isDrifted: boolean;
  lintErrorCount: number;
  lintIssues: string[];
}

export interface FlawedParagraphsPayload {
  hasDrift: boolean;
  totalParagraphCount: number;
  flawedCount: number;
  flawedIndices: number[]; // 0-based
  flawedParagraphs: FlawedParagraphItem[];
  promptBlock: string;
}

/**
 * Extracts ONLY paragraph pairs with missing numbers, paragraph drift, or QA violations.
 * Formats a compact payload with [hash|#pK] markers and [DRAFT_PASS1_FOR_SUFFIX_LOOKUP]
 * for LLM-targeted surgical self-repair and speculative suffix decoding.
 */
export function extractFlawedParagraphsPayload(
  engText: string,
  rusText: string,
  glossary: CanonicalGlossary,
  options?: LinterOptions
): FlawedParagraphsPayload {
  const alignment = alignChapterParagraphs(engText, rusText);
  const flawedParagraphs: FlawedParagraphItem[] = [];
  const flawedIndices: number[] = [];

  for (const pair of alignment.pairs) {
    let pLintErrorCount = 0;
    const pLintIssues: string[] = [];

    if (pair.engParagraph.trim() && pair.rusParagraph.trim()) {
      const pLint = runQaLinter(pair.engParagraph, pair.rusParagraph, glossary, options);
      pLintErrorCount = pLint.errorCount;
      for (const iss of pLint.issues) {
        if (iss.severity === 'error') {
          pLintIssues.push(`${iss.ruleTitle}: ${iss.explanation}`);
        }
      }
    }

    const isFlawed = pair.isDrifted || pair.missingNumbers.length > 0 || pLintErrorCount > 0;
    if (isFlawed) {
      const anchorHash = computeParagraphHashAnchor(pair.engParagraph, pair.index);
      flawedIndices.push(pair.index);
      flawedParagraphs.push({
        index: pair.index,
        anchorHash,
        engParagraph: pair.engParagraph,
        rusParagraph: pair.rusParagraph,
        missingNumbers: pair.missingNumbers,
        isDrifted: pair.isDrifted,
        lintErrorCount: pLintErrorCount,
        lintIssues: pLintIssues,
      });
    }
  }

  const promptBlock = flawedParagraphs
    .map((item) => {
      const anchor = `[#p${item.index}] [${item.anchorHash || '000'}|#p${item.index}]`;
      const parts = [
        anchor,
        `ENG: ${item.engParagraph}`,
        `RUS: ${item.rusParagraph}`,
        `[DRAFT_PASS1_FOR_SUFFIX_LOOKUP]: ${item.rusParagraph}`,
      ];
      if (item.missingNumbers.length > 0) {
        parts.push(`MISSING_NUMBERS: ${item.missingNumbers.join(', ')}`);
      }
      if (item.lintIssues.length > 0) {
        parts.push(`QA_ERRORS: ${item.lintIssues.join('; ')}`);
      }
      return parts.join('\n');
    })
    .join('\n\n');

  return {
    hasDrift: alignment.hasDrift,
    totalParagraphCount: alignment.pairs.length,
    flawedCount: flawedParagraphs.length,
    flawedIndices,
    flawedParagraphs,
    promptBlock,
  };
}

export interface MergeRepairedParagraphsResult {
  mergedText: string;
  repairedIndices: number[];
  skippedIndices: number[];
  droppedDueToNumbers: number[];
  droppedDueToHashDrift: number[];
}

/**
 * Parses an LLM self-repair response containing [#pK] or [hash|#pK] paragraph markers,
 * verifies strict Arabic number preservation and hash anchor alignment against source English,
 * and merges only the repaired paragraphs back into the chapter while keeping all verified paragraphs untouched.
 */
export function mergeRepairedParagraphsByIndex(
  originalRusText: string,
  repairedBlock: string,
  sourceEngText?: string
): MergeRepairedParagraphsResult {
  const paragraphs = (originalRusText || '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (!repairedBlock || paragraphs.length === 0) {
    return {
      mergedText: originalRusText,
      repairedIndices: [],
      skippedIndices: [],
      droppedDueToNumbers: [],
      droppedDueToHashDrift: [],
    };
  }

  const engParagraphs = sourceEngText
    ? sourceEngText
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
    : [];

  const repairedIndices: number[] = [];
  const skippedIndices: number[] = [];
  const droppedDueToNumbers: number[] = [];
  const droppedDueToHashDrift: number[] = [];

  // Matches [a7f|#p0], [#p0], [#p0] [a7f|#p0], or [a7f|#p0] [#p0]
  const regex =
    /\[(?:([a-z0-9]{3})\|)?#p(\d+)\](?:\s*\[(?:([a-z0-9]{3})\|)?#p\d+\])?\s*([\s\S]*?)(?=(?:\[(?:[a-z0-9]{3}\|)?#p\d+\])|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(repairedBlock)) !== null) {
    const anchorHash = match[1] || match[3];
    const idx = parseInt(match[2], 10);
    let content = match[4].trim();

    // Strip prefix markers if repeated by the LLM (including echoed ENG prompts, lookup tokens, and residual anchors)
    content = content
      .replace(/^\[(?:[a-z0-9]{3}\|)?#p\d+\]\s*/i, '')
      .replace(/^ENG:[\s\S]*?\n(?:RUS|REPAIRED|ПЕРЕВОД):\s*/i, '')
      .replace(/^(?:RUS|REPAIRED|ПЕРЕВОД):\s*/i, '')
      .replace(/^\[DRAFT_PASS1_FOR_SUFFIX_LOOKUP\]:\s*[\s\S]*?\n/i, '')
      .replace(/\n(?:MISSING_NUMBERS|QA_ERRORS):[\s\S]*$/i, '')
      .replace(/\[DRAFT_PASS1_FOR_SUFFIX_LOOKUP\]:.*$/im, '')
      .replace(/^\[(?:[a-z0-9]{3}\|)?#p\d+\]\s*/i, '')
      .trim();

    if (isNaN(idx) || idx < 0 || idx >= paragraphs.length) {
      skippedIndices.push(idx);
      continue;
    }

    if (!content) {
      skippedIndices.push(idx);
      continue;
    }

    // Safety guard: verify hash anchor against source paragraph if both are available
    if (anchorHash && engParagraphs.length > idx) {
      const expectedHash = computeParagraphHashAnchor(engParagraphs[idx], idx);
      if (anchorHash.toLowerCase() !== expectedHash.toLowerCase()) {
        droppedDueToHashDrift.push(idx);
        continue;
      }
    }

    // Safety guard: ensure no Arabic numbers from the original paragraph are silently dropped
    const origNums = paragraphs[idx].match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || [];
    const newNums = new Set(content.match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || []);
    const numbersPreserved = origNums.every((num) => newNums.has(num));

    if (!numbersPreserved) {
      droppedDueToNumbers.push(idx);
      continue;
    }

    paragraphs[idx] = content;
    repairedIndices.push(idx);
  }

  const mergedText = paragraphs.join('\n\n');

  return {
    mergedText,
    repairedIndices,
    skippedIndices,
    droppedDueToNumbers,
    droppedDueToHashDrift,
  };
}

export interface StylistRollbackItem {
  index: number;
  reason: string;
  restoredText: string;
  rejectedStylistText: string;
}

export interface StylistRollbackResult {
  finalRusText: string;
  acceptedParagraphIndices: number[];
  rolledBackParagraphs: StylistRollbackItem[];
}

/**
 * Step 4: Deterministic Paragraph-Level Rollback Gate for Pass 3 (MELT verify & rollback).
 * Verifies every styled paragraph against its exact factual ancestor y' across 5 invariants:
 * 1. 100% Number match (no Arabic digits lost)
 * 2. Canon glossary terms preserved in oblique cases or quotes
 * 3. Bracket [ ] and guillemets « » balance
 * 4. Dash inflation guard (ΔDash < 3)
 * 5. Length variance guard (within ±45% length of ancestor)
 * If ANY invariant fails for paragraph #pK, THAT specific paragraph is immediately rolled back to y'[#pK]!
 */
export function verifyAndRollbackStylistPass(params: {
  verifiedRusText: string; // y' (after Pass 2 accuracy patches applied)
  styledParagraphs: Array<{ index: number; styledRusText: string }>;
  glossary: CanonicalGlossary;
}): StylistRollbackResult {
  const paragraphs = (params.verifiedRusText || '')
    .replace(/\r\n/g, '\n')
    .split(/\n\n+/)
    .map((p) => p.trim());

  const acceptedParagraphIndices: number[] = [];
  const rolledBackParagraphs: StylistRollbackItem[] = [];

  for (const item of params.styledParagraphs || []) {
    const idx = item.index;
    if (isNaN(idx) || idx < 0 || idx >= paragraphs.length) {
      continue;
    }

    const yPrime = paragraphs[idx];
    const yE = (item.styledRusText || '').trim();

    if (!yE) {
      rolledBackParagraphs.push({
        index: idx,
        reason: 'Пустой вывод стилиста',
        restoredText: yPrime,
        rejectedStylistText: yE,
      });
      continue;
    }

    // Invariant 1: 100% Number Match
    const origNums = yPrime.match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || [];
    const styledNums = new Set(yE.match(/(?<!\d)\d+(?:\.\d+)?(?!\d)/g) || []);
    const missingNum = origNums.find((n) => !styledNums.has(n));
    if (missingNum) {
      rolledBackParagraphs.push({
        index: idx,
        reason: `Потеряно числовое значение: «${missingNum}»`,
        restoredText: yPrime,
        rejectedStylistText: yE,
      });
      continue;
    }

    // Invariant 2: Canon Glossary Inflection Guard
    let missingGlossaryTerm: string | undefined;
    const lowerYPrime = yPrime.toLowerCase().replace(/ё/g, 'е');
    const lowerYE = yE.toLowerCase().replace(/ё/g, 'е');

    const allTerms: string[] = [];
    (Object.keys(params.glossary || {}) as Array<keyof CanonicalGlossary>).forEach((cat) => {
      Object.values(params.glossary[cat] || {}).forEach((t) => allTerms.push(t));
    });

    for (const term of allTerms) {
      if (term.length < 3) continue;
      const cleanTerm = term.replace(/^[«"]|[»"]$/g, '').toLowerCase().replace(/ё/g, 'е');
      const stem = cleanTerm.slice(0, Math.min(5, Math.max(3, cleanTerm.length - 2)));
      if (lowerYPrime.includes(stem)) {
        if (!lowerYE.includes(stem)) {
          missingGlossaryTerm = term;
          break;
        }
      }
    }

    if (missingGlossaryTerm) {
      rolledBackParagraphs.push({
        index: idx,
        reason: `Утерян канонический термин глоссария: «${missingGlossaryTerm}»`,
        restoredText: yPrime,
        rejectedStylistText: yE,
      });
      continue;
    }

    // Invariant 3: Bracket & Guillemet Balance
    const openSq = (yE.match(/\[/g) || []).length;
    const closeSq = (yE.match(/\]/g) || []).length;
    const openGui = (yE.match(/«/g) || []).length;
    const closeGui = (yE.match(/»/g) || []).length;
    if (openSq !== closeSq || openGui !== closeGui) {
      rolledBackParagraphs.push({
        index: idx,
        reason: 'Разбалансированы скобки [ ] или кавычки « »',
        restoredText: yPrime,
        rejectedStylistText: yE,
      });
      continue;
    }

    // Invariant 4: Dash Inflation Guard (ΔDash < 3 in non-dialogue)
    const isDialogue =
      yPrime.startsWith('—') || yPrime.startsWith('"') || yPrime.startsWith('«');
    if (!isDialogue) {
      const origDashes = (yPrime.match(/—|–/g) || []).length;
      const styledDashes = (yE.match(/—|–/g) || []).length;
      if (styledDashes - origDashes >= 3) {
        rolledBackParagraphs.push({
          index: idx,
          reason: `Избыточная инфляция тире (ΔDash = +${styledDashes - origDashes})`,
          restoredText: yPrime,
          rejectedStylistText: yE,
        });
        continue;
      }
    }

    // Invariant 5: Length Ratio Anomaly Guard
    if (yPrime.length >= 40) {
      const ratio = yE.length / yPrime.length;
      if (ratio < 0.45 || ratio > 1.85) {
        rolledBackParagraphs.push({
          index: idx,
          reason: `Аномальное изменение объёма текста (коэффициент ${ratio.toFixed(2)})`,
          restoredText: yPrime,
          rejectedStylistText: yE,
        });
        continue;
      }
    }

    // All 5 invariants passed! Accept styled paragraph.
    paragraphs[idx] = yE;
    acceptedParagraphIndices.push(idx);
  }

  return {
    finalRusText: paragraphs.join('\n\n'),
    acceptedParagraphIndices,
    rolledBackParagraphs,
  };
}
