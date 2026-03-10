"use client";

import { useEffect, useMemo } from "react";
import type { Unit } from "@/data/units";

function buildQuery(unit: Unit): string {
    const parts: string[] = [];
    if (unit.name) parts.push(unit.name);
    if (unit.addressLine) parts.push(unit.addressLine);
    if (unit.state) parts.push(unit.state);
    parts.push("Brasil");
    return parts.filter(Boolean).join(", ");
}

function getLatLngQuery(unit: Unit): string | null {
    if (typeof unit.lat === "number" && typeof unit.lng === "number") {
        return `${unit.lat},${unit.lng}`;
    }
    return null;
}

function getGoogleMapsOpenUrl(unit: Unit): string {
    const q = getLatLngQuery(unit) ?? buildQuery(unit);
    const url = new URL("https://www.google.com/maps/search/");
    url.searchParams.set("api", "1");
    url.searchParams.set("query", q);
    return url.toString();
}

function getGoogleMapsEmbedUrl(unit: Unit): string {
    // No API key required. Limited UI, but enough to show the pin.
    const q = encodeURIComponent(getLatLngQuery(unit) ?? buildQuery(unit));
    return `https://www.google.com/maps?q=${q}&z=15&output=embed`;
}

export default function UnitMapsModal({
    unit,
    whatsappUrl,
    onClose,
}: {
    unit: Unit | null;
    whatsappUrl?: string;
    onClose: () => void;
}) {
    const openUrl = useMemo(() => (unit ? getGoogleMapsOpenUrl(unit) : ""), [unit]);
    const embedUrl = useMemo(() => (unit ? getGoogleMapsEmbedUrl(unit) : ""), [unit]);

    useEffect(() => {
        if (!unit) return;

        function onKeyDown(e: KeyboardEvent) {
            if (e.key === "Escape") onClose();
        }

        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [unit, onClose]);

    if (!unit) return null;

    const title = unit.name || "Unidade";
    const subtitle = [unit.addressLine, unit.state].filter(Boolean).join(" • ");

    return (
        <div
            className="modalOverlay"
            role="dialog"
            aria-modal="true"
            aria-label={`Mapa da unidade ${title}`}
            onMouseDown={(e) => {
                // Close only when clicking the backdrop.
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div className="modalCard">
                <div className="modalHeader">
                    <div>
                        <div className="modalTitle">{title}</div>
                        {subtitle ? <div className="modalSubtitle">{subtitle}</div> : null}
                    </div>
                    <button className="modalClose" type="button" onClick={onClose} aria-label="Fechar">
                        ×
                    </button>
                </div>

                <div className="modalBody">
                    <iframe
                        className="mapsFrame"
                        title={`Google Maps - ${title}`}
                        src={embedUrl}
                        loading="lazy"
                        referrerPolicy="no-referrer-when-downgrade"
                    />

                    <div className="modalActions">
                        <a className="btn btnPrimary" href={openUrl} target="_blank" rel="noreferrer">
                            Abrir no Google Maps (reviews e fotos)
                        </a>
                        {whatsappUrl ? (
                            <a className="btn btnGhost" href={whatsappUrl} target="_blank" rel="noreferrer">
                                Falar no WhatsApp
                            </a>
                        ) : null}
                    </div>

                    <div className="modalNote">
                        Dica: no Google Maps você vê avaliações, fotos e rota.
                    </div>
                </div>
            </div>
        </div>
    );
}
