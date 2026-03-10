import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacidade e Cookies",
  description:
    "Política de privacidade e cookies da Espaço Facial com transparência sobre coleta, uso e proteção de dados.",
  robots: { index: true, follow: true },
  alternates: {
    canonical: "/privacidade",
  },
  openGraph: {
    title: "Privacidade e Cookies | Espaço Facial",
    description:
      "Política de privacidade e cookies da Espaço Facial com transparência sobre coleta, uso e proteção de dados.",
    url: "/privacidade",
    type: "website",
  },
};

export default function PrivacyPage() {
  return (
    <main className="container" style={{ padding: "32px 0 60px", maxWidth: 860 }}>
      <h1 style={{ marginTop: 0 }}>Privacidade e Cookies</h1>

      <p style={{ color: "var(--muted)" }}>
        Esta politica descreve como coletamos e usamos dados pessoais e cookies no site Espaco Facial,
        em conformidade com a LGPD (Lei 13.709/2018).
      </p>

      <div className="card" style={{ padding: 18 }}>
        <h2 style={{ marginTop: 0, fontSize: 18 }}>Controladores</h2>
        <p>
          Skincare &amp; Cosmetics Ltda. (CNPJ 50.090.741/0001-89)
          <br />
          Skincare &amp; Cosmetics POA Ltda. (CNPJ 54.425.741/0001-43)
          <br />
          Endereco: Av. Doutor Mauricio Cardoso, 1126, Novo Hamburgo/RS, 93548-515.
        </p>

        <h2 style={{ fontSize: 18 }}>Responsavel / Encarregado</h2>
        <p>
          Julian Benito Garcia
          <br />
          jubenitogarcia@skincos.com.br • (51) 99510-3563
        </p>

        <h2 style={{ fontSize: 18 }}>Dados que podemos coletar</h2>
        <ul>
          <li>Identificacao e contato: nome, telefone/WhatsApp, unidade de interesse.</li>
          <li>Dados de agendamento e atendimento: horarios, unidade, profissional, observacoes.</li>
          <li>Dados de navegacao: paginas visitadas, cliques, origem de trafego e campanhas.</li>
          <li>Dados tecnicos: IP, dispositivo, navegador, sistema operacional, fuso horario.</li>
          <li>Cookies e IDs de publicidade, quando houver consentimento.</li>
        </ul>

        <h2 style={{ fontSize: 18 }}>Finalidades de uso</h2>
        <ul>
          <li>Atendimento, agendamento e confirmacoes de contato.</li>
          <li>Analise de uso do site, desempenho e melhoria de experiencia.</li>
          <li>Marketing, remarketing e medicao de campanhas (com consentimento).</li>
          <li>Seguranca, prevencao a fraudes e garantia de funcionamento.</li>
        </ul>

        <h2 style={{ fontSize: 18 }}>Bases legais</h2>
        <ul>
          <li>Consentimento: cookies e tecnologias de analise/marketing.</li>
          <li>Execucao de contrato ou procedimentos preliminares: agendamentos e atendimentos.</li>
          <li>Legitimo interesse: seguranca, estatisticas agregadas e melhoria do servico.</li>
          <li>Cumprimento de obrigacao legal e regulatoria, quando aplicavel.</li>
        </ul>

        <h2 style={{ fontSize: 18 }} id="cookies">Cookies e tecnologias</h2>
        <p>
          Usamos cookies essenciais para funcionamento do site. Cookies de analise e marketing so
          sao ativados com seu consentimento. Voce pode aceitar, rejeitar ou personalizar suas
          preferencias a qualquer momento.
        </p>
        <p>Para ajustar suas escolhas, use o link “Gerenciar cookies” no rodape.</p>
        <ul>
          <li>Essenciais: funcionamento e preferencias basicas.</li>
          <li>Analise: medir acessos e navegacao (ex.: Google Analytics 4).</li>
          <li>Marketing/Remarketing: medir campanhas e audiencias (ex.: Google Ads, Meta).</li>
        </ul>

        <h2 style={{ fontSize: 18 }}>Fornecedores e compartilhamento</h2>
        <p>
          Utilizamos Google Ads, Google Analytics, Google Tag Manager e Meta Business Suite (Meta
          Pixel) para medicao e marketing. Esses fornecedores podem tratar dados para prestacao
          dos servicos, nos limites da LGPD e de seus proprios termos.
        </p>

        <h2 style={{ fontSize: 18 }}>Transferencia internacional</h2>
        <p>
          Alguns fornecedores podem armazenar ou processar dados fora do Brasil. Quando aplicavel,
          adotamos medidas contratuais e tecnicas para garantir nivel adequado de protecao.
        </p>

        <h2 style={{ fontSize: 18 }}>Retencao</h2>
        <p>
          Mantemos dados apenas pelo tempo necessario para as finalidades acima e para cumprir
          obrigacoes legais e regulatórias.
        </p>

        <h2 style={{ fontSize: 18 }}>Direitos do titular</h2>
        <p>
          Voce pode solicitar confirmacao de tratamento, acesso, correcao, anonimização, portabilidade,
          revogacao de consentimento e exclusao de dados, conforme a LGPD, pelo contato do encarregado.
        </p>

        <h2 style={{ fontSize: 18 }}>Seguranca</h2>
        <p>
          Aplicamos medidas tecnicas e administrativas razoaveis para proteger os dados pessoais contra
          acessos nao autorizados, perda, alteracao ou destruicao.
        </p>

        <h2 style={{ fontSize: 18 }}>Contato</h2>
        <p style={{ marginBottom: 0 }}>
          BarraShoppingSul: barrashoppingsul@espacofacial.com.br • +55 (51) 98088-2293
          <br />
          Novo Hamburgo: novohamburgo@espacofacial.com.br • +55 (51) 99581-1008
        </p>
      </div>

      <p className="small" style={{ marginTop: 14 }}>
        Ultima atualizacao: 02/03/2026.
        <br />
        Nota: este texto e um resumo operacional e deve ser revisado/ajustado pelo responsavel
        juridico do projeto.
      </p>
    </main>
  );
}
