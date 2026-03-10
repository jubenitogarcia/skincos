"use client";

import Link from "next/link";
import ExperienceTracker from "@/components/ExperienceTracker";
import { useExperienceVariant } from "@/hooks/useExperienceVariant";
import { trackExperienceShortcutClick } from "@/lib/leadTracking";

type BookingUiVariant = "editorial-guided" | "concierge-fastlane";

const BOOKING_VARIANTS: Record<
    BookingUiVariant,
    {
        eyebrow: string;
        title: string;
        description: string;
        trust: Array<{ label: string; detail: string }>;
        shortcuts: Array<{ title: string; body: string; href: string; kind: "primary" | "secondary" }>;
        panelTitle: string;
        panelList: string[];
        manifestoTitle: string;
        manifestoBody: string;
    }
> = {
    "editorial-guided": {
        eyebrow: "Agendamento guiado",
        title: "Entre no fluxo com clareza, escolha certa e menos atrito até a confirmação.",
        description:
            "O agendamento foi redesenhado para permitir decisão assistida: você escolhe unidade, profissional, procedimento e janela de horário sem depender de atendimento manual para começar.",
        trust: [
            { label: "Fluxo modular", detail: "Cada etapa responde ao que já foi definido, sem ruído visual." },
            { label: "Agenda real", detail: "Horários exibidos conforme disponibilidade do sistema." },
            { label: "Retorno multicanal", detail: "Confirmação por e-mail e WhatsApp após o envio." },
        ],
        shortcuts: [
            { title: "Quero o primeiro horário", body: "Entra com sem preferência para liberar a agenda mais ampla.", href: "/agendamento?doctor=any#booking-flow", kind: "primary" },
            { title: "Preciso de orientação", body: "Abre o fluxo com a opção de procedimento indefinido.", href: "/agendamento?service=any#booking-flow", kind: "secondary" },
            { title: "Quero escolher especialista", body: "Compare perfis antes de voltar para a agenda.", href: "/doutores", kind: "secondary" },
        ],
        panelTitle: "Antes de começar",
        panelList: [
            "Selecione a unidade no topo para liberar equipe e horários.",
            "Se não souber o procedimento, use “Quero orientação”.",
            "Sem preferência de doutor costuma acelerar a confirmação.",
        ],
        manifestoTitle: "Objetivo desta tela",
        manifestoBody:
            "Reduzir fricção de decisão. O site deve ajudar você a chegar confiante no horário escolhido, não apenas coletar um formulário.",
    },
    "concierge-fastlane": {
        eyebrow: "Entrada rápida na agenda",
        title: "Quando a prioridade é velocidade, o caminho mais curto até um horário viável já está pronto.",
        description:
            "Esta variante prioriza encaixe e conveniência. Você pode cair direto na agenda mais ampla, pedir orientação no meio do fluxo ou voltar ao diretório se quiser refinar a escolha.",
        trust: [
            { label: "Fast lane", detail: "Atalhos para o primeiro horário, orientação ou escolha por especialista." },
            { label: "Menos retrabalho", detail: "A página já aponta o caminho mais útil conforme sua intenção." },
            { label: "Confirmação segura", detail: "Pedido enviado com validação, registro e acompanhamento." },
        ],
        shortcuts: [
            { title: "Abrir agenda mais ampla", body: "Vai direto para sem preferência e reduz o tempo até a seleção final.", href: "/agendamento?doctor=any#booking-flow", kind: "primary" },
            { title: "Definir o tratamento depois", body: "Comece agora e escolha “Quero orientação” no fluxo.", href: "/agendamento?service=any#booking-flow", kind: "secondary" },
            { title: "Validar pelo diretório", body: "Volte à equipe se quiser comparar perfis antes de reservar.", href: "/doutores", kind: "secondary" },
        ],
        panelTitle: "Como usar melhor",
        panelList: [
            "Se a urgência manda, comece por sem preferência.",
            "Se a escolha do tratamento ainda está aberta, não trave a agenda por isso.",
            "O horário só segue para pedido após todos os dados finais.",
        ],
        manifestoTitle: "Lógica da variante",
        manifestoBody:
            "Converter intenção em ação. Em vez de sobrecarregar a pessoa com contexto demais, a página apresenta atalhos claros para o próximo passo mais provável.",
    },
};

function pickBookingUiVariant(input: string): BookingUiVariant {
    if (input.includes("fast") || input.includes("speed") || input.includes("urgent")) {
        return "concierge-fastlane";
    }
    return "editorial-guided";
}

export default function BookingHeroExperience() {
    const resolved = useExperienceVariant("/agendamento", "editorial-guided");
    const uiVariant = pickBookingUiVariant(resolved.variant);
    const content = BOOKING_VARIANTS[uiVariant];

    return (
        <>
            <ExperienceTracker page="/agendamento" experience="guided_booking_v3" variant={resolved.variant} />

            <section className={`bookingHero bookingHero--experience bookingHero--${uiVariant}`.trim()}>
                <div className="container bookingHero__shell">
                    <div className="bookingHero__copy bookingHero__copy--experience">
                        <span className="bookingHero__capsule">{content.eyebrow}</span>
                        <h1>{content.title}</h1>
                        <p>{content.description}</p>

                        <div className="bookingHero__trust" aria-label="Diferenciais do agendamento">
                            {content.trust.map((item) => (
                                <div key={item.label} className="bookingHero__trustItem">
                                    <strong>{item.label}</strong>
                                    <span>{item.detail}</span>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bookingHero__panel" role="group" aria-label="Atalhos e preparação para a agenda">
                        <div className="bookingHero__panelCard bookingHero__panelCard--accent">
                            <span className="bookingHero__panelLabel">Entradas rápidas</span>
                            <div className="bookingHero__shortcutGrid">
                                {content.shortcuts.map((item) => (
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
                                                experience: "guided_booking_v3",
                                                variant: resolved.variant,
                                            })
                                        }
                                    >
                                        <strong>{item.title}</strong>
                                        <span>{item.body}</span>
                                    </Link>
                                ))}
                            </div>
                        </div>

                        <div className="bookingHero__panelCard bookingHero__panelCard--soft">
                            <span className="bookingHero__panelLabel">{content.panelTitle}</span>
                            <ul className="bookingHero__notes">
                                {content.panelList.map((item) => (
                                    <li key={item}>{item}</li>
                                ))}
                            </ul>
                        </div>

                        <div className="bookingHero__story">
                            <span className="bookingHero__panelLabel">{content.manifestoTitle}</span>
                            <p>{content.manifestoBody}</p>
                        </div>
                    </div>
                </div>
            </section>
        </>
    );
}
