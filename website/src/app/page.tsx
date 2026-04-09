import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import UnitsMapSection from "@/components/UnitsMapSection";
import UnitDoctorsGrid from "@/components/UnitDoctorsGrid";
import AboutUsSection from "@/components/AboutUsSection";
import HomeHeroExperience from "@/components/HomeHeroExperience";
import TrustEvidenceSection from "@/components/TrustEvidenceSection";
import { getHeroMediaItems, heroVariantFromUserAgent } from "@/lib/heroMedia.server";
import { resolveUnitFromSlug } from "@/lib/unitRoutes";
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
  const resolvedUnit = resolveUnitFromSlug(unitParam);
  const { items: heroItems } = await getHeroMediaItems({ variant, unitSlug: resolvedUnit?.slug ?? null });

  return (
    <>
      <Header />
      <main>
        <HomeHeroExperience heroItems={heroItems} initialMediaVariant={variant} initialUnitSlug={resolvedUnit?.slug ?? null} />
        <TrustEvidenceSection context="home" />

        <div className="container">
          <section className="pageSection pageNarrative homeLeadSection">
            <div className="pageNarrative__intro pageNarrative__intro--extended homeLeadSection__intro">
              <h2 className="sectionTitle">Realce sua beleza com equilíbrio, segurança e resultado natural.</h2>
              <p className="sectionLead pageNarrative__sub homeLeadSection__sub">
                Na Espaço Facial, cada atendimento começa com uma avaliação cuidadosa para indicar o que faz sentido para o seu rosto e/ou corpo, sua rotina e suas expectativas, com segurança, elegância e naturalidade.
              </p>
            </div>
          </section>

          <AboutUsSection />

          <section id="doutores" className="pageSection homeDoctorsSection">
            <h2 className="sectionTitle">Conheça a equipe</h2>
            <div className="sectionCopyPair homeDoctorsLead">
              <p className="sectionSub">
                Escolher fica mais fácil quando você conhece o profissional.
              </p>
            </div>
            <UnitDoctorsGrid variant="booking-compact" />
            <p className="small homeDoctorsAftercopy">
              Acompanhe os seus procedimentos em suas redes sociais e agende com confiança com um de nossos doutores especialistas.
            </p>
          </section>

          <section id="unidades" className="pageSection">
            <h2 className="sectionTitle">Nossas Unidades</h2>
            <p className="sectionSub">
              Veja as unidades da Espaço Facial e encontre a mais conveniente para o seu atendimento.
            </p>
            <UnitsMapSection />
          </section>
        </div>
      </main>

      <Footer />
      <FloatingContact />
    </>
  );
}
