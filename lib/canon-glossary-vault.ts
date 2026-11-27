import {
  filterGlossaryForChapter,
  runAdditionBySubtractionScout,
} from './qa-linter.ts';
import type {
  CanonicalGlossary,
  CharacterSpeechVector,
  GlossaryCategory,
  GlossaryTermMeta,
  GrammaticalGender,
  ScoutedTerm,
  SocialRegisterEdge,
} from './pipeline-types.ts';
import {
  buildInflectedRussianForms,
  splitCompoundRussianTerm,
  type InflectedFormItem,
  type SplitCompoundResult,
} from './russian-morphology.ts';

export {
  buildInflectedRussianForms,
  splitCompoundRussianTerm,
  type InflectedFormItem,
  type SplitCompoundResult,
};
export type { SocialRegisterEdge } from './pipeline-types.ts';

/**
 * Infers grammatical gender from English context clues without defaulting to 'M'.
 * Returns 'UNKNOWN' when there are no unambiguous gender markers.
 */
export function inferGenderFromContext(eng?: string, contextSnippet?: string): GrammaticalGender {
  const combined = `${contextSnippet || ''} ${eng || ''}`.trim();
  if (!combined) return 'UNKNOWN';

  let sample = combined;
  if (eng && contextSnippet) {
    const idx = contextSnippet.toLowerCase().indexOf(eng.toLowerCase());
    if (idx >= 0) {
      const start = Math.max(0, idx - 100);
      const end = Math.min(contextSnippet.length, idx + eng.length + 140);
      sample = contextSnippet.slice(start, end);
    }
  }

  const femMatches = sample.match(
    /\b(?:she|her|hers|herself|lady|queen|princess|sister|girl|maiden|woman|empress|goddess|duchess|fairy|matriarch|mother|wife|bride|daughter|concubine|saintess)\b/gi
  );
  const mascMatches = sample.match(
    /\b(?:he|his|him|himself|lord|king|prince|brother|boy|man|emperor|god|duke|patriarch|father|husband|groom|son)\b/gi
  );

  const fCount = femMatches?.length ?? 0;
  const mCount = mascMatches?.length ?? 0;
  if (fCount > mCount) return 'F';
  if (mCount > fCount) return 'M';
  return 'UNKNOWN';
}


export interface CanonRippleChapterChange {
  chapterId: string;
  chapterNumber: number;
  ReplacementsCount: number;
  updatedTitleRus: string;
  updatedRusText: string;
  previewBefore: string;
  previewAfter: string;
}

/**
 * Universal Morphological Canon Ripple:
 * Replaces old Russian glossary term across all translated chapters
 * in ALL grammatical cases (nominative, genitive, dative, accusative, instrumental, prepositional).
 */
export function previewAndApplyCanonRipple<
  T extends { id: string; number: number; titleRus: string; rusText: string }
>(
  chapters: T[],
  oldRusTerm: string,
  newRusTerm: string
): {
  changes: CanonRippleChapterChange[];
  totalOccurrences: number;
} {
  const cleanOld = (oldRusTerm || '').trim();
  const cleanNew = (newRusTerm || '').trim();
  if (!cleanOld || !cleanNew || cleanOld.toLowerCase() === cleanNew.toLowerCase()) {
    return { changes: [], totalOccurrences: 0 };
  }

  // Generate inflected forms for both terms
  const oldForms = buildInflectedRussianForms(cleanOld);
  const newForms = buildInflectedRussianForms(cleanNew);

  const newFormsByCase = new Map<string, string>();
  for (const nf of newForms) {
    newFormsByCase.set(nf.caseLabel, nf.form);
  }

  // Create aligned replacement map { search, replace }
  const replacementPairs: Array<{ search: string; replace: string }> = [];
  const seenSearches = new Set<string>();

  for (const oform of oldForms) {
    const matchingNew = newFormsByCase.get(oform.caseLabel) || cleanNew;
    const lowerSearch = oform.form.toLowerCase();
    if (!seenSearches.has(lowerSearch)) {
      seenSearches.add(lowerSearch);
      replacementPairs.push({
        search: oform.form,
        replace: matchingNew,
      });
    }
  }

  // Always ensure base string is included
  if (!seenSearches.has(cleanOld.toLowerCase())) {
    replacementPairs.push({ search: cleanOld, replace: cleanNew });
  }

  // Sort by descending search length to avoid partial substring prefix clashes
  replacementPairs.sort((a, b) => b.search.length - a.search.length);

  const escapedSearches = replacementPairs.map((p) =>
    p.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const rippleRegex = new RegExp(
    `(?<![а-яёa-z0-9])(${escapedSearches.join('|')})(?![а-яёa-z0-9])`,
    'gi'
  );

  const formatReplacement = (match: string, rep: string): string => {
    if (match === match.toUpperCase()) {
      return rep.toUpperCase();
    }
    if (match === match.toLowerCase()) {
      return rep.toLowerCase();
    }
    if (match[0] === match[0].toUpperCase()) {
      const matchWords = match.split(/\s+/);
      const repWords = rep.split(/\s+/);
      const allSubsequentMatchWordsLower =
        matchWords.length > 1 && matchWords.slice(1).every((w) => w === w.toLowerCase());

      if (allSubsequentMatchWordsLower && repWords.length > 1) {
        return repWords
          .map((w, idx) =>
            idx === 0
              ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
              : w.toLowerCase()
          )
          .join(' ');
      }
      return rep.charAt(0).toUpperCase() + rep.slice(1);
    }
    return rep;
  };

  const changes: CanonRippleChapterChange[] = [];
  let totalOccurrences = 0;

  for (const ch of chapters) {
    if (!ch.rusText.trim() && !ch.titleRus.trim()) continue;

    let chapterMatchesCount = 0;
    let firstMatchingLine = '';

    const replaceText = (text: string): string => {
      return text.replace(rippleRegex, (matched) => {
        chapterMatchesCount++;
        const pair = replacementPairs.find(
          (p) => p.search.toLowerCase() === matched.toLowerCase()
        );
        const rep = pair ? pair.replace : cleanNew;
        return formatReplacement(matched, rep);
      });
    };

    // Find first matching line before replacing
    if (ch.titleRus && rippleRegex.test(ch.titleRus)) {
      firstMatchingLine = ch.titleRus;
    } else if (ch.rusText) {
      firstMatchingLine =
        ch.rusText.split(/\r?\n/).find((line) => {
          rippleRegex.lastIndex = 0;
          return rippleRegex.test(line);
        }) || '';
    }

    rippleRegex.lastIndex = 0;
    const updatedTitle = replaceText(ch.titleRus);
    const updatedBody = replaceText(ch.rusText);

    if (chapterMatchesCount > 0) {
      totalOccurrences += chapterMatchesCount;
      const previewAfter =
        updatedBody.split(/\r?\n/).find((l) => l.toLowerCase().includes(cleanNew.toLowerCase())) ||
        updatedTitle;

      changes.push({
        chapterId: ch.id,
        chapterNumber: ch.number,
        ReplacementsCount: chapterMatchesCount,
        updatedTitleRus: updatedTitle,
        updatedRusText: updatedBody,
        previewBefore: firstMatchingLine || ch.titleRus,
        previewAfter,
      });
    }
  }

  return { changes, totalOccurrences };
}

/**
 * Enhanced Lookahead Batch Pre-Scouting across a chapter range.
 * Combines built-in canonical templates with TransAgents Addition-by-Subtraction scout
 * across all chapters in range, tracks cross-chapter recurrence, and automatically
 * promotes terms with confidence >= 0.95 and approved_for_glossary = true.
 */
export function batchLookaheadScoutChapters(
  chapters: Array<{ number: number; titleEng: string; engText: string }>,
  glossary: CanonicalGlossary,
  existingScouted: ScoutedTerm[] = []
): {
  discoveredTerms: ScoutedTerm[];
  autoPromotedCount: number;
} {
  const knownEng = new Set<string>();
  (Object.keys(glossary) as GlossaryCategory[]).forEach((cat) => {
    Object.keys(glossary[cat] || {}).forEach((k) => knownEng.add(k.toLowerCase()));
  });
  existingScouted.forEach((t) => knownEng.add(t.eng.toLowerCase()));

  const builtins: Record<
    string,
    { rus: string; cat: GlossaryCategory; gender?: GrammaticalGender }
  > = {
    'Foundation Establishment Pill': {
      rus: 'Пилюля Заложения Основ',
      cat: 'system_and_terms',
      gender: 'F',
    },
    'Foundation Establishment': {
      rus: 'Заложение Основ',
      cat: 'realms',
      gender: 'N',
    },
    'Inner Sect': {
      rus: 'Внутренняя Секта',
      cat: 'sects_and_places',
      gender: 'F',
    },
    'Outer Sect': {
      rus: 'Внешняя Секта',
      cat: 'sects_and_places',
      gender: 'F',
    },
    'Crimson Flame Pavilion': {
      rus: 'Павильон Багрового Пламени',
      cat: 'sects_and_places',
      gender: 'M',
    },
    'Blood Condensation Pill': {
      rus: 'Пилюля Конденсации Крови',
      cat: 'system_and_terms',
      gender: 'F',
    },
    'Black Iron Cauldron': {
      rus: 'Котёл Чёрного Железа',
      cat: 'system_and_terms',
      gender: 'M',
    },
    'Secret Realm': {
      rus: 'Тайное Царство',
      cat: 'sects_and_places',
      gender: 'N',
    },
  };

  const hitMap = new Map<
    string,
    {
      eng: string;
      rus: string;
      category: GlossaryCategory;
      gender: GrammaticalGender;
      firstChapter: number;
      chapterOccurrences: number;
      snippet: string;
    }
  >();

  // 1. Scan built-in canonical templates
  for (const ch of chapters) {
    for (const [eng, meta] of Object.entries(builtins)) {
      if (knownEng.has(eng.toLowerCase())) continue;
      if (ch.engText.toLowerCase().includes(eng.toLowerCase())) {
        const cur = hitMap.get(eng);
        if (cur) {
          cur.chapterOccurrences += 1;
        } else {
          hitMap.set(eng, {
            eng,
            rus: meta.rus,
            category: meta.cat,
            gender: meta.gender || inferGenderFromContext(eng, ch.engText),
            firstChapter: ch.number,
            chapterOccurrences: 1,
            snippet: ch.engText.slice(0, 140),
          });
        }
      }
    }

    // 2. Scan Addition-by-Subtraction dynamic candidates
    const abs = runAdditionBySubtractionScout(ch.engText, ch.number, glossary, existingScouted);
    for (const term of abs.finalTerms) {
      if (knownEng.has(term.eng.toLowerCase())) continue;
      const cur = hitMap.get(term.eng);
      if (cur) {
        cur.chapterOccurrences += 1;
      } else {
        hitMap.set(term.eng, {
          eng: term.eng,
          rus: term.rus_suggested,
          category: term.category,
          gender: term.gender || inferGenderFromContext(term.eng, term.context_snippet || ch.engText),
          firstChapter: ch.number,
          chapterOccurrences: 1,
          snippet: term.context_snippet || ch.engText.slice(0, 140),
        });
      }
    }
  }

  const discoveredTerms: ScoutedTerm[] = [];
  let idx = 0;
  let autoPromotedCount = 0;
  hitMap.forEach((val) => {
    const hasCyrillicTranslation = Boolean(val.rus && /[а-яёА-ЯЁ]/.test(val.rus));
    const isDomainCanon = /pill|sect|realm|cauldron|grass|flame|beast/i.test(val.eng);
    const confidence = hasCyrillicTranslation
      ? val.chapterOccurrences >= 2 || isDomainCanon
        ? 0.98
        : 0.95
      : 0.65;
    const approved = hasCyrillicTranslation;
    if (approved) autoPromotedCount++;
    discoveredTerms.push({
      id: `lookahead-${Date.now()}-${idx++}`,
      eng: val.eng,
      rus_suggested: val.rus,
      category: val.category,
      gender: val.gender,
      chapter_first_seen: val.firstChapter,
      context_snippet: val.snippet,
      approved_for_glossary: approved,
      confidence,
    });
  });

  return {
    discoveredTerms,
    autoPromotedCount,
  };
}

export interface ChapterGlossaryCoverageResult {
  canonInSource: number;
  canonMatchedInRus: number;
  unapprovedInChapter: number;
  totalDetectedTerms: number;
  glossaryCoveragePct: number;
}

/**
 * Unified calculation of canonical terminology coverage for a chapter.
 * Shared across TranslationAnalyticsChart and Pipeline chapter table.
 */
export function computeChapterGlossaryCoverage(
  chapter: { engText: string; rusText?: string; translated?: boolean },
  glossary: CanonicalGlossary,
  scoutedTerms: ScoutedTerm[]
): ChapterGlossaryCoverageResult {
  const { filteredGlossary, matchedCount: canonInSource } = filterGlossaryForChapter(
    chapter.engText,
    glossary
  );

  let canonMatchedInRus = 0;
  const lowerRus = (chapter.rusText || '').toLowerCase().replace(/ё/g, 'е');

  if (chapter.rusText && chapter.rusText.trim()) {
    Object.entries(filteredGlossary).forEach(([cat, bucket]) => {
      Object.values(bucket || {}).forEach((rusTerm) => {
        const rusStr = String(rusTerm || '').trim();
        if (!rusStr) return;

        // 1. Check all inflected forms with strict Cyrillic boundaries
        const forms = buildInflectedRussianForms(rusStr, {
          category: cat,
          isPersonName: cat === 'characters',
        });
        const formMatched = forms.some((f) => {
          const normForm = f.form.toLowerCase().replace(/ё/g, 'е').replace(/^[«"]|[»"]$/g, '');
          if (!normForm) return false;
          const esc = normForm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          return new RegExp(`(?<![а-яё])${esc}(?![а-яё])`, 'i').test(lowerRus);
        });
        if (formMatched) {
          canonMatchedInRus++;
          return;
        }

        // 2. Fallback to stem tokens, using strict Cyrillic word boundaries for stems <= 3 chars
        const tokens = rusStr
          .toLowerCase()
          .replace(/ё/g, 'е')
          .split(/[\s\-«»"()]+/)
          .filter((w) => w.length >= 2);

        const matched =
          tokens.length === 0 ||
          tokens.every((w) => {
            if (w.startsWith('камен')) {
              return /(?<![а-яё])(?:камен|камн)[а-яё]*/i.test(lowerRus);
            }
            if (w.startsWith('корен')) {
              return /(?<![а-яё])(?:корен|корн)[а-яё]*/i.test(lowerRus);
            }
            if (w.length <= 3) {
              const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              return new RegExp(`(?<![а-яё])${esc}(?![а-яё])`, 'i').test(lowerRus);
            }
            const stem = w.slice(0, Math.min(4, Math.max(4, w.length - 2)));
            if (stem.length <= 3) {
              const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
              return new RegExp(`(?<![а-яё])${esc}(?![а-яё])`, 'i').test(lowerRus);
            }
            return lowerRus.includes(stem);
          });

        if (matched) {
          canonMatchedInRus++;
        }
      });
    });
  }

  let unapprovedInChapter = 0;
  scoutedTerms.forEach((st) => {
    if (!st.approved_for_glossary) {
      const escaped = st.eng.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\b${escaped}s?\\b`, 'i').test(chapter.engText)) {
        unapprovedInChapter++;
      }
    }
  });

  const totalDetectedTerms = canonInSource + unapprovedInChapter;
  let glossaryCoveragePct = 0;

  if (chapter.translated && chapter.rusText && chapter.rusText.trim()) {
    if (totalDetectedTerms === 0) {
      glossaryCoveragePct = 100;
    } else {
      glossaryCoveragePct = Math.min(
        100,
        Math.round((canonMatchedInRus / totalDetectedTerms) * 100)
      );
    }
  } else if (totalDetectedTerms > 0) {
    glossaryCoveragePct = Math.round((canonInSource / totalDetectedTerms) * 100);
  }

  return {
    canonInSource,
    canonMatchedInRus,
    unapprovedInChapter,
    totalDetectedTerms,
    glossaryCoveragePct,
  };
}

export interface CanonVaultState {
  glossary: CanonicalGlossary;
  glossaryMeta: Record<string, GlossaryTermMeta>;
  scoutedTerms: ScoutedTerm[];
}

/**
 * Pure state mutation: Approves a candidate scouted term and adds it to Canon glossary & meta.
 */
export function approveScoutedTermInVault(
  vault: CanonVaultState,
  termId: string,
  overrides?: {
    rusSuggested?: string;
    category?: GlossaryCategory;
    gender?: GrammaticalGender;
  }
): CanonVaultState {
  const target = vault.scoutedTerms.find((t) => t.id === termId);
  if (!target) return vault;

  const category = overrides?.category || target.category;
  const rus = (overrides?.rusSuggested || target.rus_suggested).trim();
  const gender = overrides?.gender || target.gender;

  const nextGlossary = {
    ...vault.glossary,
    [category]: {
      ...vault.glossary[category],
      [target.eng]: rus,
    },
  };

  const nextMeta = { ...vault.glossaryMeta };
  if (gender) {
    nextMeta[target.eng] = { ...nextMeta[target.eng], gender };
  }

  const nextScouted = vault.scoutedTerms.map((t) =>
    t.id === termId ? { ...t, approved_for_glossary: true, rus_suggested: rus, category, gender } : t
  );

  return {
    glossary: nextGlossary,
    glossaryMeta: nextMeta,
    scoutedTerms: nextScouted,
  };
}

/**
 * Pure state mutation: Auto-approves all pending scouted terms meeting minimum confidence.
 */
export function autoApprovePendingTermsInVault(
  vault: CanonVaultState,
  minConfidence = 0.9
): { updatedVault: CanonVaultState; approvedCount: number } {
  let approvedCount = 0;
  let curVault = vault;

  for (const st of vault.scoutedTerms) {
    const hasCyrillic = Boolean(st.rus_suggested && /[а-яёА-ЯЁ]/.test(st.rus_suggested));
    if (!st.approved_for_glossary && hasCyrillic && st.confidence >= minConfidence) {
      curVault = approveScoutedTermInVault(curVault, st.id);
      approvedCount++;
    }
  }

  return { updatedVault: curVault, approvedCount };
}

/**
 * Pure state mutation: Adds or updates a canonical glossary term with metadata.
 */
export function upsertCanonTermInVault(
  vault: CanonVaultState,
  category: GlossaryCategory,
  eng: string,
  rus: string,
  meta?: GlossaryTermMeta
): CanonVaultState {
  const cleanEng = eng.trim();
  const cleanRus = rus.trim();
  if (!cleanEng || !cleanRus) return vault;

  const nextGlossary = {
    ...vault.glossary,
    [category]: {
      ...vault.glossary[category],
      [cleanEng]: cleanRus,
    },
  };

  const nextMeta = { ...vault.glossaryMeta };
  if (meta && (meta.gender || meta.declensionNote || meta.voiceNote)) {
    nextMeta[cleanEng] = { ...meta };
  }

  return {
    glossary: nextGlossary,
    glossaryMeta: nextMeta,
    scoutedTerms: vault.scoutedTerms,
  };
}

/**
 * Pure state mutation: Removes a canonical glossary term from vault.
 */
export function removeCanonTermFromVault(
  vault: CanonVaultState,
  category: GlossaryCategory,
  eng: string
): CanonVaultState {
  const nextBucket = { ...vault.glossary[category] };
  delete nextBucket[eng];

  const nextGlossary = {
    ...vault.glossary,
    [category]: nextBucket,
  };

  const nextMeta = { ...vault.glossaryMeta };
  delete nextMeta[eng];

  return {
    glossary: nextGlossary,
    glossaryMeta: nextMeta,
    scoutedTerms: vault.scoutedTerms,
  };
}

/**
 * Pure state mutation: Applies Morphological Canon Ripple to an entire novel and updates glossary.
 */
export function applyCanonRippleToNovel<
  T extends {
    id: string;
    chapters: Array<{ id: string; number: number; titleRus: string; rusText: string }>;
    glossary: CanonicalGlossary;
    glossaryMeta?: Record<string, GlossaryTermMeta>;
    scoutedTerms?: ScoutedTerm[];
  }
>(
  novel: T,
  oldRusTerm: string,
  newRusTerm: string
): { updatedNovel: T; rippleReport: ReturnType<typeof previewAndApplyCanonRipple> } {
  const rippleReport = previewAndApplyCanonRipple(novel.chapters, oldRusTerm, newRusTerm);

  const changesMap = new Map<string, { titleRus: string; rusText: string }>();
  for (const ch of rippleReport.changes) {
    changesMap.set(ch.chapterId, {
      titleRus: ch.updatedTitleRus,
      rusText: ch.updatedRusText,
    });
  }

  const updatedChapters = novel.chapters.map((ch) => {
    const change = changesMap.get(ch.id);
    if (!change) return ch;
    return {
      ...ch,
      titleRus: change.titleRus,
      rusText: change.rusText,
    };
  });

  // Also update glossary if oldRusTerm was defined in any category
  const updatedGlossary: CanonicalGlossary = { ...novel.glossary };
  (Object.keys(updatedGlossary) as GlossaryCategory[]).forEach((cat) => {
    const bucket = { ...updatedGlossary[cat] };
    Object.entries(bucket).forEach(([eng, rus]) => {
      if (rus.toLowerCase() === oldRusTerm.toLowerCase()) {
        bucket[eng] = newRusTerm;
      }
    });
    updatedGlossary[cat] = bucket;
  });

  const updatedNovel: T = {
    ...novel,
    chapters: updatedChapters,
    glossary: updatedGlossary,
  };

  return { updatedNovel, rippleReport };
}

export function buildSocialRegisterPromptBlock(
  edges: SocialRegisterEdge[],
  activeCharacters?: string[]
): string {
  if (!edges || edges.length === 0) return '';
  const filtered =
    activeCharacters && activeCharacters.length > 0
      ? edges.filter(
          (e) =>
            activeCharacters.some(
              (c) =>
                e.fromCharacter.toLowerCase().includes(c.toLowerCase()) ||
                c.toLowerCase().includes(e.fromCharacter.toLowerCase())
            ) ||
            activeCharacters.some(
              (c) =>
                e.toCharacter.toLowerCase().includes(c.toLowerCase()) ||
                c.toLowerCase().includes(e.toCharacter.toLowerCase())
            )
        )
      : edges;
  if (filtered.length === 0) return '';

  const jsonSummary = filtered.map((e) => ({
    from: e.fromCharacter,
    to: e.toCharacter,
    register: e.pronounMode,
    role: e.fineRole,
    type: e.coarseRole,
    valence: e.valence,
  }));

  return `[DIRECTED SOCIAL REGISTER GRAPH (ты ↔ Вы)]\n${JSON.stringify(jsonSummary, null, 2)}`;
}

export interface GlossaryLintIssue {
  type: 'alias_collision' | 'title_attached' | 'homonym_surname' | 'substring_shadowing';
  severity: 'error' | 'warning';
  term: string;
  category?: string;
  details: string;
  recommendation: string;
}

export function lintGlossaryVault(
  glossary: CanonicalGlossary,
  glossaryMeta?: Record<string, GlossaryTermMeta>
): GlossaryLintIssue[] {
  const issues: GlossaryLintIssue[] = [];

  // 1. Alias Collision: same Russian translation mapped to different English keys
  const rusToEngMap = new Map<string, Array<{ eng: string; category: string }>>();
  (Object.keys(glossary) as GlossaryCategory[]).forEach((cat) => {
    Object.entries(glossary[cat] || {}).forEach(([eng, rus]) => {
      const normRus = (rus || '').trim().toLowerCase();
      if (!normRus) return;
      const list = rusToEngMap.get(normRus) || [];
      list.push({ eng, category: cat });
      rusToEngMap.set(normRus, list);
    });
  });

  rusToEngMap.forEach((occurrences, normRus) => {
    if (occurrences.length > 1) {
      const uniqueEngs = Array.from(new Set(occurrences.map((o) => o.eng)));
      if (uniqueEngs.length > 1) {
        issues.push({
          type: 'alias_collision',
          severity: 'warning',
          term: normRus,
          category: occurrences[0].category,
          details: `Русский термин «${normRus}» привязан к разным английским ключам: [${uniqueEngs.join(', ')}]`,
          recommendation: 'Используйте явный алиас или унифицируйте английские термины в глоссарии.',
        });
      }
    }
  });

  // 2. Title Attached: Honorific titles glued to character names
  const attachedTitleRegex =
    /^(?:Старейшина|Старший\s+брат|Младший\s+брат|Старшая\s+сестра|Младшая\s+сестра|Мастер|Глава\s+секты|Патриарх|Владыка|Учитель|Лорд|Император|Принц|Фея|Даос|Elder|Senior\s+Brother|Junior\s+Brother|Senior\s+Sister|Junior\s+Sister|Master|Sect\s+Master|Patriarch|Lord|Emperor|Prince|Fairy|Daoist)\s+/i;
  Object.entries(glossary.characters || {}).forEach(([eng, rus]) => {
    if (attachedTitleRegex.test(rus) || attachedTitleRegex.test(eng)) {
      issues.push({
        type: 'title_attached',
        severity: 'error',
        term: rus,
        category: 'characters',
        details: `В термин персонажа «${rus}» (${eng}) включён титул или обращение.`,
        recommendation: 'Выделите имя персонажа в категорию characters, а титул добавьте в system_and_terms.',
      });
    }
  });

  // 3. Homonym Surname: Single-word Chinese/Korean surname without given name
  const singleSurnameRegex =
    /^(?:Чжао|Чэнь|Линь|Ван|Ли|Су|Сяо|Лю|Е|Хуан|У|Цянь|Сунь|Чжоу|Ян|Zhao|Chen|Lin|Wang|Li|Su|Xiao|Liu|Zhang|Ye|Huang|Wu|Qian|Sun|Zhou|Yang)$/i;
  Object.entries(glossary.characters || {}).forEach(([eng, rus]) => {
    if (singleSurnameRegex.test(rus.trim()) || singleSurnameRegex.test(eng.trim())) {
      issues.push({
        type: 'homonym_surname',
        severity: 'warning',
        term: rus,
        category: 'characters',
        details: `Односложная фамилия «${rus}» (${eng}) без уточнения личного имени может вызвать омонимические коллизии с другими персонажами того же клана.`,
        recommendation: 'Укажите полное имя персонажа (напр. «Линь Сюань» вместо «Линь»).',
      });
    }
  });

  // 4. Substring Shadowing: Shorter term is a prefix or whole-word substring of a longer term
  const allTerms: Array<{ eng: string; rus: string; category: string }> = [];
  (Object.keys(glossary) as GlossaryCategory[]).forEach((cat) => {
    Object.entries(glossary[cat] || {}).forEach(([eng, rus]) => {
      allTerms.push({ eng, rus, category: cat });
    });
  });

  const reportedShadows = new Set<string>();
  const isShadowed = (shortStr: string, longStr: string): boolean => {
    if (!shortStr || !longStr || shortStr.length >= longStr.length) return false;
    const esc = shortStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordRe = new RegExp(`(?:^|[\\s.,!?:;«"'\\[(])${esc}(?:$|[\\s.,!?:;»"'\\])])`, 'i');
    return wordRe.test(longStr);
  };

  for (let i = 0; i < allTerms.length; i++) {
    for (let j = 0; j < allTerms.length; j++) {
      if (i === j) continue;
      const a = allTerms[i];
      const b = allTerms[j];
      const cleanEngA = a.eng.trim();
      const cleanEngB = b.eng.trim();
      const cleanRusA = a.rus.replace(/^[«"]|[»"]$/g, '').trim();
      const cleanRusB = b.rus.replace(/^[«"]|[»"]$/g, '').trim();

      const engClash = isShadowed(cleanEngA, cleanEngB);
      const rusClash = isShadowed(cleanRusA, cleanRusB);

      if (engClash || rusClash) {
        const shadowKey = `${a.eng}->${b.eng}`;
        if (!reportedShadows.has(shadowKey)) {
          reportedShadows.add(shadowKey);
          issues.push({
            type: 'substring_shadowing',
            severity: 'warning',
            term: a.eng,
            category: a.category,
            details: `Короткий термин «${a.eng}» («${a.rus}») входит как отдельная часть в более длинный термин «${b.eng}» («${b.rus}»).`,
            recommendation: 'Убедитесь, что поиск терминов выполняется в порядке убывания длины (longest-match-first).',
          });
        }
      }
    }
  }

  return issues;
}

export interface CharacterVoiceCardV3 {
  charNameEng: string;
  charNameRus: string;
  gender: GrammaticalGender;
  declensionNote?: string;
  voiceNote?: string;
  speechVector: CharacterSpeechVector;
}

/**
 * Derives or defaults an 8-attribute S-VoCAL speech vector for a character.
 */
export function deriveDefaultSpeechVector(
  charNameRus: string,
  meta?: GlossaryTermMeta
): CharacterSpeechVector {
  if (meta?.speechVector) {
    return meta.speechVector;
  }

  const voiceNoteLower = (meta?.voiceNote || '').toLowerCase();
  const isFemale = meta?.gender === 'F';

  // 1. Archetype detection from voiceNote or character name
  if (voiceNoteLower.includes('архаичн') || voiceNoteLower.includes('старейшин') || voiceNoteLower.includes('властн')) {
    return {
      registerLevel: 0.8,
      sentenceLengthBias: 'ornate_periodic',
      ellipsisRate: 'low',
      inversionTendency: 'high',
      preferredParticles: ['ведь', 'ибо'],
      forbiddenLexicon: ['окей', 'круто', 'проблема', 'парень', 'чувак'],
      catchphrasesOrTics: ['Дерзость.', 'Ничтожество.'],
      contrastiveDialogueSamples: [
        {
          context: 'Отказ младшему ученику',
          badNeutralAi: '«Я не дам тебе эту таблетку, потому что ты ещё не готов к ней».',
          canonicalVoiceRu: '«Мал ещё тягаться со старшими. Знай своё место».',
        },
      ],
    };
  }

  if (voiceNoteLower.includes('груб') || voiceNoteLower.includes('разбойн') || voiceNoteLower.includes('бродяч')) {
    return {
      registerLevel: -0.7,
      sentenceLengthBias: 'clipped_staccato',
      ellipsisRate: 'low',
      inversionTendency: 'low',
      preferredParticles: ['-то', 'ну', 'слышь'],
      forbiddenLexicon: ['изволите', 'соблаговолите', 'позвольте'],
      catchphrasesOrTics: ['Живо выкладывай!'],
      contrastiveDialogueSamples: [
        {
          context: 'Требование дани',
          badNeutralAi: '«Отдай нам пожалуйста свои духовные камни прямо сейчас».',
          canonicalVoiceRu: '«Живо выкладывай камни, если шкура дорога!»',
        },
      ],
    };
  }

  if (isFemale || voiceNoteLower.includes('холодн') || voiceNoteLower.includes('дева') || voiceNoteLower.includes('фея')) {
    return {
      registerLevel: 0.5,
      sentenceLengthBias: 'balanced_conversational',
      ellipsisRate: 'medium',
      inversionTendency: 'medium',
      preferredParticles: ['разве', 'уж'],
      forbiddenLexicon: ['братан', 'чувак', 'бабло', 'парень'],
      contrastiveDialogueSamples: [
        {
          context: 'Холодное предупреждение',
          badNeutralAi: '«Ты делаешь ошибку, нападая на меня в этом месте».',
          canonicalVoiceRu: '«Не ту цель выбрал. Опомниться не успеешь».',
        },
      ],
    };
  }

  // Default protagonist / cultivation youth vector
  return {
    registerLevel: 0.1,
    sentenceLengthBias: 'balanced_conversational',
    ellipsisRate: 'low',
    inversionTendency: 'medium',
    preferredParticles: ['-то', 'ну', 'что ли'],
    forbiddenLexicon: ['окей', 'круто', 'информация', 'проблема'],
    contrastiveDialogueSamples: [
      {
        context: 'Боевая усмешка',
        badNeutralAi: '«Вы совершили ошибку, выбрав меня в качестве своей цели».',
        canonicalVoiceRu: '«Не на того напали», — холодно усмехнулся юноша.',
      },
    ],
  };
}

/**
 * Builds the CharacterVoiceCardV3 prompt block (S-VoCAL & Speech Vectors)
 * for all characters present in the chapter.
 */
export function buildCharacterVoicePromptBlock(
  filteredGlossary: CanonicalGlossary,
  glossaryMeta?: Record<string, GlossaryTermMeta>
): string {
  const characters = filteredGlossary.characters || {};
  const entries = Object.entries(characters);
  if (entries.length === 0) {
    return '[CHARACTER VOICE CARDS (S-VoCAL & SPEECH VECTORS)]: No named characters in active chapter vocabulary.';
  }

  const lines: string[] = ['[CHARACTER VOICE CARDS (S-VoCAL & SPEECH VECTORS)]:'];

  for (const [eng, rus] of entries) {
    const meta = glossaryMeta?.[eng];
    const vector = deriveDefaultSpeechVector(rus, meta);
    const gender = meta?.gender || inferGenderFromContext(eng, meta?.voiceNote || meta?.declensionNote);

    lines.push(`### ${rus} (${eng}) · Gender: ${gender}`);
    if (meta?.declensionNote) {
      lines.push(`- Declension Note: ${meta.declensionNote}`);
    }
    if (meta?.voiceNote) {
      lines.push(`- Role & Social Tone: ${meta.voiceNote}`);
    }
    lines.push(
      `- SpeechVector: Register: ${vector.registerLevel > 0 ? `+${vector.registerLevel}` : vector.registerLevel}, Rhythm: ${vector.sentenceLengthBias}, Inversion: ${vector.inversionTendency}, Ellipsis: ${vector.ellipsisRate}`
    );
    lines.push(`- Preferred Particles: ${vector.preferredParticles.map((p) => `«${p}»`).join(', ')}`);
    lines.push(`- Forbidden Lexicon (DO NOT USE IN REPLIES): ${vector.forbiddenLexicon.map((w) => `"${w}"`).join(', ')}`);
    if (vector.catchphrasesOrTics && vector.catchphrasesOrTics.length > 0) {
      lines.push(`- Characteristic Tics: ${vector.catchphrasesOrTics.join('; ')}`);
    }
    if (vector.contrastiveDialogueSamples && vector.contrastiveDialogueSamples.length > 0) {
      lines.push('- Contrastive Samples:');
      for (const s of vector.contrastiveDialogueSamples) {
        lines.push(`  * [${s.context}] Bad AI: ${s.badNeutralAi} → Canonical RU: ${s.canonicalVoiceRu}`);
      }
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

