"use client";

import HeroMedia from "@/components/HeroMedia";
import TrackedBookingLink from "@/components/TrackedBookingLink";
import ExperienceTracker from "@/components/ExperienceTracker";
import { useExperienceVariant } from "@/hooks/useExperienceVariant";
import type { HeroMediaItem, HeroMediaVariant } from "@/lib/heroMediaShared";
import { trackExperienceShortcutClick } from "@/lib/leadTracking";

type HomeHeroExperienceProps = {
    heroItems: HeroMediaItem[];
    initialMediaVariant: HeroMediaVariant;
};

type HomeHeroUiVariant = "value-led" | "precision-led";

const HOME_VARIANTS: Record<
    HomeHeroUiVariant,
    {
        eyebrow: string;
        title: string;
        description: string;
        primaryCta: string;
        secondaryCta: string;
        trustStrip: Array<{ value: string; label: string }>;
        proof: Array<{ label: string; detail: string }>;
        program: Array<{ title: string; body: string }>;
        panelTitle: string;
        panelBody: string;
        asideTitle: string;
        asideBody: string;
    }
> = {
    "value-led": {
        eyebrow: "Clínica autoral em harmonização",
        title: "Beleza com leitura clínica, direção estética e zero excesso.",
        description:
            "A Espaço Facial combina avaliação criteriosa, equipe especializada e um plano visualmente coerente para quem quer melhorar a aparência sem sacrificar naturalidade.",
        primaryCta: "Agendar avaliação",
        secondaryCta: "Ver especialistas",
        trustStrip: [
            { value: "4.9★", label: "Média pública de avaliação local" },
            { value: "Agenda online", label: "Escolha unidade, doutor e horário no mesmo fluxo" },
            { value: "Sem excesso", label: "Conduta focada em proporção e naturalidade" },
        ],
        proof: [
            { label: "2 unidades-chave", detail: "BarraShoppingSul e Novo Hamburgo com jornada digital ativa." },
            { label: "Equipe especializada", detail: "Doutores, agenda integrada e acompanhamento de retorno." },
            { label: "Protocolo elegante", detail: "Indicamos o necessário, não o máximo possível." },
        ],
        program: [
            { title: "Diagnóstico claro", body: "Você entende o raciocínio antes de escolher a intervenção." },
            { title: "Plano proporcional", body: "Procedimento, tempo e manutenção entram num mesmo desenho." },
            { title: "Jornada contínua", body: "Agendamento, confirmação e acompanhamento sem ruptura de contexto." },
        ],
        panelTitle: "O que muda aqui",
        panelBody:
            "O objetivo não é vender volume de procedimento. É construir um resultado compatível com sua anatomia, rotina e tolerância visual ao tratamento.",
        asideTitle: "Direção clínica + estética",
        asideBody:
            "Quando a decisão começa por excesso, o resultado fica datado. Aqui a indicação começa por proporção, textura e leitura facial.",
    },
    "precision-led": {
        eyebrow: "Planejamento facial e corporal",
        title: "Naturalidade verificável para quem quer precisão, não improviso.",
        description:
            "A jornada foi pensada para pacientes que valorizam critério técnico, previsibilidade de agenda e um plano estético que faça sentido no espelho e na rotina.",
        primaryCta: "Montar meu plano",
        secondaryCta: "Escolher unidade",
        trustStrip: [
            { value: "Leitura clínica", label: "Mapeamento técnico antes de qualquer intervenção" },
            { value: "Fluxo objetivo", label: "Atalhos para reduzir indecisão e tempo até ação" },
            { value: "Ritmo sustentável", label: "Plano para manter resultado ao longo do tempo" },
        ],
        proof: [
            { label: "Leitura anatômica", detail: "Cada indicação considera estrutura, tempo e expectativa real." },
            { label: "Agenda inteligente", detail: "Você entra no fluxo já com unidade, doutor e janela de atendimento." },
            { label: "Resultado sustentável", detail: "Conduta para manter aparência sofisticada ao longo do tempo." },
        ],
        program: [
            { title: "Mapeamento inicial", body: "Entendemos prioridade estética, nível de intervenção e contexto do caso." },
            { title: "Composição do protocolo", body: "Definimos o que entra agora, o que entra depois e o que não vale fazer." },
            { title: "Evolução mensurável", body: "Acompanhamento com ritmo de manutenção compatível com sua agenda." },
        ],
        panelTitle: "Para quem esse fluxo é melhor",
        panelBody:
            "Pacientes que chegam com mais repertório e querem comparar opções com racionalidade técnica, não por impulso promocional.",
        asideTitle: "Menos ruído na decisão",
        asideBody:
            "A plataforma prioriza clareza: unidade, especialista, avaliação e continuidade. O site começa a conversa já no nível de decisão.",
    },
};

function pickHomeUiVariant(input: string): HomeHeroUiVariant {
    if (input.includes("precision") || input.includes("authority") || input.includes("clinical")) {
        return "precision-led";
    }
    return "value-led";
}

export default function HomeHeroExperience({ heroItems, initialMediaVariant }: HomeHeroExperienceProps) {
    const resolved = useExperienceVariant("/", "value-led");
    const uiVariant = pickHomeUiVariant(resolved.variant);
    const content = HOME_VARIANTS[uiVariant];
    const secondaryHref = uiVariant === "precision-led" ? "#unidades" : "#doutores";

    return (
        <>
            <ExperienceTracker page="/" experience="home_value_hero_v3" variant={resolved.variant} />

            <section className={`hero hero--experience hero--${uiVariant}`.trim()} aria-label="Destaque">
                <HeroMedia initialItems={heroItems} initialVariant={initialMediaVariant} />
                <div className="heroOverlay" />
                <div className="container heroContent heroContent--experience">
                    <div className="heroContent__copy heroContent__copy--experience">
                        <span className="heroContent__capsule">{content.eyebrow}</span>
                        <h1>{content.title}</h1>
                        <p>{content.description}</p>

                        <div className="heroContent__trustStrip" aria-label="Provas de confiança para decisão rápida">
                            {content.trustStrip.map((item) => (
                                <div key={`${item.value}-${item.label}`} className="heroContent__trustChip">
                                    <strong>{item.value}</strong>
                                    <span>{item.label}</span>
                                </div>
                            ))}
                        </div>

                        <div className="heroContent__actions">
                            <TrackedBookingLink
                                href="/agendamento"
                                className="heroContent__primary"
                                placement="home_hero"
                                experience="home_value_hero_v3"
                                variant={resolved.variant}
                            >
                                {content.primaryCta}
                            </TrackedBookingLink>
                            <a
                                href={secondaryHref}
                                className="heroContent__secondary"
                                onClick={() =>
                                    trackExperienceShortcutClick({
                                        page: "/",
                                        shortcut: content.secondaryCta,
                                        destination: secondaryHref,
                                        placement: "home_panel",
                                        experience: "home_value_hero_v3",
                                        variant: resolved.variant,
                                    })
                                }
                            >
                                {content.secondaryCta}
                            </a>
                        </div>
                        <p className="heroContent__actionHint">Leva menos de 1 minuto para iniciar o fluxo de agendamento.</p>

                        <div className="heroContent__proof">
                            {content.proof.map((item) => (
                                <div key={item.label} className="heroContent__proofItem">
                                    <strong>{item.label}</strong>
                                    <span>{item.detail}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="heroContent__panel heroContent__panel--experience" role="group" aria-label="Motivos para escolher a Espaço Facial">
                        <div className="heroContent__panelCard heroContent__panelCard--accent">
                            <span className="heroContent__panelLabel">Programa da jornada</span>
                            <div className="heroContent__program">
                                {content.program.map((item) => (
                                    <div key={item.title} className="heroContent__programCard">
                                        <strong>{item.title}</strong>
                                        <span>{item.body}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="heroContent__panelCard heroContent__panelCard--soft">
                            <span className="heroContent__panelLabel">{content.panelTitle}</span>
                            <p>{content.panelBody}</p>
                            <TrackedBookingLink
                                href="/agendamento"
                                className="heroContent__panelCta"
                                placement="home_panel"
                                experience="home_value_hero_v3"
                                variant={resolved.variant}
                            >
                                Iniciar agendamento
                            </TrackedBookingLink>
                        </div>

                        <div className="heroContent__asideNote">
                            <span className="heroContent__panelLabel">{content.asideTitle}</span>
                            <p>{content.asideBody}</p>
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
}
