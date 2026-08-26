"use client";

import { useEffect, useRef, useState } from "react";
import BeautyMovementExperience, {
  type BeautyMovementConfirmationInput,
  type BeautyMovementConfirmationCommit,
  type BeautyMovementExperienceInitialState,
  type BeautyMovementReveal,
} from "@/components/BeautyMovementExperience";
import {
  BEAUTY_MOVEMENT_HANDOFF_ATTEMPT_KEY,
  BEAUTY_MOVEMENT_HANDOFF_EVENT,
  BEAUTY_MOVEMENT_INVITE_STORAGE_KEY,
  bindBeautyMovementContextRef,
  clearBeautyMovementContextRef,
  consumeBeautyMovementInviteHandoff,
  isBeautyMovementContextRef,
  parseBeautyMovementInviteFragment,
  readBeautyMovementContextRef,
  type BeautyMovementInviteHandoff,
} from "@/lib/beautyMovementBrowserContext";
import {
  isBeautyMovementTrackableEvent,
  sanitizeBeautyMovementTrackingParams,
  trackBeautyMovementSiteEvent,
} from "@/lib/beautyMovementTracking";
import styles from "./BeautyMovementCampaign.module.css";

const CONTEXT_HEADER = "X-Beauty-Movement-Context";

type CampaignApiResponse =
  | { ok: true; contextRef?: string; state: BeautyMovementExperienceInitialState }
  | { ok: false; error?: string };

type CampaignRequestOptions = RequestInit & {
  contextRef?: string | null;
};

async function requestCampaignState(
  path: string,
  { contextRef, ...init }: CampaignRequestOptions = {},
): Promise<Extract<CampaignApiResponse, { ok: true }>> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(contextRef ? { [CONTEXT_HEADER]: contextRef } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as CampaignApiResponse | null;
  if (!response.ok || !payload?.ok || !payload.state) {
    throw new Error("beauty_movement_unavailable");
  }
  return payload;
}

function redirectToInstitutionalSite() {
  try {
    window.sessionStorage.removeItem(BEAUTY_MOVEMENT_INVITE_STORAGE_KEY);
    window.sessionStorage.removeItem(BEAUTY_MOVEMENT_HANDOFF_ATTEMPT_KEY);
  } catch {
    // The redirect is still safe if storage is unavailable.
  }
  try {
    clearBeautyMovementContextRef();
  } catch {
    // A blocked History API must not prevent the fail-closed redirect.
  }
  window.location.replace("/");
}

export default function BeautyMovementCampaign() {
  const [state, setState] = useState<BeautyMovementExperienceInitialState | null>(null);
  const [contextRef, setContextRef] = useState<string | null>(null);
  const contextRefRef = useRef<string | null>(null);
  const pendingHandoffRef = useRef<BeautyMovementInviteHandoff | null>(null);
  const initializationGenerationRef = useRef(0);
  const initializationAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let mounted = true;

    async function initialize() {
      const generation = initializationGenerationRef.current + 1;
      initializationGenerationRef.current = generation;
      initializationAbortRef.current?.abort();
      const controller = new AbortController();
      initializationAbortRef.current = controller;
      setState(null);

      if (!pendingHandoffRef.current) {
        pendingHandoffRef.current = consumeBeautyMovementInviteHandoff();
      }
      const handoff = pendingHandoffRef.current;

      try {
        let nextContextRef: string;
        let nextState: BeautyMovementExperienceInitialState;
        if (handoff.attempted) {
          if (!handoff.token) throw new Error("beauty_movement_invalid_handoff");
          const exchange = await requestCampaignState("/api/beleza-em-movimento/session", {
            method: "POST",
            body: JSON.stringify({ token: handoff.token }),
            signal: controller.signal,
          });
          if (!isBeautyMovementContextRef(exchange.contextRef)) {
            throw new Error("beauty_movement_invalid_context_ref");
          }
          // The exchange body does not prove that the browser retained the
          // HttpOnly credential. Verify it before rendering personalized state.
          const verified = await requestCampaignState("/api/beleza-em-movimento/state", {
            contextRef: exchange.contextRef,
            signal: controller.signal,
          });
          nextContextRef = exchange.contextRef;
          nextState = verified.state;
        } else {
          const boundContextRef = readBeautyMovementContextRef();
          if (!boundContextRef) throw new Error("beauty_movement_context_required");
          const restored = await requestCampaignState("/api/beleza-em-movimento/state", {
            contextRef: boundContextRef,
            signal: controller.signal,
          });
          nextContextRef = boundContextRef;
          nextState = restored.state;
        }

        if (!mounted || controller.signal.aborted || generation !== initializationGenerationRef.current) return;
        pendingHandoffRef.current = null;
        bindBeautyMovementContextRef(nextContextRef);
        contextRefRef.current = nextContextRef;
        setContextRef(nextContextRef);
        setState(nextState);
      } catch {
        if (!mounted || controller.signal.aborted || generation !== initializationGenerationRef.current) return;
        pendingHandoffRef.current = null;
        contextRefRef.current = null;
        setContextRef(null);
        // A tokenless direct visit, invalid/expired invite, unavailable
        // storage, or mismatched context all fail closed. No request ever
        // falls back to a global legacy cookie.
        redirectToInstitutionalSite();
      }
    }

    const reinitializeFromHandoff = () => {
      pendingHandoffRef.current = null;
      void initialize();
    };
    const reinitializeFromHistory = () => {
      // Chromium emits popstate before hashchange for same-document fragment
      // navigation. The synchronous layout handler owns invite fragments, so
      // let it scrub and dispatch the explicit handoff instead of treating the
      // transient history entry as a tokenless visit.
      if (parseBeautyMovementInviteFragment(window.location.hash).attempted) return;
      pendingHandoffRef.current = null;
      void initialize();
    };
    const revalidateRestoredPage = (event: PageTransitionEvent) => {
      if (event.persisted) reinitializeFromHistory();
    };

    window.addEventListener(BEAUTY_MOVEMENT_HANDOFF_EVENT, reinitializeFromHandoff);
    window.addEventListener("popstate", reinitializeFromHistory);
    window.addEventListener("pageshow", revalidateRestoredPage);
    void initialize();

    return () => {
      mounted = false;
      initializationAbortRef.current?.abort();
      window.removeEventListener(BEAUTY_MOVEMENT_HANDOFF_EVENT, reinitializeFromHandoff);
      window.removeEventListener("popstate", reinitializeFromHistory);
      window.removeEventListener("pageshow", revalidateRestoredPage);
    };
  }, []);

  function trackCampaignEvent(event: string, params?: Record<string, string | number | boolean | null | undefined>) {
    if (!isBeautyMovementTrackableEvent(event)) return;
    const safeParams = sanitizeBeautyMovementTrackingParams(params);
    // This campaign intentionally uses only its isolated first-party envelope.
    // The generic tracker may fan out to GTM/gtag and is outside the MVP scope.
    trackBeautyMovementSiteEvent(event, safeParams);
  }

  async function revealCard(actIndex: number, cardId: string): Promise<{ reveals: readonly BeautyMovementReveal[] }> {
    const selectedContextRef = contextRefRef.current;
    const generation = initializationGenerationRef.current;
    if (!selectedContextRef) throw new Error("beauty_movement_context_required");
    const response = await requestCampaignState("/api/beleza-em-movimento/reveal", {
      contextRef: selectedContextRef,
      method: "POST",
      body: JSON.stringify({ actIndex, cardId }),
    });
    if (contextRefRef.current !== selectedContextRef || generation !== initializationGenerationRef.current) {
      throw new Error("beauty_movement_context_changed");
    }
    setState(response.state);
    return { reveals: response.state.reveals };
  }

  async function confirmInvite(input: BeautyMovementConfirmationInput): Promise<BeautyMovementConfirmationCommit> {
    const selectedContextRef = contextRefRef.current;
    const generation = initializationGenerationRef.current;
    if (!selectedContextRef) throw new Error("beauty_movement_context_required");
    const response = await requestCampaignState("/api/beleza-em-movimento/confirm", {
      contextRef: selectedContextRef,
      method: "POST",
      body: JSON.stringify(input),
    });
    if (contextRefRef.current !== selectedContextRef || generation !== initializationGenerationRef.current) {
      throw new Error("beauty_movement_context_changed");
    }
    setState(response.state);
    return { confirmed: response.state.confirmed, offer: response.state.offer ?? null };
  }

  if (!state || !contextRef) {
    return (
      <main className={styles.statusPage} aria-live="polite" aria-busy="true">
        <p className={styles.statusEyebrow}>Cartas da Beleza em Movimento</p>
        <h1>Preparando sua experiência.</h1>
        <span className={styles.loader} aria-hidden="true" />
      </main>
    );
  }

  return (
    <BeautyMovementExperience
      key={contextRef}
      initialState={state}
      onReveal={revealCard}
      onConfirm={confirmInvite}
      onTrack={trackCampaignEvent}
    />
  );
}
