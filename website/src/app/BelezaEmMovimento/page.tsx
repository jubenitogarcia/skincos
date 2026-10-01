import type { Metadata } from "next";
import Footer from "@/components/Footer";
import Header from "@/components/Header";
import BeautyMovementCampaign from "@/components/BeautyMovementCampaign";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Cartas da Beleza em Movimento | Espaço Facial",
  description: "Uma experiência editorial exclusiva da Espaço Facial Novo Hamburgo para celebrar 3 anos de beleza em movimento.",
  alternates: {
    canonical: `${siteUrl}/BelezaEmMovimento`,
  },
  openGraph: {
    title: "Cartas da Beleza em Movimento | Espaço Facial",
    description: "Uma experiência editorial exclusiva da Espaço Facial Novo Hamburgo para celebrar 3 anos de beleza em movimento.",
    url: `${siteUrl}/BelezaEmMovimento`,
    siteName: "Espaço Facial",
    locale: "pt_BR",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "Cartas da Beleza em Movimento | Espaço Facial",
    description: "Uma experiência editorial exclusiva da Espaço Facial Novo Hamburgo para celebrar 3 anos de beleza em movimento.",
  },
  robots: {
    index: false,
    follow: false,
  },
};

export default function BeautyMovementCanonicalPage() {
  return (
    <>
      <Header preferredUnitSlug="novo-hamburgo" fixedUnitSlug="novo-hamburgo" scrollAware />
      <BeautyMovementCampaign />
      <Footer />
    </>
  );
}
