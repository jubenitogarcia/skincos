const DESTINATIONS: Record<string, string> = {
    bss: "https://api.whatsapp.com/send?phone=5551980882293&text=Quero%20agendar%20um%20hor%C3%A1rio%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
    nh: "https://api.whatsapp.com/send?phone=5551995811008&text=Quero%20agendar%20um%20hor%C3%A1rio%20na%20Espa%C3%A7o%20Facial%21%20%F0%9F%93%85",
};

const UNIT_TO_SIGLA: Record<string, keyof typeof DESTINATIONS> = {
    // siglas
    bss: "bss",
    nh: "nh",

    // slugs (com e sem hífen)
    barrashoppingsul: "bss",
    "novo-hamburgo": "nh",
    novohamburgo: "nh",
};

function normalize(input: string): string {
    return input.trim().toLowerCase();
}

export function resolveFaleConoscoDestination(unitOrSigla: string): string | null {
    const key = normalize(unitOrSigla);
    const sigla = UNIT_TO_SIGLA[key];
    if (!sigla) return null;
    return DESTINATIONS[sigla] ?? null;
}
