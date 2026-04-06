"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { useCurrentUnit } from "@/hooks/useCurrentUnit";
import { canonicalDoctorSlugForMember } from "@/lib/doctorSlug";
import { resolveDoctorAvatarPresentation, resolveDoctorAvatarUrl, resolveDoctorPublicName } from "@/lib/doctorAvatar";
import { trackBookingStart, trackDoctorInstagramClick } from "@/lib/leadTracking";
import DoctorInstagramModal, { InstagramIcon } from "@/components/DoctorInstagramModal";
import UnitDoctorsCompactRail, { type UnitDoctorsCompactRailItem } from "@/components/UnitDoctorsCompactRail";
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

export type BookingSelectDoctor = {
    slug: string;
    name: string;
    handle: string | null;
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
    return resolveDoctorAvatarUrl(handle, name);
}

function doctorAvatarStyle(name: string): CSSProperties {
    const presentation = resolveDoctorAvatarPresentation(name);

    return {
        ["--doctor-avatar-position" as string]: presentation.objectPosition,
        ["--doctor-avatar-scale" as string]: `${presentation.scale}`,
        ["--doctor-avatar-hover-scale" as string]: `${presentation.scale + 0.03}`,
    };
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
    return resolveDoctorPublicName(name).replace(/^\s*(dr\.?|dra\.?|doutor|doutora)\s+/i, "").trim();
}

function doctorDisplayName(name: string): string {
    return doctorBareName(name);
}

function doctorCompactSelectionName(name: string): string {
    const bareName = doctorBareName(name);
    const parts = bareName.split(/\s+/).filter(Boolean);
    if (parts.length <= 2) return bareName;
    return `${parts[0]} ${parts[parts.length - 1]}`;
}

function doctorTooltipName(name: string, nickname: string | null): string {
    const honorific = doctorHonorific(name, nickname);
    const bareName = doctorBareName(name);
    const firstName = bareName.split(/\s+/).filter(Boolean)[0] ?? bareName;
    return `${honorific} ${firstName}`;
}

type UnitDoctorsGridProps = {
    variant?: "directory" | "booking-compact" | "booking-select";
    doctorSelections?: BookingSelectDoctor[] | null;
    activeDoctorSlug?: string | null;
    onDoctorSelect?: (doctor: BookingSelectDoctor) => void;
    showAllWhenNoUnitSelected?: boolean;
};

export default function UnitDoctorsGrid({
    variant = "directory",
    doctorSelections = null,
    activeDoctorSlug = null,
    onDoctorSelect,
    showAllWhenNoUnitSelected = false,
}: UnitDoctorsGridProps) {
    const unit = useCurrentUnit();
    const unitLabel = unitLabelFromSlug(unit?.slug);
    const isBookingCompact = variant === "booking-compact";
    const isBookingSelect = variant === "booking-select";
    const isCompactVariant = isBookingCompact || isBookingSelect;
    const showAllDirectoryWithoutUnit = !unitLabel && variant === "directory" && showAllWhenNoUnitSelected;

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
        if (showAllDirectoryWithoutUnit) return members;
        if (!unitLabel) return [];

        return members.filter((m) => m.units.map((u) => u.toLowerCase()).includes(unitLabel.toLowerCase()));
    }, [members, showAllDirectoryWithoutUnit, unitLabel]);

    const compactItems = useMemo<UnitDoctorsCompactRailItem[] | null>(() => {
        if (isBookingSelect) {
            if (doctorSelections === null) return null;

            const selectionItems: UnitDoctorsCompactRailItem[] = doctorSelections.map((doctor) => ({
                id: doctor.slug,
                doctorName: doctor.name,
                label: doctorCompactSelectionName(doctor.name),
                active: activeDoctorSlug === doctor.slug,
                ariaLabel:
                    activeDoctorSlug === doctor.slug
                        ? `Remover seleção de ${doctor.name}`
                        : `Selecionar ${doctor.name}`,
                onSelect: () => onDoctorSelect?.(doctor),
                avatar: (
                    <span className="bookingFlow__doctorBadgeAvatar">
                        {doctor.handle ? (
                            <Image src={avatarUrl(doctor.handle, doctor.name)} alt={doctor.name} width={76} height={76} unoptimized style={doctorAvatarStyle(doctor.name)} />
                        ) : (
                            <span className="bookingFlow__doctorBadgeFallback">{doctor.name.charAt(0).toUpperCase()}</span>
                        )}
                    </span>
                ),
            }));

            selectionItems.push({
                id: "any",
                doctorName: "Sem Preferência",
                label: "Sem Preferência",
                active: activeDoctorSlug === "any",
                ariaLabel:
                    activeDoctorSlug === "any"
                        ? "Remover seleção de sem preferência"
                        : "Selecionar sem preferência de doutor",
                onSelect: () => onDoctorSelect?.({ slug: "any", name: "Sem Preferência", handle: null }),
                avatar: (
                    <span className="bookingFlow__doctorBadgeAvatar bookingFlow__doctorBadgeAvatar--all">
                        <span className="bookingFlow__doctorBadgeFallback bookingFlow__doctorBadgeFallback--all">
                            <span>Sem</span>
                            <span>Preferência</span>
                        </span>
                    </span>
                ),
            });

            return selectionItems;
        }

        if (!filtered) return null;

        return filtered.map((doctor) => {
            const fullName = doctor.name;
            const publicName = resolveDoctorPublicName(fullName);
            const displayName = doctorDisplayName(doctor.name);
            const tooltipName = doctorTooltipName(doctor.name, doctor.nickname);
            const handle = doctor.instagramHandle;
            const href = doctor.instagramUrl;
            const instagramHandle = handle || extractInstagramHandle(href);
            const doctorSlug = canonicalDoctorSlugForMember({ name: fullName, instagramHandle: handle });
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

            return {
                id: `${fullName}-${href ?? "noinsta"}`,
                doctorName: fullName,
                label: displayName,
                tooltipName,
                bookingHref,
                unitSlug: unit?.slug ?? null,
                onOpenInstagram: instagramHandle ? openInstagram : undefined,
                avatar: (
                    <span className="bookingFlow__doctorBadgeAvatar">
                        {instagramHandle ? (
                            <Image src={avatarUrl(instagramHandle, fullName)} alt={publicName} width={76} height={76} unoptimized style={doctorAvatarStyle(fullName)} />
                        ) : (
                            <span className="bookingFlow__doctorBadgeFallback">{fullName.charAt(0).toUpperCase()}</span>
                        )}
                    </span>
                ),
            };
        });
    }, [activeDoctorSlug, doctorSelections, filtered, isBookingSelect, onDoctorSelect, unit?.slug]);

    if (!unitLabel && !showAllDirectoryWithoutUnit) {
        return (
            <>
                <p className="sectionSub">
                    Escolha uma unidade para ver a equipe daquele local ou abra a página de especialistas para comparar os perfis com calma.
                </p>
                <UnitQuickButtons placement="doctors_quick" />
                <div className="decisionCard__linksRow decisionCard__linksRow--spaced">
                    <Link className="decisionCard__secondary" href="/doutores">
                        Ver especialistas
                    </Link>
                    <Link className="decisionCard__primary" href="/agendamento">
                        Ir para o agendamento
                    </Link>
                </div>
            </>
        );
    }

    const selectedUnitSubtitle = showAllDirectoryWithoutUnit
        ? <p className="sectionSub">Veja em quais unidades cada doutor atende e siga para o agendamento quando encontrar a melhor opção para você.</p>
        : isBookingCompact
            ? null
            : isBookingSelect
                ? null
                : <p className="sectionSub">Conheça nossos especialistas, veja os perfis e escolha com mais tranquilidade.</p>;

    if (compactItems === null && isCompactVariant) {
        return (
            <>
                {selectedUnitSubtitle}
                <div className="card doctorGridLoading" aria-hidden="true">
                    <span className="doctorGridLoading__avatar" />
                    <div className="doctorGridLoading__copy">
                        <span className="doctorGridLoading__line doctorGridLoading__line--title" />
                        <span className="doctorGridLoading__line" />
                    </div>
                </div>
            </>
        );
    }

    if (!isCompactVariant && filtered === null) {
        return (
            <>
                {selectedUnitSubtitle}
                <div className="card doctorGridLoading" aria-hidden="true">
                    <span className="doctorGridLoading__avatar" />
                    <div className="doctorGridLoading__copy">
                        <span className="doctorGridLoading__line doctorGridLoading__line--title" />
                        <span className="doctorGridLoading__line" />
                    </div>
                </div>
            </>
        );
    }

    if ((isCompactVariant ? compactItems?.length ?? 0 : filtered?.length ?? 0) === 0) {
        return (
            <>
                {selectedUnitSubtitle}
                <div className="card">
                    {membersError ? "Os especialistas desta unidade voltam a aparecer em instantes." : `Nenhum especialista encontrado para ${unitLabel}.`}
                </div>
            </>
        );
    }

    if (isCompactVariant) {
        return (
            <>
                {selectedUnitSubtitle}
                <UnitDoctorsCompactRail
                    interactionMode={isBookingSelect ? "select" : "actions"}
                    items={compactItems ?? []}
                    embedded={isBookingSelect}
                />
                {isBookingCompact ? <DoctorInstagramModal profile={activeInstagram} onClose={() => setActiveInstagram(null)} /> : null}
            </>
        );
    }

    const directoryDoctors = filtered ?? [];

    return (
        <>
            {selectedUnitSubtitle}
            <div className="grid doctorDirectoryGrid">
                {directoryDoctors.map((d) => {
                    const fullName = d.name;
                    const handle = d.instagramHandle;
                    const href = d.instagramUrl;
                    const instagramHandle = handle || extractInstagramHandle(href);
                    const doctorSlug = canonicalDoctorSlugForMember({ name: fullName, instagramHandle: handle });
                    const profileHref = `/doutores/${encodeURIComponent(doctorSlug)}`;
                    const bookingHref = unit?.slug
                        ? `/agendamento?unit=${encodeURIComponent(unit.slug)}&doctor=${encodeURIComponent(doctorSlug)}`
                        : `/agendamento?doctor=${encodeURIComponent(doctorSlug)}`;
                    const publicName = resolveDoctorPublicName(fullName);
                    const directoryUnitLabel = showAllDirectoryWithoutUnit
                        ? d.units.filter(Boolean).join(" • ") || "Rede Espaço Facial"
                        : unitLabel;
                    const directoryUnitTitle = directoryUnitLabel ?? undefined;
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
                                                <Image src={avatarUrl(instagramHandle, fullName)} alt={publicName} width={56} height={56} unoptimized style={doctorAvatarStyle(fullName)} />
                                            ) : (
                                                <span className="doctorDirectoryCard__avatarFallback">{fullName.charAt(0).toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div className="doctorDirectoryCard__meta">
                                            <h3 className="doctorDirectoryCard__name" title={publicName}>{publicName}</h3>
                                            <p className="doctorDirectoryCard__sub" title={directoryUnitTitle}>{directoryUnitLabel}</p>
                                        </div>
                                    </button>
                                ) : (
                                    <div className="doctorDirectoryCard__profile doctorCardMainLink" aria-label={publicName}>
                                        <div className="doctorDirectoryCard__avatar">
                                            {instagramHandle ? (
                                                <Image src={avatarUrl(instagramHandle, fullName)} alt={publicName} width={56} height={56} unoptimized style={doctorAvatarStyle(fullName)} />
                                            ) : (
                                                <span className="doctorDirectoryCard__avatarFallback">{fullName.charAt(0).toUpperCase()}</span>
                                            )}
                                        </div>
                                        <div className="doctorDirectoryCard__meta">
                                            <h3 className="doctorDirectoryCard__name" title={publicName}>{publicName}</h3>
                                            <p className="doctorDirectoryCard__sub" title={directoryUnitTitle}>{directoryUnitLabel}</p>
                                        </div>
                                    </div>
                                )}

                                <div className="doctorDirectoryCard__actions">
                                    <Link
                                        className="doctorDirectoryCard__profileLink"
                                        href={profileHref}
                                        aria-label={`Ver perfil de ${fullName}`}
                                        title="Ver perfil"
                                    >
                                        Perfil
                                    </Link>
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
