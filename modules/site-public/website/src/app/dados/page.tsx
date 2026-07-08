import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getSiteConfigFromHost } from "@/lib/site-config";
import { SkincosDataDeletionContent } from "@/components/LegalContent";

export async function generateMetadata(): Promise<Metadata> {
  const site = getSiteConfigFromHost((await headers()).get("host"));

  return {
    title: "Exclusão de Dados",
    description:
      "Instruções de exclusão de dados do app ORB by SKINCOS para uso institucional e para o campo Data Deletion Instructions URL da Meta.",
    robots: { index: true, follow: true },
    alternates: {
      canonical: `${site.siteUrl}/dados`,
    },
    openGraph: {
      title: "Exclusão de Dados | SKINCOS",
      description:
        "Instruções de exclusão de dados do app ORB by SKINCOS para uso institucional e para o campo Data Deletion Instructions URL da Meta.",
      url: `${site.siteUrl}/dados`,
      type: "website",
    },
  };
}

export default async function DataDeletionPage() {
  const site = getSiteConfigFromHost((await headers()).get("host"));
  if (site.key !== "skincos") notFound();
  return <SkincosDataDeletionContent />;
}
