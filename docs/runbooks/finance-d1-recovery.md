# Recuperação D1 do Financeiro

Este procedimento é para staging ou produção e não deve ser executado como parte
do desenvolvimento local.

1. Desligue a flag em `finance_settings` (`key='module_enabled'`,
   `value='false'`) antes de intervir; não
   remova grants nem apague evidências.
2. Registre `request_id`, lote, escopo, período e o último evento de auditoria.
3. Gere e valide um backup/export do D1 no armazenamento privado de operação
   antes de aplicar qualquer migration corretiva. Não grave backup, dados ou
   credenciais no repositório.
4. Use somente migration aditiva ou estorno/revisão auditável. Nunca edite uma
   migration já aplicada, nem faça `DELETE` em movimentos, linhas de razão,
   auditoria, decisões ou chaves de idempotência.
5. Restaure apenas em ambiente isolado primeiro, aplique migrations até a mesma
   versão e compare `finance_audit_events`, movimentos, razão e lotes por escopo.
6. Execute o smoke autenticado com um usuário-piloto de Novo Hamburgo e outro de
   BarraShoppingSul. Confirme ausência de cruzamento entre escopos e que pessoal
   permanece bloqueado.
7. Reative a flag apenas após a comparação e o smoke serem aprovados; preserve o
   backup e o identificador da operação de recuperação.

O Worker possui binding `BACKUP_BUCKET`, mas esta branch ainda não implementa um
agendador de backup/restauração. Essa ausência é um bloqueador operacional para
ativação em produção, não uma licença para usar dados locais como recuperação.
