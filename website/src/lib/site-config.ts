export type SiteKey = "espacofacial" | "skincos";

export type SiteConfig = {
  key: SiteKey;
  host: string;
  siteUrl: string;
  brandName: string;
  titleDefault: string;
  titleTemplate: string;
  description: string;
  legalPaths: {
    privacy: string;
    terms: string;
    dataDeletion: string;
  };
  allowedPaths: ReadonlySet<string>;
};

const SKINCOS_HOSTS = new Set(["skincos.com.br", "www.skincos.com.br"]);

const ESPACOFACIAL_ALLOWED_PATHS = new Set<string>(["*"]);

const SKINCOS_ALLOWED_PATHS = new Set<string>([
  "/",
  "/privacidade",
  "/politica-de-privacidade",
  "/termos",
  "/termos-de-servico",
  "/dados",
  "/exclusao-de-dados",
  "/opengraph-image",
  "/twitter-image",
  "/favicon.ico",
  "/icon.svg",
  "/robots.txt",
  "/sitemap.xml",
]);

function normalizeHost(host: string | null | undefined): string {
  return (host ?? "")
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");
}

export function getSiteKeyFromHost(host: string | null | undefined): SiteKey {
  return SKINCOS_HOSTS.has(normalizeHost(host)) ? "skincos" : "espacofacial";
}

export function getSiteConfigFromHost(host: string | null | undefined): SiteConfig {
  const normalizedHost = normalizeHost(host);
  const siteKey = getSiteKeyFromHost(normalizedHost);

  if (siteKey === "skincos") {
    return {
      key: "skincos",
      host: normalizedHost || "skincos.com.br",
      siteUrl: "https://skincos.com.br",
      brandName: "SKINCOS",
      titleDefault: "SKINCOS | ORB by SKINCOS",
      titleTemplate: "%s | SKINCOS",
      description:
        "Hub institucional e jurídico da SKINCOS para o app ORB by SKINCOS e suas integrações com Meta.",
      legalPaths: {
        privacy: "/privacidade",
        terms: "/termos",
        dataDeletion: "/dados",
      },
      allowedPaths: SKINCOS_ALLOWED_PATHS,
    };
  }

  return {
    key: "espacofacial",
    host: normalizedHost || "espacofacial.com",
    siteUrl: "https://espacofacial.com",
    brandName: "Espaço Facial",
    titleDefault: "Espaço Facial | Harmonização Facial e Corporal",
    titleTemplate: "%s | Espaço Facial",
    description:
      "Espaço Facial: harmonização facial e corporal com equipe especializada, protocolos personalizados e agendamento online.",
    legalPaths: {
      privacy: "/privacidade",
      terms: "/termos",
      dataDeletion: "/dados",
    },
    allowedPaths: ESPACOFACIAL_ALLOWED_PATHS,
  };
}

export function isPathAllowedForSite(host: string | null | undefined, pathname: string): boolean {
  const config = getSiteConfigFromHost(host);
  if (config.allowedPaths.has("*")) return true;
  return config.allowedPaths.has((pathname.replace(/\/+$/, "") || "/").toLowerCase());
}
