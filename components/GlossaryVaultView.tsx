'use client';

import React, { useState, useMemo } from 'react';
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
} from 'lucide-react';
import {
  previewAndApplyCanonRipple,
  type CanonicalGlossary,
  type GlossaryCategory,
  type GlossaryTermMeta,
  type GrammaticalGender,
  type ScoutedTerm,
} from '@/lib/qa-linter';
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
  { value: 'M', label: 'М (мужской)' },
  { value: 'F', label: 'Ж (женский)' },
  { value: 'N', label: 'Ср (средний)' },
  { value: 'PL', label: 'Мн (множеств.)' },
];

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
  const [subView, setSubView] = useState<'canon' | 'scouted' | 'ripple'>('canon');
  const [activeCategory, setActiveCategory] = useState<GlossaryCategory | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddForm, setShowAddForm] = useState(false);
  const [newEng, setNewEng] = useState('');
  const [newRus, setNewRus] = useState('');
  const [newCategory, setNewCategory] = useState<GlossaryCategory>('characters');
  const [newGender, setNewGender] = useState<GrammaticalGender>('M');
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

  const pendingScouted = useMemo(
    () => scoutedTerms.filter((t) => !t.approved_for_glossary),
    [scoutedTerms]
  );

  const highConfidencePendingCount = useMemo(
    () => pendingScouted.filter((t) => t.confidence >= 0.92).length,
    [pendingScouted]
  );

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
          gender: meta?.gender,
          declensionNote: meta?.declensionNote,
          voiceNote: meta?.voiceNote,
        });
      });
    });

    return entries.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) {
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
  }, [glossary, glossaryMeta, activeCategory, searchQuery]);

  // Live preview of Canon Ripple across all translated chapters
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
      `Каскадная замена выполнена: обновлено ${count} вхождений «${rippleOldRus}» → «${rippleNewRus}» во всех переведённых главах (с учётом падежей) и в каноне.`
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

  return (
    <div className="space-y-5">
      {/* Clean Top Switcher: Canonical Glossary vs Scouted Buffer vs Canon Ripple */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/80 p-1">
          <button
            onClick={() => setSubView('canon')}
            className={`rounded-md px-3.5 py-2 text-xs font-medium transition ${
              subView === 'canon'
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Канонический глоссарий ({flattenedCanon.length})
          </button>
          <button
            onClick={() => setSubView('scouted')}
            className={`rounded-md px-3.5 py-2 text-xs font-medium transition ${
              subView === 'scouted'
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Буфер скаутинга ({pendingScouted.length})
          </button>
          <button
            onClick={() => setSubView('ripple')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-medium transition ${
              subView === 'ripple'
                ? 'bg-amber-500 text-slate-950 font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Replace className="h-3.5 w-3.5" />
            Глобальная замена по главам (Ripple)
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {subView === 'canon' && (
            <button
              onClick={() => setShowAddForm((prev) => !prev)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3.5 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400"
            >
              <Plus className="h-3.5 w-3.5" />
              Добавить термин / персонажа
            </button>
          )}
          <button
            onClick={exportGlossaryJson}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-700 hover:text-white"
          >
            <Download className="h-3.5 w-3.5" />
            Экспорт JSON
          </button>
        </div>
      </div>

      {/* Collapsible Add Term Form with Gender, Declension & Voice Matrix */}
      {showAddForm && subView === 'canon' && (
        <form
          onSubmit={handleAddSubmit}
          className="rounded-xl border border-slate-800 bg-slate-900/80 p-4 space-y-3"
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <select
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value as GlossaryCategory)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-amber-500/60 focus:outline-none sm:col-span-3"
            >
              {(Object.keys(CATEGORY_LABELS) as GlossaryCategory[]).map((cat) => (
                <option key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={newEng}
              onChange={(e) => setNewEng(e.target.value)}
              placeholder="Оригинал ENG (напр. Su Qingxue)"
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none sm:col-span-3"
            />
            <input
              type="text"
              value={newRus}
              onChange={(e) => setNewRus(e.target.value)}
              placeholder="Канон RUS (напр. Су Цинсюэ)"
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none sm:col-span-3"
            />
            <select
              value={newGender}
              onChange={(e) => setNewGender(e.target.value as GrammaticalGender)}
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-amber-500/60 focus:outline-none sm:col-span-3"
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
              value={newDeclensionNote}
              onChange={(e) => setNewDeclensionNote(e.target.value)}
              placeholder="Склонение (напр. женский род, не склоняется)"
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none sm:col-span-5"
            />
            <input
              type="text"
              value={newVoiceNote}
              onChange={(e) => setNewVoiceNote(e.target.value)}
              placeholder="Речевой портрет и «ты/Вы» (напр. Холодный тон; к старейшинам на «Вы»)"
              className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-300 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none sm:col-span-5"
            />
            <button
              type="submit"
              className="rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 sm:col-span-2"
            >
              Сохранить
            </button>
          </div>
        </form>
      )}

      {/* SUBVIEW 1: CANONICAL GLOSSARY */}
      {subView === 'canon' && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setActiveCategory('all')}
                className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                  activeCategory === 'all'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Все
              </button>
              {(Object.keys(CATEGORY_LABELS) as GlossaryCategory[]).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition ${
                    activeCategory === cat
                      ? 'bg-slate-800 text-amber-300'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {CATEGORY_LABELS[cat]}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-3.5 w-3.5 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Поиск по термину, склонению, речи..."
                className="w-full rounded-lg border border-slate-800 bg-slate-900/60 py-1.5 pl-8 pr-3 text-xs text-slate-200 placeholder:text-slate-500 focus:border-amber-500/60 focus:outline-none"
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-800/80 bg-slate-900/30">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/80 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-3 pl-4 pr-3">Оригинал (ENG)</th>
                  <th className="px-3 py-3">Утверждённый канон (RUS)</th>
                  <th className="px-3 py-3">Род (М/Ж) и падежи</th>
                  <th className="px-3 py-3">Матрица речи и «ты/Вы»</th>
                  <th className="py-3 pl-3 pr-4 text-right">Действие</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-xs">
                {flattenedCanon.map((item) => (
                  <tr
                    key={`${item.category}-${item.eng}`}
                    className="transition hover:bg-slate-900/60"
                  >
                    <td className="py-2.5 pl-4 pr-3">
                      <div className="font-mono font-medium text-slate-200">{item.eng}</div>
                      <div className="text-[11px] text-slate-500">
                        {CATEGORY_LABELS[item.category]}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 font-medium text-amber-300">{item.rus}</td>
                    <td className="px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <select
                          value={item.gender || ''}
                          onChange={(e) => {
                            const val = e.target.value as GrammaticalGender | '';
                            onUpdateTermMeta(
                              item.eng,
                              val ? (val as GrammaticalGender) : undefined,
                              item.declensionNote,
                              item.voiceNote
                            );
                          }}
                          className="rounded border border-slate-800 bg-slate-950 px-2 py-1 text-[11px] text-slate-300 focus:border-amber-500/60 focus:outline-none"
                        >
                          <option value="">Род не задан</option>
                          {GENDER_OPTIONS.map((g) => (
                            <option key={g.value} value={g.value}>
                              {g.label}
                            </option>
                          ))}
                        </select>
                        {item.declensionNote && (
                          <span className="text-[11px] text-slate-500">
                            {item.declensionNote}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <input
                        type="text"
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
                            ? 'Задать тон речи / обращение на ты-Вы...'
                            : 'Примечание для ИИ...'
                        }
                        className="w-full min-w-[200px] rounded border border-slate-800/80 bg-slate-950/60 px-2.5 py-1 text-[11px] text-slate-300 placeholder:text-slate-600 focus:border-amber-500/60 focus:outline-none"
                      />
                    </td>
                    <td className="py-2.5 pl-3 pr-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          onClick={() => {
                            setRippleEngKey(item.eng);
                            setRippleOldRus(item.rus);
                            setRippleNewRus(item.rus);
                            setSubView('ripple');
                          }}
                          className="rounded p-1 text-slate-500 transition hover:bg-slate-800 hover:text-amber-300"
                          title="Переименовать во всех переведённых главах (Ripple)"
                        >
                          <Replace className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => onRemoveCanonTerm(item.category, item.eng)}
                          className="rounded p-1 text-slate-500 transition hover:bg-rose-500/15 hover:text-rose-300"
                          title="Удалить из канона"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SUBVIEW 2: SCOUTED BUFFER */}
      {subView === 'scouted' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
            <div className="space-y-0.5">
              <div className="text-xs font-medium text-slate-200">
                Сканирование новых терминов и авто-одобрение
              </div>
              <p className="text-xs text-slate-400">
                Кандидаты с точностью ≥92% можно утвердить в канонический глоссарий одной кнопкой.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {highConfidencePendingCount > 0 && (
                <button
                  onClick={() => onAutoApproveHighConfidence(0.92)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3.5 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  Авто-утвердить ≥92% ({highConfidencePendingCount})
                </button>
              )}
              <select
                value={selectedChapterForScout}
                onChange={(e) => setSelectedChapterForScout(e.target.value)}
                className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-amber-500/60 focus:outline-none"
              >
                {chapters.map((ch) => (
                  <option key={ch.id} value={ch.id}>
                    Глава {ch.number}: {ch.titleEng}
                  </option>
                ))}
              </select>
              <button
                onClick={() => onScoutChapterTerms(selectedChapterForScout)}
                disabled={isScouting}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-3.5 py-1.5 text-xs font-semibold text-amber-300 transition hover:bg-amber-500/25 disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {isScouting ? 'Сканирование...' : 'Запустить ИИ-скаут'}
              </button>
            </div>
          </div>

          {pendingScouted.length === 0 ? (
            <div className="rounded-xl border border-slate-800/80 bg-slate-900/20 p-8 text-center text-xs text-slate-400">
              Все найденные термины рассмотрены и добавлены в канон.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {pendingScouted.map((term) => {
                const currentRus =
                  editedSuggestions[term.id] !== undefined
                    ? editedSuggestions[term.id]
                    : term.rus_suggested;
                const currentGender =
                  editedGenders[term.id] !== undefined
                    ? editedGenders[term.id]
                    : term.gender || 'M';

                return (
                  <div
                    key={term.id}
                    className="flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-semibold text-white">
                          {term.eng}
                        </span>
                        <span
                          className={`font-mono text-[11px] ${
                            term.confidence >= 0.92
                              ? 'text-emerald-400 font-semibold'
                              : 'text-slate-400'
                          }`}
                        >
                          Глава {term.chapter_first_seen} · Точность{' '}
                          {Math.round(term.confidence * 100)}%
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        «{term.context_snippet}»
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/80">
                      <input
                        type="text"
                        value={currentRus}
                        onChange={(e) =>
                          setEditedSuggestions((prev) => ({
                            ...prev,
                            [term.id]: e.target.value,
                          }))
                        }
                        className="min-w-[140px] flex-1 rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs font-medium text-amber-300 focus:border-amber-500/60 focus:outline-none"
                      />
                      {term.category === 'characters' && (
                        <select
                          value={currentGender}
                          onChange={(e) =>
                            setEditedGenders((prev) => ({
                              ...prev,
                              [term.id]: e.target.value as GrammaticalGender,
                            }))
                          }
                          className="rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-300"
                        >
                          {GENDER_OPTIONS.map((g) => (
                            <option key={g.value} value={g.value}>
                              {g.value}
                            </option>
                          ))}
                        </select>
                      )}
                      <button
                        onClick={() =>
                          onApproveScoutedTerm(
                            term.id,
                            currentRus,
                            term.category,
                            term.category === 'characters' ? currentGender : undefined
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-emerald-400"
                      >
                        <Check className="h-3.5 w-3.5" />В канон
                      </button>
                      <button
                        onClick={() => onRejectScoutedTerm(term.id)}
                        className="rounded-lg border border-slate-800 bg-slate-950 p-1.5 text-slate-400 transition hover:text-rose-300"
                        title="Отклонить"
                      >
                        <X className="h-3.5 w-3.5" />
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
        <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-5">
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-white">
              Каскадная замена термина во всех переведённых главах (Retroactive Canon Ripple)
            </h3>
            <p className="text-xs text-slate-400">
              Если на 50-й главе вы решили переименовать ранг, артефакт или локацию, движок
              автоматически найдёт все словоформы и падежные окончания старого термина в уже
              переведённых главах и обновит их вместе с каноническим глоссарием.
            </p>
          </div>

          {rippleSuccessBanner && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-xs text-emerald-300">
              {rippleSuccessBanner}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12">
            <div className="sm:col-span-4">
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                Выбрать из канона (опционально)
              </label>
              <select
                value={rippleEngKey}
                onChange={(e) => {
                  const eng = e.target.value;
                  setRippleEngKey(eng);
                  const found = flattenedCanon.find((c) => c.eng === eng);
                  if (found) {
                    setRippleOldRus(found.rus);
                  }
                }}
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-amber-500/60 focus:outline-none"
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
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                Старый перевод (RUS)
              </label>
              <input
                type="text"
                value={rippleOldRus}
                onChange={(e) => setRippleOldRus(e.target.value)}
                placeholder="Напр. Очки Истока"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-amber-500/60 focus:outline-none"
              />
            </div>

            <div className="sm:col-span-3">
              <label className="mb-1 block text-[11px] font-medium text-slate-400">
                Новый канон (RUS)
              </label>
              <input
                type="text"
                value={rippleNewRus}
                onChange={(e) => setRippleNewRus(e.target.value)}
                placeholder="Напр. Очки Изначальности"
                className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs font-medium text-amber-300 focus:border-amber-500/60 focus:outline-none"
              />
            </div>

            <div className="flex items-end sm:col-span-2">
              <button
                onClick={handleExecuteRipple}
                disabled={ripplePreview.totalOccurrences === 0 && !rippleEngKey}
                className="w-full rounded-lg bg-amber-500 px-3 py-2 text-xs font-semibold text-slate-950 transition hover:bg-amber-400 disabled:opacity-40"
              >
                Заменить ({ripplePreview.totalOccurrences})
              </button>
            </div>
          </div>

          {/* Live Preview of Affected Chapters */}
          <div className="space-y-2 pt-2">
            <div className="text-xs font-medium text-slate-300">
              Предпросмотр затронутых глав: найдено {ripplePreview.totalOccurrences} вхождений в{' '}
              {ripplePreview.changes.length} главах
            </div>

            {ripplePreview.changes.length === 0 ? (
              <div className="rounded-lg border border-slate-800/80 bg-slate-950/60 p-4 text-xs text-slate-500">
                В переведённых главах не найдено вхождений «{rippleOldRus}».
              </div>
            ) : (
              <div className="space-y-2">
                {ripplePreview.changes.map((m) => (
                  <div
                    key={m.chapterId}
                    className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-amber-300">
                        Глава {m.chapterNumber}
                      </span>
                      <span className="font-mono text-[11px] text-emerald-400">
                        Замен: {m.ReplacementsCount}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-2 text-[11px]">
                      <div className="rounded border border-rose-500/20 bg-rose-950/15 p-2 text-slate-400">
                        <span className="font-semibold text-rose-300">Было: </span>
                        {m.previewBefore}
                      </div>
                      <div className="rounded border border-emerald-500/20 bg-emerald-950/15 p-2 text-slate-300">
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
