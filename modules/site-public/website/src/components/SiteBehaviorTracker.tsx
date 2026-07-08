"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { COOKIE_CONSENT_EVENT, getCookieConsent, type CookieConsent } from "@/lib/cookieConsent";
import { classifySiteLinkClick, trackSiteBehaviorEvent } from "@/lib/siteBehavior";

function canTrack(consent: CookieConsent | null): boolean {
    return consent?.analytics === true;
}

function linkDetails(anchor: HTMLAnchorElement) {
    const href = anchor.getAttribute("href") ?? "";
    const url = new URL(href, window.location.origin);
    return {
        href: url.toString(),
        host: url.hostname,
        path: `${url.pathname}${url.search}${url.hash}`,
    };
}

export default function SiteBehaviorTracker() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const lastPageViewRef = useRef<string | null>(null);

    useEffect(() => {
        const search = searchParams?.toString() ?? "";
        const key = `${pathname ?? ""}?${search}`;
        if (!pathname || lastPageViewRef.current === key) return;
        if (!canTrack(getCookieConsent())) return;

        const tracked = trackSiteBehaviorEvent({ eventName: "page_view" });
        if (tracked) lastPageViewRef.current = key;
    }, [pathname, searchParams]);

    useEffect(() => {
        function onConsent(event: Event) {
            const detail = (event as CustomEvent<CookieConsent>).detail;
            if (!canTrack(detail ?? null)) return;
            lastPageViewRef.current = null;
            trackSiteBehaviorEvent({ eventName: "page_view", source: "consent_granted" });
        }

        window.addEventListener(COOKIE_CONSENT_EVENT, onConsent);
        return () => window.removeEventListener(COOKIE_CONSENT_EVENT, onConsent);
    }, []);

    useEffect(() => {
        function onClick(event: MouseEvent) {
            const target = event.target;
            if (!(target instanceof Element)) return;
            const anchor = target.closest("a[href]");
            if (!(anchor instanceof HTMLAnchorElement)) return;
            if (!canTrack(getCookieConsent())) return;

            const href = anchor.getAttribute("href") ?? "";
            const eventName = classifySiteLinkClick(href, window.location.hostname);
            if (!eventName) return;

            const details = linkDetails(anchor);
            trackSiteBehaviorEvent({
                eventName,
                linkUrl: details.href,
                linkHost: details.host,
                linkPath: details.path,
                linkType: eventName,
                placement: anchor.dataset.placement ?? anchor.getAttribute("data-tracking-placement") ?? null,
                source: anchor.dataset.source ?? null,
            });
        }

        document.addEventListener("click", onClick, { capture: true });
        return () => document.removeEventListener("click", onClick, { capture: true });
    }, []);

    return null;
}
