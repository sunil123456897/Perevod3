import {
  runQaLinter,
  autoRepairRussianText,
  repairNegationPolarityWithSource,
  surgicalRepairDriftedParagraphs,
  alignChapterParagraphs,
  applySurgicalPatches,
  extractCsiCulturalNotes,
  evaluateDitingQuality,
  verifyProseQualityGate,
  generateBilingualChapterSummary,
  detectTranslationDegenerationAndDuplicates,
  extractNormalizedRussianNumbers,
  joinParagraphsPreservingSystemBoxes,
  normalizeRussianBookLayout,
  normalizeRussianChapterTitle,
  type CanonicalGlossary,
  type GlossaryTermMeta,
  type LintRuleId,
  type LintReport,
  type SurgicalPatchItem,
  type CsiCulturalNote,
  type DitingQualityReport,
  type ProseQualityGateReport,
  type ProseQualityGateThresholds,
  type LinterOptions,
} from './qa-linter.ts';
import {
  getLocalEmbedBridgeClient,
  shutdownLocalEmbedBridgeClient,
  type ChapterNeuralAuditResult,
} from './local-embed-client.ts';

export {
  getLocalEmbedBridgeClient,
  shutdownLocalEmbedBridgeClient,
  type ChapterNeuralAuditResult,
};

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
  neuralStats?: {
    meanCosine: number;
    minCosine: number;
  };
  gateThresholds?: ProseQualityGateThresholds;
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
  proseGateReport?: ProseQualityGateReport;
  neuralAudit?: ChapterNeuralAuditResult;
  wordCountEng: number;
  wordCountRus: number;
  verified: boolean;
}

/**
 * Stage 1 Structural Alignment Repair:
 * Detects and heals both:
 * - +1/-1 zero-net-diff split+glue shifts (where an earlier paragraph was split 1->2 and a later pair was glued 2->1)
 * - Pure -1 glued paragraphs (inline dialogue stitch `. — [А-ЯЁ]` or `, — [А-ЯЁ]` when ENG has a separate paragraph)
 * - Pure +1 split paragraphs (when 1 ENG paragraph was broken into 2 consecutive short RUS fragments)
 */
export function repairSplitAndGluedParagraphs(
  engText: string,
  rusText: string
): {
  repairedRusText: string;
  appliedFixes: string[];
  repairedIndices: number[];
} {
  const engParas = engText
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  const rusParas = rusText
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (engParas.length < 2 || rusParas.length < 2) {
    return { repairedRusText: rusText, appliedFixes: [], repairedIndices: [] };
  }

  const appliedFixes: string[] = [];
  const repairedIndices: number[] = [];

  // Helper to split a glued Russian paragraph into 2 parts matching engA and engB
  const trySplitGluedParagraph = (p: string, engB = '', engA = ''): [string, string] | null => {
    // 1. Explicit inline dialogue boundary: ". — [А-ЯЁ]" or "» — [А-ЯЁ]" when not attribution
    const inlineDlgMatch = p.match(/^(.+?[.!?…»])\s+(—\s+[А-ЯЁ][\s\S]+)$/);
    if (inlineDlgMatch && inlineDlgMatch[1] && inlineDlgMatch[2]) {
      return [inlineDlgMatch[1].trim(), inlineDlgMatch[2].trim()];
    }
    // 2. Inline stitch ", — [А-ЯЁ]" on a narrative paragraph when engB starts with quote
    if (!p.startsWith('—') && /^["\u201C]/.test(engB.trim())) {
      const stitchMatch = p.match(/^(.+?),\s*—\s+([А-ЯЁ][\s\S]+)$/);
      if (stitchMatch && stitchMatch[1] && stitchMatch[2]) {
        return [`${stitchMatch[1].trim()}.`, `— ${stitchMatch[2].trim()}`];
      }
    }
    // 3. Proportional sentence boundary split when paragraph has >= 2 sentences
    const sentences = p
      .split(/(?<=[.!?…»])\s+(?=[А-ЯЁ«—])/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length >= 2) {
      const targetRatio =
        engA.length > 0 && engB.length > 0
          ? Math.max(0.15, Math.min(0.85, engA.length / (engA.length + engB.length)))
          : 0.5;
      let bestK = Math.max(1, Math.floor(sentences.length / 2));
      let bestDiff = Infinity;
      for (let k = 1; k < sentences.length; k++) {
        const leftLen = sentences.slice(0, k).join(' ').length;
        const ratio = leftLen / Math.max(1, p.length);
        const diff = Math.abs(ratio - targetRatio);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestK = k;
        }
      }
      return [sentences.slice(0, bestK).join(' '), sentences.slice(bestK).join(' ')];
    }
    return null;
  };

  let workingRus = [...rusParas];

  // Case D: Wagner-Fischer / Gale-Church Dynamic Time Warping (DTW) for unequal paragraph counts (|N - M| >= 1)
  const countDiff = Math.abs(workingRus.length - engParas.length);
  if (countDiff >= 1 && countDiff <= 10 && engParas.length >= 3 && workingRus.length >= 3) {
    const N = engParas.length;
    const M = workingRus.length;
    const isBox = (s: string) => /^\[[\s\S]+\]$/.test(s.trim()) || s.trim() === '---';
    const isDlg = (s: string) => /^(?:—|«|"|\u201C)/.test(s.trim());

    const pairCost = (e: string, r: string): number => {
      if (isBox(e) !== isBox(r)) return 25;
      const expLen = Math.max(10, e.length * 0.85);
      const z = (r.length - expLen) / Math.sqrt(Math.max(30, e.length + r.length));
      let cost = z * z;
      if (isDlg(e) !== isDlg(r)) cost += 3.2;
      const eNums = e.match(/\d+/g) || [];
      if (eNums.length > 0) {
        const rNums = extractNormalizedRussianNumbers(r);
        const allPresent = eNums.every((num) => rNums.has(num));
        cost += allPresent ? -1.4 : 4.5;
      }
      return cost;
    };

    type BackStep = {
      prevI: number;
      prevJ: number;
      op: '1:1' | '1:2' | '2:1';
      splitParts?: [string, string];
    };

    const dp: number[][] = Array.from({ length: N + 1 }, () =>
      Array(M + 1).fill( Number.POSITIVE_INFINITY )
    );
    const back: Array<Array<BackStep | null>> = Array.from({ length: N + 1 }, () =>
      Array(M + 1).fill(null)
    );
    dp[0]![0] = 0;

    const band = Math.max(4, countDiff + 3);
    for (let i = 0; i <= N; i++) {
      const jMin = Math.max(0, i - band);
      const jMax = Math.min(M, i + band);
      for (let j = jMin; j <= jMax; j++) {
        const cur = dp[i]![j]!;
        if (!Number.isFinite(cur)) continue;

        // 1:1 transition
        if (i < N && j < M) {
          const c11 = cur + pairCost(engParas[i]!, workingRus[j]!);
          if (c11 < dp[i + 1]![j + 1]!) {
            dp[i + 1]![j + 1] = c11;
            back[i + 1]![j + 1] = { prevI: i, prevJ: j, op: '1:1' };
          }
        }

        // 1:2 transition (1 ENG paragraph split into 2 RUS paragraphs: merge workingRus[j] + workingRus[j+1])
        if (i < N && j + 1 < M) {
          const e = engParas[i]!;
          const r0 = workingRus[j]!;
          const r1 = workingRus[j + 1]!;
          const combLen = r0.length + r1.length + 1;
          if (
            !isBox(e) &&
            !isBox(r0) &&
            !isBox(r1) &&
            e.length >= 45 &&
            r0.length < e.length * 0.78 &&
            r1.length < e.length * 0.82 &&
            combLen >= e.length * 0.55 &&
            combLen <= e.length * 1.55
          ) {
            const c12 = cur + pairCost(e, `${r0} ${r1}`) + 1.5;
            if (c12 < dp[i + 1]![j + 2]!) {
              dp[i + 1]![j + 2] = c12;
              back[i + 1]![j + 2] = { prevI: i, prevJ: j, op: '1:2' };
            }
          }
        }

        // 2:1 transition (2 ENG paragraphs glued into 1 RUS paragraph: split workingRus[j])
        if (i + 1 < N && j < M) {
          const e0 = engParas[i]!;
          const e1 = engParas[i + 1]!;
          const rGlued = workingRus[j]!;
          const hasInlineDlg =
            /^.+?[.!?…»]\s+—\s+[А-ЯЁ]/.test(rGlued) ||
            (!rGlued.startsWith('—') && /[а-яё],\s*—\s+[А-ЯЁ]/.test(rGlued));
          const isOverlong =
            rGlued.length >= (e0.length + e1.length) * 0.58 &&
            rGlued.length > Math.max(e0.length, e1.length) * 1.18;

          if (!isBox(e0) && !isBox(e1) && !isBox(rGlued) && (hasInlineDlg || isOverlong)) {
            const parts = trySplitGluedParagraph(rGlued, e1, e0);
            if (parts) {
              const c21 = cur + pairCost(e0, parts[0]) + pairCost(e1, parts[1]) + 1.5;
              if (c21 < dp[i + 2]![j + 1]!) {
                dp[i + 2]![j + 1] = c21;
                back[i + 2]![j + 1] = { prevI: i, prevJ: j, op: '2:1', splitParts: parts };
              }
            }
          }
        }
      }
    }

    if (Number.isFinite(dp[N]![M]!)) {
      const steps: Array<BackStep & { targetI: number }> = [];
      let ci = N;
      let cj = M;
      while (ci > 0 || cj > 0) {
        const st = back[ci]![cj];
        if (!st) break;
        steps.push({ ...st, targetI: st.prevI });
        ci = st.prevI;
        cj = st.prevJ;
      }
      if (ci === 0 && cj === 0) {
        steps.reverse();
        const reconstructed: string[] = [];
        const dtwFixes: string[] = [];
        const dtwIndices: number[] = [];
        for (const st of steps) {
          if (st.op === '1:1') {
            reconstructed.push(workingRus[st.prevJ]!);
          } else if (st.op === '1:2') {
            reconstructed.push(`${workingRus[st.prevJ]!} ${workingRus[st.prevJ + 1]!}`);
            dtwIndices.push(st.prevI);
            dtwFixes.push(
              `Stage 1 DTW Alignment: объединён разорванный абзац #p${st.prevI} (1:2 -> 1:1)`
            );
          } else if (st.op === '2:1' && st.splitParts) {
            reconstructed.push(st.splitParts[0], st.splitParts[1]);
            dtwIndices.push(st.prevI, st.prevI + 1);
            dtwFixes.push(
              `Stage 1 DTW Alignment: разделён склеенный абзац #p${st.prevI}..#p${st.prevI + 1} (2:1 -> 1:1)`
            );
          }
        }
        if (reconstructed.length === N && dtwFixes.length > 0) {
          workingRus = reconstructed;
          repairedIndices.push(...dtwIndices);
          appliedFixes.push(...dtwFixes);
        }
      }
    }
  }

  // Case A: +1/-1 compensatory split + glue within the same chapter (net diff == 0)
  if (workingRus.length === engParas.length && workingRus.length >= 4) {
    let splitIdx = -1;
    let glueIdx = -1;

    for (let i = 0; i < workingRus.length - 2; i++) {
      const eLen = engParas[i]!.length;
      const r0Len = workingRus[i]!.length;
      const r1Len = workingRus[i + 1]!.length;
      // Detect where a single ENG paragraph was split into workingRus[i] + workingRus[i+1]
      const isSplitHere =
        eLen >= 65 &&
        r0Len < eLen * 0.62 &&
        r1Len < eLen * 0.75 &&
        r0Len + r1Len >= eLen * 0.65 &&
        r0Len + r1Len <= eLen * 1.45;

      if (!isSplitHere) continue;

      // Look ahead for the compensating glued paragraph at m > i + 1
      for (let m = i + 2; m < workingRus.length; m++) {
        const ePrev = engParas[m - 1] || '';
        const eCurr = engParas[m] || '';
        const rGlued = workingRus[m]!;
        const hasInlineDlg =
          /^.+?[.!?…»]\s+—\s+[А-ЯЁ]/.test(rGlued) ||
          (!rGlued.startsWith('—') && /[а-яё],\s*—\s+[А-ЯЁ]/.test(rGlued));
        const isLongGlued =
          rGlued.length > (ePrev.length + eCurr.length) * 0.68 &&
          rGlued.length > Math.max(ePrev.length, eCurr.length) * 1.32 &&
          trySplitGluedParagraph(rGlued, eCurr) !== null;

        if (hasInlineDlg || isLongGlued) {
          splitIdx = i;
          glueIdx = m;
          break;
        }
      }
      if (splitIdx !== -1 && glueIdx !== -1) break;
    }

    if (splitIdx !== -1 && glueIdx !== -1) {
      const splitParts = trySplitGluedParagraph(workingRus[glueIdx]!, engParas[glueIdx] || '');
      if (splitParts) {
        // First split the glued paragraph at glueIdx (higher index), then merge splitIdx + splitIdx+1
        workingRus.splice(glueIdx, 1, splitParts[0], splitParts[1]);
        const merged = `${workingRus[splitIdx]} ${workingRus[splitIdx + 1]}`;
        workingRus.splice(splitIdx, 2, merged);
        repairedIndices.push(splitIdx, glueIdx);
        appliedFixes.push(
          `Stage 1 Alignment: устранён скрытый сдвиг абзацев (+1/-1) между #p${splitIdx} (склейка разорванного абзаца) и #p${glueIdx} (разделение сшитых абзацев)`
        );
      }
    }
  }

  // Case B: Pure glued paragraph (rusParas.length === engParas.length - 1)
  if (workingRus.length === engParas.length - 1) {
    for (let i = 0; i < workingRus.length; i++) {
      const rGlued = workingRus[i]!;
      const eCurr = engParas[i] || '';
      const eNext = engParas[i + 1] || '';
      const hasInlineDlg = /^.+?[.!?…»]\s+—\s+[А-ЯЁ]/.test(rGlued);
      const isOverlong =
        rGlued.length > eCurr.length * 1.45 &&
        rGlued.length >= (eCurr.length + eNext.length) * 0.65;
      if (hasInlineDlg || isOverlong) {
        const parts = trySplitGluedParagraph(rGlued, eNext);
        if (parts) {
          workingRus.splice(i, 1, parts[0], parts[1]);
          repairedIndices.push(i);
          appliedFixes.push(
            `Stage 1 Alignment: разделён склеенный абзац #p${i} для восстановления синхронизации 1:1 (${workingRus.length}/${engParas.length})`
          );
          break;
        }
      }
    }
  }

  // Case C: Pure split paragraph (rusParas.length === engParas.length + 1)
  if (workingRus.length === engParas.length + 1) {
    for (let i = 0; i < engParas.length; i++) {
      const eLen = engParas[i]!.length;
      const r0 = workingRus[i] || '';
      const r1 = workingRus[i + 1] || '';
      if (
        eLen >= 60 &&
        r0.length < eLen * 0.62 &&
        r0.length + r1.length >= eLen * 0.65 &&
        r0.length + r1.length <= eLen * 1.45
      ) {
        workingRus.splice(i, 2, `${r0} ${r1}`);
        repairedIndices.push(i);
        appliedFixes.push(
          `Stage 1 Alignment: объединён разорванный абзац #p${i} для восстановления синхронизации 1:1 (${workingRus.length}/${engParas.length})`
        );
        break;
      }
    }
  }

  if (appliedFixes.length === 0) {
    return { repairedRusText: rusText, appliedFixes: [], repairedIndices: [] };
  }

  return {
    repairedRusText: joinParagraphsPreservingSystemBoxes(workingRus),
    appliedFixes,
    repairedIndices,
  };
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
  let rusText = (input.candidateRusText || '')
    .replace(/^\s*\[(?:[a-z0-9]{2,4}\|)?#p\d+\]\s*/gim, '')
    .trim();
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

  // 2. Stage 1 Structural Split/Glue & Surgical Paragraph Drift Repair (1:1 alignment check & restoration)
  if (input.runSurgicalDriftRepair !== false && input.engText.trim() && rusText) {
    const splitGlue = repairSplitAndGluedParagraphs(input.engText, rusText);
    if (splitGlue.appliedFixes.length > 0) {
      rusText = splitGlue.repairedRusText;
      for (const idx of splitGlue.repairedIndices) {
        surgicallyFixedSet.add(idx);
      }
      appliedFixes.push(...splitGlue.appliedFixes);
    }

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

  // 3. Deterministic Auto-Repair (all active rules + gender + anti-calque + punctuation + negation polarity)
  if (rusText) {
    const auto = autoRepairRussianText(rusText, {
      glossary: input.glossary,
      glossaryMeta: input.glossaryMeta,
      enabledRuleIds: input.enabledRuleIds,
    });
    rusText = normalizeRussianBookLayout(auto.repairedText);
    appliedFixes.push(...auto.appliedFixes);

    if (input.engText.trim()) {
      const negRepair = repairNegationPolarityWithSource(input.engText, rusText);
      if (negRepair.appliedFixes.length > 0) {
        rusText = normalizeRussianBookLayout(negRepair.repairedRusText);
        for (const idx of negRepair.repairedIndices) {
          surgicallyFixedSet.add(idx);
        }
        appliedFixes.push(...negRepair.appliedFixes);
      }
    }
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

  // 7. DITING 6-Dimension Quality Report & 11-Metric Prose Quality Gate
  const ditingReport = evaluateDitingQuality(
    input.engText,
    rusText,
    input.glossary,
    input.glossaryMeta,
    input.enabledRuleIds
  );
  const proseGateReport = verifyProseQualityGate(input.engText, rusText, input.glossary, {
    glossaryMeta: input.glossaryMeta,
    enabledRuleIds: input.enabledRuleIds,
    thresholds: input.gateThresholds,
    neuralStats: input.neuralStats,
  });

  // Also include any remaining nominalization hotspot or negation polarity mismatch paragraphs in flawedParagraphIndices
  for (const hotIdx of proseGateReport.stylometry.nominalizationHotspotParagraphs) {
    if (!flawedParagraphIndices.includes(hotIdx)) {
      flawedParagraphIndices.push(hotIdx);
    }
  }
  for (const negIdx of proseGateReport.stylometry.negationPolarityMismatchParagraphs) {
    if (!flawedParagraphIndices.includes(negIdx)) {
      flawedParagraphIndices.push(negIdx);
    }
  }
  flawedParagraphIndices.sort((a, b) => a - b);

  // 8. Bilingual Chapter Summary
  const titleRus =
    normalizeRussianChapterTitle((input.titleRus || '').trim()) || `Глава ${input.chapterNumber}`;
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
    proseGateReport,
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
    const newNums = extractNormalizedRussianNumbers(content);
    const numbersPreserved = origNums.every((num) => newNums.has(num));

    if (!numbersPreserved) {
      droppedDueToNumbers.push(idx);
      continue;
    }

    paragraphs[idx] = content;
    repairedIndices.push(idx);
  }

  const mergedText = joinParagraphsPreservingSystemBoxes(paragraphs);

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
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean);

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
    const styledNums = extractNormalizedRussianNumbers(yE);
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
    finalRusText: joinParagraphsPreservingSystemBoxes(paragraphs),
    acceptedParagraphIndices,
    rolledBackParagraphs,
  };
}

export interface ScorecardDeltaRow {
  id: string;
  label: string;
  before: number;
  after: number;
  expected: string;
  passedBefore: boolean;
  passedAfter: boolean;
}

export interface UnifiedVerificationAndRepairResult extends ChapterVerificationOutput {
  beforeGateReport: ProseQualityGateReport;
  afterGateReport: ProseQualityGateReport;
  beforeNeuralAudit?: ChapterNeuralAuditResult;
  afterNeuralAudit?: ChapterNeuralAuditResult;
  scorecard: ScorecardDeltaRow[];
  llmRepairRoundsUsed: number;
}

/**
 * Asynchronous 3-Stage Verification & Self-Repair Orchestrator:
 * - Evaluates baseline (Before) Prose Quality Gate + Neural Cosine Audit (`google/embeddinggemma-2` or cloud fallback)
 * - Runs Stage 1 (Structural +1/-1 Split/Glue Alignment) & Stage 2 (Deterministic Gender, Canon & Nora Gal Anti-Bureaucracy)
 * - Runs Stage 3 (Optional Targeted LLM Self-Repair with monotonic rollback guard, up to `maxLlmRepairRounds = 2`)
 * - Evaluates final (After) Prose Quality Gate + Neural Cosine Audit and builds a `Before -> After` scorecard.
 */
export async function verifyAndRepairChapterAsync(
  input: ChapterVerificationInput,
  options?: {
    enableNeuralAudit?: boolean; // default: true
    neuralThreshold?: number; // default: 0.65
    customNeuralEvaluator?: (
      chapterNumber: number,
      engParagraphs: string[],
      rusParagraphs: string[],
      threshold: number
    ) => Promise<ChapterNeuralAuditResult>;
    llmParagraphRepairFn?: (payload: {
      flawedIndices: number[];
      promptBlock: string;
    }) => Promise<string>;
    maxLlmRepairRounds?: number; // default: 2
  }
): Promise<UnifiedVerificationAndRepairResult> {
  const enableNeural = options?.enableNeuralAudit !== false;
  const threshold = options?.neuralThreshold ?? 0.65;
  const maxRounds = options?.maxLlmRepairRounds ?? 2;

  const evaluateNeural = async (rusCandidate: string): Promise<ChapterNeuralAuditResult | undefined> => {
    if (!enableNeural) return undefined;
    const engParas = input.engText
      .split(/\r?\n\s*\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    const rusParas = rusCandidate
      .split(/\r?\n\s*\r?\n/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (options?.customNeuralEvaluator) {
      return options.customNeuralEvaluator(input.chapterNumber, engParas, rusParas, threshold);
    }
    return getLocalEmbedBridgeClient().auditChapterParagraphs(
      input.chapterNumber,
      engParas,
      rusParas,
      threshold
    );
  };

  // 0. Measure raw candidate BEFORE any repair
  const rawCandidate = (input.candidateRusText || '').trim();
  const beforeNeuralAudit = await evaluateNeural(rawCandidate);
  const beforeGateReport = verifyProseQualityGate(input.engText, rawCandidate, input.glossary, {
    glossaryMeta: input.glossaryMeta,
    enabledRuleIds: input.enabledRuleIds,
    thresholds: input.gateThresholds,
    neuralStats: beforeNeuralAudit
      ? { meanCosine: beforeNeuralAudit.meanCosine, minCosine: beforeNeuralAudit.minCosine }
      : input.neuralStats,
  });

  // 1. Run Stage 1 (Structural +1/-1 Split/Glue Alignment) + Stage 2 (Deterministic Gender, Canon & Nora Gal Anti-Bureaucracy)
  let currentVerif = finalizeAndVerifyChapter(input);
  let afterNeuralAudit = await evaluateNeural(currentVerif.rusText);
  let afterGateReport = verifyProseQualityGate(
    input.engText,
    currentVerif.rusText,
    input.glossary,
    {
      glossaryMeta: input.glossaryMeta,
      enabledRuleIds: input.enabledRuleIds,
      thresholds: input.gateThresholds,
      neuralStats: afterNeuralAudit
        ? { meanCosine: afterNeuralAudit.meanCosine, minCosine: afterNeuralAudit.minCosine }
        : input.neuralStats,
    }
  );

  // Merge low-cosine neural indices into flawedParagraphIndices
  const collectTargetFlawedIndices = (
    verif: ChapterVerificationOutput,
    gate: ProseQualityGateReport,
    neural?: ChapterNeuralAuditResult
  ): number[] => {
    const s = new Set<number>(verif.flawedParagraphIndices);
    for (const h of gate.stylometry.nominalizationHotspotParagraphs) s.add(h);
    for (const neg of gate.stylometry.negationPolarityMismatchParagraphs) s.add(neg);
    if (neural) {
      for (const lp of neural.lowPairs) {
        if (lp.index >= 1) s.add(lp.index - 1);
      }
    }
    return Array.from(s).sort((a, b) => a - b);
  };

  // 2. Stage 3: Targeted LLM Self-Repair (if still needed and llmParagraphRepairFn is provided)
  let llmRepairRoundsUsed = 0;
  if (!afterGateReport.passed && options?.llmParagraphRepairFn && maxRounds > 0) {
    for (let round = 1; round <= maxRounds; round++) {
      const targetIndices = collectTargetFlawedIndices(
        currentVerif,
        afterGateReport,
        afterNeuralAudit
      );
      if (targetIndices.length === 0) break;

      const engParas = input.engText
        .split(/\r?\n\s*\r?\n/)
        .map((p) => p.trim())
        .filter(Boolean);
      const rusParas = currentVerif.rusText
        .split(/\r?\n\s*\r?\n/)
        .map((p) => p.trim())
        .filter(Boolean);

      const promptBlock = targetIndices
        .filter((idx) => idx >= 0 && idx < engParas.length && idx < rusParas.length)
        .map((idx) => {
          const hash = computeParagraphHashAnchor(engParas[idx]!, idx);
          return `[#p${idx}] [${hash}|#p${idx}]\nENG: ${engParas[idx]}\nRUS: ${rusParas[idx]}\n[DRAFT_PASS1_FOR_SUFFIX_LOOKUP]: ${rusParas[idx]}`;
        })
        .join('\n\n');
      if (!promptBlock) break;

      llmRepairRoundsUsed++;
      const llmReply = await options.llmParagraphRepairFn({
        flawedIndices: targetIndices,
        promptBlock,
      });

      const merged = mergeRepairedParagraphsByIndex(
        currentVerif.rusText,
        llmReply,
        input.engText
      );
      if (merged.repairedIndices.length === 0) break;

      const nextVerif = finalizeAndVerifyChapter({
        ...input,
        candidateRusText: merged.mergedText,
      });
      const nextNeural = await evaluateNeural(nextVerif.rusText);
      const nextGate = verifyProseQualityGate(input.engText, nextVerif.rusText, input.glossary, {
        glossaryMeta: input.glossaryMeta,
        enabledRuleIds: input.enabledRuleIds,
        thresholds: input.gateThresholds,
        neuralStats: nextNeural
          ? { meanCosine: nextNeural.meanCosine, minCosine: nextNeural.minCosine }
          : input.neuralStats,
      });

      // Monotonic progress guard: accept only if failedChecks decreased or overallScore improved
      if (
        nextGate.failedChecks.length < afterGateReport.failedChecks.length ||
        nextGate.overallScore > afterGateReport.overallScore
      ) {
        currentVerif = {
          ...nextVerif,
          appliedFixes: [
            ...currentVerif.appliedFixes,
            `Stage 3 LLM Self-Repair (раунд ${round}): точечно исправлено ${merged.repairedIndices.length} абз.`,
          ],
        };
        afterNeuralAudit = nextNeural;
        afterGateReport = nextGate;
        if (afterGateReport.passed) break;
      } else {
        break;
      }
    }
  }

  const finalFlawed = collectTargetFlawedIndices(currentVerif, afterGateReport, afterNeuralAudit);
  const scorecard: ScorecardDeltaRow[] = afterGateReport.checks.map((afterCheck) => {
    const beforeCheck =
      beforeGateReport.checks.find((c) => c.id === afterCheck.id) || afterCheck;
    return {
      id: afterCheck.id,
      label: afterCheck.label,
      before: beforeCheck.observed,
      after: afterCheck.observed,
      expected: afterCheck.expected,
      passedBefore: beforeCheck.passed,
      passedAfter: afterCheck.passed,
    };
  });

  return {
    ...currentVerif,
    flawedParagraphIndices: finalFlawed,
    proseGateReport: afterGateReport,
    neuralAudit: afterNeuralAudit,
    verified: currentVerif.verified && afterGateReport.passed,
    beforeGateReport,
    afterGateReport,
    beforeNeuralAudit,
    afterNeuralAudit,
    scorecard,
    llmRepairRoundsUsed,
  };
}
