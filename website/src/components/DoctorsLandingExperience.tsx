"use client";

import { useMemo } from "react";
import ExperienceTracker from "@/components/ExperienceTracker";
import ConversionIntentRail from "@/components/ConversionIntentRail";
import TrackedBookingLink from "@/components/TrackedBookingLink";
import DoctorsDirectoryStats from "@/components/DoctorsDirectoryStats";
import { useExperienceVariant } from "@/hooks/useExperienceVariant";
import { useTeamDirectory } from "@/hooks/useTeamDirectory";
import { trackExperienceShortcutClick } from "@/lib/leadTracking";

type DoctorsUiVariant = "open-directory" | "fast-match";

const DOCTORS_VARIANTS: Record<
    DoctorsUiVariant,
    {
        eyebrow: string;
        title: string;
        description: string;
        playbookTitle: string;
        playbook: string[];
        manifestoTitle: string;
        manifestoBody: string;
    }
> = {
    "open-directory": {
        eyebrow: "Especialistas e decisao assistida",
        title: "Compare perfis com contexto e chegue no agendamento com escolha qualificada.",
        description:
            "O diretorio foi pensado para reduzir friccao de comparacao: perfil, unidade de atendimento e entrada no booking coexistem na mesma jornada.",
        playbookTitle: "Metodo de escolha",
        playbook: [
            "Se localizacao pesa, selecione a unidade antes de filtrar o diretorio.",
            "Use Instagram para validar linguagem visual e repertorio do profissional.",
            "Com a escolha definida, entre no agendamento ja com o doutor selecionado.",
        ],
        manifestoTitle: "Porque esta pagina existe",
        manifestoBody:
            "A decisao por especialista nao deve ser um salto cego. O site precisa oferecer sinais suficientes para uma escolha mais confiante.",
    },
    "fast-match": {
        eyebrow: "Escolha acelerada de profissional",
        title: "Quando a prioridade e encaixe, mantenha criterio sem perder velocidade.",
        description:
            "Esta variante ajuda quem quer resolver rapido: compara perfis essenciais e oferece entrada direta para agenda mais ampla.",
        playbookTitle: "Modo rapido",
        playbook: [
            "Se urgencia e o fator principal, use sem preferencia no agendamento.",
            "Se quer mais controle, compare 2 ou 3 perfis e decida com base em unidade + linguagem.",
            "Nao congele a decisao: ajuste especialista depois de confirmar a janela de horario.",
        ],
        manifestoTitle: "Logica da variante",
        manifestoBody:
            "Aceleracao sem perda de qualidade. O objetivo e encurtar caminho mantendo sinais de confianca e contexto clinico.",
    },
};

function pickDoctorsUiVariant(input: string): DoctorsUiVariant {
    if (input.includes("fast") || input.includes("speed") || input.includes("match")) {
        return "fast-match";
    }
    return "open-directory";
}

export default function DoctorsLandingExperience() {
    const resolved = useExperienceVariant("/doutores", "open-directory");
    const { members } = useTeamDirectory();
    const uiVariant = pickDoctorsUiVariant(resolved.variant);
    const content = DOCTORS_VARIANTS[uiVariant];
    const fastBookingHref = "/agendamento?doctor=any#booking-flow";
    const directBookingHref = "/agendamento#booking-flow";
    const authoritySignals = useMemo(() => {
        if (!members || members.length === 0) return null;
        const membersWithInstagram = members.filter((member) => member.instagramUrl).length;
        const multiUnitMembers = members.filter((member) => member.units.length > 1).length;
        const uniqueRoles = new Set(
            members.flatMap((member) => member.roles.map((role) => role.trim()).filter(Boolean))
        ).size;
        return { membersWithInstagram, multiUnitMembers, uniqueRoles };
    }, [members]);

    return (
        <>
            <ExperienceTracker page="/doutores" experience="authority_directory_v3" variant={resolved.variant} />

            <section className={`doctorsHero doctorsHero--${uiVariant}`.trim()} style={{ marginTop: 40 }}>
                <div className="doctorsHero__shell">
                    <div className="doctorsHero__copy">
                        <span className="doctorsHero__capsule">{content.eyebrow}</span>
                        <h1 className="sectionTitle">{content.title}</h1>
                        <p className="sectionSub">{content.description}</p>
                        <DoctorsDirectoryStats />
                        {authoritySignals ? (
                            <div className="doctorsHero__signals" aria-label="Sinais de autoridade da equipe">
                                <div className="doctorsHero__signalCard">
                                    <strong>{authoritySignals.membersWithInstagram}</strong>
                                    <span>profissionais com portifolio consultavel</span>
                                </div>
                                <div className="doctorsHero__signalCard">
                                    <strong>{authoritySignals.multiUnitMembers}</strong>
                                    <span>especialistas com cobertura em mais de uma unidade</span>
                                </div>
                                <div className="doctorsHero__signalCard">
                                    <strong>{authoritySignals.uniqueRoles}</strong>
                                    <span>frentes de atuacao representadas no diretorio</span>
                                </div>
                            </div>
                        ) : null}
                    </div>

                    <aside className="doctorsHero__panel" aria-label="Guia de escolha do profissional">
                        <div className="doctorsHero__panelCard">
                            <span className="doctorsHero__panelLabel">{content.playbookTitle}</span>
                            <ul className="doctorsHero__panelList">
                                {content.playbook.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        </div>
                        <div className="doctorsHero__panelCard doctorsHero__panelCard--soft">
                            <span className="doctorsHero__panelLabel">{content.manifestoTitle}</span>
                            <p>{content.manifestoBody}</p>
                        </div>
                    </aside>
                </div>
            </section>

            <ConversionIntentRail
                className="pageSection"
                title="Escolha a estrategia de decisao"
                subtitle="Cada caminho abaixo prioriza uma logica diferente: velocidade, comparacao guiada ou triagem por unidade."
                items={[
                    {
                        id: "doctor-fastlane",
                        eyebrow: "Estrategia 01",
                        title: "Velocidade com criterio minimo",
                        body: "Use sem preferencia para abrir a agenda mais ampla e confirmar horario primeiro.",
                        ctaLabel: "Entrar na agenda rapida",
                        href: fastBookingHref,
                        kind: "primary",
                        onClick: () =>
                            trackExperienceShortcutClick({
                                page: "/doutores",
                                shortcut: "Agenda rapida por doutores",
                                destination: fastBookingHref,
                                placement: "doctors_page",
                                experience: "authority_directory_v3",
                                variant: resolved.variant,
                            }),
                    },
                    {
                        id: "doctor-compare",
                        eyebrow: "Estrategia 02",
                        title: "Comparacao de perfis",
                        body: "Abra o diretorio completo e compare 2 ou 3 profissionais antes de reservar.",
                        ctaLabel: "Abrir diretorio completo",
                        href: "#directory-grid",
                        kind: "secondary",
                        onClick: () =>
                            trackExperienceShortcutClick({
                                page: "/doutores",
                                shortcut: "Comparar perfis no diretorio",
                                destination: "#directory-grid",
                                placement: "doctors_page",
                                experience: "authority_directory_v3",
                                variant: resolved.variant,
                            }),
                    },
                    {
                        id: "doctor-local",
                        eyebrow: "Estrategia 03",
                        title: "Triagem por unidade",
                        body: "Se localizacao pesa, escolha a unidade no topo e o diretorio ja filtra opcoes relevantes.",
                        ctaLabel: "Ver unidades primeiro",
                        href: "/unidades#units-featured",
                        kind: "ghost",
                        onClick: () =>
                            trackExperienceShortcutClick({
                                page: "/doutores",
                                shortcut: "Triagem por unidade",
                                destination: "/unidades#units-featured",
                                placement: "doctors_page",
                                experience: "authority_directory_v3",
                                variant: resolved.variant,
                            }),
                    },
                ]}
            />

            <section className="pageSection decisionCardsSection" aria-label="Como escolher seu profissional">
                <div className="decisionCards">
                    <article className="decisionCard">
                        <div className="decisionCard__eyebrow">Criterio 1</div>
                        <h2>Escolha por unidade</h2>
                        <p>Se localizacao manda na decisao, selecione a unidade no topo e o diretorio sera filtrado automaticamente.</p>
                        <div className="decisionCard__meta">
                            <span className="decisionCard__metaItem">Menos opcoes irrelevantes</span>
                            <span className="decisionCard__metaItem">Agenda mais rapida</span>
                        </div>
                    </article>

                    <article className="decisionCard">
                        <div className="decisionCard__eyebrow">Criterio 2</div>
                        <h2>Escolha por perfil</h2>
                        <p>Abra o Instagram do doutor para entender linguagem visual, estilo de conteudo e proximidade com o que voce procura.</p>
                        <div className="decisionCard__meta">
                            <span className="decisionCard__metaItem">Autoridade percebida</span>
                            <span className="decisionCard__metaItem">Comparacao mais intuitiva</span>
                        </div>
                    </article>

                    <article className="decisionCard">
                        <div className="decisionCard__eyebrow">Criterio 3</div>
                        <h2>Escolha pela agenda</h2>
                        <p>Se a prioridade e velocidade, entre direto no agendamento e use sem preferencia para ampliar disponibilidade.</p>
                        <div className="decisionCard__actions">
                            <TrackedBookingLink
                                href={uiVariant === "fast-match" ? fastBookingHref : directBookingHref}
                                className="decisionCard__primary"
                                placement="doctors_page"
                                experience="authority_directory_v3"
                                variant={resolved.variant}
                            >
                                Ir para o agendamento
                            </TrackedBookingLink>
                            <a
                                href="#directory-grid"
                                className="decisionCard__secondary"
                                onClick={() =>
                                    trackExperienceShortcutClick({
                                        page: "/doutores",
                                        shortcut: "Abrir diretorio completo",
                                        destination: "#directory-grid",
                                        placement: "doctors_page",
                                        experience: "authority_directory_v3",
                                        variant: resolved.variant,
                                    })
                                }
                            >
                                Abrir diretorio
                            </a>
                        </div>
                    </article>
                </div>
            </section>
        </>
    );
}
