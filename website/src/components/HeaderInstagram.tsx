"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { units } from "@/data/units";
import { trackHeaderInstagramClick, trackHeaderInstagramOpen } from "@/lib/leadTracking";

const ALLOWED_UNIT_SLUGS = ["barrashoppingsul", "novo-hamburgo"] as const;

function instagramIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M7.5 2h9A5.5 5.5 0 0 1 22 7.5v9A5.5 5.5 0 0 1 16.5 22h-9A5.5 5.5 0 0 1 2 16.5v-9A5.5 5.5 0 0 1 7.5 2Zm0 2A3.5 3.5 0 0 0 4 7.5v9A3.5 3.5 0 0 0 7.5 20h9a3.5 3.5 0 0 0 3.5-3.5v-9A3.5 3.5 0 0 0 16.5 4h-9ZM12 7a5 5 0 1 1 0 10a5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6a3 3 0 0 0 0-6Zm5.25-.9a1.15 1.15 0 1 1 0 2.3a1.15 1.15 0 0 1 0-2.3Z"
            />
        </svg>
    );
}

function allowedUnits() {
    return units.filter((u) => (ALLOWED_UNIT_SLUGS as readonly string[]).includes(u.slug));
}

export default function HeaderInstagram() {
    const unit = useCurrentUnit();
    const allowed = useMemo(() => allowedUnits(), []);

    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(0);
    const wrapRef = useRef<HTMLDivElement | null>(null);
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const itemRefs = useRef<Array<HTMLAnchorElement | null>>([]);

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
        const t = window.setTimeout(() => {
            itemRefs.current[nextIdx]?.focus();
        }, 0);
        return () => window.clearTimeout(t);
    }, [open, allowed, unit?.slug]);

    const currentInstagram = useMemo(() => {
        const slug = unit?.slug;
        if (!slug) return null;
        const found = allowed.find((u) => u.slug === slug);
        return found?.instagram ?? null;
    }, [allowed, unit?.slug]);

    return (
        <div className="unitChooser" ref={wrapRef}>
            <button
                className="iconBtn"
                type="button"
                onClick={() => {
                    if (currentInstagram) {
                        trackHeaderInstagramClick({ unitSlug: unit?.slug ?? null, mode: "direct" });
                        window.open(currentInstagram, "_blank", "noopener,noreferrer");
                        return;
                    }

                    setOpen((v) => !v);
                    trackHeaderInstagramOpen({ unitSlug: unit?.slug ?? null, mode: "picker" });
                }}
                onKeyDown={(e) => {
                    if (e.key === "Escape") {
                        setOpen(false);
                        return;
                    }
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        if (!currentInstagram) setOpen(true);
                    }
                }}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Instagram"
                title="Instagram"
                ref={buttonRef}
            >
                {instagramIcon()}
            </button>

            {open ? (
                <div
                    className="unitChooserMenu"
                    role="menu"
                    aria-label="Instagram das unidades"
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
                        <a
                            key={u.slug}
                            className="unitChooserItem"
                            role="menuitem"
                            href={u.instagram ?? "#"}
                            target="_blank"
                            rel="noreferrer"
                            tabIndex={idx === activeIndex ? 0 : -1}
                            ref={(el) => {
                                itemRefs.current[idx] = el;
                            }}
                            onClick={(e) => {
                                if (!u.instagram) {
                                    e.preventDefault();
                                    return;
                                }
                                trackHeaderInstagramClick({ unitSlug: u.slug, mode: "picker" });
                                setOpen(false);
                                buttonRef.current?.focus();
                            }}
                            style={{ display: "block" }}
                        >
                            <div className="unitChooserItemTitle">{u.name}</div>
                            <div className="unitChooserItemSub">@{new URL(u.instagram ?? "https://instagram.com/").pathname.replaceAll("/", "")}</div>
                        </a>
                    ))}
                </div>
            ) : null}
        </div>
    );
}
