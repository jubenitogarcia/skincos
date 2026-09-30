# Aposentadoria do GitHub Actions

**Status:** decisão vigente para novos trabalhos no SKINCOS e no Orb.

O orçamento do GitHub Actions não será renovado. Nenhuma missão nova deve iniciar,
reexecutar ou aguardar jobs do Actions para validar, integrar, publicar, fazer
deploy ou concluir uma entrega. Limite de minutos do Actions não é falha do
código nem motivo para interromper uma missão já autorizada.

## Caminho de execução

- Validar a revisão exata com Codex em Ubuntu/WSL nativo ou executor independente
  equivalente. Selecionar verificações versionadas proporcionais ao risco e
  registrar SHA, comandos, resultados e limitações. Código de PR que ainda não
  é confiável só pode executar em sandbox sem acesso à custódia do operador,
  arquivos de autenticação ou rede não autorizada; limpar variáveis de ambiente
  sozinho não estabelece esse isolamento.
- Manter PR, revisão, regras de branch, proveniência, checks realmente exigidos,
  custódia de segredos, lease global, staging, rollback e readback aplicáveis.
  Um resultado local não autoriza fabricar um status remoto.
- Integrar somente com uma autoridade independente que revalide head, base,
  fechamento de dependências, evidência e lease `merge:main` imediatamente antes
  da mutação, seguida de readback. Enquanto essa autoridade não estiver pronta,
  a integração permanece fail-closed; um workflow do Actions não é fallback.
- Publicar somente pelo procedimento versionado da superfície, com identidade
  imutável e o mesmo artefato até o destino. Registrar versão anterior,
  checkpoint, prova de staging quando aplicável, compensação e leitura real
  após a mudança. Um comando Wrangler isolado não substitui esses gates.

## Migração dos executores existentes

Os arquivos em `.github/workflows/` e as referências antigas em runbooks podem
descrever a implementação histórica. Sua existência não autoriza executá-los.
Antes de desabilitar um gatilho que ainda atende uma rotina ativa, inventariar
essa rotina, implementar substituto independente e provar conclusão, falha,
interrupção e recuperação. Desativar os gatilhos antigos após a substituição,
evitando duplicidade de writers. Não disparar jobs apenas para testar a
aposentadoria. Se uma proteção de branch ainda depender de um check do Actions,
reconciliar a regra com uma evidência independente aprovada; nunca ignorar um
controle substantivo nem simular sucesso.

Até cada publisher e operação serem migrados, a ação que depender deles fica
tecnicamente inelegível. O agente deve desenvolver e validar o substituto
necessário dentro da missão autorizada, sem converter a dependência do Actions
em pedido repetido de permissão.

O [inventário de 2026-09-30](../operations/github-actions-retirement-inventory-2026-09-30.md)
registra os gatilhos ainda ativos e a ordem de corte. Revalidar seus números
na API antes de qualquer alteração remota.
