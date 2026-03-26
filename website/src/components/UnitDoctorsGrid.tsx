"use client";

import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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

function doctorBareName(name: string): string {
    return name.replace(/^\s*(dr\.?|dra\.?|doutor|doutora)\s+/i, "").trim();
}

function doctorDisplayName(name: string): string {
    return doctorBareName(name);
}

function doctorTooltipName(name: string, nickname: string | null): string {
    const honorific = doctorHonorific(name, nickname);
    const bareName = doctorBareName(name);
    const firstName = bareName.split(/\s+/).filter(Boolean)[0] ?? bareName;
    return `${honorific} ${firstName}`;
}

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
                className="unitDoctorsCompact__avatarTrigger"
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
                aria-label={`Abrir ações de ${doctorName}`}
                title="Abrir ações"
            >
                {avatar}
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
                              <div className="unitDoctorsCompact__tooltipName">{tooltipName}</div>
                              {onOpenInstagram ? (
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
                            const displayName = doctorDisplayName(d.name);
                            const tooltipName = doctorTooltipName(d.name, d.nickname);
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
                                    <CompactDoctorTooltip
                                        avatar={
                                            <span className="bookingFlow__doctorBadgeAvatar">
                                                {instagramHandle ? (
                                                    <Image src={avatarUrl(instagramHandle, fullName)} alt={fullName} width={76} height={76} unoptimized />
                                                ) : (
                                                    <span className="bookingFlow__doctorBadgeFallback">{fullName.charAt(0).toUpperCase()}</span>
                                                )}
                                            </span>
                                        }
                                        doctorName={fullName}
                                        tooltipName={tooltipName}
                                        bookingHref={bookingHref}
                                        unitSlug={unit?.slug ?? null}
                                        onOpenInstagram={instagramHandle ? openInstagram : undefined}
                                    />

                                    <div className="unitDoctorsCompact__meta">
                                        <div className="unitDoctorsCompact__nameRow">
                                            <div className="unitDoctorsCompact__name">{displayName}</div>
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
            <div className="grid doctorDirectoryGrid">
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
                            className="card doctorDirectoryCard"
                        >
                            <div className="doctorDirectoryCard__header">
                                {instagramHandle ? (
                                    <button
                                        className="doctorDirectoryCard__profile doctorCardMainLink doctorCardMainButton"
                                        type="button"
                                        onClick={openInstagram}
                                        aria-label={`Abrir Instagram de ${fullName}`}
                                        title="Abrir Instagram"
                                    >
                                        <div className="doctorDirectoryCard__avatar">
                                            {instagramHandle ? (
                                                <Image src={avatarUrl(instagramHandle, fullName)} alt={fullName} width={56} height={56} unoptimized />
                                            ) : (
                                                <span className="doctorDirectoryCard__avatarFallback">{fullName.charAt(0).toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div className="doctorDirectoryCard__meta">
                                            <h3 className="doctorDirectoryCard__name" title={fullName}>{fullName}</h3>
                                            <p className="doctorDirectoryCard__sub" title={unitLabel ?? undefined}>{unitLabel}</p>
                                        </div>
                                    </button>
                                ) : (
                                    <div className="doctorDirectoryCard__profile doctorCardMainLink" aria-label={fullName}>
                                        <div className="doctorDirectoryCard__avatar">
                                            {instagramHandle ? (
                                                <Image src={avatarUrl(instagramHandle, fullName)} alt={fullName} width={56} height={56} unoptimized />
                                            ) : (
                                                <span className="doctorDirectoryCard__avatarFallback">{fullName.charAt(0).toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div className="doctorDirectoryCard__meta">
                                            <h3 className="doctorDirectoryCard__name" title={fullName}>{fullName}</h3>
                                            <p className="doctorDirectoryCard__sub" title={unitLabel ?? undefined}>{unitLabel}</p>
                                        </div>
                                    </div>
                                )}

                                <div className="doctorDirectoryCard__actions">
                                    {instagramHandle ? (
                                        <button
                                            className="iconBtn doctorDirectoryCard__instagramBtn"
                                            type="button"
                                            onClick={openInstagram}
                                            aria-label={`Instagram de ${fullName}`}
                                            title="Instagram"
                                        >
                                            <InstagramIcon />
                                        </button>
                                    ) : null}

                                    <Link
                                        className="doctorDirectoryCard__bookBtn"
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
                                        <span className="doctorDirectoryCard__bookIcon" aria-hidden="true">{bookingIcon()}</span>
                                        <span>Agende</span>
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
