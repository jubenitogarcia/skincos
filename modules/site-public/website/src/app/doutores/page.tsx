import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import UnitDoctorsGrid from "@/components/UnitDoctorsGrid";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Especialistas",
  description:
    "Conheça os doutores especialistas da Espaço Facial e escolha com mais confiança o profissional ideal para sua avaliação.",
  alternates: { canonical: `${siteUrl}/doutores` },
  openGraph: {
    title: "Especialistas",
    description:
      "Conheça os doutores especialistas da Espaço Facial e escolha com mais confiança o profissional ideal para sua avaliação.",
    url: `${siteUrl}/doutores`,
    type: "website",
  },
};

export default function DoctorsIndex() {
  return (
    <>
      <Header />
      <main className="container">
        <section id="directory-grid" className="pageSection pageNarrative pageNarrative--compact">
          <div className="pageNarrative__intro">
            <h1 className="sectionTitle">Especialistas</h1>
            <p className="sectionSub pageNarrative__sub">
              Conheça os doutores da Espaço Facial, veja em quais unidades atendem e siga para o agendamento quando encontrar o profissional ideal para você.
            </p>
          </div>
          <UnitDoctorsGrid showAllWhenNoUnitSelected />
        </section>
      </main>
      <Footer />
      <FloatingContact />
    </>
  );
}
