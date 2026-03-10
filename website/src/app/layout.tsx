import "@/styles/globals.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import CookieBanner from "@/components/CookieBanner";
import Analytics from "@/components/Analytics";
import MarketingPixels from "@/components/MarketingPixels";
import CampaignAttribution from "@/components/CampaignAttribution";
import WebVitalsReporter from "@/components/WebVitalsReporter";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com";
const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "";
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  robots: {
    index: true,
    follow: true,
  },
  title: {
    default: "Espaço Facial | Harmonização Facial e Corporal",
    template: "%s | Espaço Facial",
  },
  description:
    "Espaço Facial: harmonização facial e corporal com equipe especializada, protocolos personalizados e agendamento online.",
  openGraph: {
    title: "Espaço Facial | Harmonização Facial e Corporal",
    description:
      "Espaço Facial: harmonização facial e corporal com equipe especializada, protocolos personalizados e agendamento online.",
    url: siteUrl,
    siteName: "Espaço Facial",
    locale: "pt_BR",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/twitter-image"],
  },
  icons: {
    icon: "/icon.svg",
  },
};

const orgJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Espaço Facial",
  url: siteUrl,
  logo: `${siteUrl.replace(/\/$/, "")}/icon.svg`,
  // Unidades operacionais atuais (contas oficiais por unidade).
  sameAs: [
    "https://www.instagram.com/espacofacial_barrashoppingsul/",
    "https://www.facebook.com/espacofacial.barrashoppingsul/",
    "https://www.threads.com/@espacofacial_barrashoppingsul",
    "https://www.instagram.com/espacofacial_novohamburgo/",
    "https://www.facebook.com/espacofacial.novohamburgo/",
    "https://www.threads.com/@espacofacial_novohamburgo",
  ],
  contactPoint: [
    {
      "@type": "ContactPoint",
      contactType: "customer service",
      telephone: "+5551980882293",
      email: "barrashoppingsul@espacofacial.com.br",
      areaServed: "BR",
      availableLanguage: ["pt-BR"],
    },
    {
      "@type": "ContactPoint",
      contactType: "customer service",
      telephone: "+5551995811008",
      email: "novohamburgo@espacofacial.com.br",
      areaServed: "BR",
      availableLanguage: ["pt-BR"],
    },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        {buildSha ? <meta name="x-app-build" content={buildSha} /> : null}
        {buildTime ? <meta name="x-app-build-time" content={buildTime} /> : null}
      </head>
      <body>
        <Suspense fallback={null}>
          <CampaignAttribution />
        </Suspense>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        {children}
        <Analytics />
        <WebVitalsReporter />
        <MarketingPixels />
        <CookieBanner />
      </body>
    </html>
  );
}
