import type { Metadata } from 'next';
import { Plus_Jakarta_Sans, Source_Sans_3, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin', 'cyrillic-ext'],
  weight: ['500', '600', '700'],
  variable: '--font-display',
});

const sourceSans = Source_Sans_3({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Канон Сянься — Автономная студия перевода веб-новелл',
  description:
    'Профессиональный 5-фазный конвейер пакетного перевода, скаутинга терминов, литературной адаптации сянься/уся, детерминированного QA-линтера и экспорта для Рулейта.',
  openGraph: {
    title: 'Канон Сянься — Автономная студия перевода веб-новелл',
    description:
      'Профессиональный 5-фазный конвейер пакетного перевода, скаутинга терминов, литературной адаптации сянься/уся, детерминированного QA-линтера и экспорта для Рулейта.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Канон Сянься — Автономная студия перевода веб-новелл',
    description:
      'Профессиональный 5-фазный конвейер пакетного перевода, скаутинга терминов, литературной адаптации сянься/уся, детерминированного QA-линтера и экспорта для Рулейта.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ru"
      className={`${plusJakarta.variable} ${sourceSans.variable} ${jetbrainsMono.variable} dark`}
    >
      <body
        suppressHydrationWarning
        className="min-h-[100dvh] bg-[#090A0F] text-[#F1F5F9] antialiased selection:bg-[#D99B26]/30 selection:text-[#F1F5F9] font-sans"
      >
        {children}
      </body>
    </html>
  );
}
