# Deploy independente por domínio

O monorepo publica cada domínio pelo seu próprio artefato e workflow. O CRM é
um produto externo em `C:\CodexShared\Projetos\crm`; aqui existe somente o
contrato de gateway e a integração read-only de Atendimento.

| Domínio | Artefato | Publisher | Dados/rollback |
| --- | --- | --- | --- |
| Website | Pages/Worker | `deploy-website-cloudflare.yml` | bindings do Website e rollback do mesmo SHA |
| API/gateway | Worker | `deploy-core-workers.yml` | bindings da API; `/crm/*` é encaminhado ao serviço externo |
| Ponto | Workers + Pages dedicados | workflows `ponto-*` | D1/KV de Ponto e recibos de rollback |
| Financeiro | Worker + UI | `deploy-finance.yml` e workflows de UI | D1/KV próprios, sem copiar dados de outros domínios |
| Escala | Worker | `deploy-escala-api.yml` | secret e runtime de Escala |
| Atendimento | catálogo read-only | `integration/atendimento/commercial-catalog` | consulta controlada, sem migration ou writer local |
| Social, Inventário, Mensageria, Booking e Clínico | artefato do domínio | workflow próprio | banco, segredos e rollback próprios |

## Regras

1. Um publisher por superfície e um recurso de coordenação por domínio.
2. Preflight e readback devem provar o SHA, bindings, versão e ambiente antes
   de qualquer mutação.
3. Migrações são aditivas, com checkpoint e rollback operacional; dados de
   outro produto nunca são copiados.
4. Segredos, IDs, cookies, PII e recibos assinados ficam fora do repositório.
5. Falta de evidência ou dependência externa indisponível falha fechada.
