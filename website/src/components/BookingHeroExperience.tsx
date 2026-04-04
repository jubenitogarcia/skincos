"use client";

import Link from "next/link";
import ExperienceTracker from "@/components/ExperienceTracker";
import PageTitleBand from "@/components/PageTitleBand";
import { trackExperienceShortcutClick } from "@/lib/leadTracking";

const EXPERIENCE_KEY = "booking_public_v1";
const EXPERIENCE_VARIANT = "canonical";

const SHORTCUTS = [
    {
        title: "Primeiro Horário Disponível",
        href: "/agendamento?doctor=any#booking-flow",
        kind: "primary" as const,
    },
    {
        title: "Ver Especialistas",
        href: "/#doutores",
        kind: "secondary" as const,
    },
];

export default function BookingHeroExperience() {
    return (
        <>
            <ExperienceTracker page="/agendamento" experience={EXPERIENCE_KEY} variant={EXPERIENCE_VARIANT} />

            <PageTitleBand title="Agendamento online" ariaLabel="Título da página de agendamento" />

            <section className="bookingHero bookingHero--experience bookingHero--editorial-guided">
                <div className="container">
                    <div className="bookingHero__shell bookingHero__shell--stacked">
                        <div className="bookingHero__copy bookingHero__copy--experience">
                            <h1 className="sectionTitle">Escolha a unidade, o especialista e o melhor horário para você.</h1>
                            <p className="sectionSub bookingHero__lede">
                                Reserve a sua avaliação em poucos passos.
                            </p>
                        </div>

                        <div className="bookingHero__panel" role="group" aria-label="Atalhos do agendamento">
                            <div className="bookingHero__shortcutGrid bookingHero__shortcutGrid--inline">
                                {SHORTCUTS.map((item) => (
                                    <Link
                                        key={item.title}
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
                                    </Link>
                                ))}
                            </div>

                        </div>
                    </div>
                </div>
            </section>
        </>
    );
}
