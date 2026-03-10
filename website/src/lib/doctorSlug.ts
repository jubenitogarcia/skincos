export type DoctorSlugInput = {
    name: string;
    instagramHandle: string | null;
};

export function doctorSlugFromTeamMember(member: DoctorSlugInput): string {
    const handle = (member.instagramHandle ?? "").trim();
    if (handle) return handle;
    return member.name.toLowerCase().replace(/\s+/g, "").slice(0, 50);
}

export function normalizeDoctorSlug(value: string | null | undefined): string {
    return (value ?? "").trim().toLowerCase().replace(/^@/, "");
}
