# Preflight de metadados da fonte Atendimento para CRM Core

## Objetivo e limite

O preflight prepara somente a evidência técnica da fonte canônica de
Atendimento antes de qualquer baseline. Ele não é um backfill, não entrega
eventos, não cria credenciais, não altera PostgreSQL, D1, Cloudflare, Pages,
rotas, flags, serviços ou writers legados.

O único helper instalado é fixo e `root:root 0700`; somente o operador
autorizado via `sudo` pode executá-lo:

```text
sudo -n /usr/local/sbin/skincos-preflight-atendimento-crm-core-source-metadata preflight-source-metadata
```

Ele não aceita URL, arquivo, SQL, ambiente, target ou ação selecionável pelo
chamador. A execução usa apenas o release imutável fixado na instalação e o
arquivo privado root-only `/etc/skincos/crm-core-projection-exporter.env`.

O helper de preflight tem um caminho próprio e nunca substitui
`/usr/local/sbin/skincos-prepare-atendimento-crm-core-baseline`, reservado ao
helper externo de custódia que o workflow de baseline chama com
`prepare-staging-baseline`. O preflight não implementa essa ação, não consome
autorizações de baseline e não pode preparar ou entregar pacotes.

Se um host já tiver o caminho antigo apontando para o preflight, não o remova
ou substitua automaticamente: a recuperação é um rollout root-owned separado
que primeiro confirma a proveniência do helper de baseline externo e só então
restaura sua ação literal. O instalador abaixo passa a escrever apenas o
helper exclusivo de preflight.

## Fonte admitida

O código fixa a semântica
`atendimento/crm-core/confirmed-unit-membership-source/v5`, a transação
`REPEATABLE READ READ ONLY`, o banco `skincos_clientes_production` e o
principal/sessão `crm_core_projection_exporter`.

As únicas relações que devem ter `SELECT` são:

- `crm_atendimento.crm_core_identity_members`
- `crm_atendimento.crm_core_attendance_client_links`
- `crm_atendimento.attendances`
- `crm_atendimento.units`

O preflight falha se alguma relação autorizada estiver ausente, sem `SELECT` ou
com privilégio de escrita. Também falha se o principal puder ler
`crm_caixa.sales`; Finance continua excluído.

O recibo contém somente metadados sanitizados: versão, allowlist, digest do
perfil, horário do snapshot e cardinalidade agregada. Ele não contém URL,
credencial, UUID, linha de cliente, HMAC, endpoint ou payload.

Todos os indicadores de execução no recibo permanecem `false`, inclusive
leitura para execução, entrega, mutação de produção, rota pública e publisher
legado. Um recibo válido não autoriza o próximo passo por si só.

## Instalação e execução local pelo Codex

Depois de publicar o código em um release imutável de 40 caracteres no host
operacional, validar e instalar sem reiniciar nada:

```bash
bash scripts/runtime/install-atendimento-crm-core-projection-custody.sh \
  --source-root /opt/skincos/releases/<sha>/source
sudo -n bash scripts/runtime/install-atendimento-crm-core-projection-custody.sh \
  --source-root /opt/skincos/releases/<sha>/source --apply
```

O instalador nunca cria a configuração com credencial. Antes da execução, ela
deve existir como arquivo regular não-link, `root:root` e modo `0600`, com uma
única chave literal:

```text
CRM_CORE_PROJECTION_EXPORTER_DATABASE_URL=<credencial dedicada>
```

O valor nunca entra em Git, log, recibo ou conversa. A execução local do Codex
é então feita pelo helper fixo acima, exclusivamente pelo operador com `sudo`;
não depende de GitHub Actions.

Se o preflight gerar recibo válido, ainda faltam a custódia de assinatura,
baseline por unidade para staging, entrega/reconciliação, candidatos imutáveis
de Core/Identity/gateway, publisher único e aposentadoria seletiva do legado.
