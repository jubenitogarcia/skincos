import "@/styles/globals.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Oxanium, Urbanist } from "next/font/google";
import CookieBanner from "@/components/CookieBanner";
import Analytics from "@/components/Analytics";
import MarketingPixels from "@/components/MarketingPixels";
import CampaignAttribution from "@/components/CampaignAttribution";
import WebVitalsReporter from "@/components/WebVitalsReporter";
import { getSiteConfigFromHost } from "@/lib/site-config";

const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "";
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";

const brandUiFont = Oxanium({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-brand-ui-loaded",
  weight: ["400", "500", "600", "700", "800"],
});

const brandTextFont = Urbanist({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-brand-text-loaded",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export async function generateMetadata(): Promise<Metadata> {
  const site = getSiteConfigFromHost((await headers()).get("host"));

  return {
    metadataBase: new URL(site.siteUrl),
    robots: {
      index: true,
      follow: true,
    },
    title: {
      default: site.titleDefault,
      template: site.titleTemplate,
    },
    description: site.description,
    openGraph: {
      title: site.titleDefault,
      description: site.description,
      url: site.siteUrl,
      siteName: site.brandName,
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
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const site = getSiteConfigFromHost((await headers()).get("host"));
  const orgJsonLd =
    site.key === "skincos"
      ? {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "SKINCOS",
          url: site.siteUrl,
          logo: `${site.siteUrl.replace(/\/$/, "")}/icon.svg`,
          contactPoint: [
            {
              "@type": "ContactPoint",
              contactType: "customer service",
              email: "jubenitogarcia@skincos.com.br",
              areaServed: "BR",
              availableLanguage: ["pt-BR"],
            },
          ],
        }
      : {
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "Espaço Facial",
          url: site.siteUrl,
          logo: `${site.siteUrl.replace(/\/$/, "")}/icon.svg`,
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

  return (
    <html lang="pt-BR" className={`${brandUiFont.variable} ${brandTextFont.variable}`}>
      <head>
        {buildSha ? <meta name="x-app-build" content={buildSha} /> : null}
        {buildTime ? <meta name="x-app-build-time" content={buildTime} /> : null}
      </head>
      <body>
        {site.key === "espacofacial" ? (
          <Suspense fallback={null}>
            <CampaignAttribution />
          </Suspense>
        ) : null}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        {children}
        {site.key === "espacofacial" ? <Analytics /> : null}
        <WebVitalsReporter />
        {site.key === "espacofacial" ? <MarketingPixels /> : null}
        <CookieBanner />
      </body>
    </html>
  );
}
