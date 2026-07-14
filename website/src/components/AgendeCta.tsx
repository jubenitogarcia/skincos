"use client";

import Link from "next/link";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { trackBookingStart } from "@/lib/leadTracking";

export default function AgendeCta() {
    const unit = useCurrentUnit();

    const bookingHref = unit?.slug ? `/agendamento?unit=${encodeURIComponent(unit.slug)}` : "/agendamento";

    return (
        <Link
            className="cta cta--agende"
            href={bookingHref}
            onClick={() => trackBookingStart({ placement: "header", unitSlug: unit?.slug ?? null, bookingUrl: bookingHref })}
        >
            AGENDE
        </Link>
    );
}
