import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import UnitsMapSection from "@/components/UnitsMapSection";
import UnitsLandingExperience, { type UnitsFeaturedCard } from "@/components/UnitsLandingExperience";
import { getDigitalJourneyUnits, units } from "@/data/units";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

const featuredUnits = getDigitalJourneyUnits();
const unitsByState = new Set(units.map((unit) => unit.state).filter(Boolean)).size;
const cityBySlug: Record<string, string> = {
  barrashoppingsul: "Porto Alegre",
  "novo-hamburgo": "Novo Hamburgo",
};
const featuredUnitCards: UnitsFeaturedCard[] = featuredUnits.map((unit) => ({
  slug: unit.slug,
  name: unit.name,
  addressLine: unit.addressLine ?? null,
  maps: unit.maps ?? null,
  state: unit.state ?? null,
  city: cityBySlug[unit.slug] ?? unit.state ?? "Unidade",
  contactUrl: unit.contactUrl ?? null,
  whatsappPhone: unit.whatsappPhone ?? null,
}));

export const metadata: Metadata = {
  title: "Unidades e Endereços",
  description:
    "Conheça as unidades da Espaço Facial, veja localização, contato e atendimento disponível.",
  alternates: { canonical: `${siteUrl}/unidades` },
  openGraph: {
    title: "Unidades e Endereços",
    description:
      "Conheça as unidades da Espaço Facial, veja localização, contato e atendimento disponível.",
    url: `${siteUrl}/unidades`,
    type: "website",
  },
};

export default function UnitsIndex() {
  return (
    <>
      <Header />
      <main className="container">
        <UnitsLandingExperience featuredUnits={featuredUnitCards} unitsByState={unitsByState} />

        <section id="units-map" className="pageSection pageNarrative pageNarrative--compact">
          <div className="pageNarrative__intro">
            <h2 className="sectionTitle">Mapa completo da rede</h2>
            <p className="sectionSub pageNarrative__sub">
              Veja a presença da rede por estado e encontre a unidade mais conveniente para você.
            </p>
          </div>
          <UnitsMapSection />
        </section>
      </main>
      <Footer />
      <FloatingContact />
    </>
  );
}
