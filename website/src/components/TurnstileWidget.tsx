"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId?: string) => void;
      remove?: (widgetId: string) => void;
    };
  }
}

type Props = {
  siteKey: string;
  onToken: (token: string | null) => void;
  onError?: () => void;
  className?: string;
};

export default function TurnstileWidget({ siteKey, onToken, onError, className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [apiReady, setApiReady] = useState(false);

  const normalizedSiteKey = useMemo(() => siteKey.trim(), [siteKey]);

  useEffect(() => {
    onToken(null);
  }, [onToken, normalizedSiteKey]);

  useEffect(() => {
    if (!apiReady) return;
    const api = window.turnstile;
    if (!api) return;
    const el = containerRef.current;
    if (!el) return;
    if (!normalizedSiteKey) return;

    // Avoid double-render if React re-runs effects.
    if (widgetIdRef.current) {
      try {
        api.reset(widgetIdRef.current);
      } catch {
        // ignore
      }
      return;
    }

    widgetIdRef.current = api.render(el, {
      sitekey: normalizedSiteKey,
      theme: "light",
      callback: (token: unknown) => onToken(typeof token === "string" && token ? token : null),
      "expired-callback": () => onToken(null),
      "timeout-callback": () => onToken(null),
      "error-callback": () => {
        onToken(null);
        onError?.();
      },
    });

    return () => {
      const id = widgetIdRef.current;
      widgetIdRef.current = null;
      if (id && window.turnstile?.remove) {
        try {
          window.turnstile.remove(id);
        } catch {
          // ignore
        }
      }
    };
  }, [apiReady, normalizedSiteKey, onError, onToken]);

  if (!normalizedSiteKey) return null;

  return (
    <>
      <Script
        id="cf-turnstile"
        src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
        strategy="afterInteractive"
        onLoad={() => setApiReady(true)}
      />
      <div ref={containerRef} className={className} />
    </>
  );
}

