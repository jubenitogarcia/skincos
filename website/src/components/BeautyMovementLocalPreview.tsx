"use client";

import { useEffect, useState } from "react";
import BeautyMovementExperience, {
    type BeautyMovementExperienceInitialState,
    type BeautyMovementReveal,
} from "@/components/BeautyMovementExperience";
import {
    BEAUTY_MOVEMENT_OUTCOME_KEYS,
    enumerateBeautyMovementCombinations,
    resolveBeautyMovementOutcome,
    type BeautyMovementOutcomeKey,
} from "@/lib/beautyMovementOutcomes";

const INITIAL_PREVIEW_STATE: BeautyMovementExperienceInitialState = {
    invite: {
        displayName: "Ana",
        maskedWhatsapp: "WhatsApp •••• 1234",
        emailRegistered: false,
    },
    palette: "radiancia",
    offer: null,
    velocity: null,
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
        offer: null,
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
    const [previewRevision, setPreviewRevision] = useState("interactive");

    useEffect(() => {
        if (process.env.NODE_ENV === "production") return;
        const hostname = window.location.hostname;
        if (hostname !== "localhost" && hostname !== "127.0.0.1") return;
        const requested = new URLSearchParams(window.location.search).get("outcome") as BeautyMovementOutcomeKey | null;
        if (!requested || !BEAUTY_MOVEMENT_OUTCOME_KEYS.includes(requested)) return;
        const combination = enumerateBeautyMovementCombinations().find((entry) => entry.outcomeKey === requested);
        if (!combination) return;
        const resolved = resolveBeautyMovementOutcome({ palette: combination.palette, selections: combination.selections });
        setState((current) => ({
            ...current,
            palette: combination.palette,
            reveals: combination.cards.map((card, index) => ({ actIndex: index + 1, cardId: card.id })),
            confirmed: true,
            offer: resolved.offer,
        }));
        // BeautyMovementExperience owns its animation state after mounting.
        // Remount only for this explicit QA shortcut so the resolved outcome
        // becomes the initial state without resetting normal interactive reveals.
        setPreviewRevision(`outcome-${requested}`);
    }, []);

    function reveal(actIndex: number, cardId: string) {
        const nextReveals: BeautyMovementReveal[] = [
            ...state.reveals.filter((reveal) => reveal.actIndex !== actIndex),
            { actIndex, cardId },
        ];
        setState((current) => ({ ...current, reveals: nextReveals }));
        return { reveals: nextReveals };
    }

    function confirm() {
        const selections = state.reveals.reduce<Record<string, string>>((result, reveal) => {
            const act = ["beleza", "movimento", "celebracao"][reveal.actIndex - 1];
            if (act) result[act] = reveal.cardId;
            return result;
        }, {});
        const resolved = state.reveals.length === 3
            ? resolveBeautyMovementOutcome({ palette: state.palette, selections })
            : null;
        const offer = resolved?.offer ?? state.offer ?? null;
        setState((current) => ({ ...current, confirmed: true, offer }));
        return { confirmed: true, offer };
    }

    return (
        <BeautyMovementExperience
            key={previewRevision}
            initialState={state}
            onReveal={reveal}
            onConfirm={confirm}
            isLocalPreview
        />
    );
}
