import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import HomeHeroExperience from "@/components/HomeHeroExperience";
import TrustEvidenceSection from "@/components/TrustEvidenceSection";
import HomePageSections from "@/components/HomePageSections";
import { getHeroMediaItems, heroVariantFromUserAgent } from "@/lib/heroMedia.server";
import { resolveUnitFromSlug } from "@/lib/unitRoutes";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getSiteConfigFromHost } from "@/lib/site-config";
import { SkincosHubPage } from "@/components/LegalContent";

export const revalidate = 300;
const UNIT_SELECTION_COOKIE_KEY = "ef_selected_unit";

function readCookieFromHeader(cookieHeader: string | null, name: string): string {
  if (!cookieHeader) return "";

  const prefix = `${name}=`;
  const match = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!match) return "";

  try {
    return decodeURIComponent(match.slice(prefix.length).trim());
  } catch {
    return match.slice(prefix.length).trim();
  }
}

export async function generateMetadata(): Promise<Metadata> {
  const site = getSiteConfigFromHost((await headers()).get("host"));

  if (site.key === "skincos") {
    return {
      title: "ORB by SKINCOS",
      description:
        "Hub institucional e jurídico do app ORB by SKINCOS para integrações e automações com Meta.",
      robots: {
        index: true,
        follow: true,
      },
      alternates: { canonical: `${site.siteUrl}/` },
      openGraph: {
        title: "ORB by SKINCOS",
        description:
          "Hub institucional e jurídico do app ORB by SKINCOS para integrações e automações com Meta.",
        url: `${site.siteUrl}/`,
        type: "website",
      },
    };
  }

  return {
    title: { absolute: "Espaço Facial" },
    description:
      "Harmonização facial com avaliação cuidadosa, especialistas e agendamento online na Espaço Facial.",
    robots: {
      index: true,
      follow: true,
    },
    alternates: { canonical: `${site.siteUrl}/` },
    openGraph: {
      title: "Espaço Facial",
      description:
        "Harmonização facial com avaliação cuidadosa, especialistas e agendamento online na Espaço Facial.",
      url: `${site.siteUrl}/`,
      type: "website",
    },
  };
}

export default async function HomePage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const requestHeaders = await headers();
  const site = getSiteConfigFromHost(requestHeaders.get("host"));
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  if (site.key === "skincos") {
    return (
      <>
        <SkincosHubPage />
        <Footer siteKey="skincos" />
      </>
    );
  }

  const ua = requestHeaders.get("user-agent");
  const variant = heroVariantFromUserAgent(ua);
  const unitParamRaw = resolvedSearchParams?.unit;
  const unitParam =
    typeof unitParamRaw === "string"
      ? unitParamRaw
      : Array.isArray(unitParamRaw)
        ? unitParamRaw[0] ?? ""
        : "";
  const cookieUnitParam = readCookieFromHeader(
    requestHeaders.get("cookie"),
    UNIT_SELECTION_COOKIE_KEY,
  );
  const resolvedUnit = resolveUnitFromSlug(unitParam || cookieUnitParam);
  const { items: heroItems } = await getHeroMediaItems({ variant, unitSlug: resolvedUnit?.slug ?? null });

  return (
    <>
      <Header />
      <main>
        <HomeHeroExperience heroItems={heroItems} initialMediaVariant={variant} initialUnitSlug={resolvedUnit?.slug ?? null} />
        <TrustEvidenceSection context="home" />
        <HomePageSections />
      </main>

      <Footer />
      <FloatingContact />
    </>
  );
}
