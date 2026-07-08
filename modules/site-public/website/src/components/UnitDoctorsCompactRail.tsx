"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { trackBookingStart } from "@/lib/leadTracking";
import { InstagramIcon } from "@/components/DoctorInstagramModal";
import useHorizontalRail from "@/hooks/useHorizontalRail";

export type UnitDoctorsCompactRailItem = {
    id: string;
    doctorName: string;
    label: string;
    avatar: ReactNode;
    active?: boolean;
    bookingHref?: string;
    tooltipName?: string;
    unitSlug?: string | null;
    onOpenInstagram?: () => void;
    onSelect?: () => void;
    ariaLabel?: string;
};

type UnitDoctorsCompactRailProps = {
    items: UnitDoctorsCompactRailItem[];
    ariaLabel?: string;
    interactionMode: "actions" | "select";
    embedded?: boolean;
};

type CompactDoctorTooltipProps = {
    avatar: ReactNode;
    doctorName: string;
    tooltipName: string;
    bookingHref: string;
    unitSlug: string | null;
    onOpenInstagram?: () => void;
};

function CompactDoctorTooltip({
    avatar,
    doctorName,
    tooltipName,
    bookingHref,
    unitSlug,
    onOpenInstagram,
}: CompactDoctorTooltipProps) {
    const [open, setOpen] = useState(false);
    const [ready, setReady] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const closeTimerRef = useRef<number | null>(null);
    const exitTimerRef = useRef<number | null>(null);

    const clearTimers = useCallback(() => {
        if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
        if (exitTimerRef.current) {
            window.clearTimeout(exitTimerRef.current);
            exitTimerRef.current = null;
        }
    }, []);

    const scheduleClose = useCallback(() => {
        clearTimers();
        closeTimerRef.current = window.setTimeout(() => {
            setOpen(false);
            exitTimerRef.current = window.setTimeout(() => {
                setMounted(false);
                setReady(false);
            }, 220);
        }, 90);
    }, [clearTimers]);

    const updatePosition = useCallback(() => {
        const trigger = triggerRef.current;
        const tooltip = tooltipRef.current;
        if (!trigger || !tooltip) return;

        const triggerRect = trigger.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportPadding = 12;
        const gap = 12;

        const centerX = triggerRect.left + triggerRect.width / 2;
        const halfWidth = tooltipRect.width / 2;
        const left = Math.min(
            window.innerWidth - viewportPadding - halfWidth,
            Math.max(viewportPadding + halfWidth, centerX),
        );

        const spaceBelow = window.innerHeight - triggerRect.bottom;
        const spaceAbove = triggerRect.top;
        const openBelow = spaceBelow >= tooltipRect.height + gap || spaceBelow >= spaceAbove;
        const top = openBelow
            ? Math.min(window.innerHeight - viewportPadding - tooltipRect.height, triggerRect.bottom + gap)
            : Math.max(viewportPadding, triggerRect.top - tooltipRect.height - gap);

        setPosition({ left, top });
        setReady(true);
    }, []);

    useEffect(() => {
        if (!mounted) {
            setReady(false);
            return;
        }

        const onUpdate = () => updatePosition();
        const raf = window.requestAnimationFrame(onUpdate);
        window.addEventListener("resize", onUpdate);
        window.addEventListener("scroll", onUpdate, true);

        return () => {
            window.cancelAnimationFrame(raf);
            window.removeEventListener("resize", onUpdate);
            window.removeEventListener("scroll", onUpdate, true);
        };
    }, [mounted, updatePosition]);

    useEffect(() => () => clearTimers(), [clearTimers]);

    const openTooltip = useCallback(() => {
        clearTimers();
        if (!mounted) {
            setMounted(true);
            window.requestAnimationFrame(() => setOpen(true));
            return;
        }
        setOpen(true);
    }, [clearTimers, mounted]);

    const openInstagramFromTrigger = useCallback(() => {
        if (!onOpenInstagram) return;
        clearTimers();
        setOpen(false);
        setMounted(false);
        setReady(false);
        onOpenInstagram();
    }, [clearTimers, onOpenInstagram]);

    return (
        <div className="unitDoctorsCompact__tooltipAnchor">
            <button
                ref={triggerRef}
                type="button"
                className="unitDoctorsCompact__avatarTrigger"
                onMouseEnter={openTooltip}
                onMouseLeave={scheduleClose}
                onClick={() => {
                    if (onOpenInstagram) {
                        openInstagramFromTrigger();
                        return;
                    }
                    if (open || mounted) {
                        scheduleClose();
                        return;
                    }
                    openTooltip();
                }}
                onFocus={openTooltip}
                onBlur={(event) => {
                    const next = event.relatedTarget as Node | null;
                    const tooltip = tooltipRef.current;
                    if (next && tooltip?.contains(next)) return;
                    scheduleClose();
                }}
                aria-haspopup="true"
                aria-expanded={open}
                aria-label={`Abrir ações de ${doctorName}`}
                title="Abrir ações"
            >
                {avatar}
            </button>

            {mounted && typeof document !== "undefined"
                ? createPortal(
                    <div
                        ref={tooltipRef}
                        className="bookingFlow__doctorTooltip unitDoctorsCompact__tooltip"
                        data-state={open && ready ? "open" : "closed"}
                        role="tooltip"
                        style={{
                            position: "fixed",
                            left: position.left,
                            top: position.top,
                            display: "block",
                            zIndex: 5000,
                        }}
                        onMouseEnter={openTooltip}
                        onMouseLeave={scheduleClose}
                    >
                        <div className="unitDoctorsCompact__tooltipNameRow">
                            <div className="unitDoctorsCompact__tooltipName">{tooltipName}</div>
                            {onOpenInstagram ? (
                                <button
                                    type="button"
                                    className="unitDoctorsCompact__tooltipInstagramBtn"
                                    onClick={() => {
                                        openInstagramFromTrigger();
                                    }}
                                    onBlur={(event) => {
                                        const next = event.relatedTarget as Node | null;
                                        if (next && tooltipRef.current?.contains(next)) return;
                                        scheduleClose();
                                    }}
                                    aria-label={`Abrir Instagram de ${doctorName}`}
                                    title="Instagram"
                                >
                                    <InstagramIcon size={14} />
                                </button>
                            ) : null}
                        </div>

                        <Link
                            className="cta cta--agende unitDoctorsCompact__tooltipBookBtn"
                            href={bookingHref}
                            onClick={() =>
                                trackBookingStart({
                                    placement: "doctor_grid",
                                    unitSlug,
                                    doctorName,
                                    bookingUrl: bookingHref,
                                })
                            }
                            onMouseEnter={openTooltip}
                            onBlur={(event) => {
                                const next = event.relatedTarget as Node | null;
                                if (next && tooltipRef.current?.contains(next)) return;
                                scheduleClose();
                            }}
                        >
                            AGENDE
                        </Link>
                    </div>,
                    document.body,
                )
                : null}
        </div>
    );
}

export default function UnitDoctorsCompactRail({
    items,
    ariaLabel = "Lista de doutores da unidade",
    interactionMode,
    embedded = false,
}: UnitDoctorsCompactRailProps) {
    const { railRef, canScrollLeft, canScrollRight, hoverEdge, handleContainerMouseMove, clearHoverScroll, scrollByDirection } =
        useHorizontalRail({
            itemSelector: ".unitDoctorsCompact__item",
            lockMs: 720,
            baseVelocity: 0.02,
            maxVelocity: 0.18,
        });

    useEffect(() => {
        if (interactionMode !== "select") return;
        const rail = railRef.current;
        if (!rail) return;

        const activeItem = rail.querySelector(".unitDoctorsCompact__item[data-active='true']") as HTMLElement | null;
        if (!activeItem) return;

        const railRect = rail.getBoundingClientRect();
        const activeRect = activeItem.getBoundingClientRect();
        const isOutOfView = activeRect.left < railRect.left + 10 || activeRect.right > railRect.right - 10;
        if (!isOutOfView) return;

        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        activeItem.scrollIntoView({
            behavior: reduceMotion ? "auto" : "smooth",
            block: "nearest",
            inline: "center",
        });
    }, [interactionMode, items, railRef]);

    return (
        <div
            className={embedded ? "unitDoctorsCompact unitDoctorsCompact--embedded" : "card unitDoctorsCompact"}
            onMouseMove={handleContainerMouseMove}
            onMouseLeave={() => {
                clearHoverScroll();
            }}
        >
            <button
                type="button"
                className="unitDoctorsCompact__arrow unitDoctorsCompact__arrow--left carouselNavChrome"
                aria-label="Doutor anterior"
                onClick={() => scrollByDirection("left")}
                disabled={!canScrollLeft}
                data-visible={canScrollLeft ? "true" : "false"}
                data-hovered={hoverEdge === "left" ? "true" : "false"}
            >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M14.5 6.5 9 12l5.5 5.5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            <div
                ref={railRef}
                className="unitDoctorsCompact__rail"
                role="list"
                aria-label={ariaLabel}
            >
                {items.map((item) => (
                    <article key={item.id} className="unitDoctorsCompact__item" data-active={item.active ? "true" : "false"} role="listitem">
                        {interactionMode === "actions" && item.bookingHref && item.tooltipName ? (
                            <CompactDoctorTooltip
                                avatar={item.avatar}
                                doctorName={item.doctorName}
                                tooltipName={item.tooltipName}
                                bookingHref={item.bookingHref}
                                unitSlug={item.unitSlug ?? null}
                                onOpenInstagram={item.onOpenInstagram}
                            />
                        ) : (
                            <button
                                type="button"
                                className="unitDoctorsCompact__avatarTrigger unitDoctorsCompact__avatarTrigger--select"
                                data-active={item.active ? "true" : "false"}
                                onClick={item.onSelect}
                                aria-pressed={item.active}
                                aria-label={item.ariaLabel ?? item.doctorName}
                            >
                                {item.avatar}
                            </button>
                        )}

                        <div className="unitDoctorsCompact__meta">
                            <div className="unitDoctorsCompact__nameRow">
                                <div className="unitDoctorsCompact__name">{item.label}</div>
                            </div>
                        </div>
                    </article>
                ))}
            </div>

            <button
                type="button"
                className="unitDoctorsCompact__arrow unitDoctorsCompact__arrow--right carouselNavChrome"
                aria-label="Próximo doutor"
                onClick={() => scrollByDirection("right")}
                disabled={!canScrollRight}
                data-visible={canScrollRight ? "true" : "false"}
                data-hovered={hoverEdge === "right" ? "true" : "false"}
            >
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M9.5 6.5 15 12l-5.5 5.5" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>
        </div>
    );
}
