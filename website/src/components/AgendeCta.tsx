"use client";

import Link from "next/link";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { trackBookingStart } from "@/lib/leadTracking";
import { resolveUnitFromSlug } from "@/lib/unitRoutes";

export default function AgendeCta({
    preferredUnitSlug = null,
    fixedUnitSlug = null,
}: {
    preferredUnitSlug?: string | null;
    fixedUnitSlug?: string | null;
}) {
    const unit = useCurrentUnit();
    const preferredUnit = preferredUnitSlug ? resolveUnitFromSlug(preferredUnitSlug) : null;
    const fixedUnit = fixedUnitSlug ? resolveUnitFromSlug(fixedUnitSlug) : null;
    const activeUnit = fixedUnit ?? unit ?? preferredUnit;

    const bookingHref = activeUnit?.slug ? `/agendamento?unit=${encodeURIComponent(activeUnit.slug)}` : "/agendamento";

    return (
        <Link
            className="cta cta--agende"
            href={bookingHref}
            onClick={() => trackBookingStart({ placement: "header", unitSlug: activeUnit?.slug ?? null, bookingUrl: bookingHref })}
        >
            AGENDE
        </Link>
    );
}
