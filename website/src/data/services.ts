export type Service = {
    id: string;
    name: string;
    subtitle?: string;
    highlightImage?: string;
};

// Catálogo base (em ordem alfabética)
export const services: Service[] = [
    { id: "bioestimulador-colageno", name: "Bioestimulador de Colágeno", highlightImage: "/images/highlights/procedures/bioestimulador-colageno.jpg" },
    { id: "botox", name: "Botox", highlightImage: "/images/highlights/procedures/botox.jpg" },
    { id: "fios-pdo", name: "Fios de PDO", subtitle: "Espiculado, Liso, Filler", highlightImage: "/images/highlights/procedures/fios-pdo.jpg" },
    { id: "hipertrofia", name: "Hipertrofia", subtitle: "GlúteoMax, PowerMúsculo", highlightImage: "/images/highlights/procedures/hipertrofia.jpg" },
    { id: "intradermoterapia", name: "Intradermoterapia", subtitle: "Microagulhamento, Peeling, Skinbooster", highlightImage: "/images/highlights/procedures/intradermoterapia.jpg" },
    { id: "outros", name: "Outros", highlightImage: "/images/highlights/procedures/outros.jpg" },
    { id: "preenchimento", name: "Preenchimento", subtitle: "Facial, Corporal", highlightImage: "/images/highlights/procedures/preenchimento.jpg" },
    { id: "rinomodelacao", name: "Rinomodelação", highlightImage: "/images/highlights/procedures/rinomodelacao.jpg" },
    { id: "tecnologia-avancada", name: "Tecnologia Avançada", subtitle: "Lavieen, Ultraformer", highlightImage: "/images/highlights/procedures/tecnologia-avancada.jpg" },
    { id: "tratamentos", name: "Tratamentos", subtitle: "Alopécia, Celulite, Estrias, Gordura Localizada", highlightImage: "/images/highlights/procedures/tratamentos.jpg" },
];

export function getServiceById(id: string | null | undefined): Service | null {
    const needle = (id ?? "").trim();
    if (!needle) return null;
    return services.find((s) => s.id === needle) ?? null;
}
