# Cartas da Beleza em Movimento — pacote de fechamento da Fase 1

**Status:** template colaborativo; não aprovado para release e não é arquivo de
configuração. Os campos abaixo só devem ser marcados como confirmados quando
houver decisão explícita e uma evidência privada correspondente.

**Regra de segurança:** não preencher este arquivo com nome, WhatsApp, e-mail,
CPF, histórico, token, segredo, URL individual ou CSV real. Esses dados, quando
autorizados, permanecem no runtime privado do operador.

## 1. Identificação da campanha

| Campo | Valor/evidência | Estado |
| --- | --- | --- |
| ID interno da campanha | `[PENDENTE]` | pendente |
| Responsável pelo conteúdo | `[PENDENTE]` | pendente |
| Responsável pela operação | `[PENDENTE]` | pendente |
| Versão deste pacote | `[PENDENTE]` | pendente |
| Data da aprovação da Fase 1 | `[PENDENTE]` | pendente |

## 2. Objetivo e público

- Objetivo principal: confirmação de entrada em lista exclusiva por convite
  (**consolidado no plano**).
- Público: clientes convidados por WhatsApp, sujeito à lista sanitizada aprovada
  (**consolidado no plano**).
- Uso previsto: pré-evento por convite via WhatsApp (**consolidado no MVP**).
  QR Code/tablet e jornada pós-evento ficam fora do MVP e não estão aprovados.
- Métrica principal: `[PENDENTE]`.
- Métricas secundárias: `[PENDENTE]`.

## 3. Dados operacionais do evento

| Campo | Valor confirmado | Fonte/owner | Estado |
| --- | --- | --- | --- |
| Aniversário da unidade | 3 anos da unidade Novo Hamburgo | plano explícito da thread | consolidado; revisar copy final |
| Data(s) | `[PENDENTE]` | `[PENDENTE]` | pendente |
| Horário(s) | `[PENDENTE]` | `[PENDENTE]` | pendente |
| Turmas/sessões | `[PENDENTE]` | `[PENDENTE]` | pendente |
| Limite de participantes | até 90 — confirmar regra final | `[PENDENTE]` | pendente |
| Endereço da ação | `[PENDENTE]` | `[PENDENTE]` | pendente |
| Recepção/hospitalidade | `[PENDENTE]` | `[PENDENTE]` | pendente |
| Fotos e vídeos | `[PENDENTE — haverá / não haverá / consentimento]` | `[PENDENTE]` | pendente |
| Encerramento da campanha | `[PENDENTE — ISO-8601]` | `[PENDENTE]` | pendente |

O endereço e o contato atualmente presentes em `src/data/units.ts` são apenas
evidência da unidade no site; não fecham os valores específicos da ação.

## 4. Marcas e direção visual

| Decisão | Opção escolhida | Evidência/owner | Estado |
| --- | --- | --- | --- |
| Espaço Facial | liderança visual, Header/Footer reais | aprovação da marca | consolidado no plano |
| Velocity | nome textual no MVP; logo somente com aprovação explícita | plano explícito da thread | consolidado; logo opcional pendente |
| Ativos oficiais | `[PENDENTE — arquivo/licença/versão]` | `[PENDENTE]` | pendente |
| Tipografia | variáveis existentes do site; confirmar licença/asset oficial | `[PENDENTE]` | evidência parcial |
| Paleta | monocromática conforme guias; confirmar fonte final | guias de marca + aprovação | evidência parcial |

## 5. Benefícios e condições

As três cartas definem uma oferta por meio do resolver determinístico
`beautyMovementOutcomes.ts` (**decisão vigente**). A matriz completa e o
desempate estão em `docs/beauty-movement-combination-map.md`; o catálogo abaixo
documenta apenas as quatro ofertas comerciais aprovadas.

| Resultado | Oferta estruturada | Texto comercial | Preços fornecidos | Regras externas | Estado |
| --- | --- | --- | --- | --- | --- | --- |
| `elleva_upgrade` | Elleva 210 mg pelo valor de Elleva 150 mg | `[APROVADO NA ESPECIFICAÇÃO]` | sem preço inventado | avaliação profissional | aprovado |
| `filler_double` | Adquira 2 mL e receba 4 mL | `[APROVADO NA ESPECIFICAÇÃO]` | não fornecido | avaliação profissional | aprovado |
| `sculptra_classic_unlock` | 1 mL Restylane Classic; Sculptra R$ 2.899 → R$ 1.699 | `[APROVADO NA ESPECIFICAÇÃO]` | BRL | avaliação profissional | aprovado |
| `skinbooster_diamond_unlock` | 1 mL Restylane Skinbooster; Diamond R$ 2.099 → R$ 899 | `[APROVADO NA ESPECIFICAÇÃO]` | BRL | avaliação profissional | aprovado |

As quatro ofertas acima são o conjunto canônico desbloqueável; ainda faltam a
aprovação final de copy, validade, disponibilidade e redação jurídica da ação.
Não classificar a leitura como diagnóstico, indicação individual, prêmio
aleatório, concurso ou sorteio.

## 6. Contato e mensagens

| Campo | Valor | Estado |
| --- | --- | --- |
| WhatsApp da ação | `[PENDENTE — confirmar número da unidade]` | pendente |
| Mensagem para aula-cortesia | `[PENDENTE]` | pendente |
| Mensagem para condição comercial | `[PENDENTE]` | pendente |
| Label do CTA | `[PENDENTE]` | pendente |
| Suporte para correção de dados | `[PENDENTE]` | pendente |

## 7. Privacidade e dados

- Fonte da paleta: `[PENDENTE — manual na lista / classificação privada aprovada]`.
- Se houver dados preexistentes, finalidade, necessidade, transparência e gate
  de privacidade: `[PENDENTE]`.
- CPF e histórico de procedimentos: fora do D1, frontend, URL, relatório e
  analytics; nenhum dado bruto deve ser carregado (**consolidado no plano**).
- Campos do convite: `invite_ref`, nome, WhatsApp, e-mail já vinculado na lista,
  paleta, `velocity_benefit`, expiração e status do convite. `reward_id` é
  opcional e legado; o procedimento, desconto e condições vêm da oferta
  resolvida pelas cartas.
- Consentimento: aceite operacional separado de qualquer marketing futuro;
  redação jurídica final: `[PENDENTE]`.
- Retenção após encerramento + 90 dias: `[PENDENTE — eliminação / anonimização]`.

## 8. Pacote privado de importação

O CSV sanitizado deve permanecer fora do repositório e conter somente os
seguintes cabeçalhos permitidos (**contrato técnico consolidado; arquivo real
continua pendente**):

```text
invite_ref,name,whatsapp,email,palette,velocity_benefit,expires_at,invite_status
```

`velocity_benefit` aceita somente `none` ou `aula_cortesia_evento`. O catálogo
privado de recompensas é um JSON separado e referencia um snapshot do catálogo
canônico de procedimentos do CRM:

```ts
type RewardCatalogEntry = {
  rewardId: string;
  family: "radiancia" | "ritmo" | "conexao";
  type: "free_procedure" | "discount";
  procedureId: string;
  procedureName: string;
  discount: { kind: "percent" | "fixed"; value: number; currency: "BRL" } | null;
  displayText: string;
  validity: string;
  rules: string;
  termsVersion: string;
  approvedAt: string;
};
```

O importador rejeita `reward_id` inexistente, família incompatível, procedimento
fora do snapshot, desconto incompleto ou copy com dado sensível. CPF e histórico
de procedimentos não podem aparecer em nenhum dos arquivos de entrada.

O JSON privado de configuração deve fornecer `title`, `description`,
`invitationTitle`, `invitationText`, `partnerName`,
`whatsappMessageCourtesy`, `whatsappMessageCommercial`, `whatsappLabel`,
`conditionsLabel`, `conditionsText`, `velocityBenefitLabel`,
`velocityBenefitText` e, opcionalmente, `startsAt` em ISO-8601.

Estado do pacote: `[PENDENTE — dry-run sintético primeiro]`.

## 9. Gates técnicos e de publicação

- [ ] D1 exclusivo de staging criado e binding `BEAUTY_MOVEMENT_DB` configurada.
- [ ] D1 exclusivo de produção planejado, sem reutilizar `BOOKING_DB`.
- [ ] Chaves `BEAUTY_MOVEMENT_TOKEN_HMAC_KEY` e `BEAUTY_MOVEMENT_PII_KEY`
      separadas por ambiente.
- [ ] `BEAUTY_MOVEMENT_ALLOWED_ORIGINS` exata por ambiente.
- [ ] Migration aplicada em staging e schema/export registrados.
- [ ] Convites sintéticos válidos, expirados, revogados e repetidos testados.
- [ ] Rate limit de borda verificado.
- [ ] Rollback e retenção registrados.
- [ ] Flag server-side ativada somente na janela aprovada.

Todos os itens permanecem pendentes; a flag deve continuar `false`.

## 10. Aprovações necessárias para fechar a Fase 1

| Aprovação | Responsável | Evidência | Estado |
| --- | --- | --- | --- |
| Conteúdo editorial | `[PENDENTE]` | `[PENDENTE]` | pendente |
| Datas/turmas/endereço | `[PENDENTE]` | `[PENDENTE]` | pendente |
| Benefícios/condições | `[PENDENTE]` | `[PENDENTE]` | pendente |
| WhatsApp da ação | `[PENDENTE]` | `[PENDENTE]` | pendente |
| Velocity e ativos | `[PENDENTE]` | `[PENDENTE]` | pendente |
| Privacidade/paleta | `[PENDENTE]` | `[PENDENTE]` | pendente |
| Retenção e suporte | `[PENDENTE]` | `[PENDENTE]` | pendente |

**Critério de saída da Fase 1:** nenhum campo obrigatório acima permanece
`[PENDENTE]`, as evidências estão preservadas fora do repositório e o pacote é
versionado por uma referência de conteúdo aprovada. Só então o trabalho pode
avançar para staging sintético.
