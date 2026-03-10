import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import UnitsMapSection from "@/components/UnitsMapSection";
import UnitsLandingExperience, { type UnitsFeaturedCard } from "@/components/UnitsLandingExperience";
import { units } from "@/data/units";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

const featuredUnits = units.filter((unit) => ["barrashoppingsul", "novo-hamburgo"].includes(unit.slug));
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
    "Confira endereços, contatos e mapa das unidades Espaço Facial para escolher a clínica mais próxima de você.",
  alternates: { canonical: `${siteUrl}/unidades` },
  openGraph: {
    title: "Unidades e Endereços | Espaço Facial",
    description:
      "Confira endereços, contatos e mapa das unidades Espaço Facial para escolher a clínica mais próxima de você.",
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
            <h2 className="sectionTitle">Mapa completo de unidades</h2>
            <p className="sectionSub pageNarrative__sub">Clique no ponto no mapa ou no nome da unidade para abrir a página correspondente.</p>
          </div>
          <UnitsMapSection />
        </section>
      </main>
      <Footer />
      <FloatingContact />
    </>
  );
}
