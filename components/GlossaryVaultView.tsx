'use client';

import React, { useState, useMemo, useRef } from 'react';
import {
  Check,
  X,
  Plus,
  Search,
  Sparkles,
  Download,
  Trash2,
  CheckCheck,
  Replace,
  BookOpen,
} from 'lucide-react';
import { previewAndApplyCanonRipple } from '@/lib/canon-glossary-vault';
import type {
  CanonicalGlossary,
  GlossaryCategory,
  GlossaryTermMeta,
  GrammaticalGender,
  ScoutedTerm,
} from '@/lib/pipeline-types';
import type { ChapterRecord } from '@/lib/seed-data';

interface GlossaryVaultViewProps {
  glossary: CanonicalGlossary;
  glossaryMeta: Record<string, GlossaryTermMeta>;
  scoutedTerms: ScoutedTerm[];
  chapters: ChapterRecord[];
  onApproveScoutedTerm: (
    termId: string,
    customRus?: string,
    category?: GlossaryCategory,
    gender?: GrammaticalGender
  ) => void;
  onAutoApproveHighConfidence: (threshold: number) => void;
  onRejectScoutedTerm: (termId: string) => void;
  onAddCanonTerm: (
    category: GlossaryCategory,
    eng: string,
    rus: string,
    gender?: GrammaticalGender,
    declensionNote?: string,
    voiceNote?: string
  ) => void;
  onUpdateTermMeta: (
    eng: string,
    gender?: GrammaticalGender,
    declensionNote?: string,
    voiceNote?: string
  ) => void;
  onRemoveCanonTerm: (category: GlossaryCategory, eng: string) => void;
  onScoutChapterTerms: (chapterId: string) => Promise<void>;
  onApplyCanonRipple?: (
    oldRusTerm: string,
    newRusTerm: string,
    targetEngKey?: string
  ) => number;
  isScouting: boolean;
}

const CATEGORY_LABELS: Record<GlossaryCategory, string> = {
  realms: 'Культивация и ранги',
  characters: 'Персонажи',
  sects_and_places: 'Секты, гильдии и локации',
  system_and_terms: 'Система, навыки и артефакты',
  units: 'Единицы измерения',
};

const GENDER_OPTIONS: Array<{ value: GrammaticalGender; label: string }> = [
  { value: 'UNKNOWN', label: 'Не указан' },
  { value: 'M', label: 'М (мужской)' },
  { value: 'F', label: 'Ж (женский)' },
  { value: 'N', label: 'Ср (средний)' },
  { value: 'PL', label: 'Мн (множеств.)' },
];

type GlossarySubTab = 'canon' | 'scouted' | 'ripple';

export default function GlossaryVaultView({
  glossary,
  glossaryMeta,
  scoutedTerms,
  chapters,
  onApproveScoutedTerm,
  onAutoApproveHighConfidence,
  onRejectScoutedTerm,
  onAddCanonTerm,
  onUpdateTermMeta,
  onRemoveCanonTerm,
  onScoutChapterTerms,
  onApplyCanonRipple,
  isScouting,
}: GlossaryVaultViewProps) {
  const [subView, setSubView] = useState<GlossarySubTab>('canon');
  const [activeCategory, setActiveCategory] = useState<GlossaryCategory | 'all'>('all');
  const [onlyUnknownGender, setOnlyUnknownGender] = useState(false);
  const [onlyUnknownScoutedGender, setOnlyUnknownScoutedGender] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEng, setNewEng] = useState('');
  const [newRus, setNewRus] = useState('');
  const [newCategory, setNewCategory] = useState<GlossaryCategory>('characters');
  const [newGender, setNewGender] = useState<GrammaticalGender>('UNKNOWN');
  const [newDeclensionNote, setNewDeclensionNote] = useState('');
  const [newVoiceNote, setNewVoiceNote] = useState('');
  const [selectedChapterForScout, setSelectedChapterForScout] = useState(
    chapters[0]?.id || ''
  );
  const [editedSuggestions, setEditedSuggestions] = useState<Record<string, string>>({});
  const [editedGenders, setEditedGenders] = useState<Record<string, GrammaticalGender>>({});

  // Canon Ripple Refactoring state
  const [rippleEngKey, setRippleEngKey] = useState<string>('Origin Points');
  const [rippleOldRus, setRippleOldRus] = useState<string>('Очки Истока');
  const [rippleNewRus, setRippleNewRus] = useState<string>('Очки Изначальности');
  const [rippleSuccessBanner, setRippleSuccessBanner] = useState<string | null>(null);

  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const pendingScouted = useMemo(
    () => scoutedTerms.filter((t) => !t.approved_for_glossary),
    [scoutedTerms]
  );

  const highConfidencePendingCount = useMemo(
    () => pendingScouted.filter((t) => t.confidence >= 0.92).length,
    [pendingScouted]
  );

  const unknownCharactersCount = useMemo(() => {
    const charactersBucket = glossary.characters || {};
    return Object.keys(charactersBucket).filter((eng) => {
      const g = glossaryMeta?.[eng]?.gender as GrammaticalGender | undefined;
      return !g || g === 'UNKNOWN';
    }).length;
  }, [glossary.characters, glossaryMeta]);

  const unknownScoutedCharactersCount = useMemo(
    () =>
      pendingScouted.filter((t) => {
        if (t.category !== 'characters') return false;
        const g = (editedGenders[t.id] ?? t.gender ?? 'UNKNOWN') as GrammaticalGender;
        return g === 'UNKNOWN';
      }).length,
    [pendingScouted, editedGenders]
  );

  const visiblePendingScouted = useMemo(() => {
    if (!onlyUnknownScoutedGender) return pendingScouted;
    return pendingScouted.filter((t) => {
      if (t.category !== 'characters') return false;
      const g = (editedGenders[t.id] ?? t.gender ?? 'UNKNOWN') as GrammaticalGender;
      return g === 'UNKNOWN';
    });
  }, [pendingScouted, onlyUnknownScoutedGender, editedGenders]);

  const flattenedCanon = useMemo(() => {
    const entries: Array<{
      category: GlossaryCategory;
      eng: string;
      rus: string;
      gender?: GrammaticalGender;
      declensionNote?: string;
      voiceNote?: string;
    }> = [];
    (Object.keys(CATEGORY_LABELS) as GlossaryCategory[]).forEach((cat) => {
      const group = glossary[cat] || {};
      Object.entries(group).forEach(([eng, rus]) => {
        const meta = glossaryMeta?.[eng];
        entries.push({
          category: cat,
          eng,
          rus,
          gender: meta?.gender as GrammaticalGender | undefined,
          declensionNote: meta?.declensionNote,
          voiceNote: meta?.voiceNote,
        });
      });
    });

    return entries.filter((item) => {
      if (onlyUnknownGender) {
        if (item.category !== 'characters') return false;
        if (item.gender && item.gender !== 'UNKNOWN') return false;
      } else if (activeCategory !== 'all' && item.category !== activeCategory) {
        return false;
      }
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase();
      return (
        item.eng.toLowerCase().includes(q) ||
        item.rus.toLowerCase().includes(q) ||
        (item.declensionNote || '').toLowerCase().includes(q) ||
        (item.voiceNote || '').toLowerCase().includes(q)
      );
    });
  }, [glossary, glossaryMeta, activeCategory, onlyUnknownGender, searchQuery]);

  const totalCanonCount = useMemo(
    () =>
      (Object.keys(CATEGORY_LABELS) as GlossaryCategory[]).reduce(
        (sum, cat) => sum + Object.keys(glossary[cat] || {}).length,
        0
      ),
    [glossary]
  );

  const ripplePreview = useMemo(() => {
    return previewAndApplyCanonRipple(chapters, rippleOldRus, rippleNewRus);
  }, [chapters, rippleOldRus, rippleNewRus]);

  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEng.trim() || !newRus.trim()) return;
    onAddCanonTerm(
      newCategory,
      newEng.trim(),
      newRus.trim(),
      newCategory === 'characters' ? newGender : undefined,
      newDeclensionNote.trim() || undefined,
      newVoiceNote.trim() || undefined
    );
    setNewEng('');
    setNewRus('');
    setNewGender('UNKNOWN');
    setNewDeclensionNote('');
    setNewVoiceNote('');
    setShowAddForm(false);
  };

  const handleExecuteRipple = () => {
    if (!onApplyCanonRipple || !rippleOldRus.trim() || !rippleNewRus.trim()) return;
    const count = onApplyCanonRipple(
      rippleOldRus.trim(),
      rippleNewRus.trim(),
      rippleEngKey || undefined
    );
    setRippleSuccessBanner(
      `Каскадная замена выполнена: обновлено ${count} вхождений «${rippleOldRus}» → «${rippleNewRus}» во всех переведённых главах и в каноне.`
    );
    setRippleOldRus(rippleNewRus.trim());
  };

  const exportGlossaryJson = () => {
    const payload = {
      canonical: glossary,
      glossaryMeta,
      scouted_buffer: scoutedTerms,
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'glossary_canon_v2.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const subTabs: Array<{ id: GlossarySubTab; label: string; icon?: React.ReactNode }> = [
    { id: 'canon', label: `Канонический глоссарий (${totalCanonCount})` },
    { id: 'scouted', label: `Буфер скаутинга (${pendingScouted.length})` },
    {
      id: 'ripple',
      label: 'Глобальная замена (Ripple)',
      icon: <Replace className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />,
    },
  ];

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const idx = subTabs.findIndex((t) => t.id === subView);
    if (idx === -1) return;
    let nextIdx = -1;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % subTabs.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + subTabs.length) % subTabs.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = subTabs.length - 1;
    if (nextIdx >= 0) {
      e.preventDefault();
      setSubView(subTabs[nextIdx].id);
      tabRefs.current[nextIdx]?.focus();
    }
  };

  return (
    <div className="space-y-5">
      {/* Unified Sub-Tab Bar + Primary Action */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/[0.08] pb-2">
        <div
          role="tablist"
          aria-label="Разделы глоссария"
          onKeyDown={handleTabKeyDown}
          className="flex items-center gap-1 overflow-x-auto studio-tablist"
        >
          {subTabs.map((t, i) => {
            const isSelected = subView === t.id;
            return (
              <button
                key={t.id}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`glossary-tab-${t.id}`}
                aria-selected={isSelected}
                tabIndex={isSelected ? 0 : -1}
                onClick={() => setSubView(t.id)}
                className={`studio-tab inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                  isSelected ? 'text-[#F3F4F6]' : 'text-[#8893A8] hover:text-[#F3F4F6]'
                }`}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {subView === 'canon' && (
            <button
              type="button"
              onClick={() => setShowAddForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#D99B26] px-3.5 py-2 text-xs font-semibold text-[#090A0F] transition-colors hover:bg-[#E5AC3D]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Добавить термин</span>
            </button>
          )}
          <button
            type="button"
            onClick={exportGlossaryJson}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#10131C] px-3 py-2 text-xs font-medium text-[#B0B8C9] transition-colors hover:border-white/[0.2] hover:text-[#F3F4F6]"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Экспорт JSON</span>
          </button>
        </div>
      </div>

      {/* Collapsible Add Term Form */}
      {showAddForm && subView === 'canon' && (
        <form
          onSubmit={handleAddSubmit}
          className="rounded-xl border border-white/[0.1] bg-[#10131C] p-4 space-y-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <select
              aria-label="Категория термина"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as GlossaryCategory)}
              className="rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none sm:col-span-3"
            >
              {(Object.keys(CATEGORY_LABELS) as GlossaryCategory[]).map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
            <input
              type="text"
              aria-label="Оригинал ENG"
              value={newEng}
              onChange={(e) => setNewEng(e.target.value)}
              placeholder="Оригинал ENG (напр. Su Qingxue)"
              className="rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none sm:col-span-3"
            />
            <input
              type="text"
              aria-label="Канон RUS"
              value={newRus}
              onChange={(e) => setNewRus(e.target.value)}
              placeholder="Канон RUS (напр. Су Цинсюэ)"
              className="rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none sm:col-span-3"
            />
            <select
              aria-label="Грамматический род"
              value={newGender}
              onChange={(e) => setNewGender(e.target.value as GrammaticalGender)}
              className="rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none sm:col-span-3"
              title="Грамматический род для контроля глаголов"
            >
              {GENDER_OPTIONS.map((g) => (
                <option key={g.value} value={g.value}>
                  Род: {g.label}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <input
              type="text"
              aria-label="Примечание по склонению"
              value={newDeclensionNote}
              onChange={(e) => setNewDeclensionNote(e.target.value)}
              placeholder="Склонение (напр. женский род, не склоняется)"
              className="rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none sm:col-span-5"
            />
            <input
              type="text"
              aria-label="Речевой портрет и обращение на ты или Вы"
              value={newVoiceNote}
              onChange={(e) => setNewVoiceNote(e.target.value)}
              placeholder="Речевой портрет и «ты/Вы» (напр. Холодный тон; к старейшинам на «Вы»)"
              className="rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none sm:col-span-5"
            />
            <button
              type="submit"
              className="rounded-lg bg-[#D99B26] px-4 py-2 text-xs font-semibold text-[#090A0F] transition-colors hover:bg-[#E5AC3D] sm:col-span-2"
            >
              Сохранить
            </button>
          </div>
        </form>
      )}

      {/* SUBVIEW 1: CANONICAL GLOSSARY */}
      {subView === 'canon' && (
        <div role="tabpanel" aria-labelledby="glossary-tab-canon" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setOnlyUnknownGender(false);
                  setActiveCategory('all');
                }}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  !onlyUnknownGender && activeCategory === 'all'
                    ? 'border border-white/[0.12] bg-[#151925] text-[#F3F4F6]'
                    : 'border border-transparent text-[#8893A8] hover:text-[#F3F4F6]'
                }`}
              >
                Все
              </button>
              {(Object.keys(CATEGORY_LABELS) as GlossaryCategory[]).map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setOnlyUnknownGender(false);
                    setActiveCategory(cat);
                  }}
                  className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    !onlyUnknownGender && activeCategory === cat
                      ? 'border border-white/[0.12] bg-[#151925] text-[#E5AC3D]'
                      : 'border border-transparent text-[#8893A8] hover:text-[#F3F4F6]'
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
              {unknownCharactersCount > 0 && (
                <button
                  type="button"
                  onClick={() => setOnlyUnknownGender((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors tabular-nums ${
                    onlyUnknownGender
                      ? 'border-[#D99B26]/60 bg-[#D99B26]/20 text-[#E5AC3D]'
                      : 'border-[#D99B26]/30 bg-[#D99B26]/10 text-[#E5AC3D] hover:bg-[#D99B26]/15'
                  }`}
                >
                  Персонажи без пола ({unknownCharactersCount})
                </button>
              )}
            </div>

            <div className="relative w-full sm:w-72">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#8893A8]"
                aria-hidden="true"
              />
              <input
                type="search"
                aria-label="Поиск по каноническому глоссарию"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по термину, склонению, речи..."
                className="w-full rounded-lg border border-white/[0.1] bg-[#10131C] py-1.5 pl-8 pr-8 text-xs text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Очистить поиск"
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex min-h-6 min-w-6 items-center justify-center rounded text-[#8893A8] hover:text-[#F3F4F6]"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-white/[0.08] bg-[#10131C]">
            <table className="w-full text-left border-collapse tabular-nums">
              <caption className="visually-hidden">
                Утверждённый канонический глоссарий произведения
              </caption>
              <thead>
                <tr className="border-b border-white/[0.08] bg-[#0D1017] text-[11px] font-medium text-[#8893A8]">
                  <th scope="col" className="py-3 pl-4 pr-3">Оригинал (ENG)</th>
                  <th scope="col" className="px-3 py-3">Утверждённый канон (RUS)</th>
                  <th scope="col" className="px-3 py-3">Род (М/Ж) и падежи</th>
                  <th scope="col" className="px-3 py-3">Матрица речи и «ты/Вы»</th>
                  <th scope="col" className="py-3 pl-3 pr-4 text-right">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.05] text-xs">
                {flattenedCanon.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-6 py-10 text-center">
                      <div className="space-y-2">
                        <BookOpen className="mx-auto h-6 w-6 text-[#8893A8]" aria-hidden="true" />
                        <p className="text-sm font-medium text-[#F3F4F6]">
                          Термины по заданному фильтру не найдены
                        </p>
                        {(activeCategory !== 'all' || onlyUnknownGender || searchQuery.trim()) && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveCategory('all');
                              setOnlyUnknownGender(false);
                              setSearchQuery('');
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-white/[0.12] bg-[#151925] px-3 py-1.5 text-xs font-medium text-[#F3F4F6] hover:border-[#D99B26]/50"
                          >
                            Сбросить фильтры
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  flattenedCanon.map((item) => {
                    const isUnclassifiedCharacter =
                      item.category === 'characters' &&
                      (!item.gender || item.gender === 'UNKNOWN');

                    return (
                      <tr
                        key={`${item.category}-${item.eng}`}
                        className={`transition-colors ${
                          isUnclassifiedCharacter
                            ? 'bg-[#D99B26]/[0.06] hover:bg-[#D99B26]/[0.1]'
                            : 'hover:bg-white/[0.025]'
                        }`}
                      >
                        <td className="py-2.5 pl-4 pr-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-medium text-[#F3F4F6]">
                              {item.eng}
                            </span>
                            {isUnclassifiedCharacter && (
                              <span className="rounded border border-[#D99B26]/40 bg-[#D99B26]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#E5AC3D]">
                                Пол не указан
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-[#8893A8]">
                            {CATEGORY_LABELS[item.category]}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 font-medium text-[#E5AC3D]">
                          {item.rus}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap items-center gap-2">
                            <select
                              aria-label={`Грамматический род для ${item.eng}`}
                              value={
                                item.gender ||
                                (item.category === 'characters' ? 'UNKNOWN' : '')
                              }
                              onChange={(e) => {
                                const val = e.target.value as GrammaticalGender | '';
                                onUpdateTermMeta(
                                  item.eng,
                                  val ? (val as GrammaticalGender) : undefined,
                                  item.declensionNote,
                                  item.voiceNote
                                );
                              }}
                              className={`rounded-lg border px-2 py-1 text-[11px] focus:outline-none ${
                                isUnclassifiedCharacter
                                  ? 'border-[#D99B26]/50 bg-[#151925] text-[#E5AC3D] focus:border-[#D99B26]'
                                  : 'border-white/[0.1] bg-[#0A0C12] text-[#B0B8C9] focus:border-[#D99B26]'
                              }`}
                            >
                              {item.category !== 'characters' && (
                                <option value="">Не применимо</option>
                              )}
                              {GENDER_OPTIONS.map((g) => (
                                <option key={g.value} value={g.value}>
                                  {g.label}
                                </option>
                              ))}
                            </select>
                            {item.declensionNote && (
                              <span className="text-[11px] text-[#8893A8]">
                                {item.declensionNote}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">
                          <input
                            type="text"
                            aria-label={`Речевой портрет для ${item.eng}`}
                            value={item.voiceNote || ''}
                            onChange={(e) =>
                              onUpdateTermMeta(
                                item.eng,
                                item.gender,
                                item.declensionNote,
                                e.target.value
                              )
                            }
                            placeholder={
                              item.category === 'characters'
                                ? 'Задать тон речи / обращение ты-Вы...'
                                : 'Примечание для ИИ...'
                            }
                            className="w-full min-w-[200px] rounded-lg border border-white/[0.08] bg-[#0A0C12] px-2.5 py-1.5 text-[11px] text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none"
                          />
                        </td>
                        <td className="py-2.5 pl-3 pr-4 text-right">
                          <div className="inline-flex items-center gap-1">
                            <button
                              type="button"
                              aria-label={`Заменить ${item.rus} во всех главах`}
                              onClick={() => {
                                setRippleEngKey(item.eng);
                                setRippleOldRus(item.rus);
                                setRippleNewRus(item.rus);
                                setSubView('ripple');
                              }}
                              className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-lg text-[#8893A8] transition-colors hover:bg-white/[0.06] hover:text-[#E5AC3D]"
                              title="Переименовать во всех переведённых главах (Ripple)"
                            >
                              <Replace className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Удалить ${item.eng} из канона`}
                              onClick={() => onRemoveCanonTerm(item.category, item.eng)}
                              className="inline-flex min-h-7 min-w-7 items-center justify-center rounded-lg text-[#8893A8] transition-colors hover:bg-rose-500/15 hover:text-rose-300"
                              title="Удалить из канона"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBVIEW 2: SCOUTED BUFFER */}
      {subView === 'scouted' && (
        <div role="tabpanel" aria-labelledby="glossary-tab-scouted" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/[0.09] bg-[#10131C] p-4">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-[#F3F4F6]">
                Сканирование новых терминов и авто-одобрение
              </div>
              <p className="text-xs text-[#8893A8]">
                Кандидаты с точностью ≥92% можно утвердить в канонический глоссарий одной кнопкой.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {unknownScoutedCharactersCount > 0 && (
                <button
                  type="button"
                  onClick={() => setOnlyUnknownScoutedGender((v) => !v)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors tabular-nums ${
                    onlyUnknownScoutedGender
                      ? 'border-[#D99B26]/60 bg-[#D99B26]/20 text-[#E5AC3D]'
                      : 'border-[#D99B26]/30 bg-[#D99B26]/10 text-[#E5AC3D] hover:bg-[#D99B26]/15'
                  }`}
                >
                  Персонажи без пола ({unknownScoutedCharactersCount})
                </button>
              )}
              {highConfidencePendingCount > 0 && (
                <button
                  type="button"
                  onClick={() => onAutoApproveHighConfidence(0.92)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3.5 py-1.5 text-xs font-semibold text-emerald-300 transition-colors hover:bg-emerald-500/25"
                >
                  <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Авто-утвердить ≥92% ({highConfidencePendingCount})</span>
                </button>
              )}
              <select
                aria-label="Выбор главы для сканирования ИИ-скаутом"
                value={selectedChapterForScout}
                onChange={(e) => setSelectedChapterForScout(e.target.value)}
                className="rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-1.5 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
              >
                {chapters.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    Глава {ch.subPart || ch.number}: {ch.titleEng}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => onScoutChapterTerms(selectedChapterForScout)}
                disabled={isScouting}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#D99B26] px-3.5 py-1.5 text-xs font-semibold text-[#090A0F] transition-colors hover:bg-[#E5AC3D] disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                <span>{isScouting ? 'Сканирование...' : 'Запустить ИИ-скаут'}</span>
              </button>
            </div>
          </div>

          {visiblePendingScouted.length === 0 ? (
            <div className="rounded-xl border border-white/[0.08] bg-[#10131C] p-10 text-center text-xs text-[#8893A8]">
              {onlyUnknownScoutedGender
                ? 'Все кандидаты-персонажи уже классифицированы по роду.'
                : 'Все найденные термины рассмотрены и добавлены в канон.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {visiblePendingScouted.map((term) => {
                const currentRus =
                  editedSuggestions[term.id] !== undefined
                    ? editedSuggestions[term.id]
                    : term.rus_suggested;
                const currentGender: GrammaticalGender =
                  editedGenders[term.id] !== undefined
                    ? editedGenders[term.id]
                    : ((term.gender as GrammaticalGender | undefined) || 'UNKNOWN');
                const isUnclassifiedCharacter =
                  term.category === 'characters' && currentGender === 'UNKNOWN';

                return (
                  <div
                    key={term.id}
                    className={`flex flex-col justify-between rounded-xl border p-4 space-y-3 ${
                      isUnclassifiedCharacter
                        ? 'border-[#D99B26]/40 bg-[#10131C]'
                        : 'border-white/[0.08] bg-[#10131C]'
                    }`}
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-sm font-semibold text-[#F3F4F6]">
                            {term.eng}
                          </span>
                          {isUnclassifiedCharacter && (
                            <span className="rounded border border-[#D99B26]/40 bg-[#D99B26]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#E5AC3D]">
                              Пол не указан
                            </span>
                          )}
                        </div>
                        <span
                          className={`font-mono text-[11px] tabular-nums ${
                            term.confidence >= 0.92
                              ? 'text-emerald-300 font-semibold'
                              : 'text-[#8893A8]'
                          }`}
                        >
                          Глава {term.chapter_first_seen} ·{' '}
                          {Math.round(term.confidence * 100)}%
                        </span>
                      </div>
                      <p className="text-xs text-[#B0B8C9] leading-relaxed">
                        «{term.context_snippet}»
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2.5 border-t border-white/[0.07]">
                      <input
                        type="text"
                        aria-label={`Русский вариант для ${term.eng}`}
                        value={currentRus}
                        onChange={(e) =>
                          setEditedSuggestions((prev) => ({
                            ...prev,
                            [term.id]: e.target.value,
                          }))
                        }
                        className="min-w-[140px] flex-1 rounded-lg border border-white/[0.1] bg-[#0A0C12] px-2.5 py-1.5 text-xs font-medium text-[#E5AC3D] focus:border-[#D99B26] focus:outline-none"
                      />
                      {term.category === 'characters' && (
                        <select
                          aria-label={`Род для ${term.eng}`}
                          value={currentGender}
                          onChange={(e) =>
                            setEditedGenders((prev) => ({
                              ...prev,
                              [term.id]: e.target.value as GrammaticalGender,
                            }))
                          }
                          className={`rounded-lg border px-2 py-1.5 text-xs focus:outline-none ${
                            isUnclassifiedCharacter
                              ? 'border-[#D99B26]/50 bg-[#151925] text-[#E5AC3D]'
                              : 'border-white/[0.1] bg-[#0A0C12] text-[#B0B8C9]'
                          }`}
                        >
                          {GENDER_OPTIONS.map((g) => (
                            <option key={g.value} value={g.value}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          onApproveScoutedTerm(
                            term.id,
                            currentRus,
                            term.category,
                            term.category === 'characters' ? currentGender : undefined
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 transition-colors hover:bg-emerald-500/25"
                      >
                        <Check className="h-3.5 w-3.5" aria-hidden="true" />
                        <span>В канон</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Отклонить термин ${term.eng}`}
                        onClick={() => onRejectScoutedTerm(term.id)}
                        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-lg border border-white/[0.1] bg-[#0A0C12] text-[#8893A8] transition-colors hover:text-rose-300"
                        title="Отклонить"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* SUBVIEW 3: RETROACTIVE CANON RIPPLE REFACTORING */}
      {subView === 'ripple' && (
        <div
          role="tabpanel"
          aria-labelledby="glossary-tab-ripple"
          className="space-y-4 rounded-xl border border-white/[0.09] bg-[#10131C] p-5"
        >
          <div className="space-y-1">
            <h2 className="font-display text-sm font-semibold text-[#F3F4F6]">
              Каскадная замена термина во всех переведённых главах
            </h2>
            <p className="text-xs text-[#8893A8]">
              Переименование ранга, артефакта или имени обновит все падежные словоформы в переведённых главах и в каноне.
            </p>
          </div>

          {rippleSuccessBanner && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-200">
              {rippleSuccessBanner}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-4">
              <label
                htmlFor="ripple-canon-select"
                className="mb-1.5 block text-[11px] font-medium text-[#B0B8C9]"
              >
                Выбрать из канона
              </label>
              <select
                id="ripple-canon-select"
                value={rippleEngKey}
                onChange={(e) => {
                  const eng = e.target.value;
                  setRippleEngKey(eng);
                  const found = flattenedCanon.find((c) => c.eng === eng);
                  if (found) {
                    setRippleOldRus(found.rus);
                  }
                }}
                className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
              >
                <option value="">— Произвольный термин —</option>
                {flattenedCanon.map((c) => (
                  <option key={`${c.category}-${c.eng}`} value={c.eng}>
                    {c.eng} → {c.rus}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="ripple-old-rus"
                className="mb-1.5 block text-[11px] font-medium text-[#B0B8C9]"
              >
                Старый перевод (RUS)
              </label>
              <input
                id="ripple-old-rus"
                type="text"
                value={rippleOldRus}
                onChange={(e) => setRippleOldRus(e.target.value)}
                placeholder="Напр. Очки Истока"
                className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs text-[#F3F4F6] focus:border-[#D99B26] focus:outline-none"
              />
            </div>

            <div className="sm:col-span-3">
              <label
                htmlFor="ripple-new-rus"
                className="mb-1.5 block text-[11px] font-medium text-[#B0B8C9]"
              >
                Новый канон (RUS)
              </label>
              <input
                id="ripple-new-rus"
                type="text"
                value={rippleNewRus}
                onChange={(e) => setRippleNewRus(e.target.value)}
                placeholder="Напр. Очки Изначальности"
                className="w-full rounded-lg border border-white/[0.1] bg-[#0A0C12] px-3 py-2 text-xs font-medium text-[#E5AC3D] focus:border-[#D99B26] focus:outline-none"
              />
            </div>

            <div className="flex items-end sm:col-span-2">
              <button
                type="button"
                onClick={handleExecuteRipple}
                disabled={ripplePreview.totalOccurrences === 0 && !rippleEngKey}
                className="w-full rounded-lg bg-[#D99B26] px-3 py-2 text-xs font-semibold text-[#090A0F] transition-colors hover:bg-[#E5AC3D] disabled:opacity-40"
              >
                Заменить ({ripplePreview.totalOccurrences})
              </button>
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <div className="text-xs font-medium text-[#B0B8C9] tabular-nums">
              Предпросмотр: найдено {ripplePreview.totalOccurrences} вхождений в{' '}
              {ripplePreview.changes.length} главах
            </div>

            {ripplePreview.changes.length === 0 ? (
              <div className="rounded-lg border border-white/[0.07] bg-[#0A0C12] p-4 text-xs text-[#8893A8]">
                В переведённых главах не найдено вхождений «{rippleOldRus}».
              </div>
            ) : (
              <div className="space-y-2">
                {ripplePreview.changes.map((m) => (
                  <div
                    key={m.chapterId}
                    className="rounded-lg border border-white/[0.08] bg-[#0A0C12] p-3 text-xs space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[#E5AC3D]">
                        Глава {m.chapterNumber}
                      </span>
                      <span className="font-mono text-[11px] text-emerald-300">
                        Замен: {m.ReplacementsCount}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 text-[11px]">
                      <div className="rounded-lg border border-rose-500/25 bg-rose-950/20 p-2.5 text-[#B0B8C9]">
                        <span className="font-semibold text-rose-300">Было: </span>
                        {m.previewBefore}
                      </div>
                      <div className="rounded-lg border border-emerald-500/25 bg-emerald-950/20 p-2.5 text-[#F3F4F6]">
                        <span className="font-semibold text-emerald-300">Станет: </span>
                        {m.previewAfter}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
