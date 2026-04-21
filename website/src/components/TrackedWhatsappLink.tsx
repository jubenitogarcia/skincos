"use client";

import Link, { type LinkProps } from "next/link";
import { type MouseEventHandler, type ReactNode, useMemo } from "react";
import { buildTrackingContextFromBrowser } from "@/lib/attribution";
import { trackContactConversion } from "@/lib/conversions";
import { createMetaEventId } from "@/lib/metaBrowser";
import { trackEvent } from "@/lib/analytics";
import { buildWhatsappRedirectHref } from "@/lib/whatsappTracking";

type TrackedWhatsappLinkProps = Omit<LinkProps, "href"> & {
    children: ReactNode;
    className?: string;
    rawUrl?: string | null;
    phone?: string | null;
    text?: string | null;
    placement: string;
    unitSlug?: string | null;
    doctorName?: string | null;
    source?: string | null;
    bookingId?: string | null;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
    target?: string;
    rel?: string;
};

export default function TrackedWhatsappLink({
    children,
    className,
    rawUrl,
    phone,
    text,
    placement,
    unitSlug = null,
    doctorName,
    source,
    bookingId,
    onClick,
    target,
    rel,
    ...rest
}: TrackedWhatsappLinkProps) {
    const fallbackHref = useMemo(
        () =>
            buildWhatsappRedirectHref({
                rawUrl,
                phone,
                text,
                tracking: {
                    placement,
                    unitSlug,
                    doctorName,
                    source,
                    bookingId,
                },
            }) ?? "#",
        [bookingId, doctorName, phone, placement, rawUrl, source, text, unitSlug],
    );

    return (
        <Link
            {...rest}
            href={fallbackHref}
            className={className}
            target={target}
            rel={rel}
            onClick={(event) => {
                onClick?.(event);

                const eventId = createMetaEventId("contact");
                const trackingContext = buildTrackingContextFromBrowser();
                const href =
                    buildWhatsappRedirectHref({
                        rawUrl,
                        phone,
                        text,
                        tracking: {
                            eventId,
                            placement,
                            unitSlug,
                            doctorName,
                            source,
                            bookingId,
                            pageUrl: typeof window !== "undefined" ? window.location.href : null,
                            pagePath: typeof window !== "undefined" ? `${window.location.pathname}${window.location.search}${window.location.hash}` : null,
                            trackingContext,
                        },
                    }) ?? fallbackHref;

                trackEvent("whatsapp_click", {
                    placement,
                    unitSlug,
                    doctorName,
                    source: source ?? "site",
                    bookingId,
                });
                trackContactConversion({
                    placement,
                    unitSlug,
                    doctorName,
                    source: source ?? "site",
                    bookingId,
                }, { eventId });

                if (typeof window !== "undefined" && href && href !== "#") {
                    event.preventDefault();
                    if (target === "_blank") {
                        window.open(href, "_blank", "noopener,noreferrer");
                    } else {
                        window.location.assign(href);
                    }
                }
            }}
        >
            {children}
        </Link>
    );
}
