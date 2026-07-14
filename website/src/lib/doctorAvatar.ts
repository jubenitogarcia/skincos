const LOCAL_DOCTOR_AVATARS_BY_NAME: Record<string, string> = {
    "marcelo gomes": "/images/doctors/marcelo-gomes.jpeg",
    "marcelo soares": "/images/doctors/marcelo-gomes.jpeg",
    "marcelo gomes soares": "/images/doctors/marcelo-gomes.jpeg",
    "vinicius vieira": "/images/doctors/vinicius-vieira.jpeg",
    "gabriela menegat": "/images/doctors/gabriela-menegat.jpeg",
    "josiele de souza": "/images/doctors/josiele-de-souza.jpeg",
    "raul junior": "/images/doctors/raul-junior.jpeg",
    "raul rosario junior": "/images/doctors/raul-junior.jpeg",
    "luize baum": "/images/doctors/luize-baum.png",
    "rafaela ferreira": "/images/doctors/rafaela-ferreira.png",
    "viviane mondin": "/images/doctors/viviane-mondin.jpeg",
};

const LOCAL_DOCTOR_AVATARS_BY_HANDLE: Record<string, string> = {
    drviniciusvieira: "/images/doctors/vinicius-vieira.jpeg",
    dragabrielamenegat: "/images/doctors/gabriela-menegat.jpeg",
    drajosielesouza: "/images/doctors/josiele-de-souza.jpeg",
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
    "dra.luizebaum": "/images/doctors/luize-baum.png",
    dralu: "/images/doctors/luize-baum.png",
    draluizebaum: "/images/doctors/luize-baum.png",
    "dra.rafaelaferreira": "/images/doctors/rafaela-ferreira.png",
    drarafa: "/images/doctors/rafaela-ferreira.png",
    drarafaelaferreira: "/images/doctors/rafaela-ferreira.png",
};

type DoctorAvatarPresentation = {
    objectPosition: string;
    scale: number;
};

const DEFAULT_DOCTOR_AVATAR_PRESENTATION: DoctorAvatarPresentation = {
    objectPosition: "50% 28%",
    scale: 1,
};

const DOCTOR_PUBLIC_NAME_BY_NORMALIZED_NAME: Record<string, string> = {
    "raul rosario junior": "Raul Júnior",
    "raul junior": "Raul Júnior",
};

const DOCTOR_AVATAR_PRESENTATION_BY_NORMALIZED_NAME: Record<string, DoctorAvatarPresentation> = {
    "marcelo soares": { objectPosition: "50% 32%", scale: 1.27 },
    "marcelo gomes": { objectPosition: "50% 32%", scale: 1.27 },
    "marcelo gomes soares": { objectPosition: "50% 32%", scale: 1.27 },
    "vinicius vieira": { objectPosition: "50% 30%", scale: 1.19 },
    "josiele de souza": { objectPosition: "50% 36%", scale: 1.08 },
    "viviane mondin": { objectPosition: "50% 41%", scale: 1.02 },
    "gabriela menegat": { objectPosition: "50% 29%", scale: 1.06 },
    "luize baum": { objectPosition: "50% 26%", scale: 1.08 },
    "rafaela ferreira": { objectPosition: "50% 24%", scale: 1.08 },
    "raul rosario junior": { objectPosition: "50% 36%", scale: 1.14 },
    "raul junior": { objectPosition: "50% 36%", scale: 1.14 },
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

function detectHonorific(name: string): "Dr." | "Dra." | null {
    if (/^\s*(dra\.?|doutora)\b/i.test(name)) return "Dra.";
    if (/^\s*(dr\.?|doutor)\b/i.test(name)) return "Dr.";
    return null;
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

export function resolveDoctorAvatarPresentation(name: string): DoctorAvatarPresentation {
    const normalizedName = normalizeDoctorName(name);
    return DOCTOR_AVATAR_PRESENTATION_BY_NORMALIZED_NAME[normalizedName] ?? DEFAULT_DOCTOR_AVATAR_PRESENTATION;
}

export function resolveDoctorPublicName(name: string): string {
    const normalizedName = normalizeDoctorName(name);
    const publicName = DOCTOR_PUBLIC_NAME_BY_NORMALIZED_NAME[normalizedName];
    if (!publicName) return name;

    const honorific = detectHonorific(name);
    return honorific ? `${honorific} ${publicName}` : publicName;
}
