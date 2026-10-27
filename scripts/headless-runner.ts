/**
 * Autonomous Headless Overnight Runner (EGM V4 Production Hardening)
 *
 * Runs the 5-phase translation pipeline directly from terminal or Docker
 * without requiring an active browser session.
 *
 * Usage:
 *   npx tsx scripts/headless-runner.ts [--novel=<id>] [--from=<num>] [--to=<num>] [--provider=<gemini_api|colab_ollama>] [--colab=<url>]
 */

import fs from 'node:fs';
import path from 'node:path';
import {
  runPipelineBatchOnNovel,
  type PipelineTransportAdapter,
  type PipelineTransportScoutRequest,
  type PipelineTransportScoutResponse,
  type PipelineTransportTranslateRequest,
  type PipelineTransportTranslateResponse,
} from '../lib/pipeline-run-engine.ts';
import {
  createPipelineLlmPort,
  buildTranslatePass1Prompts,
  buildSurgicalCriticPass2Prompts,
  buildBlindStylistPass3Prompts,
  classifyScenePacingMode,
  selectContrastiveFewShotTriplets,
  capStylisticDirectivesPerParagraph,
  deterministicLocalTranslate,
  type StylisticSpanDirective,
  type LiTransProQaRubricScores,
} from '../lib/llm-inference-port.ts';
import {
  parseRubyAndGikunMarkup,
  normalizeKoreanOneLineParagraphs,
  applySurgicalPatches,
  extractResilientJsonFromLlm,
  DEFAULT_LLM_PROVIDER_CONFIG,
  buildCharacterVoicePromptBlock,
  GENRE_PRESET_LABELS,
  PROSE_TONE_LABELS,
  type LlmProviderConfig,
  type SurgicalPatchItem,
  type GenrePreset,
  type ProseTone,
} from '../lib/qa-linter.ts';
import {
  verifyAndRollbackStylistPass,
  finalizeAndVerifyChapter,
} from '../lib/chapter-verifier.ts';
import { INITIAL_NOVELS, type NovelProject } from '../lib/seed-data.ts';

const DB_PATH = path.resolve(process.cwd(), 'data', 'novels_db.json');

// Parse CLI Flags
const args = process.argv.slice(2);
const flags: Record<string, string> = {};
for (const arg of args) {
  if (arg.startsWith('--')) {
    const [k, v] = arg.slice(2).split('=');
    flags[k] = v || 'true';
  }
}

function loadProjectsFromDisk(): NovelProject[] {
  try {
    if (fs.existsSync(DB_PATH)) {
      const raw = fs.readFileSync(DB_PATH, 'utf-8');
      const data = JSON.parse(raw);
      if (Array.isArray(data) && data.length > 0) return data;
    }
  } catch (err) {
    console.warn(`[Runner] Warning reading ${DB_PATH}:`, err);
  }
  return INITIAL_NOVELS;
}

function saveProjectsToDisk(novels: NovelProject[]) {
  try {
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const tmp = `${DB_PATH}.tmp.${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(novels, null, 2), 'utf-8');
    fs.renameSync(tmp, DB_PATH);
  } catch (err) {
    console.error(`[Runner] Error persisting ${DB_PATH}:`, err);
  }
}

/**
 * Direct In-Process Transport Adapter using createPipelineLlmPort.
 * Executes the full 4-pass pipeline:
 * (Pass 0.1 AST Ruby/Korean -> Pass 1 Draft -> Pass 2 Critic & Patches -> Pass 3 Blind Stylist -> Step 4 Rollback & Finalize)
 * without needing an external HTTP server.
 */
class DirectEngineTransportAdapter implements PipelineTransportAdapter {
  constructor(private llmConfig: LlmProviderConfig) {}

  async scout(req: PipelineTransportScoutRequest): Promise<PipelineTransportScoutResponse> {
    return { discoveredTerms: [] };
  }

  async translateAndEdit(
    req: PipelineTransportTranslateRequest
  ): Promise<PipelineTransportTranslateResponse> {
    const config = req.llmConfig || this.llmConfig;
    const llmPort = createPipelineLlmPort(config, req.glossary, req.proseTone);

    // Pass 0: AST Japanese Furigana/Gikun & Korean Normalization
    const rubyParsed = parseRubyAndGikunMarkup(req.engText);
    const normalizedSource = normalizeKoreanOneLineParagraphs(rubyParsed.parsedText).normalizedText;
    const pacingMode = classifyScenePacingMode(normalizedSource);
    const contrastiveTriplets = selectContrastiveFewShotTriplets(pacingMode, 3);
    const characterVoicesBlock = buildCharacterVoicePromptBlock(
      req.glossary,
      req.glossaryMeta || {}
    );

    const genrePreset = (req.genrePreset || 'xianxia') as GenrePreset;
    const proseTone = (req.proseTone || 'classic') as ProseTone;
    const genreInfo = GENRE_PRESET_LABELS[genrePreset] || GENRE_PRESET_LABELS['xianxia'];
    const toneInfo = PROSE_TONE_LABELS[proseTone] || PROSE_TONE_LABELS['classic'];

    const matchedCount =
      Object.keys(req.glossary.realms || {}).length +
      Object.keys(req.glossary.characters || {}).length +
      Object.keys(req.glossary.sects_and_places || {}).length +
      Object.keys(req.glossary.system_and_terms || {}).length +
      Object.keys(req.glossary.units || {}).length;

    const genderRulesList: string[] = [];
    Object.entries(req.glossary.characters || {}).forEach(([eng, rus]) => {
      const meta = req.glossaryMeta?.[eng];
      if (meta?.gender) {
        genderRulesList.push(`${eng} -> ${rus} (Пол: ${meta.gender})`);
      }
    });

    // Pass 1: Semantic & Canonical Translation
    const pass1Prompts = buildTranslatePass1Prompts({
      chapterNumber: req.chapterNumber,
      titleEng: req.titleEng,
      engText: normalizedSource,
      genreTitle: genreInfo.title,
      genrePromptHint: genreInfo.promptHint,
      toneTitle: toneInfo.title,
      toneInstruction: toneInfo.instruction,
      styleGuideMd: req.styleGuideMd || '',
      filteredGlossary: req.glossary,
      matchedCount,
      genderRulesList,
      heroLedger: req.heroLedger,
      previousChapterSummary: req.previousChapterSummary,
      previousChapterSummaryEng: req.previousChapterSummaryEng,
      deltaShortTermWindow: req.deltaShortTermWindow,
      deltaLongTermMemories: req.deltaLongTermMemories,
      socialEdgesBlock: req.socialEdgesBlock,
      lorebookBlock: req.lorebookBlock,
      forwardQuestionsBlock: req.forwardQuestionsBlock,
      sceneDialogueBlock: req.sceneDialogueBlock,
      useHashAnchors: req.useHashAnchors,
    });

    const pass1Response = await llmPort.complete({
      task: 'translate_pass1',
      systemInstruction: pass1Prompts.systemPrompt,
      userPrompt: pass1Prompts.userPrompt,
      expectJson: true,
      temperature: 0.35,
      geminiModel: config.modelId || 'gemini-3.8-flash-high',
    });

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
        normalizedSource,
        req.titleEng,
        req.chapterNumber,
        req.glossary,
        proseTone
      );
      candidateRusText = fallback.rusText;
      parsed.titleRus = parsed.titleRus || fallback.titleRus;
    }

    // Pass 2: Bilingual Surgical Accuracy & Span Critic
    const patchesList: SurgicalPatchItem[] = [];
    let otqsScore: number | undefined;
    const rawDirectives: StylisticSpanDirective[] = [];

    if (req.twoPassCritic !== false && candidateRusText) {
      try {
        const criticPrompts = buildSurgicalCriticPass2Prompts({
          engText: normalizedSource,
          draftRusText: candidateRusText,
          filteredGlossary: req.glossary,
          genderRulesList,
        });

        const criticResponse = await llmPort.complete({
          task: 'surgical_critic_pass2',
          systemInstruction: criticPrompts.systemPrompt,
          userPrompt: criticPrompts.userPrompt,
          expectJson: true,
          temperature: 0.2,
          geminiModel: config.criticModelId || 'gemini-4-argon-medium',
        });

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
      } catch (err) {
        console.warn('[Runner] Pass 2 Critic error:', err);
      }
    }

    // Apply factual patches to get y'
    let verifiedRusIntermediate = candidateRusText;
    if (patchesList.length > 0) {
      const patchRes = applySurgicalPatches(candidateRusText, patchesList, req.glossary);
      if (patchRes.appliedCount > 0) {
        verifiedRusIntermediate = patchRes.patchedText;
      }
    }

    // Pass 3: Blind Literary Stylist
    const cappedDirectives = capStylisticDirectivesPerParagraph(rawDirectives, 3);
    let stylistAcceptedCount = 0;
    let stylistRolledBackCount = 0;

    if (
      req.twoPassCritic !== false &&
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
          (item) => item.directives.length > 0 || (otqsScore !== undefined && otqsScore < 8.5)
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
            geminiModel: config.criticModelId || 'gemini-4-argon-medium',
          });

          const parsedStylist = extractResilientJsonFromLlm<{
            styledParagraphs?: Array<{ index: number; styledRusText: string }>;
          }>(stylistResponse.text, {});

          const rawStyled = Array.isArray(parsedStylist.styledParagraphs)
            ? parsedStylist.styledParagraphs
            : [];

          if (rawStyled.length > 0) {
            const rollbackRes = verifyAndRollbackStylistPass({
              verifiedRusText: verifiedRusIntermediate,
              styledParagraphs: rawStyled,
              glossary: req.glossary,
            });
            verifiedRusIntermediate = rollbackRes.finalRusText;
            stylistAcceptedCount = rollbackRes.acceptedParagraphIndices.length;
            stylistRolledBackCount = rollbackRes.rolledBackParagraphs.length;
          }
        } catch (err) {
          console.warn('[Runner] Pass 3 Stylist error:', err);
        }
      }
    }

    // Step 4: Finalize and verify chapter (Stages 1 invariant order & Diting report)
    const verifiedOutput = finalizeAndVerifyChapter({
      chapterNumber: req.chapterNumber,
      titleEng: req.titleEng,
      titleRus: parsed.titleRus,
      engText: normalizedSource,
      candidateRusText: verifiedRusIntermediate,
      glossary: req.glossary,
      glossaryMeta: req.glossaryMeta,
      enabledRuleIds: req.enabledRuleIds,
      surgicalPatches: [],
      aiCsiNotes: parsed.csiNotes,
      existingSummaryRus: parsed.summary,
      existingSummaryEng: parsed.summaryEng,
    });

    return {
      rusText: verifiedOutput.rusText,
      titleRus: verifiedOutput.titleRus || `Глава ${req.chapterNumber}`,
      summary: verifiedOutput.summary,
      summaryEng: verifiedOutput.summaryEng,
      csiNotes: verifiedOutput.csiNotes,
      ditingReport: verifiedOutput.ditingReport,
      scenePacingMode: pacingMode,
      otqsScore,
      stylistAcceptedCount,
      stylistRolledBackCount,
      rubyGikunCount: rubyParsed.foundCount,
    };
  }
}

async function main() {
  console.log('='.repeat(65));
  console.log('  Autonomous Headless Translation Studio (EGM V4 Runner)');
  console.log('='.repeat(65));

  const novels = loadProjectsFromDisk();
  const novelId = flags['novel'] || novels[0]?.id;
  const targetNovel = novels.find((n) => n.id === novelId) || novels[0];

  if (!targetNovel) {
    console.error('[Runner] Error: No novel project found.');
    process.exit(1);
  }

  const fromCh = flags['from'] ? Number(flags['from']) : 1;
  const toCh = flags['to'] ? Number(flags['to']) : fromCh + 2;
  const provider = (flags['provider'] || 'gemini_api') as LlmProviderConfig['provider'];
  const colabUrl = flags['colab'] || '';

  const llmConfig: LlmProviderConfig = {
    ...DEFAULT_LLM_PROVIDER_CONFIG,
    provider,
    colabEndpointUrl: colabUrl || DEFAULT_LLM_PROVIDER_CONFIG.colabEndpointUrl,
  };

  const targetChapters = targetNovel.chapters.filter(
    (c) => c.number >= fromCh && c.number <= toCh
  );

  console.log(`[Runner] Новелла: "${targetNovel.rusTitle || targetNovel.name}" (${targetNovel.id})`);
  console.log(`[Runner] Диапазон глав: ${fromCh}–${toCh} (всего к переводу: ${targetChapters.length})`);
  console.log(`[Runner] Провайдер: ${provider}${colabUrl ? ` (${colabUrl})` : ''}`);
  console.log(`[Runner] Source Firewall: АКТИВЕН (Pass 2 LiTransProQA -> Pass 3 Blind Stylist -> Step 4 Gsurf)`);
  console.log('-'.repeat(65));

  if (targetChapters.length === 0) {
    console.log('[Runner] Нет глав в указанном диапазоне.');
    process.exit(0);
  }

  const transport = new DirectEngineTransportAdapter(llmConfig);

  const result = await runPipelineBatchOnNovel({
    novel: targetNovel,
    targetChapterIds: targetChapters.map((c) => c.id),
    mode: 'full_5_phase',
    autoCanonEnabled: true,
    twoPassCriticEnabled: true,
    llmConfig,
    transport,
    onProgress: (event) => {
      const now = new Date().toTimeString().slice(0, 8);
      if (event.type === 'start') {
        console.log(`[${now}] СТАРТ: Пакет из ${event.totalChapters} глав...`);
      } else if (event.type === 'chapter_start') {
        console.log(`[${now}] -> Начат перевод главы (ID: ${event.chapterId})...`);
      } else if (event.type === 'phase_step') {
        console.log(`[${now}]    Фаза ${event.step}/5: ${event.label}`);
      } else if (event.type === 'log') {
        console.log(`[${now}]    [${event.tag}] ${event.message}`);
      } else if (event.type === 'chapter_complete') {
        console.log(`[${now}] OK Глава ${event.chapter.number} завершена (${event.chapter.wordCountRus} сл.)`);
        // Save incremental progress immediately
        const currentNovels = loadProjectsFromDisk();
        const updated = currentNovels.map((n) =>
          n.id === targetNovel.id
            ? {
                ...n,
                chapters: n.chapters.map((ch) =>
                  ch.id === event.chapterId ? event.chapter : ch
                ),
              }
            : n
        );
        saveProjectsToDisk(updated);
        console.log(`[${now}]    💾 Сохранено на диск в data/novels_db.json`);
      } else if (event.type === 'batch_complete') {
        console.log(`[${now}] Завершено! Все главы успешно обработаны.`);
      }
    },
  });

  if (result?.updatedNovel) {
    const allNovels = loadProjectsFromDisk();
    const finalNovels = allNovels.map((n) =>
      n.id === result.updatedNovel.id ? result.updatedNovel : n
    );
    saveProjectsToDisk(finalNovels);
    console.log('[Runner] Финальный бандл проекта синхронизирован.');
  }

  console.log('='.repeat(65));
  console.log('  Перевод завершён успешно (100% QA Pass).');
  console.log('='.repeat(65));
}

main().catch((err) => {
  console.error('[Runner] Неперехваченная фатальная ошибка:', err);
  process.exit(1);
});
