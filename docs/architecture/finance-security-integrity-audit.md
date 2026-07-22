# Auditoria de segurança e integridade — Financeiro

Data da revisão: 2026-07-21. Escopo: `finance/`, contratos compartilhados, mount
do gateway, proxy Pages do CRM, autenticação compartilhada, migrations e testes
diretamente associados. Não houve deploy, merge, alteração remota de D1 ou acesso
a dados reais.

## Controles confirmados

| Área | Controle e evidência |
| --- | --- |
| Autorização | O handler exige sessão CRM válida, `allowedModules` contendo `finance`, flag e grant por escopo antes de qualquer rota de dados (`finance/api/worker.js`). |
| Escopos | Todas as leituras e mutações usam `scope_id` concedido; filtros não substituem o escopo autorizado. Triggers de D1 validam vínculos entre movimento, cadastros e razão. |
| Contexto pessoal | O escopo pessoal nasce `active=0`; a consulta de grants aceita somente escopos ativos. Mesmo um grant inserido diretamente não o torna acessível. |
| CSRF e sessão | O gateway resolve a sessão HMAC existente e exige `x-csrf-token` para toda mutação antes de delegar ao domínio. O proxy Pages preserva cookies e não cria sessão paralela. |
| Idempotência e concorrência | Chave obrigatória é vinculada a ator, rota, escopo e hash. Corrida de chave idêntica relê o vencedor da restrição única em vez de duplicar ou expor erro de D1. |
| Integridade | Nova migration `0007` torna movimentos, linhas de razão, splits e chaves de idempotência imutáveis; entradas de razão começam em rascunho e só são postadas quando débitos e créditos estão balanceados. |
| Importação | Corpo HTTP limitado a 8 MiB e CSV canônico a 2.000.000 de caracteres. O commit usa uma única `DB.batch`; teste D1 força colisão no segundo lançamento e prova que o primeiro não persiste. |
| Anexos | Esta fase aceita somente metadados: chave com prefixo do escopo, caminho sem travessia, tipos permitidos e máximo declarado de 25 MiB. Não existe upload binário nem URL de leitura. |
| Erros e respostas | Falhas inesperadas retornam mensagem genérica; o lote não devolve mais o CSV bruto nem o payload bruto da origem. Respostas são `no-store`. |
| Rate limit | O gateway usa o Durable Object `RATE_LIMITER` já declarado para 240 leituras/min, 60 mutações/min e 12 operações de importação/min por identidade hash. Falha do limitador com binding configurado bloqueia a rota com 503. |

## Itens não aplicáveis nesta fase

- Não há exportação CSV financeira; portanto não existe superfície atual para
  *formula injection* de planilha. Qualquer exportação futura deverá neutralizar
  células iniciadas por `=`, `+`, `-` ou `@` e terá teste próprio.
- Não há upload binário, integração bancária, URL assinada, download de anexos ou
  sincronização automática. A validação de malware, *content sniffing* e quotas
  de storage só poderá ser concluída quando esse fluxo existir.

## Pré-condições operacionais ainda obrigatórias

1. Manter `RATE_LIMITER` no Worker de produção e aplicar as migrations em ordem.
2. Fazer backup/export verificável do D1 antes de migrations e guardar o artefato
   fora do repositório; o bucket `BACKUP_BUCKET` é a superfície prevista, mas o
   job de backup/restauração ainda não é implementado nesta branch.
3. Validar a migração e o smoke autenticado em staging antes de qualquer flag ou
   grant. O contexto pessoal continua inativo.

Essas pré-condições mantêm a aba Financeiro não ativável em produção nesta revisão.
