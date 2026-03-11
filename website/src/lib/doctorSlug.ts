import { doctors as marketingDoctors } from "@/data/doctors";

export type DoctorSlugInput = {
    name: string;
    instagramHandle: string | null;
};

function stripDiacritics(value: string): string {
    return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeNameAlias(value: string): string {
    return stripDiacritics(value ?? "")
        .toLowerCase()
        .replace(/\b(dr|dra|doutor|doutora)\b/g, " ")
        .replace(/[^a-z0-9]+/g, "")
        .trim();
}

function normalizeSlugAlias(value: string | null | undefined): string {
    return stripDiacritics(normalizeDoctorSlug(value))
        .replace(/[^a-z0-9]+/g, "")
        .trim();
}

export function doctorSlugFromTeamMember(member: DoctorSlugInput): string {
    const handle = (member.instagramHandle ?? "").trim();
    if (handle) return handle;
    return member.name.toLowerCase().replace(/\s+/g, "").slice(0, 50);
}

export function normalizeDoctorSlug(value: string | null | undefined): string {
    return (value ?? "").trim().toLowerCase().replace(/^@/, "");
}

export function doctorSlugAliases(member: DoctorSlugInput): string[] {
    const aliases = new Set<string>();
    const handle = normalizeDoctorSlug(member.instagramHandle);
    const slug = normalizeDoctorSlug(doctorSlugFromTeamMember(member));
    const nameAlias = normalizeNameAlias(member.name);

    if (handle) aliases.add(handle);
    if (slug) aliases.add(slug);
    if (nameAlias) aliases.add(nameAlias);

    for (const doctor of marketingDoctors) {
        if (normalizeNameAlias(doctor.name) !== nameAlias) continue;
        aliases.add(normalizeDoctorSlug(doctor.slug));
    }

    return Array.from(aliases).filter(Boolean);
}

export function doctorSlugMatchesQuery(query: string | null | undefined, member: DoctorSlugInput): boolean {
    const queryAlias = normalizeSlugAlias(query);
    if (!queryAlias) return false;
    return doctorSlugAliases(member).some((alias) => normalizeSlugAlias(alias) === queryAlias);
}
