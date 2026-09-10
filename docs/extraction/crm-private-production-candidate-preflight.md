# Preflight de candidatos privados de produção do CRM

Este documento define uma preparação **somente de fonte e leitura** para os
candidatos privados de produção do CRM. O workflow
`.github/workflows/crm-private-production-candidate-preflight.yml` só pode ser
iniciado manualmente e não contém comando de publicação, rota, Pages, D1,
migração, dado de cliente ou escrita de segredo. Ele não chama
`deploy-core-workers.yml` nem `deploy-crm-pages.yml`.

Nem uploads de versões inertes são permitidos por este PR ou por esse
workflow. O modo de solicitação foi incluído justamente para falhar antes de
qualquer mutação externa, mesmo quando uma confirmação é digitada. Portanto,
um `workflow_dispatch` não consegue publicar acidentalmente por push, por
rerun ou por uma variável de ambiente configurada incorretamente.

O artefato produzido é sanitizado: inclui somente hashes, nomes de Worker,
estados booleanos e motivos de bloqueio. Não inclui token, valor de segredo,
JWS, cookie, PII ou conteúdo de recibo.

## O que o preflight comprova

O operador fornece o SHA completo de `main`, o SHA do candidato no repositório
independente `jubenitogarcia/skincos-crm-core` e o digest sanitizado de seu
artefato. O workflow recusa a execução se o SHA não for exatamente o checkout
observado, `GITHUB_SHA`, a entrada do operador e a ponta observada de
`origin/main`, se não estiver em `main`, ou se o evento não for
`workflow_dispatch`.

Ele também reutiliza o readback sanitizado de Identity para verificar que o
Worker de produção correto está sem `workers.dev`, rota ou domínio público e
que a custódia externa apresenta os nomes e tipos esperados. A chave de emissão
precisa ser Ed25519 somente para assinatura; seu valor nunca é lido nem salvo
no GitHub.

O novo workflow aceita exclusivamente `CRM_IDENTITY_READBACK_API_TOKEN` e
`CRM_IDENTITY_READBACK_ACCOUNT_ID`, ambos como segredos do ambiente dedicado
`crm-production-candidate-preflight` e destinados somente ao readback GET de
Identity. Ele não lê, referencia nem usa `CLOUDFLARE_API_TOKEN` ou
`CLOUDFLARE_ACCOUNT_ID` genéricos. Enquanto os dois segredos dedicados não
existirem, o leitor não faz chamada Cloudflare: produz um relatório sanitizado
`blocked` e o workflow falha fechado.

O modo `request-private-inert-candidates` exige a frase exata
`request-private-inert-crm-candidates`, mas ainda termina bloqueado. Ele existe
para registrar a intenção auditável sem converter este preflight em um
publisher. Qualquer gate ou entrada ausente faz o workflow falhar depois de
gravar o relatório sanitizado; não há modo permissivo.

## Papéis e limites de propriedade

| Papel | Dono | Estado permitido por este preflight |
| --- | --- | --- |
| `I` | Identity no monorepo | Apenas plano para uma versão privada e inerta, sem rota ou tráfego. |
| `C` | `jubenitogarcia/skincos-crm-core` | Deve ser criado e atestado pelo repositório independente; o monorepo não empacota nem publica Core. |
| `G` | gateway `skincos-api` no monorepo | Apenas plano para versão privada e inerta, com os flags CRM ainda desligados. |

O produtor que um dia criar `I` e `G` precisa ser uma mudança separada,
revisada e protegida por ambiente de produção. Ele deve exigir uma fonte
imutável, a custódia de Identity, um lease global imediatamente antes de cada
mutação e somente um upload de versão inerte; não pode criar deployment,
triggers, rota, domínio, Pages, D1 ou segredo. O candidato `C` continua sob o
workflow equivalente do repositório Core.

## Condições que continuam fora deste fluxo

O preflight não autoriza e não implementa o resolvedor `R`, o recibo assinado
de rota, a ativação de tráfego, a troca de Pages, a execução de backfill ou a
aposentadoria de runtime. Antes de qualquer uma delas, devem existir provas
externas de:

- separação operacional de Ponto;
- reconciliação do backfill por domínio;
- um publisher único e a aposentadoria verificável do writer legado;
- candidatos `I`, `C` e `G` com identidades exatas e rollback sem tráfego;
- recibo assinado que prenda as três versões e smoke privado do mesmo artefato.

Uma variável de ambiente marcada como verdadeira não substitui essas provas:
o workflow apenas registra os estados como gates pendentes. Um relatório
`blocked` é o resultado correto enquanto a evidência externa não existe.

## Single writer e custódia

Este workflow é validado contra
`.github/governance/cloudflare-single-writer-policy.json` como preflight não
publicador: ele não recebe uma autoridade de mutação porque não tem mutação. A
validação de single writer varre o grafo do workflow e confirma que não há
`wrangler`, endpoint Cloudflare mutante, upload, deployment, trigger ou comando
de segredo.

Um publisher futuro não poderá ser acrescentado por edição incidental deste
workflow. Ele precisa de uma mudança revisada que, antes de qualquer chamada
externa, seja incluída explicitamente na política single-writer, tenha recurso
de coordenação global escolhido para a topologia já separada de Ponto, adquira
e revalide lease imediatamente antes de cada mutação e tenha rollback
verificável. Até isso existir, os publishers gerais permanecem proibidos.

Além da fonte imutável, os requisitos externos mínimos de custódia são:

- aprovação do ambiente dedicado `crm-production-candidate-preflight` para a leitura;
- um ambiente de produção separado, com a admissão revisada do publisher futuro;
- os segredos dedicados `CRM_IDENTITY_READBACK_API_TOKEN` e
  `CRM_IDENTITY_READBACK_ACCOUNT_ID`, com escopo mínimo e somente GET para o
  readback; segredos Cloudflare genéricos são proibidos neste workflow;
- nomes e tipos de segredo de Identity visíveis no readback, mas nunca seus
  valores;
- chave não extraível Ed25519 de assinatura e registro de rotação/rollback;
- SHA e digest do candidato `C` emitidos pelo repositório Core independente;
- recibos sanitizados e verificáveis para as provas de Ponto, backfill e writer
  único.
