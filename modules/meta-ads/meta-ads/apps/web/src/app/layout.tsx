import type { Metadata } from 'next';
import { Space_Grotesk, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { Sidebar } from '../components/Sidebar';

const space = Space_Grotesk({
  variable: '--font-space',
  subsets: ['latin'],
});

const plexMono = IBM_Plex_Mono({
  variable: '--font-plex-mono',
  subsets: ['latin'],
  weight: ['400', '600'],
});

export const metadata: Metadata = {
  title: 'Meta Campaign Control Center',
  description: 'Painel de campanhas Meta Ads',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${space.variable} ${plexMono.variable} antialiased bg-slate-950 text-slate-100`}>
        <div className="min-h-screen grid grid-cols-[260px_1fr]">
          <Sidebar />
          <main className="px-8 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
