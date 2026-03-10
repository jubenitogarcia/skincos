"use client";

import { useEffect, useRef, useState } from "react";
import { units } from "@/data/units";
import { setStoredUnitSlug } from "@/lib/unitSelection";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { trackEvent } from "@/lib/analytics";

const ALLOWED_UNIT_SLUGS = ["barrashoppingsul", "novo-hamburgo"] as const;

function getAllowedUnits() {
    return units.filter((u) => (ALLOWED_UNIT_SLUGS as readonly string[]).includes(u.slug));
}

export default function UnitChooser() {
    const unit = useCurrentUnit();
    const allowed = getAllowedUnits();

    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

    useEffect(() => {
        function onDocClick(e: MouseEvent) {
            const el = wrapRef.current;
            if (!el) return;
            if (e.target instanceof Node && el.contains(e.target)) return;
            setOpen(false);
        }

        document.addEventListener("click", onDocClick);
        return () => document.removeEventListener("click", onDocClick);
    }, []);

    useEffect(() => {
        if (!open) return;
        const selectedIdx = unit?.slug ? allowed.findIndex((u) => u.slug === unit.slug) : -1;
        const nextIdx = selectedIdx >= 0 ? selectedIdx : 0;
        setActiveIndex(nextIdx);
        // Focus after paint.
        const t = window.setTimeout(() => {
            itemRefs.current[nextIdx]?.focus();
        }, 0);
        return () => window.clearTimeout(t);
    }, [open, allowed, unit?.slug]);

    const label = unit?.name ? unit.name : "Selecione a unidade";

    return (
        <div className="unitChooser" ref={wrapRef}>
            <button
                className="unitChooserBtn"
                type="button"
                onClick={() => {
                    setOpen((v) => !v);
                    trackEvent("unit_chooser_open", { placement: "header" });
                }}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        setOpen(false);
                        return;
                    }
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        setOpen(true);
                    }
                }}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Selecionar unidade"
                ref={buttonRef}
            >
                {label}
            </button>

            {open ? (
                <div
                    className="unitChooserMenu"
                    role="menu"
                    aria-label="Escolher unidade"
                    onKeyDown={(e) => {
                        if (e.key === "Escape") {
                            e.preventDefault();
                            setOpen(false);
                            buttonRef.current?.focus();
                            return;
                        }

                        if (!allowed.length) return;

                        if (e.key === "Home") {
                            e.preventDefault();
                            setActiveIndex(0);
                            itemRefs.current[0]?.focus();
                            return;
                        }
                        if (e.key === "End") {
                            e.preventDefault();
                            const idx = allowed.length - 1;
                            setActiveIndex(idx);
                            itemRefs.current[idx]?.focus();
                            return;
                        }

                        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                            e.preventDefault();
                            const dir = e.key === "ArrowDown" ? 1 : -1;
                            const next = (activeIndex + dir + allowed.length) % allowed.length;
                            setActiveIndex(next);
                            itemRefs.current[next]?.focus();
                            return;
                        }
                    }}
                >
                    {allowed.map((u, idx) => (
                        <button
                            key={u.slug}
                            className="unitChooserItem"
                            role="menuitem"
                            type="button"
                            tabIndex={idx === activeIndex ? 0 : -1}
                            ref={(el) => {
                                itemRefs.current[idx] = el;
                            }}
                            onClick={() => {
                                setStoredUnitSlug(u.slug);
                                trackEvent("unit_select", { unitSlug: u.slug, placement: "header_unit_chooser" });
                                setOpen(false);
                                buttonRef.current?.focus();
                            }}
                        >
                            <div className="unitChooserItemTitle">{u.name}</div>
                            {u.addressLine ? <div className="unitChooserItemSub">{u.addressLine}</div> : null}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
