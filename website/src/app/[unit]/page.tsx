import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import UnitsMapSection from "@/components/UnitsMapSection";
import UnitDoctorsGrid from "@/components/UnitDoctorsGrid";
import HeroMedia from "@/components/HeroMedia";
import UnitSelectionSync from "@/components/UnitSelectionSync";
import AboutUsSection from "@/components/AboutUsSection";
import { units } from "@/data/units";
import { getHeroMediaItems, heroVariantFromUserAgent } from "@/lib/heroMedia.server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { headers } from "next/headers";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");
export const revalidate = 300;

function normalizeSlug(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unitLocality(unitSlug: string): string | null {
    const normalized = normalizeSlug(unitSlug);
    if (normalized === "novohamburgo") return "Novo Hamburgo";
    if (normalized === "barrashoppingsul") return "Porto Alegre";
    return null;
}

function normalizeTelephone(value: string | undefined): string | null {
    const v = (value ?? "").trim();
    if (!v) return null;
    if (v.startsWith("tel:")) return v.slice(4);
    return v;
}

function resolveUnitFromParam(param: string) {
    const direct = units.find((u) => u.slug === param);
    if (direct) return direct;

    const normalizedParam = normalizeSlug(param);
    return units.find((u) => normalizeSlug(u.slug) === normalizedParam) ?? null;
}

function canonicalUnitPath(unitSlug: string): string {
    // Canonicalize Novo Hamburgo without hyphen as requested.
    if (normalizeSlug(unitSlug) === "novohamburgo") return "novohamburgo";
    return unitSlug;
}

function isIndexableUnitPath(path: string): boolean {
    const normalized = normalizeSlug(path);
    return normalized === "novohamburgo" || normalized === "barrashoppingsul";
}

export async function generateMetadata({ params }: { params: Promise<{ unit: string }> }): Promise<Metadata> {
    const { unit: unitParam } = await params;
    const unit = resolveUnitFromParam(unitParam);
    if (!unit) {
        return {
            title: "Espaço Facial",
            robots: { index: false, follow: false },
            alternates: { canonical: `${siteUrl}/` },
        };
    }

    const canonicalPath = canonicalUnitPath(unit.slug);
    const canonicalUrl = `${siteUrl}/${canonicalPath}`;

    return {
        title: `Espaço Facial — ${unit.name}`,
        description: "Harmonização facial e corporal. Selecione sua unidade e agende.",
        robots: {
            index: isIndexableUnitPath(canonicalPath),
            follow: isIndexableUnitPath(canonicalPath),
        },
        alternates: { canonical: canonicalUrl },
        openGraph: {
            title: `Espaço Facial — ${unit.name}`,
            description: "Harmonização facial e corporal. Selecione sua unidade e agende.",
            url: canonicalUrl,
            type: "website",
        },
    };
}

export default async function UnitHomePage({
    params,
    searchParams,
}: {
    params: Promise<{ unit: string }>;
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
    const { unit: unitParam } = await params;
    const resolvedSearchParams = searchParams ? await searchParams : undefined;
    const unit = resolveUnitFromParam(unitParam);
    if (!unit) {
        redirect("/");
    }

    const canonicalPath = canonicalUnitPath(unit.slug);
    if (normalizeSlug(unitParam) !== normalizeSlug(canonicalPath)) {
        const qs = new URLSearchParams();
        for (const [key, raw] of Object.entries(resolvedSearchParams ?? {})) {
            if (typeof raw === "string") qs.set(key, raw);
            else if (Array.isArray(raw)) raw.forEach((v) => typeof v === "string" && qs.append(key, v));
        }
        const suffix = qs.toString();
        redirect(suffix ? `/${canonicalPath}?${suffix}` : `/${canonicalPath}`);
    }

    const isIndexable = isIndexableUnitPath(canonicalPath);
    const locality = unitLocality(unit.slug);
    const telephone = normalizeTelephone(unit.whatsappPhone) ?? normalizeTelephone(unit.phone);
    const email = unit.email ? unit.email.replace(/^mailto:/, "").split("?")[0] : null;
    const ua = (await headers()).get("user-agent");
    const variant = heroVariantFromUserAgent(ua);
    const { items: heroItems } = await getHeroMediaItems({ variant });

    const localBusinessJsonLd =
        isIndexable && locality && unit.addressLine
            ? {
                "@context": "https://schema.org",
                "@type": "MedicalBusiness",
                "@id": `${siteUrl}/${canonicalPath}#localbusiness`,
                name: `Espaço Facial - ${unit.name}`,
                url: `${siteUrl}/${canonicalPath}`,
                image: `${siteUrl}/opengraph-image`,
                telephone: telephone ?? undefined,
                email: email || undefined,
                address: {
                    "@type": "PostalAddress",
                    streetAddress: unit.addressLine,
                    addressLocality: locality,
                    addressRegion: unit.state ?? "RS",
                    addressCountry: "BR",
                },
                geo:
                    typeof unit.lat === "number" && typeof unit.lng === "number"
                        ? {
                            "@type": "GeoCoordinates",
                            latitude: unit.lat,
                            longitude: unit.lng,
                        }
                        : undefined,
                sameAs: [unit.instagram, unit.facebook, unit.threads].filter(Boolean),
                hasMap: unit.maps ?? undefined,
            }
            : null;

    return (
        <>
            <UnitSelectionSync slug={unit.slug} />
            <Header />
            {localBusinessJsonLd ? (
                <script
                    type="application/ld+json"
                    // eslint-disable-next-line react/no-danger
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
                />
            ) : null}

            <h1 className="srOnly">Espaço Facial</h1>

            <section className="hero" aria-label="Destaque">
                <HeroMedia initialItems={heroItems} />
                <div className="heroOverlay" />
            </section>

            <main className="container">
                <AboutUsSection />

                <section id="doutores" className="pageSection" style={{ marginTop: 50 }}>
                    <h2 className="sectionTitle">Nossos Doutores</h2>
                    <p className="sectionSub">Selecione uma unidade no cabeçalho para ver a equipe.</p>
                    <UnitDoctorsGrid />
                </section>

                <section id="unidades" className="pageSection" style={{ marginTop: 50 }}>
                    <h2 className="sectionTitle">Nossas Unidades</h2>
                    <p className="sectionSub">Clique no ponto no mapa ou no nome da unidade para abrir.</p>
                    <UnitsMapSection />
                </section>
            </main>

            <Footer />
            <FloatingContact />
        </>
    );
}
