import type { Metadata } from 'next';
import { Golos_Text, Literata } from 'next/font/google';
import './globals.css';

const golosText = Golos_Text({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-golos',
  display: 'swap',
});

const literata = Literata({
  subsets: ['latin', 'cyrillic'],
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
  variable: '--font-literata',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Канон Сянься: автономная студия перевода веб-новелл',
  description:
    'Профессиональный 5-фазный конвейер пакетного перевода, скаутинга терминов, литературной адаптации сянься и уся, детерминированного QA-линтера и экспорта для Рулейта.',
  openGraph: {
    title: 'Канон Сянься: автономная студия перевода веб-новелл',
    description:
      'Профессиональный 5-фазный конвейер пакетного перевода, скаутинга терминов, литературной адаптации сянься и уся, детерминированного QA-линтера и экспорта для Рулейта.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Канон Сянься: автономная студия перевода веб-новелл',
    description:
      'Профессиональный 5-фазный конвейер пакетного перевода, скаутинга терминов, литературной адаптации сянься и уся, детерминированного QA-линтера и экспорта для Рулейта.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="ru"
      className={`dark ${golosText.variable} ${literata.variable}`}
    >
      <body
        suppressHydrationWarning
        className="min-h-[100dvh] bg-[#0D0D0F] text-[#F2EFE9] antialiased selection:bg-[#D69E36]/30 selection:text-[#F2EFE9] font-sans"
      >
        {children}
      </body>
    </html>
  );
}
