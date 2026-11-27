import type { Metadata } from 'next';
import { Inter, Literata, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
  display: 'swap',
});

const literata = Literata({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-literata',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
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
      className={`dark ${inter.variable} ${literata.variable} ${jetbrainsMono.variable}`}
    >
      <body
        suppressHydrationWarning
        className="min-h-[100dvh] bg-[#090A0F] text-[#F3F4F6] antialiased selection:bg-[#D99B26]/30 selection:text-[#F3F4F6] font-sans"
      >
        {children}
      </body>
    </html>
  );
}
