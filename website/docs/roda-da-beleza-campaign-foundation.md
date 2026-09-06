# Roda da Beleza — fundação da próxima campanha

## Estado atual

Esta fundação cria apenas um contrato público versionado e uma rota de leitura
desligada por padrão:

`GET /api/public/campaigns/roda-da-beleza/v1`

Enquanto não houver uma campanha aprovada, a rota responde `503` com
`campaign_unavailable`. Ela não lê cookies, query strings, variáveis de
ambiente, D1, segredos, dados pessoais ou o catálogo legado. Ela não é uma
troca de tráfego para `/cadastro`, `/roleta`, `/roda-da-beleza` ou
`/rodadabeleza`.

O componente e as APIs atuais de cadastro são uma referência de experiência
legada, não a fonte para uma nova campanha. Eles usam `BOOKING_DB`, persistem
nome, telefone e e-mail, e ainda não carregam um aceite próprio versionado da
campanha. Não reutilizá-los para a ativação nova.

## Limite deste change

Incluído:

- contrato público `roda-da-beleza-public/v1`, sem catálogo comercial;
- endpoint somente de leitura, privado no cache e fail-closed;
- testes de isolamento contra dependências de cadastro, Booking, cookies,
  D1, segredos e configuração de runtime;
- este roteiro para transformar a fundação em campanha operacional.

Excluído deliberadamente:

- catálogo, preço, desconto, sorteio, estoque ou texto promocional;
- formulário, cadastro, WhatsApp, conversão, pixel, CAPI e links de mídia;
- binding, database ID, migration aplicada, seed, secret, workflow ou deploy
  externo;
- troca, remoção ou alteração do fluxo de cadastro existente.

## Contrato público v1

Uma futura resposta disponível terá somente dados publicáveis:

```json
{
  "ok": true,
  "contractVersion": "roda-da-beleza-public/v1",
  "campaign": {
    "id": "roda-da-beleza",
    "title": "...",
    "termsVersion": "...",
    "capabilities": { "catalog": true, "enrollment": false, "award": false },
    "offers": [{ "code": "...", "title": "...", "description": "...", "termsVersion": "..." }]
  }
}
```

Nunca incluir identificador de lead, nome, e-mail, telefone, prêmio individual,
token, validade de sessão, replay ou destino individual de WhatsApp nessa
resposta. Cadastro, autenticação de participação e atribuição de oferta são
contratos separados e só podem existir depois dos controles abaixo.

## Pré-requisitos de ativação

### 1. Brief comercial e jurídico aprovado

Registrar em um artefato revisável, antes de criar ofertas ou tela pública:

| Tema | Definição necessária |
| --- | --- |
| Janela | início, fim, timezone, encerramento e unidades participantes |
| Mecânica | elegibilidade, uma participação por campanha, aleatoriedade, disputa e auditoria |
| Ofertas | código, texto exato, preço/condição, peso, estoque, teto por unidade, validade e exceções |
| Atendimento | número oficial, mensagem por oferta, responsável, SLA e fluxo de contestação |
| Regulamento | versão, URL pública, condições, restrições, eventual enquadramento promocional e responsável jurídico |
| Dados | finalidade, base legal, retenção, descarte, canal LGPD e opt-outs independentes para operação, marketing e medição |
| Mídia | URL canônica, UTMs obrigatórias, criativos, consentimento de marketing e eventos permitidos |

Nenhum valor desta tabela pode ser inferido do catálogo legado ou de campanhas
anteriores.

### 1.1. Decisão de enquadramento antes de desenhar a mecânica

Uma animação de roleta não define, por si só, o enquadramento jurídico da
campanha. Antes de configurar catálogo, tela, banco ou tráfego, o responsável
comercial e jurídico deve anexar uma das evidências abaixo ao artefato da
campanha:

1. **Promoção comercial com elemento aleatório:** certificado de autorização
   emitido pela SPA/SCPC, regulamento aprovado e versão do plano de operação.
   Esse é o caminho a tratar quando houver sorteio, vale-brinde, operação
   assemelhada, prêmio limitado ou outro resultado que não seja garantido
   objetivamente a todos os elegíveis. O certificado, a janela, a pessoa
   jurídica mandatária e as unidades aderentes precisam coincidir com a
   configuração que será publicada.
2. **Benefício determinístico:** manifestação jurídica escrita de que todo
   participante elegível receberá a mesma condição previamente definida, sem
   sorte, aleatoriedade, competição ou limitação de estoque promocional. Nesse
   caso a experiência não pode simular uma roleta que prometa prêmio, nem usar
   catálogo ponderado, sorteio ou claim escasso.

As referências públicas da SPA descrevem promoções com distribuição de prêmios
e elemento aleatório como sujeitas a autorização prévia, e distinguem delas os
benefícios concedidos objetivamente a todos os elegíveis. Elas também indicam,
em regra, antecedência de 40 a 120 dias para o protocolo; eventual redução é
decisão do órgão autorizador, não uma suposição de produto. Consulte
[Promoção Comercial — SPA](https://www.gov.br/fazenda/pt-br/composicao/orgaos/secretaria-de-premios-e-apostas/promocao-comercial/promocao-comercial)
e o [serviço de autorização no SCPC](https://www.gov.br/pt-br/servicos/obter-autorizacao-para-atividades-de-distribuicao-gratuita-de-premios-a-titulo-de-propaganda-ou-de-captacao-de-poupanca-popular?id=14880&origem=servico).

Esta fundação não classifica juridicamente a campanha. Uma resposta pública
legada, um catálogo histórico ou a ausência de um resultado em consulta pública
não comprovam que não exista certificado sob outro CNPJ, título ou mandatário;
eles nunca substituem a evidência acima.

### 2. Serviço de campanha separado

Criar uma D1 dedicada por ambiente, fora de `BOOKING_DB`, com migration
versionada aplicada por Wrangler antes do deploy. A migration futura deve ter,
no mínimo:

- campanhas e revisões imutáveis, com estado `draft`, `active`, `disabled` ou
  `closed`, janela e versão de regulamento;
- unidades e ofertas por campanha, peso, capacidade e snapshots públicos;
- participante identificado por HMAC de contato e dados pessoais cifrados,
  nunca em retorno público ou URL;
- aceite append-only com finalidade, versão do aviso, data, revogação e prazo
  de retenção;
- sessão opaca em cookie HttpOnly, HMAC próprio e expiração curta;
- prêmio único por campanha/participante e snapshot imutável da oferta e do
  regulamento;
- limitadores por identidade e IP usando valores HMAC;
- evento/auditoria sem PII em metadata.

O claim deve ocorrer integralmente no banco: sorteio feito no servidor com
CSPRNG, capacidade reservada por update/trigger condicional e constraint de
prêmio único. Repetições devem devolver o mesmo resultado canônico. Nunca
aceitar um `prizeId` enviado pelo navegador, nem usar `localStorage` ou cookie
como prova de prêmio.

### 3. Segurança, consentimento e medição

- Use chaves distintas para HMAC de sessão/identidade e cifra de PII; não
  reutilize `CADASTRO_WHEEL_SECRET` ou segredos de Booking.
- Exija origem permitida, limites de payload, rate limit e ausência de CORS
  permissivo em toda rota de escrita.
- Grave consentimento operacional, contato promocional/WhatsApp e medição
  como decisões separadas, cada uma com versão e timestamp.
- Só envie Meta/Google/CAPI após o respectivo consentimento de marketing.
- Defina previamente se o redirector de WhatsApp pode receber cada tipo de
  contexto; não coloque PII em URL, evento ou mensagem de tracking.

### 4. Liberação

1. Criar banco/binding/segredos separados para staging e produção; manter a
   flag de campanha desligada.
2. Aplicar migration e seed estritamente sintético em staging.
3. Testar contrato, origem, rate limit, replay, concorrência de capacidade,
   expiracão, revogação, consentimento e ausência de PII em logs/URLs.
4. Fazer revisão jurídica/comercial da página renderizada, regulamento e
   mensagens reais.
5. Promover o mesmo SHA após evidência de staging; só então habilitar a flag
   de produção durante a janela aprovada.
6. Para rollback, desligar a flag, preservar ledger/snapshots para auditoria e
   remover a rota de entrada de mídia. Não apagar participantes ou prêmios
   enquanto houver obrigação operacional ou jurídica.

## Evidência mínima para aceitar a campanha

- migration registrada em D1 dedicada e sem DDL em caminho de requisição;
- configuração da campanha e regulamento aprovados e versionados;
- testes automatizados de contrato, segurança, concorrência e regressão da
  roleta legada;
- smoke sintético em staging e leitura posterior do estado;
- captura da página final e validação de acessibilidade/movimento reduzido;
- evidência de promoção pelo SHA imutável e plano de rollback executável.
