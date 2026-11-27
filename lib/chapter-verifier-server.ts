import {
  filterGlossaryForChapter,
  splitChapterParagraphs,
} from './qa-linter.ts';
import {
  verifyProseQualityGate,
  type ProseQualityGateReport,
} from './delta-diting.ts';
import {
  computeParagraphHashAnchor,
  countParagraphInternalDashes,
  finalizeAndVerifyChapter,
  mergeRepairedParagraphsByIndex,
  verifyAndRollbackStylistPass,
  type ChapterVerificationInput,
  type ChapterVerificationOutput,
} from './chapter-verifier.ts';
import {
  getLocalEmbedBridgeClient,
  shutdownLocalEmbedBridgeClient,
  type ChapterNeuralAuditResult,
} from './local-embed-client.ts';

export {
  getLocalEmbedBridgeClient,
  shutdownLocalEmbedBridgeClient,
  finalizeAndVerifyChapter,
  verifyAndRollbackStylistPass,
  type ChapterNeuralAuditResult,
  type ChapterVerificationInput,
  type ChapterVerificationOutput,
};

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
    const engParas = splitChapterParagraphs(input.engText);
    const rusParas = splitChapterParagraphs(rusCandidate);
    if (options?.customNeuralEvaluator) {
      return options.customNeuralEvaluator(input.chapterNumber, engParas, rusParas, threshold);
    }
    try {
      return await getLocalEmbedBridgeClient().auditChapterParagraphs(
        input.chapterNumber,
        engParas,
        rusParas,
        threshold
      );
    } catch {
      // Degrade gracefully to Stage 1+2 deterministic QA when local GPU bridge and cloud embedding keys are unavailable
      return undefined;
    }
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

  const isStrictVerificationImprovement = (
    curVerif: ChapterVerificationOutput,
    curGate: ProseQualityGateReport,
    nextVerif: ChapterVerificationOutput,
    nextGate: ProseQualityGateReport
  ): boolean => {
    const curErrors = curVerif.lintReport.errorCount;
    const nextErrors = nextVerif.lintReport.errorCount;
    if (nextErrors > curErrors) return false;
    if (nextErrors < curErrors) return true;

    const curFailed = curGate.failedChecks.length;
    const nextFailed = nextGate.failedChecks.length;
    if (nextFailed > curFailed) return false;
    if (nextFailed < curFailed) return true;

    const curWarnings = curVerif.lintReport.warningCount;
    const nextWarnings = nextVerif.lintReport.warningCount;
    if (nextWarnings < curWarnings) return true;
    if (nextWarnings > curWarnings) return false;

    return nextGate.overallScore > curGate.overallScore;
  };

  const formatGlossarySliceBlock = (engSubsetText: string): string => {
    const { filteredGlossary } = filterGlossaryForChapter(engSubsetText, input.glossary);
    const lines: string[] = [];
    for (const catMap of Object.values(filteredGlossary)) {
      for (const [eng, rus] of Object.entries(catMap)) {
        lines.push(`${eng} -> ${rus}`);
      }
    }
    return lines.length > 0 ? `[GLOSSARY_SLICE]\n${lines.join('\n')}` : '';
  };

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
      const neuralMeanFailed = gate.failedChecks.some((c) => c.id === 'NEURAL_MEAN_COSINE');
      if (neuralMeanFailed && neural.lowPairs.length === 0) {
        if (Array.isArray(neural.pairCosines) && neural.pairCosines.length > 0) {
          const worstLow = neural.pairCosines
            .filter((pc) => pc.cosine < 0.82 && pc.index >= 0)
            .sort((a, b) => a.cosine - b.cosine)
            .slice(0, 3);
          for (const pc of worstLow) {
            s.add(pc.index);
          }
        } else {
          // Fallback when caller's customNeuralEvaluator did not attach pairCosines
          const engP = splitChapterParagraphs(input.engText);
          const rusP = splitChapterParagraphs(verif.rusText);
          const pairCount = Math.min(engP.length, rusP.length);
          const scored: Array<{ idx: number; divergence: number }> = [];
          for (let i = 0; i < pairCount; i++) {
            const eLen = Math.max(1, engP[i]!.length);
            const rLen = rusP[i]!.length;
            const ratioDiff = Math.abs(rLen - eLen * 0.85) / Math.max(20, eLen);
            scored.push({ idx: i, divergence: ratioDiff });
          }
          scored.sort((a, b) => b.divergence - a.divergence);
          for (const item of scored.slice(0, 3)) {
            if (item.divergence > 0) s.add(item.idx);
          }
        }
      }
    }
    if (gate.failedChecks.some((c) => c.id === 'INTERNAL_DASH_CAP')) {
      const rusP = splitChapterParagraphs(verif.rusText);
      const dashHotspots = rusP
        .map((p, idx) => ({ idx, counted: countParagraphInternalDashes(p).counted }))
        .filter((x) => x.counted >= 2)
        .sort((a, b) => b.counted - a.counted)
        .slice(0, 3);
      for (const item of dashHotspots) {
        s.add(item.idx);
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

      const engParas = splitChapterParagraphs(input.engText);
      const rusParas = splitChapterParagraphs(currentVerif.rusText);
      const validTargets = targetIndices.filter(
        (idx) => idx >= 0 && idx < engParas.length && idx < rusParas.length
      );
      if (validTargets.length === 0) break;

      const glossarySlice = formatGlossarySliceBlock(
        validTargets.map((idx) => engParas[idx]!).join('\n')
      );
      const paraBlocks = validTargets
        .map((idx) => {
          const hash = computeParagraphHashAnchor(engParas[idx]!, idx);
          const lines = [`[#p${idx}] [${hash}|#p${idx}]`];
          if (idx > 0 && rusParas[idx - 1]) {
            lines.push(`CONTEXT_PREV: ${rusParas[idx - 1]}`);
          }
          lines.push(`ENG: ${engParas[idx]}`);
          lines.push(`RUS: ${rusParas[idx]}`);
          if (idx + 1 < rusParas.length && rusParas[idx + 1]) {
            lines.push(`CONTEXT_NEXT: ${rusParas[idx + 1]}`);
          }
          return lines.join('\n');
        })
        .join('\n\n');
      const promptBlock = glossarySlice ? `${glossarySlice}\n\n${paraBlocks}` : paraBlocks;
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

      // Strict lexicographical rollback guard: nextErrors > curErrors rejects and rolls back immediately
      if (isStrictVerificationImprovement(currentVerif, afterGateReport, nextVerif, nextGate)) {
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
