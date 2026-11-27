import { NextRequest, NextResponse } from 'next/server';
import { getAiClientPool, pingColabServer } from '@/lib/llm-inference-port';
import { ServerPipelineExecutionAdapter } from '@/lib/pipeline-run-engine';
import type {
  CanonicalGlossary,
  ScoutedTerm,
  GenrePreset,
  ProseTone,
  LintRuleId,
  GlossaryTermMeta,
  HeroStateLedger,
  LlmProviderConfig,
} from '@/lib/pipeline-types';
import type {
  DelTAShortTermPair,
  DelTALongTermMatch,
} from '@/lib/delta-diting';
import {
  verifyStudioApiRequest,
  sanitizeClientLlmConfig,
  validateSafeColabEndpointUrl,
} from '@/lib/api-security';

export async function GET(req: NextRequest) {
  const auth = verifyStudioApiRequest(req, { requireMutationOrigin: false });
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'Unauthorized' },
      { status: auth.status }
    );
  }

  const keyPool = getAiClientPool();
  return NextResponse.json({
    ok: true,
    hasServerApiKey: keyPool.length > 0,
    configuredKeyCount: keyPool.length,
    hasColabUrl: Boolean(process.env.COLAB_OLLAMA_URL),
  });
}

export async function POST(req: NextRequest) {
  const auth = verifyStudioApiRequest(req);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error || 'Unauthorized' },
      { status: auth.status }
    );
  }

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
      socialEdgesBlock,
      lorebookBlock,
      forwardQuestionsBlock,
      sceneDialogueBlock,
      useHashAnchors = true,
    } = body as {
      action: 'scout' | 'translate_and_edit' | 'self_repair' | 'finalize' | 'ping_colab';
      engText: string;
      rusText?: string;
      titleEng?: string;
      titleRus?: string;
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
      socialEdgesBlock?: string;
      lorebookBlock?: string;
      forwardQuestionsBlock?: string;
      sceneDialogueBlock?: string;
      useHashAnchors?: boolean;
      existingSummaryRus?: string;
      existingSummaryEng?: string;
    };

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

      const urlValidation = validateSafeColabEndpointUrl(colabUrl);
      if (!urlValidation.ok) {
        return NextResponse.json(
          {
            ok: false,
            error: urlValidation.error,
          },
          { status: 400 }
        );
      }

      const pingRes = await pingColabServer(urlValidation.normalizedUrl);
      if (!pingRes.ok) {
        return NextResponse.json(
          {
            ok: false,
            error:
              pingRes.error ||
              `Не удалось подключиться к серверу (${urlValidation.normalizedUrl}). Проверьте туннель Cloudflare/ngrok.`,
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

    const safeLlmConfig = sanitizeClientLlmConfig(llmConfig, auth);
    const executionAdapter = new ServerPipelineExecutionAdapter(safeLlmConfig);

    if (action === 'scout') {
      const scoutRes = await executionAdapter.scout({
        engText,
        titleEng,
        chapterNumber,
        glossary,
        scoutedTerms,
        genrePreset,
        llmConfig: safeLlmConfig,
      });
      return NextResponse.json(scoutRes);
    }

    if (action === 'translate_and_edit') {
      const translateRes = await executionAdapter.translateAndEdit({
        engText,
        titleEng,
        chapterNumber,
        glossary,
        glossaryMeta,
        scoutedTerms,
        styleGuideMd,
        genrePreset,
        proseTone,
        previousChapterSummary,
        previousChapterSummaryEng,
        deltaShortTermWindow,
        deltaLongTermMemories,
        enabledRuleIds,
        twoPassCritic,
        heroLedger,
        llmConfig: safeLlmConfig,
        socialEdgesBlock,
        lorebookBlock,
        forwardQuestionsBlock,
        sceneDialogueBlock,
        useHashAnchors,
      });
      return NextResponse.json({
        ...translateRes,
        quarantined: Boolean(translateRes.quarantined),
        quarantineReason: translateRes.quarantineReason,
        degradedWarnings: translateRes.degradedWarnings,
        engine: translateRes.engine,
      });
    }

    if (action === 'self_repair' || action === 'finalize') {
      const verifiedOutput = await executionAdapter.verifyAndRepair({
        chapterNumber,
        titleEng,
        titleRus: (body as { titleRus?: string }).titleRus || '',
        engText,
        rusText,
        glossary,
        glossaryMeta,
        enabledRuleIds,
        genrePreset,
        proseTone,
        llmConfig: safeLlmConfig,
        existingSummaryRus: (body as { existingSummaryRus?: string }).existingSummaryRus,
        existingSummaryEng: (body as { existingSummaryEng?: string }).existingSummaryEng,
      });

      return NextResponse.json({
        engine: verifiedOutput.engine,
        titleRus: verifiedOutput.titleRus,
        rusText: verifiedOutput.rusText,
        summary: verifiedOutput.summary,
        summaryEng: verifiedOutput.summaryEng,
        csiNotes: verifiedOutput.csiNotes,
        ditingReport: verifiedOutput.ditingReport,
        proseGateReport: verifiedOutput.proseGateReport,
        neuralAudit: verifiedOutput.neuralAudit,
        scorecard: verifiedOutput.scorecard,
        appliedFixes: verifiedOutput.appliedFixes,
        surgicallyFixedParagraphs: verifiedOutput.surgicallyFixedParagraphs,
        flawedParagraphIndices: verifiedOutput.flawedParagraphIndices,
        lintReport: verifiedOutput.lintReport,
        verified: verifiedOutput.verified,
        wordCountEng: verifiedOutput.wordCountEng,
        wordCountRus: verifiedOutput.wordCountRus,
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
