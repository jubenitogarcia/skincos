import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import UnitsMapSection from "@/components/UnitsMapSection";
import UnitDoctorsGrid from "@/components/UnitDoctorsGrid";
import HeroMedia from "@/components/HeroMedia";
import AboutUsSection from "@/components/AboutUsSection";
import { getHeroMediaItems, heroVariantFromUserAgent } from "@/lib/heroMedia.server";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { getSiteConfigFromHost } from "@/lib/site-config";
import { SkincosHubPage } from "@/components/LegalContent";

export const revalidate = 300;

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
    title: "Espaço Facial",
    description: "Harmonização facial e corporal. Selecione sua unidade e agende.",
    robots: {
      index: true,
      follow: true,
    },
    alternates: { canonical: `${site.siteUrl}/` },
    openGraph: {
      title: "Espaço Facial",
      description: "Harmonização facial e corporal. Selecione sua unidade e agende.",
      url: `${site.siteUrl}/`,
      type: "website",
    },
  };
}

export default async function HomePage() {
  const requestHeaders = await headers();
  const site = getSiteConfigFromHost(requestHeaders.get("host"));

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
  const { items: heroItems } = await getHeroMediaItems({ variant });

  return (
    <>
      <Header />

      <h1 className="srOnly">Espaço Facial</h1>

      <section className="hero" aria-label="Destaque">
        <HeroMedia initialItems={heroItems} initialVariant={variant} />
        <div className="heroOverlay" />
      </section>

      <main className="container">
        <AboutUsSection />

        <section id="doutores" className="pageSection" style={{ marginTop: 50 }}>
          <h2 className="sectionTitle">Nossos Doutores</h2>
          <UnitDoctorsGrid variant="booking-compact" />
        </section>

        <section id="unidades" className="pageSection" style={{ marginTop: 50 }}>
          <h2 className="sectionTitle">Nossas Unidades</h2>
          <p className="sectionSub">
            Clique no ponto no mapa ou no nome da unidade para abrir.
          </p>
          <UnitsMapSection />
        </section>
      </main>

      <Footer />
      <FloatingContact />
    </>
  );
}
