import type { Metadata } from "next";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import AboutUsSection from "@/components/AboutUsSection";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Sobre",
  description:
    "Conheça a Espaço Facial, nossa forma de atendimento e o cuidado por trás de cada avaliação.",
  alternates: { canonical: `${siteUrl}/sobre` },
  openGraph: {
    title: "Sobre | Espaço Facial",
    description:
      "Conheça a Espaço Facial, nossa forma de atendimento e o cuidado por trás de cada avaliação.",
    url: `${siteUrl}/sobre`,
    type: "website",
  },
};

export default function AboutPage() {
  return (
    <>
      <Header />
      <main className="container">
        <AboutUsSection
          headingLevel={1}
          selectedTitle="Conheça a unidade"
          selectedSubtitle="Veja localização, fotos, avaliações e formas de contato antes de agendar."
          unselectedTitle="Espaço Facial"
        />
      </main>
      <Footer />
      <FloatingContact />
    </>
  );
}
