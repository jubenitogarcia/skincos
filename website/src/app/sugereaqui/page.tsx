import SugereAquiForm from "@/components/SugereAquiForm";

export const metadata = {
    title: "Sugestões e Reclamações | Espaço Facial",
    description: "Canal interno para sugestões e reclamações da equipe.",
    robots: {
        index: false,
        follow: false,
    },
};

export default function SugereAquiPage() {
    return (
        <main className="container" style={{ padding: "32px 16px", maxWidth: 860 }}>
            <h1 style={{ fontSize: 28, marginBottom: 8 }}>Sugestões e Reclamações</h1>
            <p style={{ marginTop: 0, opacity: 0.85 }}>
                Canal interno da equipe. Use este formulário para registrar sugestões, melhorias e
                reclamações operacionais.
            </p>

            <SugereAquiForm />

            <p style={{ marginTop: 24, fontSize: 12, opacity: 0.75 }}>
                Privacidade: evite inserir dados sensíveis de pacientes. Se precisar tratar um caso
                específico, use os canais internos apropriados.
            </p>
        </main>
    );
}
