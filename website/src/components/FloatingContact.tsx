"use client";

import { useState } from "react";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { trackBookingStart, trackCtaInstagramClick } from "@/lib/leadTracking";
import DoctorInstagramModal, { type DoctorInstagramProfile } from "@/components/DoctorInstagramModal";

function instagramIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2Zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9ZM12 7a5 5 0 1 1 0 10a5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6a3 3 0 0 0 0-6Zm5.25-.9a1.15 1.15 0 1 1 0 2.3a1.15 1.15 0 0 1 0-2.3Z"
      />
    </svg>
  );
}

export default function FloatingContact() {
  const unit = useCurrentUnit();
  const instagram = unit?.instagram;
  const bookingHref = unit?.slug ? `/agendamento?unit=${encodeURIComponent(unit.slug)}` : "/agendamento";
  const [instagramProfile, setInstagramProfile] = useState<DoctorInstagramProfile | null>(null);

  const instagramHandle = (() => {
    if (!instagram) return null;
    try {
      const pathname = new URL(instagram).pathname;
      const handle = pathname.split("/").filter(Boolean)[0] ?? "";
      return handle.replace(/^@/, "") || null;
    } catch {
      return null;
    }
  })();

  return (
    <div className="fabDock" aria-label="Ações rápidas">
      {instagram ? (
        <button
          className="iconBtn fabInsta"
          type="button"
          aria-label="Instagram"
          title="Instagram"
          onClick={() => {
            trackCtaInstagramClick({ placement: "floating", unitSlug: unit?.slug ?? null, instagramUrl: instagram });
            if (instagramHandle) {
              setInstagramProfile({
                name: unit?.name ?? "Espaço Facial",
                handle: instagramHandle,
              });
              return;
            }
            window.open(instagram, "_blank", "noopener,noreferrer");
          }}
        >
          {instagramIcon()}
        </button>
      ) : null}

      <a
        className="cta cta--agende fab"
        href={bookingHref}
        aria-label="Agendar"
        onClick={() => trackBookingStart({ placement: "floating", unitSlug: unit?.slug ?? null, bookingUrl: bookingHref })}
      >
        <span>AGENDE</span>
      </a>

      <DoctorInstagramModal profile={instagramProfile} onClose={() => setInstagramProfile(null)} />
    </div>
  );
}
