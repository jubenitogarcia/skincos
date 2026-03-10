"use client";

import Link from "next/link";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { trackBookingStart } from "@/lib/leadTracking";

export default function DoctorAgendarPill({ doctorName }: { doctorName: string }) {
    const unit = useCurrentUnit();
    const bookingHref = unit?.slug ? `/agendamento?unit=${encodeURIComponent(unit.slug)}` : "/agendamento";

    return (
        <Link
            className="pill"
            href={bookingHref}
            onClick={() => trackBookingStart({ placement: "doctor", doctorName, unitSlug: unit?.slug ?? null, bookingUrl: bookingHref })}
        >
            AGENDAR
        </Link>
    );
}
