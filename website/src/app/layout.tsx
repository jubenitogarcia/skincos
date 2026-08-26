import "@/styles/globals.css";
import type { Metadata } from "next";
import { Suspense } from "react";
import { headers } from "next/headers";
import { Bodoni_Moda, Oxanium, Urbanist } from "next/font/google";
import Script from "next/script";
import CookieBanner from "@/components/CookieBanner";
import Analytics from "@/components/Analytics";
import MarketingPixels from "@/components/MarketingPixels";
import CampaignAttribution from "@/components/CampaignAttribution";
import SiteBehaviorTracker from "@/components/SiteBehaviorTracker";
import WebVitalsReporter from "@/components/WebVitalsReporter";
import HomeHashScroller from "@/components/HomeHashScroller";
import { getSiteConfigFromHost } from "@/lib/site-config";

const buildSha = process.env.NEXT_PUBLIC_BUILD_SHA ?? "";
const buildTime = process.env.NEXT_PUBLIC_BUILD_TIME ?? "";

const brandUiFont = Oxanium({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-brand-ui-loaded",
  weight: ["400", "500", "600", "700", "800"],
});

const brandTextFont = Urbanist({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-brand-text-loaded",
  weight: ["300", "400", "500", "600", "700", "800"],
});

// Loaded as an inert variable and consumed only by the Beauty Movement module.
// Keeping it at the layout layer lets Next package the font without changing the
// typography of the institutional surface.
const beautyMovementEditorialFont = Bodoni_Moda({
  subsets: ["latin"],
  display: "swap",
  preload: false,
  variable: "--font-beauty-movement-editorial",
  weight: ["400", "500", "600", "700"],
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
    <html lang="pt-BR" className={`${brandUiFont.variable} ${brandTextFont.variable} ${beautyMovementEditorialFont.variable}`}>
      <head>
        {buildSha ? <meta name="x-app-build" content={buildSha} /> : null}
        {buildTime ? <meta name="x-app-build-time" content={buildTime} /> : null}
      </head>
      <body>
        <Script id="beauty-movement-invite-fragment" strategy="beforeInteractive">
          {`(function () {
  var inviteKey = "ef:beauty-movement:invite";
  var attemptKey = "ef:beauty-movement:handoff-attempt";
  var handoffEvent = "beauty-movement-invite-handoff";

  function captureInviteFragment() {
    var shouldScrub = false;
    var token = "";
    var validToken = false;
    try {
    var pathname = window.location.pathname.replace(/\\/+$/, "") || "/";
    var normalizedPathname = pathname.toLowerCase();
    if (normalizedPathname !== "/beleza-em-movimento" && normalizedPathname !== "/belezaemmovimento") return;
    var fragment = window.location.hash.slice(1);
    if (!fragment) return;
    var params = new URLSearchParams(fragment);
    if (!params.has("c")) return;
    shouldScrub = true;
    token = params.get("c") || "";
    validToken = /^[A-Za-z0-9_-]{40,180}$/.test(token);
    // The invite itself must never reach analytics, attribution, referrers or
    // the server through a URL. Keep it only long enough for the client to
    // exchange it for an HttpOnly session, then remove it synchronously.
    try {
      window.sessionStorage.setItem(attemptKey, "1");
      window.sessionStorage.removeItem(inviteKey);
      if (validToken) window.sessionStorage.setItem(inviteKey, token);
    } catch (_) {
      // The in-memory handoff below keeps this navigation fail-closed even
      // when sessionStorage is unavailable.
    }
    try {
      window.__efBeautyMovementInviteHandoff = { attempted: true, token: validToken ? token : null };
    } catch (_) {}
    } catch (_) {
    // A malformed fragment is treated exactly like an invalid invitation.
    shouldScrub = true;
    try { window.__efBeautyMovementInviteHandoff = { attempted: true, token: null }; } catch (_) {}
    }
    if (shouldScrub) {
      try {
        var currentState = window.history.state;
        var nextState = currentState && typeof currentState === "object" ? Object.assign({}, currentState) : {};
        // A hash navigation may copy the previous entry's state. Removing the
        // old selector before the new exchange prevents invite B from ever
        // falling back to invite A.
        delete nextState.__efBeautyMovementContextRef;
        window.history.replaceState(nextState, "", window.location.pathname + window.location.search);
      } catch (_) {}
      try { window.dispatchEvent(new Event(handoffEvent)); } catch (_) {}
    }
  }

  captureInviteFragment();
  window.addEventListener("hashchange", captureInviteFragment, true);
})();`}
        </Script>
        {site.key === "espacofacial" ? (
          <Suspense fallback={null}>
            <CampaignAttribution />
            <SiteBehaviorTracker />
          </Suspense>
        ) : null}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
        {children}
        <HomeHashScroller />
        {site.key === "espacofacial" ? <Analytics /> : null}
        <WebVitalsReporter />
        {site.key === "espacofacial" ? <MarketingPixels /> : null}
        <CookieBanner />
      </body>
    </html>
  );
}
