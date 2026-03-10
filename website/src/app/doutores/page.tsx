import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import UnitDoctorsGrid from "@/components/UnitDoctorsGrid";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Doutores",
  description: "Conheça os doutores da Espaço Facial e agende seu atendimento.",
  alternates: { canonical: `${siteUrl}/doutores` },
  openGraph: {
    title: "Doutores | Espaço Facial",
    description: "Conheça os doutores da Espaço Facial e agende seu atendimento.",
    url: `${siteUrl}/doutores`,
    type: "website",
  },
};

export default function DoctorsIndex() {
  return (
    <>
      <Header />
      <main className="container">
        <section className="pageSection" style={{ marginTop: 40 }}>
          <h1 className="sectionTitle">Nossos Doutores</h1>
          <UnitDoctorsGrid />
        </section>
      </main>
      <Footer />
      <FloatingContact />
    </>
  );
}
