export type Service = {
    id: string;
    name: string;
    subtitle?: string;
    highlightImage?: string;
};

// Catálogo base (em ordem alfabética)
export const services: Service[] = [
    { id: "bioestimulador-colageno", name: "Bioestimulador de Colágeno", subtitle: "Diamond, Elleva, Radiesse, Sculptra", highlightImage: "/images/highlights/procedures/bioestimulador-colageno.jpg" },
    { id: "botox", name: "Botox", subtitle: "Protocolos de 1 região até full face (20u - 100u). Tratamentos para bruxismo, sudorese, entre outros", highlightImage: "/images/highlights/procedures/botox.jpg" },
    { id: "fios-pdo", name: "Fios de PDO", subtitle: "Espiculado, Liso, Filler", highlightImage: "/images/highlights/procedures/fios-pdo.jpg" },
    { id: "hipertrofia", name: "Hipertrofia & Emagrecimento", subtitle: "GlúteoMax, Lipólise, PowerMúsculo", highlightImage: "/images/highlights/procedures/hipertrofia.jpg" },
    { id: "preenchimento", name: "Preenchimento", subtitle: "Facial, Corporal", highlightImage: "/images/highlights/procedures/preenchimento.jpg" },
    { id: "intradermoterapia", name: "Qualidade de Pele", subtitle: "Celulite, Estrias, Microagulhamento, Peeling, Skinbooster", highlightImage: "/images/highlights/procedures/intradermoterapia.jpg" },
    { id: "tecnologia-avancada", name: "Tecnologia Avançada", subtitle: "Lavieen, Ultraformer", highlightImage: "/images/highlights/procedures/tecnologia-avancada.jpg" },
];

export function getServiceById(id: string | null | undefined): Service | null {
    const needle = (id ?? "").trim();
    if (!needle) return null;
    return services.find((s) => s.id === needle) ?? null;
}
