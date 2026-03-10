import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Uso",
  description:
    "Termos de uso do site da Espaço Facial com orientações de uso, informações de atendimento e canais oficiais.",
  robots: { index: true, follow: true },
  alternates: {
    canonical: "/termos",
  },
  openGraph: {
    title: "Termos de Uso | Espaço Facial",
    description:
      "Termos de uso do site da Espaço Facial com orientações de uso, informações de atendimento e canais oficiais.",
    url: "/termos",
    type: "website",
  },
};

export default function TermsPage() {
  return (
    <main className="container" style={{ padding: "32px 0 60px", maxWidth: 860 }}>
      <h1 style={{ marginTop: 0 }}>Termos de Uso</h1>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Uso do site</h2>
        <p>
          Este site tem finalidade informativa e de solicitacao de agendamento. O envio de um pedido
          de agendamento nao garante confirmacao imediata; a confirmacao ocorre por WhatsApp.
        </p>

        <h2 style={{ fontSize: 18 }}>Informacoes</h2>
        <p>
          Mantemos o conteudo atualizado sempre que possivel, mas informacoes podem mudar sem aviso
          (ex.: equipe, horarios e servicos).
        </p>

        <h2 style={{ fontSize: 18 }}>Conduta</h2>
        <p>
          Nao utilize este site para envio de informacoes sensiveis. Para casos urgentes, utilize os
          canais oficiais de contato.
        </p>

        <h2 style={{ fontSize: 18 }}>Contato</h2>
        <p style={{ marginBottom: 0 }}>
          BarraShoppingSul: barrashoppingsul@espacofacial.com.br • +55 (51) 98088-2293
          <br />
          Novo Hamburgo: novohamburgo@espacofacial.com.br • +55 (51) 99581-1008
        </p>
      </div>

      <p className="small" style={{ marginTop: 14 }}>
        Nota: este texto e um resumo operacional e deve ser revisado/ajustado pelo responsavel
        juridico do projeto.
      </p>
    </main>
  );
}
