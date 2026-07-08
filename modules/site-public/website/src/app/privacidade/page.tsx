import type { Metadata } from "next";
import { headers } from "next/headers";
import { getSiteConfigFromHost } from "@/lib/site-config";
import { EspacofacialPrivacyContent, SkincosPrivacyContent } from "@/components/LegalContent";

export async function generateMetadata(): Promise<Metadata> {
  const site = getSiteConfigFromHost((await headers()).get("host"));

  if (site.key === "skincos") {
    return {
      title: "Política de Privacidade",
      description:
        "Política de privacidade da SKINCOS e do app ORB by SKINCOS, com foco em integrações com Meta e tratamento de dados operacionais.",
      robots: { index: true, follow: true },
      alternates: {
        canonical: `${site.siteUrl}/privacidade`,
      },
      openGraph: {
        title: "Política de Privacidade | SKINCOS",
        description:
          "Política de privacidade da SKINCOS e do app ORB by SKINCOS, com foco em integrações com Meta e tratamento de dados operacionais.",
        url: `${site.siteUrl}/privacidade`,
        type: "website",
      },
    };
  }

  return {
    title: "Privacidade e Cookies",
    description:
      "Política de privacidade e cookies da Espaço Facial com transparência sobre coleta, uso e proteção de dados.",
    robots: { index: true, follow: true },
    alternates: {
      canonical: `${site.siteUrl}/privacidade`,
    },
    openGraph: {
      title: "Privacidade e Cookies | Espaço Facial",
      description:
        "Política de privacidade e cookies da Espaço Facial com transparência sobre coleta, uso e proteção de dados.",
      url: `${site.siteUrl}/privacidade`,
      type: "website",
    },
  };
}

export default async function PrivacyPage() {
  const site = getSiteConfigFromHost((await headers()).get("host"));
  return site.key === "skincos" ? <SkincosPrivacyContent /> : <EspacofacialPrivacyContent />;
}
