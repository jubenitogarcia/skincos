# Financeiro: fundação v1

## Fonte de verdade e propriedade

`finance/` é o único dono de movimentos, partidas, importações, conciliação, auditoria e relatórios. O D1 `skincos-db` é acessado pelo gateway em `api.skincos.com.br/finance/*`. `integration/` apenas coleta e normaliza entradas externas; `crm/console` não calcula nem persiste regras financeiras. O gateway chama o handler Financeiro diretamente; ele não encaminha mais `/finance` pelo Worker de Inventário. `identity/` valida a sessão existente e entrega o ator pelo contrato `shared/identity-contract`; Finance não lê usuários, hashes ou tabelas de sessão.

O antigo `backend/apps/actual-server` não é serviço, banco, autenticação ou dependência do Financeiro. Sua licença MIT permite referência seletiva, mas não há código nem estado importado dele.

## Acesso e ativação

O acesso exige sessão CRM válida, `allowedModules` contendo literalmente `finance`, a feature flag `finance_settings` com `key='module_enabled'` e `value='true'`, e um grant em `finance_access_grants`. Não existe herança por papel, lista vazia ou administrador. A tela só aparece após o bootstrap confirmar esses três gates.

Os escopos empresariais são Novo Hamburgo e BarraShoppingSul. O escopo pessoal é criado inativo e não recebe grant. Consolidado é somente uma consulta futura sobre escopos empresariais explicitamente autorizados.

## Operação inicial

O importador aceita CSV para staging. Ele grava lote, hash, linhas normalizadas e erros antes de qualquer movimento. O commit requer conta e categoria explícitas, idempotência e cria movimento + entrada + duas linhas de razão balanceadas. Reimportação exata é sinalizada por hash de arquivo/linha; duplicidades prováveis e o editor de mapeamento ainda não estão disponibilizados na interface. Adaptadores EF, MoneyWiz, Pluggy e Belvo deverão produzir o contrato de staging, não escrever tabelas Financeiro diretamente.

## Gate de produção

Aplicar `finance/migrations/0001_finance_foundation.sql` por procedimento de mudança revisado no D1 de staging antes do deploy do gateway. O script de deploy não aplica mais essa migration implicitamente. Validar usuário sem módulo (403), usuário com módulo sem grant (bootstrap sem acesso), usuário piloto com grant e isolamento entre unidades. Em produção, manter a flag desligada e nenhum grant até a evidência de staging ser aprovada.
