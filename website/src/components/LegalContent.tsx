import Link from "next/link";

function SummaryBox({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="card"
      style={{
        padding: 18,
        borderLeft: "4px solid var(--accent, #c5a46d)",
        marginBottom: 18,
      }}
    >
      {children}
    </div>
  );
}

function LegalLayout({
  title,
  subtitle,
  children,
  updatedAt,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  updatedAt: string;
}) {
  return (
    <main className="container" style={{ padding: "32px 0 60px", maxWidth: 920 }}>
      <h1 style={{ marginTop: 0 }}>{title}</h1>
      <p style={{ color: "var(--muted)", marginBottom: 20 }}>{subtitle}</p>
      {children}
      <p className="small" style={{ marginTop: 16 }}>
        Última atualização: {updatedAt}.
      </p>
    </main>
  );
}

export function SkincosHubPage() {
  return (
    <main className="container" style={{ padding: "48px 0 72px", maxWidth: 980 }}>
      <section
        className="card"
        style={{
          padding: 28,
          display: "grid",
          gap: 18,
          background:
            "linear-gradient(135deg, rgba(10,22,35,0.96) 0%, rgba(18,38,57,0.92) 55%, rgba(32,60,84,0.9) 100%)",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            width: "fit-content",
            padding: "7px 12px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.08)",
            color: "#f5efe6",
            fontSize: 12,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
          }}
        >
          SKINCOS
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: "clamp(2rem, 5vw, 3.4rem)" }}>ORB by SKINCOS</h1>
          <p style={{ margin: 0, fontSize: 18, color: "rgba(255,255,255,0.82)", maxWidth: 780 }}>
            ORB by SKINCOS é o ambiente operacional em desenvolvimento para integrações com Meta,
            automações de Facebook, Instagram, Threads e WhatsApp, além de rotinas internas de
            marketing, comunicação e operação.
          </p>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 14,
          }}
        >
          <div className="card" style={{ padding: 18 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Domínio institucional</h2>
            <p style={{ marginBottom: 0 }}>
              <strong>skincos.com.br</strong> concentra as páginas institucionais e jurídicas da
              SKINCOS e do app.
            </p>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Domínio operacional</h2>
            <p style={{ marginBottom: 0 }}>
              <strong>orb.skincos.com.br</strong>, <strong>crm.skincos.com.br</strong> e{" "}
              <strong>wa.skincos.com.br</strong> são usados como subdomínios técnicos e
              operacionais da SKINCOS.
            </p>
          </div>

          <div className="card" style={{ padding: 18 }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Categoria do app</h2>
            <p style={{ marginBottom: 0 }}>
              Utilitários e produtividade, com foco atual em uso interno e expansão futura do
              produto.
            </p>
          </div>
        </div>
      </section>

      <section style={{ marginTop: 28 }}>
        <h2 style={{ fontSize: 22 }}>Páginas jurídicas</h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 14,
          }}
        >
          <Link href="/privacidade" className="card" style={{ padding: 18, textDecoration: "none" }}>
            <strong>Política de Privacidade</strong>
            <p style={{ margin: "8px 0 0" }}>
              Tratamento de dados, integrações com Meta, bases legais, retenção e segurança.
            </p>
          </Link>

          <Link href="/dados" className="card" style={{ padding: 18, textDecoration: "none" }}>
            <strong>Exclusão de Dados</strong>
            <p style={{ margin: "8px 0 0" }}>
              Instruções para solicitação de exclusão, retenções legais e canal de atendimento.
            </p>
          </Link>

          <Link href="/termos" className="card" style={{ padding: 18, textDecoration: "none" }}>
            <strong>Termos de Serviço</strong>
            <p style={{ margin: "8px 0 0" }}>
              Regras de uso do app, responsabilidades, conformidade com a Meta e limites do serviço.
            </p>
          </Link>
        </div>
      </section>
    </main>
  );
}

export function SkincosPrivacyContent() {
  return (
    <LegalLayout
      title="Política de Privacidade"
      subtitle="Esta política descreve como a SKINCOS trata dados pessoais e dados operacionais relacionados ao app ORB by SKINCOS e às integrações com plataformas da Meta."
      updatedAt="21/03/2026"
    >
      <SummaryBox>
        <strong>Resumo rápido.</strong>
        <p style={{ marginBottom: 0 }}>
          O app ORB by SKINCOS pode tratar dados de autenticação, identificadores de contas,
          páginas, campanhas, anúncios, mensagens, comentários, logs operacionais e dados técnicos
          necessários para integrações e automações. O tratamento ocorre com base na LGPD, nas
          permissões concedidas pelo usuário e nas políticas aplicáveis da Meta.
        </p>
      </SummaryBox>

      <div className="card" style={{ padding: 22 }}>
        <h2 style={{ marginTop: 0 }}>1. Quem somos</h2>
        <p>
          A SKINCOS, originada de <em>Skincare &amp; Cosmetics</em>, atua em operações ligadas a
          estética, skincare, cosméticos, CRM, automações e iniciativas digitais relacionadas à
          marca e às suas unidades.
        </p>
        <p>
          Para fins desta política, a controladora responsável pelo site e pelo app é:
          <br />
          <strong>Skincare &amp; Cosmetics Ltda.</strong> (CNPJ 50.090.741/0001-89)
          <br />
          <strong>Skincare &amp; Cosmetics POA Ltda.</strong> (CNPJ 54.425.741/0001-43)
          <br />
          Endereço de referência: Av. Doutor Maurício Cardoso, 1126, Novo Hamburgo/RS, CEP
          93548-515.
          <br />
          Contato: <a href="mailto:jubenitogarcia@skincos.com.br">jubenitogarcia@skincos.com.br</a>
        </p>

        <h2>2. Escopo desta política</h2>
        <p>
          Esta política se aplica ao domínio institucional <strong>skincos.com.br</strong>, ao app{" "}
          <strong>ORB by SKINCOS</strong> e às rotinas operacionais relacionadas às integrações com
          Facebook, Instagram, Threads e WhatsApp, quando operadas pela SKINCOS.
        </p>
        <p>
          Os subdomínios <strong>orb.skincos.com.br</strong>, <strong>crm.skincos.com.br</strong>{" "}
          e <strong>wa.skincos.com.br</strong> podem ser utilizados como ambientes técnicos e
          operacionais. As páginas jurídicas permanecem vinculadas preferencialmente ao domínio
          principal.
        </p>

        <h2>3. Quais dados podem ser tratados</h2>
        <ul>
          <li>Dados cadastrais e de contato de usuários autorizados do app.</li>
          <li>
            Identificadores de autenticação e integração, como IDs de usuário, contas comerciais,
            páginas, perfis profissionais, contas de anúncios, contas do WhatsApp Business e ativos
            vinculados.
          </li>
          <li>
            Tokens, credenciais delegadas e permissões técnicas fornecidas por plataformas parceiras,
            observadas as regras de segurança aplicáveis.
          </li>
          <li>
            Dados operacionais decorrentes do uso do app, como campanhas, anúncios, comentários,
            mensagens, respostas automáticas, logs de execução, filas, agendamentos e eventos de
            integração.
          </li>
          <li>
            Dados técnicos, como endereço IP, data e hora, navegador, dispositivo, sistema
            operacional, identificadores de sessão, falhas, auditorias e trilhas de uso.
          </li>
          <li>
            Dados eventualmente recebidos de APIs da Meta ou de terceiros autorizados, sempre dentro
            do escopo das permissões concedidas e da finalidade operacional declarada.
          </li>
        </ul>

        <h2>4. Finalidades do tratamento</h2>
        <ul>
          <li>Autenticar usuários e habilitar integrações com plataformas da Meta.</li>
          <li>
            Executar automações de publicações, comentários, mensagens, anúncios e demais fluxos
            operacionais.
          </li>
          <li>Gerenciar ativos, contas, campanhas e rotinas internas da SKINCOS.</li>
          <li>Monitorar estabilidade, desempenho, segurança e rastreabilidade do app.</li>
          <li>
            Cumprir obrigações legais, regulatórias, contratuais e requisitos das plataformas
            integradas.
          </li>
          <li>
            Desenvolver, testar, validar e futuramente expandir comercialmente o produto, sempre
            dentro dos limites legais e contratuais aplicáveis.
          </li>
        </ul>

        <h2>5. Bases legais</h2>
        <ul>
          <li>Execução de contrato e procedimentos preliminares relacionados ao serviço.</li>
          <li>
            Legítimo interesse para segurança, prevenção a fraudes, estabilidade, auditoria e
            melhoria do serviço.
          </li>
          <li>Cumprimento de obrigação legal ou regulatória, quando aplicável.</li>
          <li>
            Consentimento, quando necessário para tecnologias não essenciais, permissões específicas
            ou tratamentos facultativos.
          </li>
          <li>Exercício regular de direitos em processo judicial, administrativo ou arbitral.</li>
        </ul>

        <h2>6. Compartilhamento com terceiros e provedores</h2>
        <p>
          A SKINCOS pode compartilhar dados com provedores de infraestrutura, observabilidade,
          hospedagem, segurança, comunicação e armazenamento, além da Meta e de empresas do mesmo
          grupo econômico, sempre na medida necessária para a execução do serviço.
        </p>
        <p>
          Esse compartilhamento pode incluir Cloudflare, Meta Platforms e outros prestadores
          indispensáveis à operação técnica do app. A SKINCOS não comercializa dados pessoais fora
          do escopo operacional, contratual ou legalmente permitido.
        </p>

        <h2>7. Armazenamento e retenção</h2>
        <p>
          Os dados são mantidos pelo período necessário para cumprir as finalidades descritas nesta
          política, respeitar exigências legais, preservar segurança, auditoria, prevenção a fraudes
          e manter a continuidade operacional do app.
        </p>
        <p>
          Dados poderão ser eliminados ou anonimizados quando deixarem de ser necessários, salvo
          quando sua retenção for exigida por obrigação legal, regulatória, defesa de direitos ou
          necessidade técnica devidamente justificada.
        </p>

        <h2>8. Segurança da informação</h2>
        <p>
          A SKINCOS adota medidas técnicas e administrativas razoáveis para proteger dados contra
          acessos não autorizados, perda, destruição, vazamento, alteração ou uso indevido. Essas
          medidas podem incluir segregação de ambientes, controle de acesso, registro de logs,
          proteção de credenciais, criptografia quando aplicável e monitoramento de incidentes.
        </p>

        <h2>9. Transferência internacional</h2>
        <p>
          Parte da infraestrutura tecnológica utilizada pela SKINCOS e pelos provedores integrados
          pode envolver processamento ou armazenamento fora do Brasil. Nesses casos, a SKINCOS busca
          adotar mecanismos compatíveis com a LGPD e com padrões adequados de proteção de dados.
        </p>

        <h2>10. Direitos do titular</h2>
        <p>
          O titular pode solicitar confirmação de tratamento, acesso, correção, anonimização,
          bloqueio, eliminação, portabilidade, informação sobre compartilhamentos e revogação de
          consentimento, quando aplicável.
        </p>
        <p>
          Solicitações podem ser enviadas para{" "}
          <a href="mailto:jubenitogarcia@skincos.com.br">jubenitogarcia@skincos.com.br</a>.
        </p>

        <h2>11. Exclusão de dados</h2>
        <p>
          Instruções específicas sobre exclusão de dados do usuário estão disponíveis em{" "}
          <Link href="/dados">/dados</Link>. Essa página também pode ser utilizada como referência
          para o campo <em>Data Deletion Instructions URL</em> em integrações com a Meta.
        </p>

        <h2>12. Alterações desta política</h2>
        <p style={{ marginBottom: 0 }}>
          Esta política pode ser atualizada a qualquer tempo para refletir evoluções do app, mudanças
          regulatórias, ajustes operacionais ou novos recursos. A versão vigente sempre será a
          publicada em <strong>skincos.com.br</strong>.
        </p>
      </div>
    </LegalLayout>
  );
}

export function SkincosDataDeletionContent() {
  return (
    <LegalLayout
      title="Exclusão de Dados do Usuário"
      subtitle="Estas instruções explicam como solicitar a exclusão de dados relacionados ao app ORB by SKINCOS e às integrações operadas pela SKINCOS."
      updatedAt="21/03/2026"
    >
      <SummaryBox>
        <strong>Resumo rápido.</strong>
        <p style={{ marginBottom: 0 }}>
          Para solicitar exclusão de dados, envie um e-mail para{" "}
          <a href="mailto:jubenitogarcia@skincos.com.br">jubenitogarcia@skincos.com.br</a> com a
          identificação da conta, ativo ou integração a ser removida. A SKINCOS analisará a
          solicitação, confirmará o recebimento e executará a exclusão dentro do prazo operacional
          aplicável, ressalvadas retenções legais e de segurança.
        </p>
      </SummaryBox>

      <div className="card" style={{ padding: 22 }}>
        <h2 style={{ marginTop: 0 }}>1. Como solicitar</h2>
        <p>Envie um e-mail para <a href="mailto:jubenitogarcia@skincos.com.br">jubenitogarcia@skincos.com.br</a> com:</p>
        <ul>
          <li>nome do solicitante;</li>
          <li>e-mail de contato;</li>
          <li>identificação da conta, página, perfil, número ou ativo relacionado;</li>
          <li>descrição clara do pedido de exclusão;</li>
          <li>se aplicável, evidência de vínculo ou autorização para representar a conta.</li>
        </ul>

        <h2>2. Quais dados podem ser excluídos</h2>
        <ul>
          <li>cadastros operacionais e vínculos de integração mantidos pela SKINCOS;</li>
          <li>tokens, permissões e credenciais delegadas armazenadas para integração;</li>
          <li>logs, registros e históricos operacionais que não precisem ser mantidos;</li>
          <li>configurações de automação associadas ao usuário ou ativo solicitado;</li>
          <li>dados de mensagens, comentários ou execuções mantidos sob controle da SKINCOS, quando aplicável.</li>
        </ul>

        <h2>3. Prazo estimado</h2>
        <p>
          A SKINCOS buscará confirmar o recebimento da solicitação em até <strong>5 dias úteis</strong>{" "}
          e concluir o tratamento do pedido em até <strong>30 dias</strong>, salvo hipóteses de maior
          complexidade, necessidade de validação adicional, obrigações legais ou dependência de
          terceiros integrados.
        </p>

        <h2>4. O que pode ser mantido</h2>
        <p>Mesmo após uma solicitação de exclusão, alguns dados poderão ser retidos quando necessários para:</p>
        <ul>
          <li>cumprimento de obrigação legal, regulatória ou contratual;</li>
          <li>prevenção a fraudes, segurança e auditoria;</li>
          <li>exercício regular de direitos em processo judicial, administrativo ou arbitral;</li>
          <li>comprovação de eventos técnicos, integridade operacional e trilhas mínimas de segurança.</li>
        </ul>

        <h2>5. Integrações com a Meta</h2>
        <p>
          Quando o pedido envolver dados obtidos ou operados por meio de Facebook, Instagram, Threads
          ou WhatsApp, a SKINCOS removerá os dados sob seu controle e, quando necessário, poderá
          orientar o solicitante a revogar permissões diretamente na plataforma da Meta.
        </p>

        <h2>6. URL para a Meta</h2>
        <p>
          Esta página foi estruturada para servir como referência do campo{" "}
          <em>Data Deletion Instructions URL</em> do app na Meta for Developers.
        </p>

        <h2>7. Contato</h2>
        <p style={{ marginBottom: 0 }}>
          Canal oficial:{" "}
          <a href="mailto:jubenitogarcia@skincos.com.br">jubenitogarcia@skincos.com.br</a>
        </p>
      </div>
    </LegalLayout>
  );
}

export function SkincosTermsContent() {
  return (
    <LegalLayout
      title="Termos de Serviço"
      subtitle="Estes termos regulam o uso do app ORB by SKINCOS, do domínio institucional skincos.com.br e das integrações operadas pela SKINCOS."
      updatedAt="21/03/2026"
    >
      <SummaryBox>
        <strong>Resumo rápido.</strong>
        <p style={{ marginBottom: 0 }}>
          O app ORB by SKINCOS é um ambiente de utilidade operacional voltado a integrações,
          automações e gestão de rotinas digitais. O uso deve respeitar estes termos, a LGPD e as
          políticas da Meta e de demais plataformas integradas.
        </p>
      </SummaryBox>

      <div className="card" style={{ padding: 22 }}>
        <h2 style={{ marginTop: 0 }}>1. Objeto do serviço</h2>
        <p>
          O ORB by SKINCOS é um app e ambiente operacional destinado a automações, integrações,
          gestão de ativos digitais, rotinas de comunicação, marketing, mensagens, comentários,
          publicações, anúncios e fluxos operacionais relacionados às atividades da SKINCOS.
        </p>

        <h2>2. Escopo atual de uso</h2>
        <p>
          No estágio atual, o serviço é utilizado prioritariamente em operações internas da SKINCOS e
          de suas unidades. A SKINCOS poderá ampliar o uso comercial do produto no futuro, inclusive
          como solução oferecida a terceiros, mediante condições próprias.
        </p>

        <h2>3. Integrações com terceiros</h2>
        <p>
          O serviço pode se integrar com Facebook, Instagram, Threads, WhatsApp e outras plataformas
          de terceiros. O uso dessas integrações depende de permissões válidas, disponibilidade das
          APIs, regras externas e manutenção das credenciais adequadas.
        </p>

        <h2>4. Responsabilidades do usuário</h2>
        <ul>
          <li>fornecer informações corretas e atualizadas;</li>
          <li>usar o app apenas para finalidades legítimas e autorizadas;</li>
          <li>respeitar a legislação aplicável, incluindo LGPD e direitos de terceiros;</li>
          <li>respeitar as políticas, termos e limitações técnicas da Meta e demais plataformas;</li>
          <li>proteger credenciais, acessos e permissões de integração;</li>
          <li>não utilizar o app para spam, fraude, manipulação ilícita, abuso ou coleta indevida de dados.</li>
        </ul>

        <h2>5. Uso adequado da plataforma</h2>
        <p>É proibido utilizar o serviço para:</p>
        <ul>
          <li>automatizações em desacordo com regras das plataformas integradas;</li>
          <li>envio indevido de mensagens, comentários ou conteúdos abusivos;</li>
          <li>acesso não autorizado a contas, ativos ou dados de terceiros;</li>
          <li>tentativas de contornar restrições técnicas, limites de API ou controles de segurança;</li>
          <li>qualquer atividade ilícita, enganosa, discriminatória ou que viole direitos de terceiros.</li>
        </ul>

        <h2>6. Conformidade com políticas da Meta</h2>
        <p>
          O uso do ORB by SKINCOS deve observar as políticas aplicáveis da Meta for Developers, Meta
          Platform Terms, políticas de dados, regras de permissões, políticas de automação e demais
          documentos oficiais relacionados às integrações utilizadas.
        </p>

        <h2>7. Disponibilidade e alterações</h2>
        <p>
          A SKINCOS poderá atualizar, restringir, suspender, descontinuar ou modificar recursos do
          app a qualquer momento, inclusive por razões técnicas, operacionais, regulatórias ou
          estratégicas.
        </p>

        <h2>8. Suspensão e encerramento</h2>
        <p>
          A SKINCOS poderá suspender ou encerrar acessos quando identificar uso indevido, risco
          operacional, exigência legal, violação destes termos, violação de políticas da Meta ou
          qualquer situação que comprometa segurança, conformidade ou integridade do serviço.
        </p>

        <h2>9. Propriedade intelectual</h2>
        <p>
          O app, sua arquitetura, marca, textos, componentes, fluxos, código e materiais associados
          pertencem à SKINCOS ou a seus licenciantes, salvo direitos de terceiros. Estes termos não
          implicam cessão de propriedade intelectual.
        </p>

        <h2>10. Privacidade e dados</h2>
        <p>
          O tratamento de dados vinculado ao serviço é regido pela <Link href="/privacidade">Política
          de Privacidade</Link> e pelas <Link href="/dados">Instruções de Exclusão de Dados</Link>.
        </p>

        <h2>11. Limites de responsabilidade</h2>
        <p>
          A SKINCOS envida esforços razoáveis para manter o serviço em funcionamento, mas não garante
          disponibilidade ininterrupta, ausência de falhas ou continuidade de APIs de terceiros. A
          SKINCOS não responde por indisponibilidades, bloqueios, suspensões, mudanças de política ou
          limitações impostas por plataformas externas.
        </p>

        <h2>12. Alterações destes termos</h2>
        <p>
          Estes termos podem ser atualizados periodicamente. A versão vigente será a publicada em{" "}
          <strong>skincos.com.br</strong>.
        </p>

        <h2>13. Contato e foro</h2>
        <p style={{ marginBottom: 0 }}>
          Contato: <a href="mailto:jubenitogarcia@skincos.com.br">jubenitogarcia@skincos.com.br</a>
          <br />
          Foro sugerido para preenchimento institucional definitivo: <strong>[COMARCA / UF]</strong>.
        </p>
      </div>
    </LegalLayout>
  );
}

export function EspacofacialPrivacyContent() {
  return (
    <main className="container" style={{ padding: "32px 0 60px", maxWidth: 860 }}>
      <h1 style={{ marginTop: 0 }}>Privacidade e Cookies</h1>

      <p style={{ color: "var(--muted)" }}>
        Esta politica descreve como coletamos e usamos dados pessoais e cookies no site Espaco
        Facial, em conformidade com a LGPD (Lei 13.709/2018).
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

        <h2 style={{ fontSize: 18 }} id="cookies">
          Cookies e tecnologias
        </h2>
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
          Pixel) para medicao e marketing. Esses fornecedores podem tratar dados para prestacao dos
          servicos, nos limites da LGPD e de seus proprios termos.
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
          Voce pode solicitar confirmacao de tratamento, acesso, correcao, anonimização,
          portabilidade, revogacao de consentimento e exclusao de dados, conforme a LGPD, pelo
          contato do encarregado.
        </p>

        <h2 style={{ fontSize: 18 }}>Seguranca</h2>
        <p>
          Aplicamos medidas tecnicas e administrativas razoaveis para proteger os dados pessoais
          contra acessos nao autorizados, perda, alteracao ou destruicao.
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
      </p>
    </main>
  );
}

export function EspacofacialTermsContent() {
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

    </main>
  );
}
