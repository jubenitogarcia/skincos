"use client";

import { type ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createPortal } from "react-dom";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { doctorSlugFromTeamMember } from "@/lib/doctorSlug";
import { trackBookingStart, trackDoctorInstagramClick } from "@/lib/leadTracking";
import DoctorInstagramModal, { InstagramIcon } from "@/components/DoctorInstagramModal";
import UnitQuickButtons from "@/components/UnitQuickButtons";

type TeamMember = {
    name: string;
    nickname: string | null;
    units: string[];
    role: string;
    roles: string[];
    instagramHandle: string | null;
    instagramUrl: string | null;
};

function bookingIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M7 2a1 1 0 0 1 1 1v1h8V3a1 1 0 1 1 2 0v1h1.5A2.5 2.5 0 0 1 22 6.5v13A2.5 2.5 0 0 1 19.5 22h-15A2.5 2.5 0 0 1 2 19.5v-13A2.5 2.5 0 0 1 4.5 4H6V3a1 1 0 0 1 1-1Zm12.5 6H4.5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h15a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5Z"
            />
        </svg>
    );
}

function unitLabelFromSlug(slug: string | null | undefined): string | null {
    if (!slug) return null;
    if (slug === "barrashoppingsul") return "BarraShoppingSul";
    if (slug === "novo-hamburgo") return "Novo Hamburgo";
    return null;
}

function avatarUrl(handle: string, name: string) {
    const h = encodeURIComponent(handle);
    const n = encodeURIComponent(name);
    return `/api/instagram-avatar?handle=${h}&name=${n}`;
}

function extractInstagramHandle(url: string | null): string | null {
    if (!url) return null;
    try {
        const { pathname } = new URL(url);
        const handle = pathname.split("/").filter(Boolean)[0];
        return handle ? handle.replace(/^@/, "") : null;
    } catch {
        return null;
    }
}

type UnitDoctorsGridProps = {
    variant?: "directory" | "booking-compact";
};

function PortalTooltip(props: { content: ReactNode; children: ReactNode; className: string; disabled?: boolean }) {
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<{ left: number; top: number }>({ left: 0, top: 0 });

    const clearCloseTimer = useCallback(() => {
        if (!closeTimerRef.current) return;
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
    }, []);

    const openTooltip = useCallback(() => {
        if (props.disabled) return;
        clearCloseTimer();
        setOpen(true);
    }, [clearCloseTimer, props.disabled]);

    const scheduleClose = useCallback(() => {
        clearCloseTimer();
        closeTimerRef.current = setTimeout(() => setOpen(false), 120);
    }, [clearCloseTimer]);

    const updatePosition = useCallback(() => {
        const anchor = anchorRef.current;
        const tooltip = tooltipRef.current;
        if (!anchor || !tooltip) return;
        const anchorRect = anchor.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();
        const viewportPadding = 8;
        let left = anchorRect.left + anchorRect.width / 2;
        const minLeft = viewportPadding + tooltipRect.width / 2;
        const maxLeft = window.innerWidth - viewportPadding - tooltipRect.width / 2;
        left = Math.max(minLeft, Math.min(maxLeft, left));
        const top = anchorRect.bottom + 4;
        setPosition({ left, top });
    }, []);

    useLayoutEffect(() => {
        if (!open) return;
        updatePosition();
    }, [open, updatePosition, props.content]);

    useEffect(() => {
        if (!open) return;
        const onWindowChange = () => updatePosition();
        window.addEventListener("resize", onWindowChange);
        window.addEventListener("scroll", onWindowChange, true);
        return () => {
            window.removeEventListener("resize", onWindowChange);
            window.removeEventListener("scroll", onWindowChange, true);
        };
    }, [open, updatePosition]);

    useEffect(() => {
        return () => clearCloseTimer();
    }, [clearCloseTimer]);

    return (
        <div
            ref={anchorRef}
            className="bookingFlow__tooltipAnchor"
            onMouseEnter={openTooltip}
            onMouseLeave={scheduleClose}
            onFocusCapture={openTooltip}
            onBlurCapture={scheduleClose}
        >
            {props.children}
            {open && typeof document !== "undefined"
                ? createPortal(
                      <div
                          ref={tooltipRef}
                          className={props.className}
                          role="tooltip"
                          style={{
                              position: "fixed",
                              left: position.left,
                              top: position.top,
                              transform: "translateX(-50%)",
                              display: "block",
                              zIndex: 5000,
                          }}
                          onMouseEnter={openTooltip}
                          onMouseLeave={scheduleClose}
                      >
                          {props.content}
                      </div>,
                      document.body,
                  )
                : null}
        </div>
    );
}

export default function UnitDoctorsGrid({ variant = "directory" }: UnitDoctorsGridProps) {
    const unit = useCurrentUnit();
    const unitLabel = unitLabelFromSlug(unit?.slug);

    const [members, setMembers] = useState<TeamMember[] | null>(null);
    const [membersError, setMembersError] = useState<string | null>(null);
    const [activeInstagram, setActiveInstagram] = useState<{
        name: string;
        handle: string;
    } | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            try {
                const res = await fetch("/api/equipe", { cache: "no-store" });
                const json = (await res.json().catch(() => null)) as
                    | { ok?: boolean; members?: TeamMember[]; error?: { code?: string; status?: number } }
                    | null;
                if (cancelled) return;
                const nextMembers = Array.isArray(json?.members) ? json!.members! : [];
                setMembers(nextMembers);
                setMembersError(json && json.ok === false ? json.error?.code ?? "unknown" : null);
            } catch {
                if (cancelled) return;
                setMembers([]);
                setMembersError("exception");
            }
        }

        load();
        return () => {
            cancelled = true;
        };
    }, []);

    const filtered = useMemo(() => {
        if (!members) return null;
        if (!unitLabel) return [];

        return members.filter((m) => m.units.map((u) => u.toLowerCase()).includes(unitLabel.toLowerCase()));
    }, [members, unitLabel]);

    if (!unitLabel) {
        return (
            <>
                <p className="sectionSub">Selecione a unidade para conhecer nossos doutores.</p>
                <UnitQuickButtons placement="doctors_quick" />
            </>
        );
    }

    const selectedUnitSubtitle =
        variant === "booking-compact"
            ? <p className="sectionSub">Conheça a equipe da unidade e entre no agendamento com o doutor já definido.</p>
            : <p className="sectionSub">Conheça nossos doutores, veja seus perfis e procedimentos realizados.</p>;

    if (filtered === null) {
        return (
            <>
                {selectedUnitSubtitle}
                <div className="card">Carregando equipe…</div>
            </>
        );
    }

    if (filtered.length === 0) {
        return (
            <>
                {selectedUnitSubtitle}
                <div className="card">
                    {membersError ? "Não foi possível carregar a equipe no momento." : `Nenhum doutor encontrado para ${unitLabel}.`}
                </div>
            </>
        );
    }

    if (variant === "booking-compact") {
        return (
            <>
                {selectedUnitSubtitle}
                <div className="card unitDoctorsCompact">
                    <div className="unitDoctorsCompact__rail" role="list" aria-label="Lista de doutores da unidade">
                        {filtered.map((d) => {
                            const fullName = d.name;
                            const handle = d.instagramHandle;
                            const href = d.instagramUrl;
                            const instagramHandle = handle || extractInstagramHandle(href);
                            const doctorSlug = doctorSlugFromTeamMember({ name: fullName, instagramHandle: handle });
                            const bookingHref = unit?.slug
                                ? `/agendamento?unit=${encodeURIComponent(unit.slug)}&doctor=${encodeURIComponent(doctorSlug)}`
                                : "/agendamento";
                            const openInstagram = () => {
                                if (!instagramHandle) return;
                                setActiveInstagram({ name: fullName, handle: instagramHandle });
                                trackDoctorInstagramClick({
                                    unitSlug: unit?.slug ?? null,
                                    doctorName: fullName,
                                    instagramUrl: href ?? `https://www.instagram.com/${instagramHandle}/`,
                                });
                            };

                            return (
                                <article key={`${fullName}-${href ?? "noinsta"}`} className="unitDoctorsCompact__item" role="listitem">
                                    <PortalTooltip
                                        className="bookingFlow__doctorTooltip unitDoctorsCompact__tooltip"
                                        content={
                                            <>
                                                <div className="bookingFlow__doctorTooltipName">{fullName}</div>
                                                <div className="unitDoctorsCompact__tooltipActions">
                                                    <Link
                                                        className="unitDoctorsCompact__tooltipAction"
                                                        href={bookingHref}
                                                        onClick={() =>
                                                            trackBookingStart({
                                                                placement: "doctor_grid",
                                                                unitSlug: unit?.slug ?? null,
                                                                doctorName: fullName,
                                                                bookingUrl: bookingHref,
                                                            })
                                                        }
                                                    >
                                                        Agendar
                                                    </Link>
                                                    {instagramHandle ? (
                                                        <button
                                                            type="button"
                                                            className="unitDoctorsCompact__tooltipAction"
                                                            onClick={openInstagram}
                                                        >
                                                            Instagram
                                                        </button>
                                                    ) : null}
                                                </div>
                                            </>
                                        }
                                    >
                                        <Link
                                            className="bookingFlow__doctorBadge unitDoctorsCompact__badgeLink"
                                            href={bookingHref}
                                            onClick={() =>
                                                trackBookingStart({
                                                    placement: "doctor_grid",
                                                    unitSlug: unit?.slug ?? null,
                                                    doctorName: fullName,
                                                    bookingUrl: bookingHref,
                                                })
                                            }
                                            aria-label={`Agendar com ${fullName}`}
                                        >
                                            <span className="bookingFlow__doctorBadgeAvatar">
                                                {instagramHandle ? (
                                                    <Image src={avatarUrl(instagramHandle, fullName)} alt={fullName} width={76} height={76} unoptimized />
                                                ) : (
                                                    <span className="bookingFlow__doctorBadgeFallback">{fullName.charAt(0).toUpperCase()}</span>
                                                )}
                                            </span>
                                        </Link>
                                    </PortalTooltip>

                                    <div className="unitDoctorsCompact__name">{fullName}</div>
                                </article>
                            );
                        })}
                    </div>
                </div>

                <DoctorInstagramModal profile={activeInstagram} onClose={() => setActiveInstagram(null)} />
            </>
        );
    }

    return (
        <>
            {selectedUnitSubtitle}
            <div className="grid">
                {filtered.map((d) => {
                    const fullName = d.name;
                    const handle = d.instagramHandle;
                    const href = d.instagramUrl;
                    const instagramHandle = handle || extractInstagramHandle(href);
                    const doctorSlug = doctorSlugFromTeamMember({ name: fullName, instagramHandle: handle });
                    const bookingHref = unit?.slug
                        ? `/agendamento?unit=${encodeURIComponent(unit.slug)}&doctor=${encodeURIComponent(doctorSlug)}`
                        : "/agendamento";
                    const openInstagram = () => {
                        if (!instagramHandle) return;
                        setActiveInstagram({ name: fullName, handle: instagramHandle });
                        trackDoctorInstagramClick({
                            unitSlug: unit?.slug ?? null,
                            doctorName: fullName,
                            instagramUrl: href ?? `https://www.instagram.com/${instagramHandle}/`,
                        });
                    };

                    return (
                        <article
                            key={`${fullName}-${href ?? "noinsta"}`}
                            className="card"
                            style={{ display: "block" }}
                        >
                            <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
                                {instagramHandle ? (
                                    <button
                                        className="doctorCardMainLink doctorCardMainButton"
                                        type="button"
                                        onClick={openInstagram}
                                        aria-label={`Abrir Instagram de ${fullName}`}
                                        title="Abrir Instagram"
                                    >
                                        <div style={{ width: 56, height: 56, borderRadius: 14, overflow: "hidden", background: "white" }}>
                                            {instagramHandle ? (
                                                <Image src={avatarUrl(instagramHandle, fullName)} alt={fullName} width={56} height={56} unoptimized />
                                            ) : null}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <h3 style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fullName}</h3>
                                            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{unitLabel}</p>
                                        </div>
                                    </button>
                                ) : (
                                    <div className="doctorCardMainLink" aria-label={fullName}>
                                        <div style={{ width: 56, height: 56, borderRadius: 14, overflow: "hidden", background: "white" }}>
                                            {instagramHandle ? (
                                                <Image src={avatarUrl(instagramHandle, fullName)} alt={fullName} width={56} height={56} unoptimized />
                                            ) : null}
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <h3 style={{ margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{fullName}</h3>
                                            <p style={{ margin: 0, color: "var(--muted)", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{unitLabel}</p>
                                        </div>
                                    </div>
                                )}

                                <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                                    {instagramHandle ? (
                                        <button
                                            className="iconBtn"
                                            type="button"
                                            onClick={openInstagram}
                                            aria-label="Instagram"
                                            title="Instagram"
                                        >
                                            <InstagramIcon />
                                        </button>
                                    ) : null}

                                    <Link
                                        className="iconBtn"
                                        href={bookingHref}
                                        onClick={() =>
                                            trackBookingStart({
                                                placement: "doctor_grid",
                                                unitSlug: unit?.slug ?? null,
                                                doctorName: fullName,
                                                bookingUrl: bookingHref,
                                            })
                                        }
                                        aria-label={`Agendar com ${fullName}`}
                                        title="Agendar"
                                    >
                                        {bookingIcon()}
                                    </Link>
                                </div>
                            </div>
                        </article>
                    );
                })}
            </div>

            <DoctorInstagramModal profile={activeInstagram} onClose={() => setActiveInstagram(null)} />
        </>
    );
}
