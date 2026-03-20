"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
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

function doctorActionsIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path
                fill="currentColor"
                d="M12 2a5.25 5.25 0 1 1 0 10.5A5.25 5.25 0 0 1 12 2Zm0 2a3.25 3.25 0 1 0 0 6.5A3.25 3.25 0 0 0 12 4Zm0 9.75c4.56 0 8.25 2.78 8.25 6.21a1 1 0 1 1-2 0c0-2.05-2.67-4.21-6.25-4.21s-6.25 2.16-6.25 4.21a1 1 0 1 1-2 0c0-3.43 3.69-6.21 8.25-6.21Z"
            />
        </svg>
    );
}

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

function doctorHonorific(name: string, nickname: string | null): "Dr." | "Dra." {
    const source = `${nickname ?? ""} ${name}`.toLowerCase();
    if (/\b(dra|doutora)\b/.test(source)) return "Dra.";
    return "Dr.";
}

function doctorDisplayName(name: string, nickname: string | null): string {
    const honorific = doctorHonorific(name, nickname);
    const bareName = name.replace(/^\s*(dr\.?|dra\.?|doutor|doutora)\s+/i, "").trim();
    return `${honorific} ${bareName}`;
}

type CompactDoctorTooltipProps = {
    displayName: string;
    bookingHref: string;
    unitSlug: string | null;
    onOpenInstagram: () => void;
};

function CompactDoctorTooltip({
    displayName,
    bookingHref,
    unitSlug,
    onOpenInstagram,
}: CompactDoctorTooltipProps) {
    const [open, setOpen] = useState(false);
    const [ready, setReady] = useState(false);
    const [position, setPosition] = useState({ left: 0, top: 0 });
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const tooltipRef = useRef<HTMLDivElement | null>(null);
    const closeTimerRef = useRef<number | null>(null);

    const clearCloseTimer = useCallback(() => {
        if (!closeTimerRef.current) return;
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
    }, []);

    const scheduleClose = useCallback(() => {
        clearCloseTimer();
        closeTimerRef.current = window.setTimeout(() => {
            setOpen(false);
        }, 120);
    }, [clearCloseTimer]);

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
        if (!open) {
            setReady(false);
            clearCloseTimer();
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
    }, [clearCloseTimer, open, updatePosition]);

    useEffect(() => () => clearCloseTimer(), [clearCloseTimer]);

    return (
        <div className="unitDoctorsCompact__tooltipAnchor">
            <button
                ref={triggerRef}
                type="button"
                className="unitDoctorsCompact__triggerBtn"
                onMouseEnter={() => {
                    clearCloseTimer();
                    setOpen(true);
                }}
                onMouseLeave={scheduleClose}
                onClick={() => {
                    clearCloseTimer();
                    setOpen((current) => !current);
                }}
                onFocus={() => {
                    clearCloseTimer();
                    setOpen(true);
                }}
                onBlur={(event) => {
                    const next = event.relatedTarget as Node | null;
                    const tooltip = tooltipRef.current;
                    if (next && tooltip?.contains(next)) return;
                    scheduleClose();
                }}
                aria-haspopup="true"
                aria-expanded={open}
                aria-label={`Abrir ações de ${displayName}`}
                title="Abrir ações"
            >
                {doctorActionsIcon()}
            </button>

            {open && typeof document !== "undefined"
                ? createPortal(
                      <div
                          ref={tooltipRef}
                          className="bookingFlow__doctorTooltip unitDoctorsCompact__tooltip"
                          role="tooltip"
                          style={{
                              position: "fixed",
                              left: position.left,
                              top: position.top,
                              transform: "translateX(-50%)",
                              display: "block",
                              zIndex: 5000,
                              opacity: ready ? 1 : 0,
                          }}
                          onMouseEnter={() => {
                              clearCloseTimer();
                              setOpen(true);
                          }}
                          onMouseLeave={scheduleClose}
                      >
                          <div className="unitDoctorsCompact__tooltipNameRow">
                              <div className="unitDoctorsCompact__tooltipName">{displayName}</div>
                              <button
                                  type="button"
                                  className="unitDoctorsCompact__tooltipInstagramBtn"
                                  onClick={() => {
                                      clearCloseTimer();
                                      setOpen(false);
                                      onOpenInstagram();
                                  }}
                                  onBlur={(event) => {
                                      const next = event.relatedTarget as Node | null;
                                      if (next && tooltipRef.current?.contains(next)) return;
                                      scheduleClose();
                                  }}
                                  aria-label={`Abrir Instagram de ${displayName}`}
                                  title="Instagram"
                              >
                                  <InstagramIcon size={14} />
                              </button>
                          </div>

                          <Link
                              className="cta cta--agende unitDoctorsCompact__tooltipBookBtn"
                              href={bookingHref}
                              onClick={() =>
                                  trackBookingStart({
                                      placement: "doctor_grid",
                                      unitSlug,
                                      doctorName: displayName,
                                      bookingUrl: bookingHref,
                                  })
                              }
                              onMouseEnter={() => clearCloseTimer()}
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

type UnitDoctorsGridProps = {
    variant?: "directory" | "booking-compact";
};

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
                            const displayName = doctorDisplayName(d.name, d.nickname);
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

                                    <div className="unitDoctorsCompact__meta">
                                        <div className="unitDoctorsCompact__nameRow">
                                            <div className="unitDoctorsCompact__name">{displayName}</div>
                                            {instagramHandle ? (
                                                <CompactDoctorTooltip
                                                    displayName={displayName}
                                                    bookingHref={bookingHref}
                                                    unitSlug={unit?.slug ?? null}
                                                    onOpenInstagram={openInstagram}
                                                />
                                            ) : null}
                                        </div>
                                    </div>
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
