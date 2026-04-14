"use client";

import { useRouter, useSearchParams } from "next/navigation";
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
    action?: "first_available";
};

export default function BookingHeroExperience() {
    const router = useRouter();
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
    const preferredUnitSlug = resolvedUnit?.slug ?? unit?.slug ?? null;

    const shortcuts: HeroShortcut[] = [
        {
            title: "Primeiro Horário Disponível",
            description: "Sem preferência por especialista e indicação de procedimento.",
            href: "/agendamento#booking-flow",
            kind: "primary" as const,
            action: "first_available",
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

    function activateFirstAvailableShortcut() {
        const params = new URLSearchParams({
            doctor: "any",
            service: "any",
            autopick: "first",
            autopick_nonce: `${Date.now()}`,
        });
        if (preferredUnitSlug) params.set("unit", preferredUnitSlug);
        router.push(`/agendamento?${params.toString()}#booking-flow`, { scroll: false });
    }

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
                                        {item.action === "first_available" ? (
                                            <button
                                                type="button"
                                                className={`bookingHero__shortcut bookingHero__shortcut--${item.kind}`.trim()}
                                                onClick={() => {
                                                    trackExperienceShortcutClick({
                                                        page: "/agendamento",
                                                        shortcut: item.title,
                                                        destination: "/agendamento?doctor=any&service=any&autopick=first#booking-flow",
                                                        placement: "booking_page",
                                                        experience: EXPERIENCE_KEY,
                                                        variant: EXPERIENCE_VARIANT,
                                                    });
                                                    activateFirstAvailableShortcut();
                                                }}
                                            >
                                                <strong>{item.title}</strong>
                                            </button>
                                        ) : item.external ? (
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
