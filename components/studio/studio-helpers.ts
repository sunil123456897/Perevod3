import type {
  CanonicalGlossary,
  ChapterQaSummary,
  GlossaryCategory,
  GlossaryTermMeta,
  LintReport,
  LintRuleId,
} from '@/lib/pipeline-types';

export type StudioTab = 'pipeline' | 'editor' | 'glossary' | 'export';
export type PipelineMode = 'full_5_phase' | 'scout_only' | 'verify_and_repair';
export type ChapterFilter = 'all' | 'verified' | 'needs_qa' | 'untranslated' | 'quarantined';

export interface PipelineLogEntry {
  id: string;
  timestamp: string;
  phase: string;
  message: string;
  level: 'info' | 'success' | 'warn';
}

export const MAX_QA_MEMO_CACHE_ENTRIES = 600;

export function fastHash32(str: string): number {
  let h = 2166136261;
  const step = str.length > 4096 ? 4 : 1;
  for (let i = 0; i < str.length; i += step) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function hashGlossaryAndRules(
  glossary: CanonicalGlossary,
  glossaryMeta: Record<string, GlossaryTermMeta> | undefined,
  enabledRuleIds: LintRuleId[]
): string {
  let h = 2166136261;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  };
  let termCount = 0;
  for (const cat of Object.keys(glossary).sort()) {
    feed(cat);
    const bucket = glossary[cat as GlossaryCategory] || {};
    for (const [k, v] of Object.entries(bucket)) {
      termCount += 1;
      feed(k);
      feed('=');
      feed(v);
      const m = glossaryMeta?.[k];
      if (m) {
        if (m.gender) feed(m.gender);
        if (m.voiceNote) feed(m.voiceNote);
        if (m.declensionNote) feed(m.declensionNote);
      }
      feed(';');
    }
  }
  feed('|');
  for (const r of enabledRuleIds) {
    feed(r);
    feed(',');
  }
  return `${termCount}:${enabledRuleIds.length}:${h >>> 0}`;
}

export function qaSummaryToLintReport(summary: ChapterQaSummary): LintReport {
  return {
    passed: summary.passed,
    errorCount: summary.errorCount,
    warningCount: summary.warningCount,
    score: summary.score,
    issues: [],
    checkedNumbersCount: 0,
    glossaryMatchesCount: 0,
  };
}

export function parsePhaseStepFromEvent(phase?: string): number {
  if (!phase) return 0;
  const digitMatch =
    phase.match(/(?:phase|step|фаза)\s*([1-5])/i) || phase.match(/\b([1-5])\s*\/\s*5\b/);
  if (digitMatch) {
    return Number(digitMatch[1]);
  }
  const lower = phase.toLowerCase();
  if (lower.includes('scout') || lower.includes('скаут') || lower.includes('канон')) return 1;
  if (lower.includes('translat') || lower.includes('перевод') || lower.includes('draft')) return 2;
  if (lower.includes('critic') || lower.includes('критик') || lower.includes('repair')) return 3;
  if (lower.includes('qa') || lower.includes('verif') || lower.includes('провер')) return 4;
  if (lower.includes('styl') || lower.includes('стил') || lower.includes('summary')) return 5;
  return 0;
}

export function sanitizeZipSlug(name: string): string {
  const cleaned = (name || 'novel')
    .toLowerCase()
    .replace(/[^a-z0-9а-яё_-]+/gi, '_')
    .replace(/^_+|_+$/g, '');
  return cleaned || 'novel';
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
