"use client";

import { useState } from "react";
import BeautyMovementExperience, {
    type BeautyMovementExperienceInitialState,
    type BeautyMovementReveal,
} from "@/components/BeautyMovementExperience";

const INITIAL_PREVIEW_STATE: BeautyMovementExperienceInitialState = {
    invite: {
        displayName: "Ana",
        maskedWhatsapp: "WhatsApp •••• 1234",
        emailRegistered: false,
    },
    palette: "radiancia",
    benefit: {
        type: "free_procedure",
        procedureName: "Lavieen",
        discount: null,
        displayText: "Um cuidado de renovação para celebrar seu momento.",
        validity: "Válido até 30/09/2026.",
        rules: "Uso pessoal e intransferível; agendamento sujeito à disponibilidade da unidade.",
        termsVersion: "prévia local",
    },
    velocity: {
        enabled: true,
        label: "Aula-cortesia Velocity",
        text: "Sua aula será confirmada pela equipe da unidade após o contato.",
    },
    reveals: [],
    confirmed: false,
    campaign: {
        title: "Beleza que se move com você.",
        description: "3 anos. 3 cartas. Um novo movimento para celebrar tudo o que ainda vem pela frente.",
        invitationTitle: "Seu convite para celebrar",
        invitationText: "A equipe vai confirmar os próximos detalhes com você.",
        partnerName: "Velocity",
        whatsappMessage: "Olá! Quero falar sobre o meu convite da celebração.",
        whatsappLabel: "Falar com a equipe",
        conditionsLabel: "Ler condições da campanha",
        conditionsText: "Prévia com dados fictícios. As condições finais serão configuradas antes da publicação.",
    },
};

function cloneInitialPreviewState(): BeautyMovementExperienceInitialState {
    return {
        ...INITIAL_PREVIEW_STATE,
        invite: { ...INITIAL_PREVIEW_STATE.invite },
        benefit: INITIAL_PREVIEW_STATE.benefit ? { ...INITIAL_PREVIEW_STATE.benefit, discount: INITIAL_PREVIEW_STATE.benefit.discount ? { ...INITIAL_PREVIEW_STATE.benefit.discount } : null } : null,
        velocity: INITIAL_PREVIEW_STATE.velocity ? { ...INITIAL_PREVIEW_STATE.velocity } : null,
        reveals: [],
        campaign: { ...INITIAL_PREVIEW_STATE.campaign },
    };
}

/**
 * A fully interactive, synthetic campaign journey. It intentionally avoids all
 * invite, D1, tracking and WhatsApp integrations so it can be safely shared on
 * localhost while the production configuration remains closed.
 */
export default function BeautyMovementLocalPreview() {
    const [state, setState] = useState<BeautyMovementExperienceInitialState>(cloneInitialPreviewState);

    function reveal(actIndex: number, cardId: string) {
        const nextReveals: BeautyMovementReveal[] = [
            ...state.reveals.filter((reveal) => reveal.actIndex !== actIndex),
            { actIndex, cardId },
        ];
        setState((current) => ({ ...current, reveals: nextReveals }));
        return { reveals: nextReveals };
    }

    function confirm() {
        setState((current) => ({ ...current, confirmed: true }));
        return { confirmed: true };
    }

    return (
        <BeautyMovementExperience
            initialState={state}
            onReveal={reveal}
            onConfirm={confirm}
            isLocalPreview
        />
    );
}
