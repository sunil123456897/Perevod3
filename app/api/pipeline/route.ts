import { NextRequest, NextResponse } from 'next/server';
import {
  finalizeAndVerifyChapter,
  extractFlawedParagraphsPayload,
  mergeRepairedParagraphsByIndex,
  filterGlossaryForChapter,
  runAdditionBySubtractionScout,
  extractResilientJsonFromLlm,
  alignChapterParagraphs,
  createPipelineLlmPort,
  pingColabServer,
  buildScoutPrompts,
  buildTranslatePass1Prompts,
  buildSurgicalCriticPass2Prompts,
  buildBlindStylistPass3Prompts,
  verifyAndRollbackStylistPass,
  applySurgicalPatches,
  parseRubyAndGikunMarkup,
  classifyScenePacingMode,
  selectContrastiveFewShotTriplets,
  buildCharacterVoicePromptBlock,
  capStylisticDirectivesPerParagraph,
  buildSelfRepairPrompts,
  deterministicLocalTranslate,
  GENRE_PRESET_LABELS,
  PROSE_TONE_LABELS,
  type CanonicalGlossary,
  type ScoutedTerm,
  type GenrePreset,
  type ProseTone,
  type LintRuleId,
  type GlossaryTermMeta,
  type HeroStateLedger,
  type DelTAShortTermPair,
  type DelTALongTermMatch,
  type LlmProviderConfig,
  type SurgicalPatchItem,
  type StylisticSpanDirective,
  type LiTransProQaRubricScores,
} from '@/lib/qa-linter';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      action,
      engText = '',
      rusText = '',
      titleEng = '',
      chapterNumber = 1,
      glossary,
      glossaryMeta = {},
      scoutedTerms = [],
      styleGuideMd = '',
      genrePreset = 'xianxia',
      proseTone = 'classic',
      previousChapterSummary = '',
      previousChapterSummaryEng = '',
      deltaShortTermWindow = [],
      deltaLongTermMemories = [],
      enabledRuleIds,
      twoPassCritic = true,
      heroLedger,
      llmConfig,
    } = body as {
      action: 'scout' | 'translate_and_edit' | 'self_repair' | 'ping_colab';
      engText: string;
      rusText?: string;
      titleEng?: string;
      chapterNumber?: number;
      glossary: CanonicalGlossary;
      glossaryMeta?: Record<string, GlossaryTermMeta>;
      scoutedTerms?: ScoutedTerm[];
      styleGuideMd?: string;
      genrePreset?: GenrePreset;
      proseTone?: ProseTone;
      previousChapterSummary?: string;
      previousChapterSummaryEng?: string;
      deltaShortTermWindow?: DelTAShortTermPair[];
      deltaLongTermMemories?: DelTALongTermMatch[];
      enabledRuleIds?: LintRuleId[];
      twoPassCritic?: boolean;
      heroLedger?: HeroStateLedger;
      llmConfig?: LlmProviderConfig;
    };

    const genreInfo = GENRE_PRESET_LABELS[genrePreset] || GENRE_PRESET_LABELS.xianxia;
    const toneInfo = PROSE_TONE_LABELS[proseTone] || PROSE_TONE_LABELS.classic;

    // ACTION 0: Ping Google Colab L4 (Ollama / vLLM) Server Health & Loaded Models
    if (action === 'ping_colab') {
      const colabUrl = llmConfig?.colabEndpointUrl || process.env.COLAB_OLLAMA_URL || '';
      if (!colabUrl) {
        return NextResponse.json(
          {
            ok: false,
            error:
              'Укажите URL туннеля Google Colab (например, https://xxxx.trycloudflare.com или http://localhost:11434).',
          },
          { status: 400 }
        );
      }

      const pingRes = await pingColabServer(colabUrl);
      if (!pingRes.ok) {
        return NextResponse.json(
          {
            ok: false,
            error:
              pingRes.error ||
              `Не удалось подключиться к серверу (${colabUrl}). Проверьте туннель Cloudflare/ngrok.`,
          },
          { status: 502 }
        );
      }

      return NextResponse.json({
        ok: true,
        latencyMs: pingRes.latencyMs,
        models: pingRes.models,
        serverType: pingRes.serverType,
      });
    }

    // Initialize unified inference port with full fallback chain: Colab -> Gemini -> Deterministic
    const llmPort = createPipelineLlmPort(llmConfig, glossary, proseTone);

    // PHASE 1: TransAgents "Addition-by-Subtraction" Terminology Scout
    if (action === 'scout') {
      const localAbs = runAdditionBySubtractionScout(
        engText,
        chapterNumber,
        glossary,
        scoutedTerms
      );
      const scoutPrompts = buildScoutPrompts({
        chapterNumber,
        titleEng,
        engText,
        glossary,
        scoutedTerms,
        genrePromptHint: genreInfo.promptHint,
        genreTitle: genreInfo.title,
      });

      let discoveredList = localAbs.discoveredTerms;
      let engineUsed = 'transagents-addition-by-subtraction-v3';

      try {
        const response = await llmPort.complete({
          task: 'scout',
          systemInstruction: scoutPrompts.systemPrompt,
          userPrompt: scoutPrompts.userPrompt,
          expectJson: true,
          temperature: 0.2,
          numCtx: llmConfig?.numCtx || 16384,
          geminiModel: 'gemini-3.1-flash-lite',
          geminiResponseSchema: scoutPrompts.geminiSchema,
        });

        engineUsed = response.engineUsed;
        const parsed = extractResilientJsonFromLlm<unknown>(
          response.text,
          localAbs.discoveredTerms
        );
        const candidateList = Array.isArray(parsed)
          ? parsed
          : Array.isArray((parsed as { terms?: unknown[] })?.terms)
            ? (parsed as { terms: unknown[] }).terms
            : localAbs.discoveredTerms;

        if (Array.isArray(candidateList) && candidateList.length > 0) {
          discoveredList = candidateList as typeof localAbs.discoveredTerms;
        }
      } catch {
        // Fall back to local Addition-by-Subtraction scout
      }

      return NextResponse.json({
        engine: engineUsed,
        discoveredTerms: discoveredList,
        addedRecallCount: localAbs.addedRecallCount,
        subtractedNoiseCount: localAbs.subtractedNoiseCount,
        subtractedSamples: localAbs.subtractedSamples,
      });
    }

    // PHASE 2 & 3: DelTA 4-Level Memory + LCD-MAS + Universal Pass 2 Surgical Critic + Pass 3 Blind Stylist (Source Firewall)
    if (action === 'translate_and_edit') {
      // Step 0.1: Japanese AST Ruby/Gikun/Bouten Pre-parser
      const rubyGikunRes = parseRubyAndGikunMarkup(engText);
      const effectiveEngText = rubyGikunRes.foundCount > 0 ? rubyGikunRes.parsedText : engText;

      const { filteredGlossary, matchedCount } = filterGlossaryForChapter(effectiveEngText, glossary);

      // Pass 0: Scene Pacing Mode, Character Voices & Dynamic Few-Shot
      const pacingMode = classifyScenePacingMode(effectiveEngText);
      const contrastiveTriplets = selectContrastiveFewShotTriplets(pacingMode, 3);
      const characterVoicesBlock = buildCharacterVoicePromptBlock(filteredGlossary, glossaryMeta);

      const genderRulesList: string[] = [];
      Object.entries(filteredGlossary.characters || {}).forEach(([eng, rus]) => {
        const meta = glossaryMeta[eng];
        if (meta) {
          genderRulesList.push(
            `${eng} → ${rus} (Род: ${meta.gender || 'M'}${meta.declensionNote ? `, Склонение: ${meta.declensionNote}` : ''}${meta.voiceNote ? `, Речь и регистр: ${meta.voiceNote}` : ''})`
          );
        }
      });

      // Pass 1: Semantic & Canonical Translation
      const translatePrompts = buildTranslatePass1Prompts({
        chapterNumber,
        titleEng,
        engText: effectiveEngText,
        genreTitle: genreInfo.title,
        genrePromptHint: genreInfo.promptHint,
        toneTitle: toneInfo.title,
        toneInstruction: toneInfo.instruction,
        styleGuideMd,
        filteredGlossary,
        matchedCount,
        genderRulesList,
        heroLedger,
        previousChapterSummary,
        previousChapterSummaryEng,
        deltaShortTermWindow,
        deltaLongTermMemories,
      });

      let pass1Response;
      try {
        pass1Response = await llmPort.complete({
          task: 'translate_pass1',
          systemInstruction: translatePrompts.systemPrompt,
          userPrompt: translatePrompts.userPrompt,
          expectJson: true,
          temperature: llmConfig?.temperature ?? 0.2,
          numCtx: llmConfig?.numCtx ?? 16384,
          geminiModel: 'gemini-3.8-flash',
        });
      } catch {
        // Deterministic local adaptation fallback
        const fallback = deterministicLocalTranslate(
          effectiveEngText,
          titleEng,
          chapterNumber,
          glossary,
          proseTone
        );
        pass1Response = {
          text: JSON.stringify({
            titleRus: fallback.titleRus,
            rusText: fallback.rusText,
            summary: `Итог главы ${chapterNumber}`,
            summaryEng: `Summary of Chapter ${chapterNumber}`,
            csiNotes: [],
          }),
          engineUsed: 'deterministic-fallback',
          provider: 'deterministic' as const,
        };
      }

      const parsed = extractResilientJsonFromLlm<{
        titleRus?: string;
        rusText?: string;
        summary?: string;
        summaryEng?: string;
        csiNotes?: Array<{
          sourcePhrase: string;
          categoryLabel?: string;
          adaptedRus: string;
          rationale: string;
        }>;
      }>(pass1Response.text, {});

      let candidateRusText =
        parsed.rusText ||
        (!pass1Response.text.trim().startsWith('{') && /[а-яА-ЯёЁ]{10,}/.test(pass1Response.text)
          ? pass1Response.text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
          : '');

      if (!candidateRusText) {
        const fallback = deterministicLocalTranslate(
          effectiveEngText,
          titleEng,
          chapterNumber,
          glossary,
          proseTone
        );
        candidateRusText = fallback.rusText;
        parsed.titleRus = parsed.titleRus || fallback.titleRus;
      }

      // Pass 2: Bilingual Surgical Accuracy & Span Critic (gemini-4-argon-medium)
      const patchesList: SurgicalPatchItem[] = [];
      let criticEngineLabel = '';
      let otqsScore: number | undefined;
      const rawDirectives: StylisticSpanDirective[] = [];

      if (twoPassCritic !== false && candidateRusText) {
        try {
          const criticPrompts = buildSurgicalCriticPass2Prompts({
            engText: effectiveEngText,
            draftRusText: candidateRusText,
            filteredGlossary,
            genderRulesList,
          });

          const criticResponse = await llmPort.complete({
            task: 'surgical_critic_pass2',
            systemInstruction: criticPrompts.systemPrompt,
            userPrompt: criticPrompts.userPrompt,
            expectJson: true,
            temperature: 0.35,
            numCtx: llmConfig?.numCtx ?? 16384,
            geminiModel: llmConfig?.criticModelId || 'gemini-4-argon-medium',
          });
          criticEngineLabel = criticResponse.engineUsed;

          const parsedCritic = extractResilientJsonFromLlm<{
            patches?: SurgicalPatchItem[];
            edits?: SurgicalPatchItem[];
            rubricScores?: LiTransProQaRubricScores;
            stylisticSpanDirectives?: StylisticSpanDirective[];
          }>(criticResponse.text, {});

          const extractedPatches = Array.isArray(parsedCritic.patches)
            ? parsedCritic.patches
            : Array.isArray(parsedCritic.edits)
              ? parsedCritic.edits
              : Array.isArray(parsedCritic)
                ? (parsedCritic as unknown as SurgicalPatchItem[])
                : [];

          patchesList.push(...extractedPatches);

          if (parsedCritic.rubricScores?.otqs !== undefined) {
            otqsScore = parsedCritic.rubricScores.otqs;
          }

          if (Array.isArray(parsedCritic.stylisticSpanDirectives)) {
            rawDirectives.push(...parsedCritic.stylisticSpanDirectives);
          }
        } catch {
          // If Pass 2 critic times out or fails, keep Pass 1 output safely
        }
      }

      // Apply factual accuracy patches (Classes A/B) -> yields verified Russian text y'
      let verifiedRusIntermediate = candidateRusText;
      if (patchesList.length > 0) {
        const patchRes = applySurgicalPatches(candidateRusText, patchesList, glossary);
        if (patchRes.appliedCount > 0) {
          verifiedRusIntermediate = patchRes.patchedText;
        }
      }

      // Pass 3: Blind Literary Stylist (Source Firewall — x_s is strictly absent!)
      const cappedDirectives = capStylisticDirectivesPerParagraph(rawDirectives, 3);
      let stylistEngineLabel = '';
      let stylistAcceptedCount = 0;
      let stylistRolledBackCount = 0;

      if (
        twoPassCritic !== false &&
        (cappedDirectives.length > 0 || (otqsScore !== undefined && otqsScore < 8.5))
      ) {
        const paragraphs = verifiedRusIntermediate.split(/\n\n+/).map((p) => p.trim());
        const flawedForStylist = paragraphs
          .map((p, idx) => {
            const dirs = cappedDirectives.filter((d) => d.paragraphIndex === idx);
            return {
              index: idx,
              verifiedRusText: p,
              directives: dirs,
            };
          })
          .filter(
            (item) =>
              item.directives.length > 0 || (otqsScore !== undefined && otqsScore < 8.5)
          );

        if (flawedForStylist.length > 0) {
          try {
            const stylistPrompts = buildBlindStylistPass3Prompts({
              flawedParagraphs: flawedForStylist,
              genreTitle: genreInfo.title,
              toneTitle: toneInfo.title,
              toneInstruction: toneInfo.instruction,
              characterVoicesBlock,
              pacingMode,
              contrastiveTriplets,
            });

            const stylistResponse = await llmPort.complete({
              task: 'blind_stylist_pass3',
              systemInstruction: stylistPrompts.systemPrompt,
              userPrompt: stylistPrompts.userPrompt,
              expectJson: true,
              temperature: 0.35,
              numCtx: llmConfig?.numCtx ?? 16384,
              geminiModel: llmConfig?.criticModelId || 'gemini-4-argon-medium',
            });
            stylistEngineLabel = stylistResponse.engineUsed;

            const parsedStylist = extractResilientJsonFromLlm<{
              styledParagraphs?: Array<{ index: number; styledRusText: string }>;
            }>(stylistResponse.text, {});

            const rawStyled = Array.isArray(parsedStylist.styledParagraphs)
              ? parsedStylist.styledParagraphs
              : [];

            if (rawStyled.length > 0) {
              // Step 4: Deterministic Paragraph-Level Rollback Gate (MELT Verify & Rollback)
              const rollbackRes = verifyAndRollbackStylistPass({
                verifiedRusText: verifiedRusIntermediate,
                styledParagraphs: rawStyled,
                glossary,
              });
              verifiedRusIntermediate = rollbackRes.finalRusText;
              stylistAcceptedCount = rollbackRes.acceptedParagraphIndices.length;
              stylistRolledBackCount = rollbackRes.rolledBackParagraphs.length;
            }
          } catch {
            // If Pass 3 fails or times out, safely retain y'
          }
        }
      }

      // Deep verification and postprocessing (Stages 1 invariant order)
      const verifiedOutput = finalizeAndVerifyChapter({
        chapterNumber,
        titleEng,
        titleRus: parsed.titleRus,
        engText: effectiveEngText,
        candidateRusText: verifiedRusIntermediate,
        glossary,
        glossaryMeta,
        enabledRuleIds,
        surgicalPatches: [], // already applied via Mechanical Gate prior to Pass 3
        aiCsiNotes: parsed.csiNotes,
        existingSummaryRus: parsed.summary,
        existingSummaryEng: parsed.summaryEng,
      });

      return NextResponse.json({
        engine: `${pass1Response.engineUsed}${
          twoPassCritic !== false
            ? ` → Pass 2: ${criticEngineLabel || llmConfig?.criticModelId || 'gemini-4-argon-medium'}${
                stylistEngineLabel
                  ? ` → Pass 3 Blind Stylist: ${stylistEngineLabel}`
                  : ''
              }`
            : ''
        }`,
        titleRus: verifiedOutput.titleRus,
        rusText: verifiedOutput.rusText,
        summary: verifiedOutput.summary,
        summaryEng: verifiedOutput.summaryEng,
        csiNotes: verifiedOutput.csiNotes,
        ditingReport: verifiedOutput.ditingReport,
        slicedGlossaryCount: matchedCount,
        deltaShortTermCount: deltaShortTermWindow.length,
        appliedFixes: verifiedOutput.appliedFixes,
        lintReport: verifiedOutput.lintReport,
        scenePacingMode: pacingMode,
        otqsScore,
        stylistAcceptedCount,
        stylistRolledBackCount,
        rubyGikunCount: rubyGikunRes.foundCount,
      });
    }

    // PHASE 4: QA Self-Repair Loop (Paragraph-Scoped or Full Chapter)
    if (action === 'self_repair') {
      const alignment = alignChapterParagraphs(engText, rusText);
      let targetRusText = rusText;
      let engineUsed = 'surgical-deterministic-qa-repair';

      if (!alignment.hasDrift) {
        // High-precision paragraph-scoped self repair
        const flawedPayload = extractFlawedParagraphsPayload(engText, rusText, glossary, {
          enabledRuleIds,
          glossaryMeta,
        });

        if (flawedPayload.flawedCount > 0) {
          try {
            const repairPrompts = buildSelfRepairPrompts({
              engText,
              rusText,
              glossary,
              linterIssues: [],
              genreTitle: genreInfo.title,
              toneTitle: toneInfo.title,
              flawedPromptBlock: flawedPayload.promptBlock,
            });

            const response = await llmPort.complete({
              task: 'self_repair',
              systemInstruction: repairPrompts.systemPrompt,
              userPrompt: repairPrompts.userPrompt,
              expectJson: false,
              temperature: 0.2,
              numCtx: llmConfig?.numCtx ?? 16384,
              geminiModel: 'gemini-3.8-flash',
            });

            const cleanedRepair = response.text
              .replace(/<think>[\s\S]*?<\/think>/gi, '')
              .trim();

            if (cleanedRepair) {
              const merged = mergeRepairedParagraphsByIndex(rusText, cleanedRepair);
              if (merged.repairedIndices.length > 0) {
                targetRusText = merged.mergedText;
                engineUsed = `${response.engineUsed} (Paragraph-Scoped Repair)`;
              }
            }
          } catch {
            // Keep deterministic repair
          }
        }
      } else {
        // Structural drift: repair full chapter text
        try {
          const repairPrompts = buildSelfRepairPrompts({
            engText,
            rusText,
            glossary,
            linterIssues: [],
            genreTitle: genreInfo.title,
            toneTitle: toneInfo.title,
          });

          const response = await llmPort.complete({
            task: 'self_repair',
            systemInstruction: repairPrompts.systemPrompt,
            userPrompt: repairPrompts.userPrompt,
            expectJson: false,
            temperature: 0.2,
            numCtx: llmConfig?.numCtx ?? 16384,
            geminiModel: 'gemini-3.8-flash',
          });

          const cleanedRepair = response.text
            .replace(/<think>[\s\S]*?<\/think>/gi, '')
            .trim();

          if (cleanedRepair) {
            targetRusText = cleanedRepair;
            engineUsed = `${response.engineUsed} (Full-Chapter Drift Repair)`;
          }
        } catch {
          // Keep deterministic repair
        }
      }

      // Final deep verification
      const verifiedOutput = finalizeAndVerifyChapter({
        chapterNumber,
        titleEng,
        titleRus: '',
        engText,
        candidateRusText: targetRusText,
        glossary,
        glossaryMeta,
        enabledRuleIds,
      });

      return NextResponse.json({
        engine: `${engineUsed} + diting-agenteval`,
        titleRus: verifiedOutput.titleRus,
        rusText: verifiedOutput.rusText,
        summary: verifiedOutput.summary,
        summaryEng: verifiedOutput.summaryEng,
        csiNotes: verifiedOutput.csiNotes,
        ditingReport: verifiedOutput.ditingReport,
        appliedFixes: verifiedOutput.appliedFixes,
        lintReport: verifiedOutput.lintReport,
        repairedCount: verifiedOutput.surgicallyFixedParagraphs.length,
      });
    }

    return NextResponse.json({ error: 'Unknown pipeline action' }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Pipeline execution failed' },
      { status: 500 }
    );
  }
}
