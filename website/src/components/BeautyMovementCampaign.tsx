"use client";

import { useEffect, useRef, useState } from "react";
import BeautyMovementExperience, {
  type BeautyMovementConfirmationInput,
  type BeautyMovementExperienceInitialState,
  type BeautyMovementReveal,
} from "@/components/BeautyMovementExperience";
import {
    isBeautyMovementTrackableEvent,
    sanitizeBeautyMovementTrackingParams,
    trackBeautyMovementSiteEvent,
} from "@/lib/beautyMovementTracking";
import styles from "./BeautyMovementCampaign.module.css";

const INVITE_STORAGE_KEY = "ef:beauty-movement:invite";

type CampaignApiResponse =
  | { ok: true; state: BeautyMovementExperienceInitialState }
  | { ok: false; error?: string };

async function requestCampaignState(path: string, init?: RequestInit): Promise<BeautyMovementExperienceInitialState> {
  const response = await fetch(path, {
    cache: "no-store",
    credentials: "same-origin",
    ...init,
    headers: {
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
  });
  const payload = (await response.json().catch(() => null)) as CampaignApiResponse | null;
  if (!response.ok || !payload?.ok || !payload.state) {
    throw new Error("beauty_movement_unavailable");
  }
  return payload.state;
}

function redirectToInstitutionalSite() {
  try {
    window.sessionStorage.removeItem(INVITE_STORAGE_KEY);
  } catch {
    // The redirect is still safe if storage is unavailable.
  }
  window.location.replace("/");
}

export default function BeautyMovementCampaign() {
  const [state, setState] = useState<BeautyMovementExperienceInitialState | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    let active = true;

    async function initialize() {
      let inviteToken: string | null = null;
      try {
        inviteToken = window.sessionStorage.getItem(INVITE_STORAGE_KEY);
        window.sessionStorage.removeItem(INVITE_STORAGE_KEY);
      } catch {
        // A valid existing session can still continue without session storage.
      }

      try {
        if (inviteToken) {
          await requestCampaignState("/api/beleza-em-movimento/session", {
            method: "POST",
            body: JSON.stringify({ token: inviteToken }),
          });
        }
        const nextState = await requestCampaignState("/api/beleza-em-movimento/state");
        if (active) setState(nextState);
      } catch {
        // The API intentionally has one generic invalid state. A tokenless
        // direct visit, invalid token, expired invite and revoked invite all
        // return to the institutional site without disclosing the reason.
        redirectToInstitutionalSite();
      }
    }

    void initialize();
    return () => {
      active = false;
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
    const nextState = await requestCampaignState("/api/beleza-em-movimento/reveal", {
      method: "POST",
      body: JSON.stringify({ actIndex, cardId }),
    });
    setState(nextState);
    return { reveals: nextState.reveals };
  }

  async function confirmInvite(input: BeautyMovementConfirmationInput): Promise<void> {
    const nextState = await requestCampaignState("/api/beleza-em-movimento/confirm", {
      method: "POST",
      body: JSON.stringify(input),
    });
    setState(nextState);
  }

  if (!state) {
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
      initialState={state}
      onReveal={revealCard}
      onConfirm={confirmInvite}
      onTrack={trackCampaignEvent}
    />
  );
}
