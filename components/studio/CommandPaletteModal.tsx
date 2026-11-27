'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  BookOpen,
  Cpu,
  SlidersHorizontal,
  Upload,
  FolderPlus,
  Terminal,
  Zap,
  ArrowRight,
  Download,
  FileText,
} from 'lucide-react';
import { StudioDialog } from './StudioDialog';
import type { ChapterRecord } from '@/lib/seed-data';
import type { StudioTab } from './studio-helpers';

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  keywords: string;
  icon: React.ReactNode;
  run: () => void;
}

interface CommandPaletteModalProps {
  isOpen: boolean;
  onClose: () => void;
  chapters: ChapterRecord[];
  activeTab: StudioTab;
  onNavigateTab: (tab: StudioTab) => void;
  onSelectChapter: (chapterId: string) => void;
  onOpenLlmSettings: () => void;
  onOpenRules: () => void;
  onOpenImport: () => void;
  onOpenNewNovel: () => void;
  onToggleLogs: () => void;
  onTranslateNext3: () => void;
  isRunningPipeline: boolean;
}

function CommandPaletteContent({
  onClose,
  chapters,
  onNavigateTab,
  onSelectChapter,
  onOpenLlmSettings,
  onOpenRules,
  onOpenImport,
  onOpenNewNovel,
  onToggleLogs,
  onTranslateNext3,
  isRunningPipeline,
}: Omit<CommandPaletteModalProps, 'isOpen' | 'activeTab'>) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  const commands = useMemo<CommandItem[]>(() => {
    const base: CommandItem[] = [
      {
        id: 'tab-pipeline',
        label: 'Открыть вкладку «Главы и конвейер»',
        hint: 'Вкладка',
        keywords: 'главы конвейер список pipeline',
        icon: <FileText className="h-3.5 w-3.5 text-[#A6B0C3]" aria-hidden="true" />,
        run: () => {
          onNavigateTab('pipeline');
          onClose();
        },
      },
      {
        id: 'tab-editor',
        label: 'Открыть параллельный редактор',
        hint: 'Вкладка',
        keywords: 'редактор текст перевод split',
        icon: <BookOpen className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />,
        run: () => {
          onNavigateTab('editor');
          onClose();
        },
      },
      {
        id: 'tab-glossary',
        label: 'Открыть канонический глоссарий и скаут',
        hint: 'Вкладка',
        keywords: 'глоссарий канон термины персонажи род',
        icon: <BookOpen className="h-3.5 w-3.5 text-[#A6B0C3]" aria-hidden="true" />,
        run: () => {
          onNavigateTab('glossary');
          onClose();
        },
      },
      {
        id: 'tab-export',
        label: 'Открыть «Экспорт Рулейт и EPUB 3»',
        hint: 'Вкладка',
        keywords: 'экспорт рулейт epub zip скачать',
        icon: <Download className="h-3.5 w-3.5 text-[#A6B0C3]" aria-hidden="true" />,
        run: () => {
          onNavigateTab('export');
          onClose();
        },
      },
      {
        id: 'cmd-llm',
        label: 'Настройки ИИ-движка и моделей',
        hint: 'Модели',
        keywords: 'ии модели gemini colab api настройки',
        icon: <Cpu className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />,
        run: () => {
          onClose();
          onOpenLlmSettings();
        },
      },
      {
        id: 'cmd-rules',
        label: 'Правила QA-линтера и профиль жанра',
        hint: 'QA',
        keywords: 'правила линтер qa жанр профиль',
        icon: <SlidersHorizontal className="h-3.5 w-3.5 text-[#A6B0C3]" aria-hidden="true" />,
        run: () => {
          onClose();
          onOpenRules();
        },
      },
      {
        id: 'cmd-import',
        label: 'Импорт глав (.epub, .txt, .md или текстом)',
        hint: 'Импорт',
        keywords: 'импорт загрузка epub txt добавить главу',
        icon: <Upload className="h-3.5 w-3.5 text-[#A6B0C3]" aria-hidden="true" />,
        run: () => {
          onClose();
          onOpenImport();
        },
      },
      {
        id: 'cmd-new-novel',
        label: 'Создать новый проект книги',
        hint: 'Книга',
        keywords: 'новая книга создать проект новелла',
        icon: <FolderPlus className="h-3.5 w-3.5 text-[#A6B0C3]" aria-hidden="true" />,
        run: () => {
          onClose();
          onOpenNewNovel();
        },
      },
      {
        id: 'cmd-logs',
        label: 'Показать или скрыть журнал событий конвейера',
        hint: 'Лог',
        keywords: 'журнал логи события отладка',
        icon: <Terminal className="h-3.5 w-3.5 text-[#A6B0C3]" aria-hidden="true" />,
        run: () => {
          onToggleLogs();
          onClose();
        },
      },
    ];

    if (!isRunningPipeline) {
      base.unshift({
        id: 'cmd-next3',
        label: 'Перевести следующие 3 непереведённые главы',
        hint: 'Конвейер',
        keywords: 'перевести следующие 3 главы запуск пакет',
        icon: <Zap className="h-3.5 w-3.5 text-[#D99B26]" aria-hidden="true" />,
        run: () => {
          onClose();
          onTranslateNext3();
        },
      });
    }

    return base;
  }, [
    isRunningPipeline,
    onClose,
    onNavigateTab,
    onOpenImport,
    onOpenLlmSettings,
    onOpenNewNovel,
    onOpenRules,
    onToggleLogs,
    onTranslateNext3,
  ]);

  const { filteredCommands, filteredChapters } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matchedCmds = q
      ? commands.filter(
          (c) =>
            c.label.toLowerCase().includes(q) ||
            c.keywords.toLowerCase().includes(q)
        )
      : commands.slice(0, 6);

    const sortedChs = [...chapters].sort((a, b) => a.number - b.number);
    const matchedChs = q
      ? sortedChs.filter((ch) => {
          const numStr = String(ch.subPart || ch.number).toLowerCase();
          return (
            numStr.includes(q) ||
            (ch.titleRus || '').toLowerCase().includes(q) ||
            (ch.titleEng || '').toLowerCase().includes(q)
          );
        })
      : sortedChs;

    return {
      filteredCommands: matchedCmds.slice(0, 6),
      filteredChapters: matchedChs.slice(0, 12),
    };
  }, [chapters, commands, query]);

  const flatEntries = useMemo(() => {
    const items: Array<{ id: string; run: () => void }> = [];
    for (const cmd of filteredCommands) {
      items.push({ id: cmd.id, run: cmd.run });
    }
    for (const ch of filteredChapters) {
      items.push({
        id: `ch-${ch.id}`,
        run: () => {
          onSelectChapter(ch.id);
          onNavigateTab('editor');
          onClose();
        },
      });
    }
    return items;
  }, [filteredCommands, filteredChapters, onClose, onNavigateTab, onSelectChapter]);

  const clampedCursor = Math.min(cursor, Math.max(0, flatEntries.length - 1));

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (flatEntries.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (c + 1) % flatEntries.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (c - 1 + flatEntries.length) % flatEntries.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      flatEntries[clampedCursor]?.run();
    }
  };

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8893A8]"
          aria-hidden="true"
        />
        <input
          type="search"
          autoFocus
          aria-label="Поиск главы по номеру, названию или команде"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Номер главы, заголовок или действие..."
          className="w-full rounded-xl border border-white/[0.12] bg-[#0A0C12] py-2.5 pl-9 pr-3 text-sm text-[#F3F4F6] placeholder:text-[#8893A8] focus:border-[#D99B26] focus:outline-none"
        />
      </div>

      {flatEntries.length === 0 ? (
        <div className="rounded-xl border border-white/[0.07] bg-[#0A0C12] py-8 text-center text-xs text-[#8893A8]">
          Ничего не найдено по запросу «{query}»
        </div>
      ) : (
        <div className="space-y-4">
          {filteredCommands.length > 0 && (
            <div className="space-y-1">
              <div className="px-1 text-[11px] font-medium text-[#8893A8]">
                Команды студии
              </div>
              <div className="space-y-0.5">
                {filteredCommands.map((cmd, idx) => {
                  const active = clampedCursor === idx;
                  return (
                    <button
                      key={cmd.id}
                      type="button"
                      onClick={cmd.run}
                      onMouseEnter={() => setCursor(idx)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                        active
                          ? 'bg-[#D99B26]/15 text-[#F3F4F6]'
                          : 'text-[#B0B8C9] hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        {cmd.icon}
                        <span className="truncate font-medium">{cmd.label}</span>
                      </span>
                      {cmd.hint && (
                        <span className="font-mono text-[11px] text-[#8893A8] shrink-0">
                          {cmd.hint}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {filteredChapters.length > 0 && (
            <div className="space-y-1">
              <div className="px-1 text-[11px] font-medium text-[#8893A8]">
                Главы активной книги
              </div>
              <div className="space-y-0.5">
                {filteredChapters.map((ch, chIdx) => {
                  const globalIdx = filteredCommands.length + chIdx;
                  const active = clampedCursor === globalIdx;
                  const statusLabel =
                    ch.status === 'quarantined'
                      ? { text: 'Карантин', cls: 'text-rose-300' }
                      : ch.verified
                        ? { text: 'QA 100%', cls: 'text-emerald-300' }
                        : ch.translated
                          ? { text: 'Черновик', cls: 'text-[#E5AC3D]' }
                          : { text: 'Ожидает', cls: 'text-[#8893A8]' };

                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => {
                        onSelectChapter(ch.id);
                        onNavigateTab('editor');
                        onClose();
                      }}
                      onMouseEnter={() => setCursor(globalIdx)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                        active
                          ? 'bg-[#D99B26]/15 text-[#F3F4F6]'
                          : 'text-[#B0B8C9] hover:bg-white/[0.04]'
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span className="font-mono text-[11px] text-[#8893A8] w-10 shrink-0 tabular-nums">
                          #{ch.subPart || ch.number}
                        </span>
                        <span className="truncate font-medium text-[#F3F4F6]">
                          {ch.titleRus || ch.titleEng}
                        </span>
                      </span>
                      <span className="flex items-center gap-2 shrink-0">
                        <span className={`font-mono text-[11px] ${statusLabel.cls}`}>
                          {statusLabel.text}
                        </span>
                        <ArrowRight className="h-3 w-3 text-[#8893A8]" aria-hidden="true" />
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function CommandPaletteModal({
  isOpen,
  onClose,
  chapters,
  onNavigateTab,
  onSelectChapter,
  onOpenLlmSettings,
  onOpenRules,
  onOpenImport,
  onOpenNewNovel,
  onToggleLogs,
  onTranslateNext3,
  isRunningPipeline,
}: CommandPaletteModalProps) {
  return (
    <StudioDialog
      isOpen={isOpen}
      onClose={onClose}
      title="Быстрый переход и команды"
      subtitle="Переходите к любой главе или действию с клавиатуры (↑ ↓ Enter)"
      titleId="command-palette-title"
      maxWidthClass="max-w-xl"
    >
      {isOpen && (
        <CommandPaletteContent
          onClose={onClose}
          chapters={chapters}
          onNavigateTab={onNavigateTab}
          onSelectChapter={onSelectChapter}
          onOpenLlmSettings={onOpenLlmSettings}
          onOpenRules={onOpenRules}
          onOpenImport={onOpenImport}
          onOpenNewNovel={onOpenNewNovel}
          onToggleLogs={onToggleLogs}
          onTranslateNext3={onTranslateNext3}
          isRunningPipeline={isRunningPipeline}
        />
      )}
    </StudioDialog>
  );
}
