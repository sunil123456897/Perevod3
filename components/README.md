# UI Studio Components (`components`)

## Overview
Клиентский интерфейс студии перевода веб-новелл на базе Next.js 15, React 19 и Tailwind CSS v4. Включает 4 основных режима работы: оркестратор пакетного конвейера, параллельный редактор с Zen-режимом и пословным диффом, хранилище канона и глоссария, экспорт для платформы Рулейт.

## Interface
- [`PipelineStudioApp`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/components/PipelineStudioApp.tsx): Главный корневой компонент приложения. Управляет проектами новелл, очередью пакетной обработки, фильтрами глав и телеметрией конвейера.
- [`QuickStartWizard`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/components/QuickStartWizard.tsx): Интерактивный 3-шаговый мастер быстрого запуска для новичков (выбор текста, статус ИИ, 1-клик перевод).
- [`ParallelEditorView`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/components/ParallelEditorView.tsx): Двуколоночный редактор с поддержкой Zen-режима (полноэкранный фокус), настройки книжной типографики (Serif/Sans/Mono, 14–20px), переключателя «Финал Pass 3 vs Черновик Pass 2 vs Дифф стилиста» и плавающего тулбара выделения термина `+ В Канон (Ctrl+Shift+M)`.
- [`ToastProvider` / `useToast`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/components/ToastProvider.tsx): Контекст плавающих анимированных уведомлений (`success`, `error`, `warn`, `info`).
- [`GlossaryVaultView`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/components/GlossaryVaultView.tsx): Интерактивное управление каноническим глоссарием, одобрение кандидатов скаутинга, карточки персонажей S-VoCAL и Canon Ripple.
- [`RulateExportView`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/components/RulateExportView.tsx): Генератор пакетов для загрузки на Рулейт (строгие окончания строк Unix LF, двухпараметрические заголовки, оглавление).
- [`TranslationAnalyticsChart`](file:///c:/Users/vanya/Desktop/автономная-студия-перевода-веб-новелл/components/TranslationAnalyticsChart.tsx): Графическая аналитика прогресса перевода, плотности терминов и качества DITING / MQM.

## Invariants
- **Гидратация**: Никаких мутаций IndexedDB до завершения `isHydrated === true`.
- **Эргономика**: В Zen-режиме редактор изолирует пользователя от системных панелей, сохранение доступно по `Ctrl+S`, выход по `Esc`.
- **Типографика**: Все читательские панели поддерживают синхронное переключение шрифтов и межстрочных интервалов.
- **Безопасность ключей**: API-ключи никогда не выводятся в разметку открытым текстом.

## Side Effects
- Запись пользовательских предпочтений (типографика, статус плашки мастера) в `localStorage`.
- Синхронизация глав и версий в браузерном хранилище `IndexedDB`.
- Вызовы серверных API роутов `/api/pipeline` и `/api/projects`.

## Verification
- Run: `npm run lint`
- Run: `npx tsc --noEmit`
- Run: `npm run build`
