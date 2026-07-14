import type { Metadata } from "next";
import { headers } from "next/headers";
import { getSiteConfigFromHost } from "@/lib/site-config";
import { EspacofacialTermsContent, SkincosTermsContent } from "@/components/LegalContent";

export async function generateMetadata(): Promise<Metadata> {
  const site = getSiteConfigFromHost((await headers()).get("host"));

  if (site.key === "skincos") {
    return {
      title: "Termos de Serviço",
      description:
        "Termos de serviço da SKINCOS para o app ORB by SKINCOS e suas integrações com plataformas da Meta.",
      robots: { index: true, follow: true },
      alternates: {
        canonical: `${site.siteUrl}/termos`,
      },
      openGraph: {
        title: "Termos de Serviço | SKINCOS",
        description:
          "Termos de serviço da SKINCOS para o app ORB by SKINCOS e suas integrações com plataformas da Meta.",
        url: `${site.siteUrl}/termos`,
        type: "website",
      },
    };
  }

  return {
    title: "Termos de Uso",
    description:
      "Termos de uso do site da Espaço Facial com orientações de uso, informações de atendimento e canais oficiais.",
    robots: { index: true, follow: true },
    alternates: {
      canonical: `${site.siteUrl}/termos`,
    },
    openGraph: {
      title: "Termos de Uso | Espaço Facial",
      description:
        "Termos de uso do site da Espaço Facial com orientações de uso, informações de atendimento e canais oficiais.",
      url: `${site.siteUrl}/termos`,
      type: "website",
    },
  };
}

export default async function TermsPage() {
  const site = getSiteConfigFromHost((await headers()).get("host"));
  return site.key === "skincos" ? <SkincosTermsContent /> : <EspacofacialTermsContent />;
}
