"use client";

import Link from "next/link";
import ExperienceTracker from "@/components/ExperienceTracker";
import TrackedBookingLink from "@/components/TrackedBookingLink";
import { trackExperienceShortcutClick } from "@/lib/leadTracking";
import { getUnitHref } from "@/lib/unitRoutes";

export type UnitsFeaturedCard = {
    slug: string;
    name: string;
    addressLine: string | null;
    maps: string | null;
    state: string | null;
    city: string;
    contactUrl: string | null;
    whatsappPhone: string | null;
};

type UnitsLandingExperienceProps = {
    featuredUnits: UnitsFeaturedCard[];
    unitsByState: number;
};

const EXPERIENCE_KEY = "units_public_v1";
const EXPERIENCE_VARIANT = "canonical";

const UNIT_TIPS = [
    "Considere a unidade mais prática para você ir e voltar com tranquilidade.",
    "Abra a página da unidade para ver equipe, contato e localização.",
    "Se preferir, já comece o agendamento com a unidade escolhida.",
];

export default function UnitsLandingExperience({ featuredUnits, unitsByState }: UnitsLandingExperienceProps) {
    return (
        <>
            <ExperienceTracker page="/unidades" experience={EXPERIENCE_KEY} variant={EXPERIENCE_VARIANT} />

            <section className="unitsHero unitsHero--featured-units" style={{ marginTop: 40 }}>
                <div className="unitsHero__shell">
                    <div className="unitsHero__copy">
                        <span className="unitsHero__capsule">Escolha sua unidade</span>
                        <h1 className="sectionTitle">Veja onde a Espaço Facial atende e encontre o local ideal para você.</h1>
                        <p className="sectionSub">
                            Encontre a unidade mais conveniente para você, veja endereço, contato e acesso ao agendamento online.
                        </p>

                        <div className="unitsHero__actions">
                            <a
                                href="#units-featured"
                                className="unitsHero__primary"
                                onClick={() =>
                                    trackExperienceShortcutClick({
                                        page: "/unidades",
                                        shortcut: "Ver unidades em destaque",
                                        destination: "#units-featured",
                                        placement: "units_page",
                                        experience: EXPERIENCE_KEY,
                                        variant: EXPERIENCE_VARIANT,
                                    })
                                }
                            >
                                Ver unidades em destaque
                            </a>
                            <a
                                href="#units-map"
                                className="unitsHero__secondary"
                                onClick={() =>
                                    trackExperienceShortcutClick({
                                        page: "/unidades",
                                        shortcut: "Abrir mapa completo",
                                        destination: "#units-map",
                                        placement: "units_page",
                                        experience: EXPERIENCE_KEY,
                                        variant: EXPERIENCE_VARIANT,
                                    })
                                }
                            >
                                Abrir mapa completo
                            </a>
                        </div>

                        <div className="unitsHero__stats" role="group" aria-label="Panorama das unidades">
                            <div className="unitsHero__stat">
                                <strong>{featuredUnits.length}</strong>
                                <span>unidades com endereço, contato e agendamento online</span>
                            </div>
                            <div className="unitsHero__stat">
                                <strong>{unitsByState}</strong>
                                <span>estados representados no mapa da rede</span>
                            </div>
                            <div className="unitsHero__stat">
                                <strong>Mapa + contato</strong>
                                <span>localização, rota e contato para facilitar sua escolha</span>
                            </div>
                        </div>
                    </div>

                    <aside className="unitsHero__panel" aria-label="Informações sobre as unidades">
                        <div className="unitsHero__panelCard">
                            <span className="unitsHero__panelLabel">Antes de escolher</span>
                            <ul className="unitsHero__panelList">
                                {UNIT_TIPS.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        </div>
                        <div className="unitsHero__panelCard unitsHero__panelCard--soft">
                            <span className="unitsHero__panelLabel">Atendimento perto de você</span>
                            <p>Escolher a unidade certa ajuda a deixar o atendimento e os retornos mais práticos.</p>
                        </div>
                    </aside>
                </div>
            </section>

            <section id="units-featured" className="pageSection decisionCardsSection" aria-label="Unidades em destaque">
                <div className="decisionCards">
                    {featuredUnits.map((unit) => {
                        const unitHref = getUnitHref(unit.slug);
                        return (
                            <article key={unit.slug} className="decisionCard decisionCard--unit">
                                <div className="decisionCard__eyebrow">{unit.city || unit.state || "Unidade"}</div>
                                <h2>{unit.name}</h2>
                                <p>{unit.addressLine ? unit.addressLine : "Abra a unidade para ver detalhes e contato direto."}</p>

                                <div className="decisionCard__meta">
                                    <span className="decisionCard__metaItem">
                                        {unit.city}, {unit.state ?? "Brasil"}
                                    </span>
                                    <span className="decisionCard__metaItem">{unit.maps ? "Como chegar disponível" : "Localização sob consulta"}</span>
                                    <span className="decisionCard__metaItem">{unit.whatsappPhone ? "WhatsApp direto" : "Contato local"}</span>
                                </div>

                                <div className="decisionCard__actions">
                                    <TrackedBookingLink
                                        href={`/agendamento?unit=${encodeURIComponent(unit.slug)}#booking-flow`}
                                        className="decisionCard__primary"
                                        placement="units_page"
                                        unitSlug={unit.slug}
                                        experience={EXPERIENCE_KEY}
                                        variant={EXPERIENCE_VARIANT}
                                    >
                                        Agendar nesta unidade
                                    </TrackedBookingLink>
                                </div>

                                <div className="decisionCard__linksRow">
                                    <Link
                                        href={unitHref}
                                        className="decisionCard__link"
                                        onClick={() =>
                                            trackExperienceShortcutClick({
                                                page: "/unidades",
                                                shortcut: `Detalhes unidade ${unit.slug}`,
                                                destination: unitHref,
                                                placement: "units_page",
                                                unitSlug: unit.slug,
                                                experience: EXPERIENCE_KEY,
                                                variant: EXPERIENCE_VARIANT,
                                            })
                                        }
                                    >
                                        Ver detalhes da unidade
                                    </Link>

                                    {unit.contactUrl ? (
                                        <Link
                                            href={unit.contactUrl}
                                            prefetch={false}
                                            className="decisionCard__link"
                                            onClick={() =>
                                                trackExperienceShortcutClick({
                                                    page: "/unidades",
                                                    shortcut: `Contato unidade ${unit.slug}`,
                                                    destination: unit.contactUrl ?? "contact",
                                                    placement: "units_page",
                                                    unitSlug: unit.slug,
                                                    experience: EXPERIENCE_KEY,
                                                    variant: EXPERIENCE_VARIANT,
                                                })
                                            }
                                        >
                                            Falar com a unidade
                                        </Link>
                                    ) : null}

                                    {unit.maps ? (
                                        <a
                                            href={unit.maps}
                                            className="decisionCard__link"
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={() =>
                                                trackExperienceShortcutClick({
                                                    page: "/unidades",
                                                    shortcut: `Abrir rota ${unit.slug}`,
                                                    destination: unit.maps ?? "maps",
                                                    placement: "units_page",
                                                    unitSlug: unit.slug,
                                                    experience: EXPERIENCE_KEY,
                                                    variant: EXPERIENCE_VARIANT,
                                                })
                                            }
                                        >
                                            Abrir rota no mapa
                                        </a>
                                    ) : null}
                                </div>
                            </article>
                        );
                    })}
                </div>
            </section>
        </>
    );
}
