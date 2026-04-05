const LOCAL_DOCTOR_AVATARS_BY_NAME: Record<string, string> = {
    "marcelo gomes": "/images/doctors/marcelo-gomes.jpeg",
    "marcelo soares": "/images/doctors/marcelo-gomes.jpeg",
    "marcelo gomes soares": "/images/doctors/marcelo-gomes.jpeg",
    "vinicius vieira": "/images/doctors/vinicius-vieira.jpeg",
    "gabriela menegat": "/images/doctors/gabriela-menegat.jpeg",
    "josiele de souza": "/images/doctors/josiele-de-souza.jpeg",
    "marina lima": "/images/doctors/marina-lima.jpeg",
    "raul junior": "/images/doctors/raul-junior.jpeg",
    "raul rosario junior": "/images/doctors/raul-junior.jpeg",
    "viviane mondin": "/images/doctors/viviane-mondin.jpeg",
};

const LOCAL_DOCTOR_AVATARS_BY_HANDLE: Record<string, string> = {
    drviniciusvieira: "/images/doctors/vinicius-vieira.jpeg",
    dragabrielamenegat: "/images/doctors/gabriela-menegat.jpeg",
    drajosielesouza: "/images/doctors/josiele-de-souza.jpeg",
    dramarinalima: "/images/doctors/marina-lima.jpeg",
    dravivianemondin: "/images/doctors/viviane-mondin.jpeg",
    drmarcelogomes: "/images/doctors/marcelo-gomes.jpeg",
    drmarcelogsoares: "/images/doctors/marcelo-gomes.jpeg",
    drmarcelogomessoares: "/images/doctors/marcelo-gomes.jpeg",
    marcelogsoares: "/images/doctors/marcelo-gomes.jpeg",
    marcelogomessoares: "/images/doctors/marcelo-gomes.jpeg",
    drrauljunior: "/images/doctors/raul-junior.jpeg",
    drrauljuniior: "/images/doctors/raul-junior.jpeg",
    drraulrosariojunior: "/images/doctors/raul-junior.jpeg",
    raulrosariojunior: "/images/doctors/raul-junior.jpeg",
};

function normalizeHandle(handle: string | null | undefined): string {
    if (!handle) return "";
    return handle
        .trim()
        .toLowerCase()
        .replace(/^@/, "")
        .replace(/[^a-z0-9._]/g, "");
}

function normalizeDoctorName(name: string): string {
    return name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\b(dr\.?|dra\.?|doutor|doutora)\b/g, " ")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeHandleLookupKey(handle: string): string {
    return handle.replace(/[._]/g, "");
}

function findAvatarByName(normalizedName: string): string | null {
    const exact = LOCAL_DOCTOR_AVATARS_BY_NAME[normalizedName];
    if (exact) return exact;

    const nameTokens = normalizedName.split(" ").filter(Boolean);
    if (nameTokens.length < 2) return null;

    for (const [alias, avatar] of Object.entries(LOCAL_DOCTOR_AVATARS_BY_NAME)) {
        const aliasTokens = alias.split(" ").filter(Boolean);
        if (aliasTokens.length < 2) continue;
        if (aliasTokens.every((token) => nameTokens.includes(token))) {
            return avatar;
        }
    }

    return null;
}

export function resolveDoctorAvatarUrl(handle: string, name: string): string {
    const normalizedHandle = normalizeHandle(handle);
    const byHandle =
        LOCAL_DOCTOR_AVATARS_BY_HANDLE[normalizedHandle] ??
        LOCAL_DOCTOR_AVATARS_BY_HANDLE[normalizeHandleLookupKey(normalizedHandle)];
    if (byHandle) return byHandle;

    const normalizedName = normalizeDoctorName(name);
    const byName = findAvatarByName(normalizedName);
    if (byName) return byName;

    return `/api/instagram-avatar?handle=${encodeURIComponent(handle)}&name=${encodeURIComponent(name)}`;
}
