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

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");
export const revalidate = 300;

export const metadata: Metadata = {
  title: "Espaço Facial",
  description: "Harmonização facial e corporal. Selecione sua unidade e agende.",
  robots: {
    index: true,
    follow: true,
  },
  alternates: { canonical: `${siteUrl}/` },
  openGraph: {
    title: "Espaço Facial",
    description: "Harmonização facial e corporal. Selecione sua unidade e agende.",
    url: `${siteUrl}/`,
    type: "website",
  },
};

export default async function HomePage() {
  const ua = (await headers()).get("user-agent");
  const variant = heroVariantFromUserAgent(ua);
  const { items: heroItems } = await getHeroMediaItems({ variant });

  return (
    <>
      <Header />

      <h1 className="srOnly">Espaço Facial</h1>

      <section className="hero" aria-label="Destaque">
        <HeroMedia initialItems={heroItems} />
        <div className="heroOverlay" />
      </section>

      <main className="container">
        <AboutUsSection />

        <section id="doutores" className="pageSection" style={{ marginTop: 50 }}>
          <h2 className="sectionTitle">Nossos Doutores</h2>
          <UnitDoctorsGrid />
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
