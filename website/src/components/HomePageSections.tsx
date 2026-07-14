"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import UnitsMapSection from "@/components/UnitsMapSection";
import UnitDoctorsGrid from "@/components/UnitDoctorsGrid";
import AboutUsSection from "@/components/AboutUsSection";
import { getDigitalJourneyUnits } from "@/data/units";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { trackEvent } from "@/lib/analytics";
import { setStoredUnitSlug } from "@/lib/unitSelection";
import { getUnitHref } from "@/lib/unitRoutes";

export default function HomePageSections() {
    const router = useRouter();
    const unit = useCurrentUnit();
    const [hasHydrated, setHasHydrated] = useState(false);
    const availableUnits = getDigitalJourneyUnits();

    useEffect(() => {
        setHasHydrated(true);
    }, []);

    if (!hasHydrated) return null;

    if (!unit) {
        return (
            <div className="container">
                <section className="pageSection pageNarrative pageNarrative--compact homeUnitSelector" aria-labelledby="home-unit-selector-title">
                    <div className="pageNarrative__intro homeUnitSelector__intro">
                        <h2 id="home-unit-selector-title" className="sectionTitle">
                            Selecione a unidade para continuar.
                        </h2>
                        <p className="sectionSub pageNarrative__sub">
                            Para ver informações da unidade, equipe, localização e seguir para a jornada correta, escolha uma das unidades abaixo.
                        </p>
                    </div>

                    <div className="homeUnitSelector__actions" role="group" aria-label="Selecionar unidade">
                        {availableUnits.map((availableUnit) => (
                            <Link
                                key={availableUnit.slug}
                                href={getUnitHref(availableUnit.slug)}
                                className="homeUnitSelector__button"
                                onClick={(event) => {
                                    event.preventDefault();
                                    setStoredUnitSlug(availableUnit.slug);
                                    trackEvent("unit_select", {
                                        unitSlug: availableUnit.slug,
                                        placement: "home_empty_state_unit_buttons",
                                    });
                                    router.push(getUnitHref(availableUnit.slug));
                                }}
                            >
                                {availableUnit.name}
                            </Link>
                        ))}
                    </div>

                    <p className="small pageNarrative__hint homeUnitSelector__hint">
                        Ao escolher uma unidade, você será redirecionado automaticamente para a página correspondente.
                    </p>
                </section>
            </div>
        );
    }

    return (
        <div className="container">
            <section className="pageSection pageNarrative homeLeadSection">
                <div className="pageNarrative__intro pageNarrative__intro--extended homeLeadSection__intro">
                    <h2 className="sectionTitle">Realce sua beleza com equilíbrio, segurança e resultado natural.</h2>
                    <p className="sectionLead pageNarrative__sub homeLeadSection__sub">
                        Na Espaço Facial, cada atendimento começa com uma avaliação cuidadosa para indicar o que faz sentido para o seu rosto e/ou corpo, sua rotina e suas expectativas, com segurança, elegância e naturalidade.
                    </p>
                </div>
            </section>

            <AboutUsSection />

            <section id="doutores" className="pageSection homeDoctorsSection">
                <h2 className="sectionTitle">Conheça a equipe</h2>
                <div className="sectionCopyPair homeDoctorsLead">
                    <p className="sectionSub">
                        Escolher fica mais fácil quando você conhece o profissional.
                    </p>
                </div>
                <UnitDoctorsGrid variant="booking-compact" />
                <p className="small homeDoctorsAftercopy">
                    Acompanhe os seus procedimentos em suas redes sociais e agende com confiança com um de nossos doutores especialistas.
                </p>
            </section>

            <section id="unidades" className="pageSection">
                <h2 className="sectionTitle">Nossas Unidades</h2>
                <p className="sectionSub">
                    Veja as unidades da Espaço Facial e encontre a mais conveniente para o seu atendimento.
                </p>
                <UnitsMapSection />
            </section>
        </div>
    );
}
