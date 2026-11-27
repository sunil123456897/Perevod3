import {
  runQaLinter,
  createChapterAnalysisContext,
  filterGlossaryForChapter,
  autoRepairRussianText,
  surgicalRepairDriftedParagraphs,
  alignChapterParagraphs,
  splitChapterParagraphs,
  applySurgicalPatches,
  detectTranslationDegenerationAndDuplicates,
  extractNormalizedRussianNumbers,
  joinParagraphsPreservingSystemBoxes,
  normalizeRussianBookLayout,
  normalizeRussianChapterTitle,
  computeParagraphHashAnchor,
  type ChapterAnalysisContext,
  type SurgicalPatchItem,
  type LinterOptions,
} from './qa-linter.ts';
import {
  repairNegationPolarityWithSource,
  extractCsiCulturalNotes,
  evaluateDitingQuality,
  verifyProseQualityGate,
  generateBilingualChapterSummary,
  computeStylometricMetrics,
  type ProseQualityGateReport,
  type ProseQualityGateThresholds,
} from './delta-diting.ts';
import type {
  CanonicalGlossary,
  GlossaryTermMeta,
  LintRuleId,
  LintReport,
  CsiCulturalNote,
  DitingQualityReport,
  ChapterNeuralAuditResult,
} from './pipeline-types.ts';

export { computeParagraphHashAnchor };
export type { ChapterNeuralAuditResult };

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
  const engParas = splitChapterParagraphs(engText);
  const rusParas = splitChapterParagraphs(rusText);

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
      .split(/(?<=[.!?…»])\s+(?=[А-ЯЁ«]|—\s+[А-ЯЁ«])/)
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

  /** Split a 3-way glued Russian paragraph proportionally across three consecutive English paragraphs. */
  const trySplitGluedIntoThree = (
    p: string,
    e0: string,
    e1: string,
    e2: string
  ): [string, string, string] | null => {
    const first = trySplitGluedParagraph(p, `${e1} ${e2}`, e0);
    if (first && first[0] && first[1]) {
      const second = trySplitGluedParagraph(first[1], e2, e1);
      if (second && second[0] && second[1]) {
        return [first[0], second[0], second[1]];
      }
    }
    const sentences = p
      .split(/(?<=[.!?…»])\s+(?=[А-ЯЁ«]|—\s+[А-ЯЁ«])/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sentences.length < 3) return null;

    const totalEng = Math.max(1, e0.length + e1.length + e2.length);
    const t0 = e0.length / totalEng;
    const t1 = e1.length / totalEng;
    const totalLen = Math.max(1, p.length);
    let bestPair: [number, number] | null = null;
    let bestErr = Infinity;
    for (let k1 = 1; k1 < sentences.length - 1; k1++) {
      const l0 = sentences.slice(0, k1).join(' ').length / totalLen;
      for (let k2 = k1 + 1; k2 < sentences.length; k2++) {
        const l1 = sentences.slice(k1, k2).join(' ').length / totalLen;
        const err = Math.abs(l0 - t0) + Math.abs(l1 - t1);
        if (err < bestErr) {
          bestErr = err;
          bestPair = [k1, k2];
        }
      }
    }
    if (!bestPair) return null;
    const [k1, k2] = bestPair;
    return [
      sentences.slice(0, k1).join(' '),
      sentences.slice(k1, k2).join(' '),
      sentences.slice(k2).join(' '),
    ];
  };

  let workingRus = [...rusParas];

  // Case D: Banded Wagner-Fischer / Gale-Church Dynamic Time Warping (DTW) for unequal paragraph counts (|N - M| >= 1)
  const countDiff = Math.abs(workingRus.length - engParas.length);
  if (countDiff >= 1 && engParas.length >= 2 && workingRus.length >= 2) {
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
      op: '1:1' | '1:2' | '2:1' | '1:3' | '3:1';
      splitParts?: string[];
    };

    const dp: number[][] = Array.from({ length: N + 1 }, () =>
      Array(M + 1).fill(Number.POSITIVE_INFINITY)
    );
    const back: Array<Array<BackStep | null>> = Array.from({ length: N + 1 }, () =>
      Array(M + 1).fill(null)
    );
    dp[0]![0] = 0;

    // Sakoe-Chiba band without artificial |N - M| <= 10 cutoff (supports diff = 15..25+)
    const band = Math.max(16, countDiff + 12);
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

        // 1:3 transition (1 ENG paragraph split into 3 consecutive RUS fragments)
        if (i < N && j + 2 < M) {
          const e = engParas[i]!;
          const r0 = workingRus[j]!;
          const r1 = workingRus[j + 1]!;
          const r2 = workingRus[j + 2]!;
          const combLen = r0.length + r1.length + r2.length + 2;
          if (
            !isBox(e) &&
            !isBox(r0) &&
            !isBox(r1) &&
            !isBox(r2) &&
            e.length >= 65 &&
            r0.length < e.length * 0.65 &&
            r1.length < e.length * 0.65 &&
            r2.length < e.length * 0.65 &&
            combLen >= e.length * 0.55 &&
            combLen <= e.length * 1.65
          ) {
            const c13 = cur + pairCost(e, `${r0} ${r1} ${r2}`) + 2.6;
            if (c13 < dp[i + 1]![j + 3]!) {
              dp[i + 1]![j + 3] = c13;
              back[i + 1]![j + 3] = { prevI: i, prevJ: j, op: '1:3' };
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

        // 3:1 transition (3 ENG paragraphs glued into 1 RUS paragraph: split workingRus[j] into 3)
        if (i + 2 < N && j < M) {
          const e0 = engParas[i]!;
          const e1 = engParas[i + 1]!;
          const e2 = engParas[i + 2]!;
          const rGlued = workingRus[j]!;
          const inlineDlgMatches = rGlued.match(/[.!?…»]\s+—\s+[А-ЯЁ]/g)?.length || 0;
          const isOverlong3 =
            rGlued.length >= (e0.length + e1.length + e2.length) * 0.52 &&
            rGlued.length > Math.max(e0.length, e1.length, e2.length) * 1.35;

          if (
            !isBox(e0) &&
            !isBox(e1) &&
            !isBox(e2) &&
            !isBox(rGlued) &&
            (inlineDlgMatches >= 2 || isOverlong3)
          ) {
            const parts = trySplitGluedIntoThree(rGlued, e0, e1, e2);
            if (parts) {
              const c31 =
                cur +
                pairCost(e0, parts[0]) +
                pairCost(e1, parts[1]) +
                pairCost(e2, parts[2]) +
                2.6;
              if (c31 < dp[i + 3]![j + 1]!) {
                dp[i + 3]![j + 1] = c31;
                back[i + 3]![j + 1] = { prevI: i, prevJ: j, op: '3:1', splitParts: parts };
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
          } else if (st.op === '1:3') {
            reconstructed.push(
              `${workingRus[st.prevJ]!} ${workingRus[st.prevJ + 1]!} ${workingRus[st.prevJ + 2]!}`
            );
            dtwIndices.push(st.prevI);
            dtwFixes.push(
              `Stage 1 DTW Alignment: объединён разорванный абзац #p${st.prevI} (1:3 -> 1:1)`
            );
          } else if ((st.op === '2:1' || st.op === '3:1') && st.splitParts) {
            reconstructed.push(...st.splitParts);
            for (let k = 0; k < st.splitParts.length; k++) {
              dtwIndices.push(st.prevI + k);
            }
            dtwFixes.push(
              `Stage 1 DTW Alignment: разделён склеенный абзац #p${st.prevI}..#p${st.prevI + st.splitParts.length - 1} (${st.splitParts.length}:1 -> 1:1)`
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

export function countParagraphInternalDashes(paragraph: string): {
  counted: number;
  words: number;
} {
  const trimmed = paragraph.trim();
  const withoutLeadDash = trimmed.replace(/^—\s+/, '');
  const matches = withoutLeadDash.match(/\s[—–]\s/g) || [];
  const isDialogue = /^—\s+/.test(trimmed);
  const counted = isDialogue ? Math.max(0, matches.length - 1) : matches.length;
  const words = (trimmed.match(/[а-яё]+(?:-[а-яё]+)*/gi) || []).filter(
    (w) => w.length >= 2
  ).length;
  return { counted, words };
}

/**
 * Deterministic chapter-level budget relaxation for excess intra-paragraph AI em-dashes.
 * Preserves system boxes, leading dialogue dashes (`— ...`), and attribution/resumption
 * dashes following `[,!?….»:;—–]`, converting only excess authorial medial dashes into
 * commas, spaces (around `это`/`вот` and linking verbs), or sentence breaks.
 */
export function relaxChapterExcessInternalDashes(
  rusText: string,
  engText = '',
  maxInternalDash = 2.0
): {
  repairedRusText: string;
  relaxedCount: number;
  touchedParagraphs: number[];
} {
  const stylo = computeStylometricMetrics(rusText, engText);
  if (stylo.wordCount === 0 || stylo.internalDashPer100Words <= maxInternalDash) {
    return { repairedRusText: rusText, relaxedCount: 0, touchedParagraphs: [] };
  }

  const paragraphs = splitChapterParagraphs(rusText);
  if (paragraphs.length === 0) {
    return { repairedRusText: rusText, relaxedCount: 0, touchedParagraphs: [] };
  }

  let inBox = false;
  const meta = paragraphs.map((p, idx) => {
    const trimmed = p.trim();
    let isBox = false;
    if (trimmed === '---') {
      inBox = !inBox;
      isBox = true;
    } else if (inBox || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      isBox = true;
    }
    const { counted, words } = countParagraphInternalDashes(p);
    return { idx, isBox, counted, words };
  });

  const totalCounted = meta.reduce((sum, m) => sum + m.counted, 0);
  const targetMaxDashes = Math.max(
    0,
    Math.floor((Math.max(0.05, maxInternalDash - 0.12) * stylo.wordCount) / 100)
  );
  let needed = totalCounted - targetMaxDashes;
  if (needed <= 0) {
    return { repairedRusText: rusText, relaxedCount: 0, touchedParagraphs: [] };
  }

  const touchedSet = new Set<number>();
  let relaxedCount = 0;

  const runTier = (tier: 1 | 2): void => {
    while (needed > 0) {
      let changedInRound = false;
      const candidates = meta
        .filter((m) => !m.isBox && m.counted >= 1)
        .sort((a, b) => b.counted / Math.max(1, b.words) - a.counted / Math.max(1, a.words));

      for (const item of candidates) {
        if (needed <= 0) break;
        const p = paragraphs[item.idx]!;
        let nextP = p;

        if (tier === 1) {
          const match = /([а-яёa-z0-9)])\s+[—–]\s+([а-яё])/.exec(p);
          if (match) {
            const leftChar = match[1]!;
            const rightChar = match[2]!;
            const prefix = p.slice(0, match.index + leftChar.length);
            const suffix = p.slice(match.index + match[0].length - rightChar.length);
            const keepSpace =
              /(?<![а-яёА-ЯЁ])(?:это|вот)$/i.test(prefix) ||
              /^(?:не\s+)?(?:был[аои]?|будет|будут|ста(?:л[аои]?|нет|нут)|явля(?:ется|ются|лся|лась)|казал(?:ся|ась|ось|ись)|оказал(?:ся|ась|ось|ись))(?![а-яё])/i.test(
                suffix
              );
            nextP =
              p.slice(0, match.index) +
              (keepSpace ? `${leftChar} ${rightChar}` : `${leftChar}, ${rightChar}`) +
              p.slice(match.index + match[0].length);
          }
        } else {
          const match = /([а-яё]{2,}|[0-9)])\s+[—–]\s+([А-ЯЁ])/.exec(p);
          if (match) {
            const leftPart = match[1]!;
            const rightChar = match[2]!;
            const prefix = p.slice(0, match.index + leftPart.length);
            const sep = /(?<![а-яёА-ЯЁ])(?:это|вот)$/i.test(prefix) ? ' ' : '. ';
            nextP =
              p.slice(0, match.index) +
              `${leftPart}${sep}${rightChar}` +
              p.slice(match.index + match[0].length);
          }
        }

        if (nextP !== p) {
          paragraphs[item.idx] = nextP;
          const updated = countParagraphInternalDashes(nextP);
          const drop = Math.max(0, item.counted - updated.counted);
          item.counted = updated.counted;
          item.words = updated.words;
          if (drop > 0) {
            needed -= drop;
            relaxedCount += drop;
          }
          touchedSet.add(item.idx);
          changedInRound = true;
        }
      }

      if (!changedInRound) break;
    }
  };

  runTier(1);
  if (needed > 0) {
    runTier(2);
  }

  if (relaxedCount === 0) {
    return { repairedRusText: rusText, relaxedCount: 0, touchedParagraphs: [] };
  }

  return {
    repairedRusText: normalizeRussianBookLayout(joinParagraphsPreservingSystemBoxes(paragraphs)),
    relaxedCount,
    touchedParagraphs: Array.from(touchedSet).sort((a, b) => a - b),
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

    const dashRuleActive =
      !input.enabledRuleIds || input.enabledRuleIds.includes('DASH_AND_COMMA_INFLATION');
    if (dashRuleActive) {
      const maxDashCap = input.gateThresholds?.maxInternalDashPer100Words ?? 2.0;
      const dashRepair = relaxChapterExcessInternalDashes(rusText, input.engText, maxDashCap);
      if (dashRepair.relaxedCount > 0) {
        rusText = dashRepair.repairedRusText;
        for (const idx of dashRepair.touchedParagraphs) {
          surgicallyFixedSet.add(idx);
        }
        appliedFixes.push(
          `Бюджет тире главы: снято ${dashRepair.relaxedCount} избыточных внутриабзацных ИИ-тире для соблюдения лимита <= ${maxDashCap}%`
        );
      }
    }
  }

  // 4. QA Linter (single-pass ChapterAnalysisContext reuse)
  const analysisCtx: ChapterAnalysisContext = createChapterAnalysisContext(
    input.engText,
    rusText,
    input.glossary,
    {
      enabledRuleIds: input.enabledRuleIds,
      glossaryMeta: input.glossaryMeta,
    }
  );
  const lintReport = runQaLinter(input.engText, rusText, input.glossary, {
    enabledRuleIds: input.enabledRuleIds,
    glossaryMeta: input.glossaryMeta,
    analysisContext: analysisCtx,
  });

  // 5. Flawed Paragraph Indexing (0-based)
  const alignment = analysisCtx.alignment;
  const flawedSet = new Set<number>();
  for (const pair of alignment.pairs) {
    if (pair.isDrifted || pair.missingNumbers.length > 0) {
      flawedSet.add(pair.index);
      continue;
    }
    if (pair.engParagraph.trim() && pair.rusParagraph.trim()) {
      const pLint = runQaLinter(pair.engParagraph, pair.rusParagraph, analysisCtx.filteredGlossary, {
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

  const cleanLlmParagraphContent = (raw: string): string => {
    let text = raw
      .replace(/^\s*```[^\n]*\s*$/gm, '')
      .replace(/^\[(?:[a-z0-9]{3}\|)?#p\d+\]\s*/i, '')
      .replace(/^ENG:[\s\S]*?\n(?:RUS|REPAIRED|ПЕРЕВОД|ИСПРАВЛЕНО):\s*/i, '')
      .replace(/^\[DRAFT_PASS1_FOR_SUFFIX_LOOKUP\]:\s*[\s\S]*?\n/i, '')
      .replace(/\n(?:MISSING_NUMBERS|QA_ERRORS):[\s\S]*$/i, '')
      .replace(/\[DRAFT_PASS1_FOR_SUFFIX_LOOKUP\]:.*$/im, '');

    const keptLines: string[] = [];
    let skippingGlossaryBlock = false;
    for (const rawLine of text.split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^```/.test(line)) continue;
      if (/^(?:[#>*\-\s]*)?(?:SPECULATIVE\s+SUFFIX\s+DECODING|LAYER\s*0\b)/i.test(line)) {
        skippingGlossaryBlock = false;
        continue;
      }
      if (/^\[GLOSSARY(?:_SLICE|_GUARD|\b)[^\]]*\]?:?/i.test(line)) {
        skippingGlossaryBlock = true;
        continue;
      }
      if (skippingGlossaryBlock) {
        if (/^(?:[-•*]\s*)?[^:\n]{1,80}\s*(?:->|=>|→|=)\s*[^\n]+$/.test(line)) {
          continue;
        }
        skippingGlossaryBlock = false;
      }
      if (/^(?:CONTEXT_PREV|CONTEXT_NEXT|ENG|CANON_CONTEXT|MISSING_NUMBERS|QA_ERRORS)\s*:/i.test(line)) {
        continue;
      }
      if (
        /^(?:Вот исправленн[а-яё]+(?:\s+[а-яё]+){0,3}|Исправленн(?:ый|ая|ое|ые)\s+(?:вариант|перевод|текст|абзац(?:ы)?)|Конечно[,!.]?(?:\s+вот[^\n:]*)?|Here is the (?:repaired|fixed|corrected)[^\n:]*)\s*:?\s*$/i.test(
          line
        )
      ) {
        continue;
      }
      keptLines.push(line);
    }

    return keptLines
      .join(' ')
      .replace(/^(?:\[(?:[a-z0-9]{3}\|)?#p\d+\]\s*)+/i, '')
      .replace(/^(?:RUS|REPAIRED|ПЕРЕВОД|ИСПРАВЛЕНО|Исправленный вариант)\s*:\s*/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  };

  // Strip markdown code-fence wrappers before scanning paragraph anchors
  const sanitizedBlock = repairedBlock.replace(/^\s*```[^\n]*\s*$/gm, '');

  // Matches [a7f|#p0], [#p0], [#p0] [a7f|#p0], or [a7f|#p0] [#p0]
  const regex =
    /\[(?:([a-z0-9]{3})\|)?#p(\d+)\](?:\s*\[(?:([a-z0-9]{3})\|)?#p\d+\])?\s*([\s\S]*?)(?=(?:\[(?:[a-z0-9]{3}\|)?#p\d+\])|$)/gi;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(sanitizedBlock)) !== null) {
    const anchorHash = match[1] || match[3];
    const idx = parseInt(match[2], 10);
    const content = cleanLlmParagraphContent(match[4]);

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
