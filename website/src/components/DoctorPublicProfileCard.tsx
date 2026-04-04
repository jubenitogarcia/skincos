"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import { trackDoctorInstagramClick } from "@/lib/leadTracking";

type InstagramMedia = {
    id: string;
    thumbnailUrl: string;
    permalink: string | null;
};

type PublicProfileState = {
    bio: string | null;
    items: InstagramMedia[];
    loading: boolean;
    error: boolean;
};

type DoctorPublicProfileCardProps = {
    name: string;
    handle: string | null;
    instagramUrl: string | null;
    roleLabel: string;
    availabilityLabel: string;
    unitLabels: string[];
};

function avatarUrl(handle: string, name: string) {
    return `/api/instagram-avatar?handle=${encodeURIComponent(handle)}&name=${encodeURIComponent(name)}`;
}

export default function DoctorPublicProfileCard({
    name,
    handle,
    instagramUrl,
    roleLabel,
    availabilityLabel,
    unitLabels,
}: DoctorPublicProfileCardProps) {
    const [state, setState] = useState<PublicProfileState>({
        bio: null,
        items: [],
        loading: Boolean(handle),
        error: false,
    });

    useEffect(() => {
        let cancelled = false;

        async function loadProfile() {
            if (!handle) {
                setState({ bio: null, items: [], loading: false, error: false });
                return;
            }

            try {
                const response = await fetch(`/api/instagram-feed?handle=${encodeURIComponent(handle)}&count=3`, {
                    cache: "no-store",
                });
                const json = (await response.json().catch(() => null)) as
                    | {
                          ok: true;
                          user?: { bio?: string | null };
                          items?: Array<{ id: string; thumbnailUrl: string; permalink?: string | null }>;
                      }
                    | { ok: false; error?: string }
                    | null;

                if (cancelled) return;
                if (!json || json.ok !== true) {
                    setState({ bio: null, items: [], loading: false, error: true });
                    return;
                }

                const items = Array.isArray(json.items)
                    ? json.items
                          .filter((item) => item && typeof item.thumbnailUrl === "string" && item.thumbnailUrl.trim())
                          .slice(0, 3)
                          .map((item) => ({
                              id: item.id,
                              thumbnailUrl: item.thumbnailUrl,
                              permalink: item.permalink ?? null,
                          }))
                    : [];

                setState({
                    bio: typeof json.user?.bio === "string" && json.user.bio.trim() ? json.user.bio.trim() : null,
                    items,
                    loading: false,
                    error: false,
                });
            } catch {
                if (!cancelled) {
                    setState({ bio: null, items: [], loading: false, error: true });
                }
            }
        }

        void loadProfile();
        return () => {
            cancelled = true;
        };
    }, [handle]);

    const publicSignals = useMemo(
        () =>
            [
                roleLabel,
                availabilityLabel,
                unitLabels.length ? unitLabels.join(" • ") : null,
                handle ? `@${handle}` : null,
            ].filter(Boolean) as string[],
        [availabilityLabel, handle, roleLabel, unitLabels],
    );

    const href = instagramUrl ?? (handle ? `https://www.instagram.com/${handle}/` : null);

    return (
        <div className="doctorPublicProfile">
            <div className="doctorPublicProfile__head">
                <div className="doctorPublicProfile__identity">
                    {handle ? (
                        <div className="doctorPublicProfile__avatar">
                            <Image src={avatarUrl(handle, name)} alt={name} width={84} height={84} unoptimized />
                        </div>
                    ) : (
                        <div className="doctorPublicProfile__avatar doctorPublicProfile__avatar--fallback" aria-hidden="true">
                            {name.charAt(0).toUpperCase()}
                        </div>
                    )}

                    <div className="doctorPublicProfile__copy">
                        <span className="doctorPublicProfile__eyebrow">Especialista</span>
                        <strong>{name}</strong>
                        <p>
                            {state.bio
                                ? state.bio
                                : state.loading
                                  ? "Carregando informações do especialista."
                                  : "Se o conteúdo do perfil não estiver disponível agora, você ainda pode conhecer este especialista pelo Instagram ou seguir para o agendamento."}
                        </p>
                    </div>
                </div>

                {href ? (
                    <a
                        href={href}
                        className="decisionCard__secondary"
                        target="_blank"
                        rel="noreferrer"
                        onClick={() =>
                            trackDoctorInstagramClick({
                                unitSlug: null,
                                doctorName: name,
                                instagramUrl: href,
                            })
                        }
                    >
                        Ver Instagram
                    </a>
                ) : null}
            </div>

            <div className="decisionCard__meta">
                {publicSignals.map((signal) => (
                    <span key={signal} className="decisionCard__metaItem">
                        {signal}
                    </span>
                ))}
            </div>

            {state.items.length ? (
                <div className="doctorPublicProfile__gallery" aria-label="Publicações recentes do especialista">
                    {state.items.map((item, index) => {
                        const thumb = (
                            <Image
                                src={item.thumbnailUrl}
                                alt={`Prévia pública ${index + 1} de ${name}`}
                                width={220}
                                height={220}
                                unoptimized
                            />
                        );

                        return item.permalink ? (
                            <a
                                key={item.id}
                                href={item.permalink}
                                className="doctorPublicProfile__thumb"
                                target="_blank"
                                rel="noreferrer"
                                onClick={() =>
                                    trackDoctorInstagramClick({
                                        unitSlug: null,
                                        doctorName: name,
                                        instagramUrl: item.permalink ?? href ?? "",
                                    })
                                }
                            >
                                {thumb}
                            </a>
                        ) : (
                            <div key={item.id} className="doctorPublicProfile__thumb">
                                {thumb}
                            </div>
                        );
                    })}
                </div>
            ) : null}

            {!state.loading && state.error ? (
                <p className="doctorPublicProfile__note">
                    Não foi possível carregar as publicações agora. Você ainda pode seguir pelo Instagram ou pelo agendamento.
                </p>
            ) : null}
        </div>
    );
}
