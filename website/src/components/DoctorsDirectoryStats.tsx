"use client";

import { useMemo } from "react";
import { useTeamDirectory } from "@/hooks/useTeamDirectory";

export default function DoctorsDirectoryStats() {
    const { members, loading } = useTeamDirectory();

    const stats = useMemo(() => {
        if (!members) return null;

        return {
            members: members.length,
            unitsRepresented: new Set(
                members.flatMap((member) => member.units.map((unit) => unit.trim()).filter(Boolean))
            ).size,
            instagramProfiles: members.filter((member) => member.instagramUrl).length,
        };
    }, [members]);

    const value = (input: number | null) => {
        if (loading || input === null) {
            return <span className="pageNarrative__valuePlaceholder" aria-hidden="true" />;
        }

        return String(input);
    };

    return (
        <div className="pageNarrative__stats" role="group" aria-label="Panorama da equipe">
            <div className="pageNarrative__stat">
                <strong>{value(stats?.members ?? null)}</strong>
                <span>profissionais ativos no diretório</span>
            </div>
            <div className="pageNarrative__stat">
                <strong>{value(stats?.unitsRepresented ?? null)}</strong>
                <span>unidades representadas na agenda</span>
            </div>
            <div className="pageNarrative__stat">
                <strong>{value(stats?.instagramProfiles ?? null)}</strong>
                <span>perfis com conteúdo consultável</span>
            </div>
        </div>
    );
}
