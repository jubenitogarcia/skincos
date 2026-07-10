import Header from "@/components/Header";
import Footer from "@/components/Footer";
import FloatingContact from "@/components/FloatingContact";
import MetaMountEvent from "@/components/MetaMountEvent";
import UnitsMapSection from "@/components/UnitsMapSection";
import UnitDoctorsGrid from "@/components/UnitDoctorsGrid";
import HeroMedia from "@/components/HeroMedia";
import UnitSelectionSync from "@/components/UnitSelectionSync";
import AboutUsSection from "@/components/AboutUsSection";
import PageTitleBand from "@/components/PageTitleBand";
import TrustEvidenceSection from "@/components/TrustEvidenceSection";
import { getCanonicalDigitalUnitSlug, getNetworkUnitHref, isDigitalJourneyUnit, isIndexableUnitPath, normalizeUnitSlug, resolveUnitFromSlug } from "@/lib/unitRoutes";
import { getHeroMediaItems, heroVariantFromUserAgent } from "@/lib/heroMedia.server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { headers } from "next/headers";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://espacofacial.com").replace(/\/$/, "");
export const revalidate = 300;

function unitLocality(unitSlug: string): string | null {
    const normalized = normalizeUnitSlug(unitSlug);
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

export async function generateMetadata({ params }: { params: Promise<{ unit: string }> }): Promise<Metadata> {
    const { unit: unitParam } = await params;
    const unit = resolveUnitFromSlug(unitParam);
    if (!unit) {
        return {
            title: "Espaço Facial",
            robots: { index: false, follow: false },
            alternates: { canonical: `${siteUrl}/` },
        };
    }

    if (!isDigitalJourneyUnit(unit)) {
        const fallbackUrl = `${siteUrl}${getNetworkUnitHref(unit.slug)}`;
        return {
            title: `${unit.name} | Rede Espaço Facial`,
            description: `Confirme a presença da unidade ${unit.name} na rede Espaço Facial e siga para mapa, contato ou agendamento online.`,
            robots: { index: false, follow: true },
            alternates: { canonical: fallbackUrl },
            openGraph: {
                title: `${unit.name} | Rede Espaço Facial`,
                description: `Confirme a presença da unidade ${unit.name} na rede Espaço Facial e siga para mapa, contato ou agendamento online.`,
                url: fallbackUrl,
                type: "website",
            },
        };
    }

    const canonicalPath = getCanonicalDigitalUnitSlug(unit.slug);
    const canonicalUrl = `${siteUrl}/${canonicalPath}`;

    return {
        title: unit.name,
        description: `Conheça a unidade ${unit.name}, veja equipe, localização e siga para o agendamento com mais facilidade.`,
        robots: {
            index: isIndexableUnitPath(canonicalPath),
            follow: isIndexableUnitPath(canonicalPath),
        },
        alternates: { canonical: canonicalUrl },
        openGraph: {
            title: unit.name,
            description: `Conheça a unidade ${unit.name}, veja equipe, localização e siga para o agendamento com mais facilidade.`,
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
    const unit = resolveUnitFromSlug(unitParam);
    if (!unit) {
        redirect("/");
    }

    if (!isDigitalJourneyUnit(unit)) {
        redirect(getNetworkUnitHref(unit.slug));
    }

    const canonicalPath = getCanonicalDigitalUnitSlug(unit.slug);
    if (unitParam !== canonicalPath) {
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
    const [desktopHeroMedia, mobileHeroMedia] = await Promise.all([
        getHeroMediaItems({ variant: "desktop", unitSlug: unit.slug }),
        getHeroMediaItems({ variant: "mobile", unitSlug: unit.slug }),
    ]);
    const heroItemsByVariant = {
        desktop: desktopHeroMedia.items,
        mobile: mobileHeroMedia.items,
    };
    const heroItems = heroItemsByVariant[variant];

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
            <MetaMountEvent
                eventName="ViewContent"
                dedupeKey={`unit:${unit.slug}`}
                params={{
                    content_type: "unit",
                    content_name: unit.name,
                    content_ids: [unit.slug],
                }}
            />
            {localBusinessJsonLd ? (
                <script
                    type="application/ld+json"
                    dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessJsonLd) }}
                />
            ) : null}

            <h1 className="srOnly">Espaço Facial</h1>

            <PageTitleBand title="Harmonização facial com naturalidade" ariaLabel="Título da página da unidade" />

            <section className="hero" aria-label="Destaque">
                <HeroMedia initialItems={heroItems} initialItemsByVariant={heroItemsByVariant} initialVariant={variant} initialUnitSlug={unit.slug} />
                <div className="heroOverlay" />
            </section>

            <TrustEvidenceSection context="home" />

            <main className="container">
                <AboutUsSection />

                <section id="doutores" className="pageSection">
                    <h2 className="sectionTitle">Conheça a equipe</h2>
                    <p className="sectionSub">Escolher fica mais fácil quando você conhece o profissional.</p>
                    <UnitDoctorsGrid variant="booking-compact" />
                    <p className="small homeDoctorsAftercopy">
                        Acompanhe os seus procedimentos em suas redes sociais e agende com confiança com um de nossos doutores especialistas.
                    </p>
                </section>

                <section id="unidades" className="pageSection">
                    <h2 className="sectionTitle">Outras unidades</h2>
                    <p className="sectionSub">Veja outras unidades da rede no mapa.</p>
                    <UnitsMapSection />
                </section>
            </main>

            <Footer />
            <FloatingContact />
        </>
    );
}
