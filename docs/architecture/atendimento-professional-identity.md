# Identidade de profissionais — Atendimento

## Regra de identidade

`crm_atendimento.professionals.id` identifica um cadastro físico e
`canonical_id` identifica a pessoa canônica. Um alias histórico aponta para a
identidade canônica em `professional_aliases`; ele não substitui nem apaga a
linha de origem. Os lançamentos manuais persistem somente o ID canônico.
`professional_identity_audit_events` reserva a trilha antes/depois de toda
futura decisão de mesclagem ou link canônico.

O nome é dado de apresentação e evidência de auditoria, nunca a chave de uma
mutação manual. Para injetor e consultor, o backend exige o ID selecionado e
valida, nessa ordem: identidade existente, coerência opcional do nome exibido,
status ativo, vínculo com a unidade e função compatível. Inativos só podem
aparecer em dados históricos importados, preservando o texto de origem em
`injector_source_name` e `consultant_source_name` quando não houver resolução
segura.

## Compatibilidade histórica

- Nenhuma FK histórica é movida ou apagada pela migration.
- Os links confirmados recebem evento de auditoria; nenhuma proposta ambígua
  vira alias ou link automaticamente.
- A agenda passa a poder guardar `professional_id`, mantendo `doctor_name`.
- O import não cria profissional a partir de uma linha de atendimento; só o
  cadastro explícito vindo da aba Equipe pode criar/atualizar o roster.
- Todos os relatórios consolidados devem agrupar por `canonical_id`; aliases
  confirmados não podem duplicar produção em Todas unidades.

## Aliases inicialmente confirmados

| Nome histórico | Identidade canônica | Base |
| --- | --- | --- |
| Raul Júnior | Raul Rosário Júnior | revisão do roster |
| Rafaela Ferreira | Rafaela Machado Ferreira | revisão do roster |

Qualquer abreviação, nome antigo ou homônimo fora desta tabela fica como caso
ambíguo. O diagnóstico não mescla, não atualiza FKs e não cria aliases.

## Diagnóstico somente leitura

Execute apenas com o `DATABASE_URL` local autorizado:

```bash
npm --prefix crm/api exec node scripts/report-atendimento-professional-identity.mjs
```

O JSON informa colisões por nome/alias, abreviações para decisão humana,
cadastros inválidos e nomes de agenda sem identidade resolvida. A saída deve ser
anexada à revisão humana antes de registrar novos aliases ou aprovar uma futura
mesclagem auditável.

## Migration e reversão

```bash
npm --prefix crm/api exec node scripts/migrate-atendimento-professional-identity.mjs --apply
npm --prefix crm/api exec node scripts/migrate-atendimento-professional-identity.mjs --rollback
```

A migration é exclusiva de `skincos_crm_local`, com advisory lock, timeout de
lock e índices concorrentes. Ela apenas cria estrutura, preenche
`canonical_id=id` quando vazio, registra aliases e conecta os dois aliases
confirmados. O rollback remove índices e a constraint de FK, mantendo vínculos,
aliases e dados históricos para não destruir auditabilidade.
