"use client";

import { useSearchParams } from "next/navigation";
import ExperienceTracker from "@/components/ExperienceTracker";
import PageTitleBand from "@/components/PageTitleBand";
import SmoothAnchorLink from "@/components/SmoothAnchorLink";
import { units } from "@/data/units";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { trackExperienceShortcutClick } from "@/lib/leadTracking";

const EXPERIENCE_KEY = "booking_public_v1";
const EXPERIENCE_VARIANT = "canonical";

type HeroShortcut = {
    title: string;
    href: string;
    kind: "primary" | "secondary";
    description?: string;
    external?: boolean;
};

export default function BookingHeroExperience() {
    const unit = useCurrentUnit();
    const searchParams = useSearchParams();
    const bookingId = (searchParams?.get("booking") ?? "").trim();
    const unitFromQuery = (searchParams?.get("unit") ?? "").trim();
    const confirmationMode = bookingId.length > 0;

    const resolvedUnit =
        units.find((item) => item.slug === unitFromQuery) ??
        units.find((item) => item.slug === unit?.slug) ??
        null;
    const unitWhatsappDigits = (resolvedUnit?.whatsappPhone ?? "").replace(/\D/g, "");
    const unitWhatsappUrl = unitWhatsappDigits ? `https://api.whatsapp.com/send?phone=${unitWhatsappDigits}` : "/agendamento#booking-flow";
    const scheduleAnotherHref = resolvedUnit?.slug ? `/agendamento?unit=${resolvedUnit.slug}#booking-flow` : "/agendamento#booking-flow";

    const bookingQuery = new URLSearchParams({
        doctor: "any",
        service: "any",
        autopick: "first",
    });
    if (unit?.slug) bookingQuery.set("unit", unit.slug);

    const shortcuts: HeroShortcut[] = [
        {
            title: "Primeiro Horário Disponível",
            description: "Sem preferência por especialista e indicação de procedimento.",
            href: `/agendamento?${bookingQuery.toString()}#booking-flow`,
            kind: "primary" as const,
        },
        {
            title: "Ver Especialistas",
            description: "Conheça a equipe e veja seus procedimentos.",
            href: "/#doutores",
            kind: "secondary" as const,
        },
    ];
    const confirmationActions: HeroShortcut[] = [
        {
            title: "Agendar Outra Reserva",
            href: scheduleAnotherHref,
            kind: "primary" as const,
            external: false,
        },
        {
            title: "Alterar Reserva",
            href: unitWhatsappUrl,
            kind: "secondary" as const,
            external: true,
        },
    ];

    const firstSlotSelected = (searchParams?.get("autopick") ?? "").toLowerCase() === "first";

    return (
        <>
            <ExperienceTracker page="/agendamento" experience={EXPERIENCE_KEY} variant={EXPERIENCE_VARIANT} />

            <PageTitleBand title="Agendamento online" ariaLabel="Título da página de agendamento" />

            <section className="bookingHero bookingHero--experience bookingHero--editorial-guided">
                <div className="container">
                    <div className="bookingHero__shell bookingHero__shell--stacked">
                        <div className="bookingHero__copy bookingHero__copy--experience">
                            <h1 className="sectionTitle">
                                {confirmationMode ? "Confira os detalhes da sua reserva." : "Escolha a unidade, o especialista e o melhor horário para você."}
                            </h1>
                            <p className="sectionSub bookingHero__lede">
                                {confirmationMode
                                    ? "Se quiser iniciar um novo agendamento ou falar com a unidade, use os atalhos abaixo."
                                    : "Reserve a sua avaliação em poucos passos."}
                            </p>
                        </div>

                        <div className="bookingHero__panel" role="group" aria-label={confirmationMode ? "Ações da reserva" : "Atalhos do agendamento"}>
                            <div className="bookingHero__shortcutGrid bookingHero__shortcutGrid--inline">
                                {(confirmationMode ? confirmationActions : shortcuts).map((item) => (
                                    <div key={item.title} className="bookingHero__shortcutItem">
                                        {item.external ? (
                                            <a
                                                href={item.href}
                                                className={`bookingHero__shortcut bookingHero__shortcut--${item.kind}`.trim()}
                                                target="_blank"
                                                rel="noreferrer"
                                                onClick={() =>
                                                    trackExperienceShortcutClick({
                                                        page: "/agendamento",
                                                        shortcut: item.title,
                                                        destination: item.href,
                                                        placement: "booking_page",
                                                        experience: EXPERIENCE_KEY,
                                                        variant: EXPERIENCE_VARIANT,
                                                    })
                                                }
                                            >
                                                <strong>{item.title}</strong>
                                            </a>
                                        ) : (
                                            <SmoothAnchorLink
                                                href={item.href}
                                                className={`bookingHero__shortcut bookingHero__shortcut--${item.kind}`.trim()}
                                                data-selected={!confirmationMode && item.kind === "primary" && firstSlotSelected ? "true" : "false"}
                                                onClick={() =>
                                                    trackExperienceShortcutClick({
                                                        page: "/agendamento",
                                                        shortcut: item.title,
                                                        destination: item.href,
                                                        placement: "booking_page",
                                                        experience: EXPERIENCE_KEY,
                                                        variant: EXPERIENCE_VARIANT,
                                                    })
                                                }
                                            >
                                                <strong>{item.title}</strong>
                                            </SmoothAnchorLink>
                                        )}
                                        {!confirmationMode && item.description ? <p className="bookingHero__shortcutNote">{item.description}</p> : null}
                                    </div>
                                ))}
                            </div>

                        </div>
                    </div>
                </div>
            </section>
        </>
    );
}
