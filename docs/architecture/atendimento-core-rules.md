# Núcleo técnico do Atendimento

**Estado documentado:** implementação consolidada em 2026-07-18. Este é o contrato de negócio do backend; interface, planilhas e proxy não podem redefinir os valores aqui descritos.

## Fonte de verdade

Atendimento registra produção de procedimentos, não recebimento de Caixa. O
backend PostgreSQL é a fonte de verdade: o navegador só apresenta uma prévia.

## Limites de responsabilidade e fluxo

`crm/console` envia intenção e exibe a resposta. A rota valida identidade, módulo e unidade; `store.js` normaliza referências e persiste; `domain.js` calcula estatísticas determinísticas. A planilha é fonte de importação explícita/auditável, não de recalcular histórico ao abrir um relatório. O proxy Pages transporta a solicitação e não autoriza nem calcula.

```mermaid
flowchart LR
  UI["Console"] --> API["routes.js"]
  API --> Scope["allowedModules + allowedUnits"]
  Scope --> Store["store.js"]
  Store --> Domain["domain.js"]
  Domain --> DB[("attendances/metas/profissionais")]
  DB --> Audit[("audit_events")]
```

## Valor versionado

Versão atual: `attendance-value/v1`.

```text
base = parte numérica do código normalizado (#0799 = 799)
bruto = base × quantidade × (desconto ? 0,97 : 1) − outro_valor
valor = roundValue ? arredondar bruto ao múltiplo de 10 : bruto
valor = arredondar para duas casas decimais
```

O servidor normaliza os campos e ignora qualquer `value` enviado pelo cliente.
Data inválida, quantidade não positiva, outro valor negativo e resultado
negativo são rejeitados. Cada registro armazena `value_formula_version`.

## Escritas seguras

- `POST /attendances` recebe `Idempotency-Key` (máximo 128 caracteres). A chave
  é única por autor e devolve o registro já criado em caso de repetição.
- `PATCH` e `DELETE` exigem `revision`; ausência retorna `428` e versão antiga
  retorna `409`. Cada alteração incrementa a revisão.
- Criar, editar, excluir e mover registros validam a unidade atual e a unidade
  de destino contra `allowedUnits`. Um ator não gestor sem unidade permitida não
  pode escrever.
- A auditoria preserva antes/depois, autor, versão da fórmula e se o valor do
  navegador foi ignorado.

O contrato devolve `200` para criação nova ou replay idempotente, `403` para escopo/módulo proibido, `409` para revisão desatualizada, `428` quando `revision` falta em PATCH/DELETE e `422` para referência ou campo inválido. A identidade da chave é id/usuário/email estável: papel nunca é usado como namespace de idempotência.

## Identidade de profissionais e clientes

Lançamentos manuais resolvem unidade, procedimento e profissional já existentes;
eles não criam catálogo ou alteram cadastro de equipe. O profissional precisa
estar ativo, ter o papel correto e pertencer à unidade quando houver vínculo.
Aliases confirmados são normalizados (por exemplo, Raul Júnior para Raul Rosário
Júnior); nomes parecidos sem confirmação continuam distintos.

Clientes são normalizados por unidade e `name_key`, com unicidade por unidade.
As sugestões combinam o cadastro e o histórico da mesma unidade; nunca expõem
nomes de unidade sem permissão.

## Metas, ranking e conversão

Para períodos que cruzam meses, a meta é ponderada por dias operacionais de cada
trecho. Meta ausente vale zero, sem inferência. A visão de Todas unidades soma
capacidade e meta antes de calcular o ranking; não é média de rankings locais.

`GET /management/conversion-report` é estritamente de leitura: não persiste
resultado e não completa a escala. Persistência e sincronização somente ocorrem
nas operações gerenciais explícitas de otimização/recomputação.

## Migration local de escrita segura

`crm/api/scripts/migrate-atendimento-write-safety.mjs --apply` aceita somente
o banco local `skincos_crm_local` em loopback ou socket. A migration é
versionada em `20260718_atendimento_write_safety_v1`, usa lock curto, batches de
500 linhas e índices `CONCURRENTLY`.

Registros existentes no instante de aplicação recebem
`attendance-value/legacy-imported-v0`, preservando exatamente o valor legado;
nenhum valor financeiro é recalculado. Linhas novas recebem
`attendance-value/v1`. `revision` nulo recebe `1`; `idempotency_key` legado
nulo permanece nulo e fica fora do índice parcial. O rollback é não destrutivo:
remove somente índices e constraints adicionados, mantendo colunas, auditoria e
dados para uma reaplicação segura.

## Catálogo matemático final — backend

As fórmulas abaixo são implementadas exclusivamente em
`crm/api/server/atendimento/domain.js` e
`crm/api/server/atendimento/store.js`. A interface pode antecipar valores para
UX, mas não calcula nem persiste valores de negócio.

### Grão, filtros e convenções

- **Atendimento** é uma linha ativa de `crm_atendimento.attendances`: um
  procedimento registrado, não necessariamente uma venda, cliente ou unidade
  de quantidade.
- Filtros combinados aplicam simultaneamente unidade autorizada, unidade
  escolhida, `service_date` entre `from` e `to` (inclusivos), procedimento,
  código, injetor, consultor e busca de cliente. As agregações nunca incluem
  linhas fora desse conjunto.
- **Produção** é `Σ quantity`; **faturamento** é `Σ value`. São métricas
  distintas.
- Sem linhas, agregados operacionais retornam 0. Já `k`, platô e curva retornam
  `null`/vazio quando não são aplicáveis. Meta ausente vale 0 por regra
  explícita, sem estimativa.
- Escritas manuais rejeitam quantidade não positiva, outro valor negativo e
  valor calculado negativo. Linhas históricas não são corrigidas silenciosamente.

### Métricas de atendimento e comercial

| Métrica | Fórmula backend | Origem e grão | Ausência/extremos |
| --- | --- | --- | --- |
| Valor do atendimento | `round2((codigo_numérico × quantidade × (desconto ? 0,97 : 1)) − outro_valor)`; aplica múltiplo de 10 se solicitado | campos normalizados, uma linha `attendances` | Código inválido rejeita; manual não aceita resultado negativo; histórico não é recalculado. |
| Faturamento | `Σ value` | `attendances.value`, linhas ativas filtradas | Sem linhas = 0; valores históricos zero permanecem zero. |
| Produção | `Σ quantity` | `attendances.quantity`, linhas ativas filtradas | Sem linhas = 0; manual não aceita `quantity <= 0`. |
| Ticket médio por registro | `Σ value ÷ count(linhas)` | linhas ativas filtradas | Sem linhas = 0. Não é ticket por cliente; UI usa “Média por registro”. |
| Clientes únicos | `count(distinct lower(trim(client_name)))`, ignorando vazio | `attendances.client_name`, conjunto filtrado | Sem nomes válidos = 0; identidade é nome normalizado no filtro, não CPF global. |
| Remuneração estimada | `max(total_do_profissional × 10%, R$ 212,50)` se total > 0; senão 0 | `reportPreview`, por injetor/período | Política legada `attendance-remuneration/legacy-preview-v1`, não folha de pagamento. |

Cada valor novo persiste `value_formula_version = attendance-value/v1`.
Registros anteriores à migration são `attendance-value/legacy-imported-v0`;
uma nova fórmula exige nova versão e não pode alterar esses valores.

### Metas, calendário e capacidade

| Métrica | Fórmula backend | Origem e grão | Ausência/extremos |
| --- | --- | --- | --- |
| Meta mensal de referência | nível `first`; se ausente, meta base; se ambos ausentes, 0 | `monthly_unit_goal_levels.value` / `monthly_unit_goals.value`, por unidade/mês | Nunca é inferida do faturamento. |
| Dias operacionais do mês | contagem de dias na escala operacional; sem escala, fallback por unidade | `schedule_days` e cobertura autorizada da Escala, por unidade/mês | Fechados e feriados não contam; sem dias = 0. |
| Capacidade operacional | quantidade de **unidade-dias operacionais** | soma dos dias operacionais dos segmentos | Não representa vagas, horas ou número de profissionais. |
| Meta diária | `meta_mensal ÷ dias_operacionais_do_mês`; no total, `meta_período ÷ dias_operacionais_período` | metas e calendário acima | Dia operacional 0 resulta em 0, sem divisão infinita. |
| Meta do período | `Σ(meta_diária_do_mês × dias_operacionais_do_trecho_no_mês)` | segmentos de `splitIsoDateRangeByMonth` | Meta faltante contribui 0; meses não recebem peso uniforme. |

Para um período entre meses, cada trecho preserva a meta e os dias do mês de
origem. Isto impede que uma meta mensal seja dividida pelos dias do mês errado.

### Ranking, faixas e distribuição

O universo estatístico contém injetores ativos, elegíveis e vinculados à unidade.
Cada um entra inclusive com realizado zero. A produção do ranking é a soma de
`attendances.value` por injetor/unidade/período; o total geral também inclui
linhas sem injetor e por isso pode ser maior.

| Métrica | Fórmula backend | Origem e grão | Ausência/extremos |
| --- | --- | --- | --- |
| Ranking | realizado desc, nível desc, nome pt-BR; posição = índice + 1 | profissional elegível por unidade/período | Empates têm ordem determinística, sem posição compartilhada. |
| Média | `Σ realizado_elegível ÷ quantidade_elegível` | ranking unitário/período | Sem elegíveis = 0. |
| Mediana | centro ordenado; em par, média dos dois centros | ranking unitário/período | Sem elegíveis = 0. |
| Desvio padrão | desvio padrão **amostral** dos realizados | ranking unitário/período | Menos de 2 profissionais = 0. |
| Linha de corte | `0,30×média + 0,20×mediana + 0,50×meta_diária` | estatísticas e meta diária do mesmo período | Meta ausente contribui 0; pesos entram no `configHash`. |
| Intervalo | `desvio_padrão_amostral × k` | mesma unidade/período | Desvio 0 ou `k` não aplicável resulta em 0. |
| Limites | inferior = corte − intervalo; superior = corte + intervalo | mesma unidade/período | Podem ficar fora da distribuição; status explica. |
| Níveis | N0 `x < inferior`; N1 `inferior ≤ x < corte`; N2 `corte ≤ x ≤ superior`; N3 `x > superior` | um profissional em exatamente um nível | Bordas não duplicam profissionais. |
| Razões ponderadas legadas | divisor `N1 + 2×N2 + 3×N3`; combinações ponderadas / divisor | contagens por nível | Divisor 0 retorna razões 0. |
| Lados/faixas estruturais | inferior `p0+p1`; superior `p2+p3`; centrais `p1+p2`; extremas `p0+p3` | `pi = Ni ÷ total_elegível` | Sem elegíveis = 0; são as razões compactas da UI. |
| Homogeneidade | `H = clamp(1 − (4/3)×Σ(pi − 0,25)², 0, 1)` | contagens dos quatro níveis | 25% por nível = 1; sem elegíveis = 0. |

### Multiplicador `k`, platôs e curva

`k` é buscado em `[k_min, k_max]` (padrão `[0,2]`). Os pontos de mudança são
`abs(realizado − linha_corte) ÷ desvio_padrão`; entre dois pontos consecutivos
as contagens são constantes. O backend avalia os segmentos, prioriza quatro
faixas preenchidas quando possível, senão extremos preenchidos quando possível,
e minimiza a perda de homogeneidade.

Com empate entre platôs ótimos, preserva o `k` anterior se ele permanecer no
platô. Caso contrário, escolhe o centro do platô mais largo, com desempates
determinísticos. Cada ponto da curva traz início/fim, inclusividade, contagens,
proporções, perda e `H`; ela pode ser explicada sem o gráfico. Sem dados ou sem
variância, `k`, platô e curva são não aplicáveis (`null`/lista vazia). Com menos
de quatro profissionais, o relatório sinaliza `INSUFFICIENT_DOCTORS` mesmo que
o otimizador consiga classificar valores.

### Todas unidades e calendários incompatíveis

Todas unidades é nova apuração: soma metas e unidade-dias por mês antes de
calcular meta diária, corte, níveis, `k` e homogeneidade. Nunca calcula média de
metas, tickets, cortes ou rankings unitários. Aliases confirmados são
consolidados antes do ranking global; nomes somente parecidos permanecem
separados.

Não existe calendário consolidado exibível. A seção agregada retorna
`calendarMode = per-unit-capacity-sum` e `calendarCompatible = false`: seu hash
é assinatura de dependências para auditoria, não uma agenda compartilhada.
Calendários e históricos de multiplicador são unitários.

### Pendências empresariais e guardrails

- A remuneração é política legada de prévia, versionada e marcada
  `pending_confirmation`. Antes de uso trabalhista/financeiro, a clínica precisa
  aprovar beneficiário, base, impostos, teto, vigência e estornos; isso exige
  política nova e versionada.
- Os pesos 30%/20%/50% da linha de corte são rastreáveis pelo `configHash`, mas
  a justificativa empresarial ainda deve ser formalizada antes de permitir sua
  configuração.
- O banco local contém nove linhas legadas com `quantity = 0` e valores zero.
  São preservadas por integridade de importação e precisam de saneamento
  explícito/auditado; o dashboard não as reescreve.

### Matriz de casos-limite e consolidação

| Situação | Métricas comerciais | Conversão, ranking e multiplicador |
| --- | --- | --- |
| Sem atendimentos | faturamento, produção, ticket e clientes únicos retornam 0; não se inventa valor ausente | realizados podem ser 0 para profissionais elegíveis; sem elegíveis, estatísticas e razões retornam 0 e `k`/platô/curva não se aplicam |
| Zero, negativo ou extremo | zero histórico é preservado; escrita manual rejeita quantidade não positiva, outro valor negativo e valor final negativo; valores altos continuam finitos e arredondados em centavos | zero é classificação válida; extremos ampliam desvio/limites e entram na otimização, sem truncamento silencioso |
| Um profissional elegível | ticket e totais continuam normais | média e mediana são o realizado; desvio e intervalo são 0; relatório sinaliza insuficiência para comparação de quatro faixas e não comunica falsa homogeneidade |
| Empate de profissionais | não altera agregados | ordenação é determinística por realizado, nível e nome; não há posição compartilhada implícita |
| Profissional duplicado | não altera o valor original do atendimento | somente aliases confirmados são unidos antes do ranking global; o realizado é somado. Nomes parecidos não são mesclados automaticamente |
| Meta ausente ou mês fechado | não é inferida de receita | a meta do segmento vale 0; dia operacional 0 dá meta diária 0 e evita divisão por zero |
| Todas unidades | totais são `Σ` das linhas filtradas, e ticket é `Σ valor ÷ Σ linhas`, nunca média dos tickets das unidades | metas e capacidade são somadas por unidade-mês; não existe calendário único, e `calendarCompatible=false` impede apresentar uma agenda consolidada fictícia |
| Filtros combinados | todos restringem o mesmo conjunto de linhas antes de somar ou contar | o relatório recebe o período e a unidade autorizados; as estatísticas não reutilizam resultado de outro filtro |

Os testes de domínio cobrem a fórmula de valor, remuneração versionada, aliases,
empates, estatísticas, bordas de nível, razões, homogeneidade, platôs, ausência
de variância e períodos entre meses. Os testes de store cobrem filtros
combinados, ticket por **linha**, clientes distintos, consolidação de unidades,
leitura sem escrita da configuração de conversão e o contrato de remuneração.
Os testes de API exercitam a mesma fonte de cálculo usada pelas rotas; nenhum
valor financeiro enviado pelo navegador passa a ser fonte de persistência.
