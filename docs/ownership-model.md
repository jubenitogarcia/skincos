# Ownership E Operação

## Estado atual

- Enforcement real no GitHub: um único owner em `.github/CODEOWNERS`.
- Operação real: múltiplos domínios com risco de bus factor 1.

## Modelo recomendado

- `website/`: owner de produto público + backup operacional.
- `frontend/`: owner do CRM + backup operacional.
- `backend/apps/crm-api/`: owner de backend transacional + backup operacional.
- `backend/apps/escala-api/`: owner da agenda/escala + backup operacional.
- `backend/config` e `backend/libs`: owner de plataforma/automação + backup operacional.
- `.github/` e `docs/`: owner de plataforma/entrega.

## Regras mínimas

1. Nenhum domínio crítico deve depender de uma única pessoa sem backup nominal.
2. Alertas de produção precisam apontar para owner primário e backup.
3. Mudanças em deploy, auth, secrets ou observability exigem revisão explícita do owner do domínio.
4. Exceções temporárias devem ter vencimento e motivo em arquivo versionado.

## Passos pendentes fora do código

1. Criar times GitHub por domínio.
2. Atualizar `.github/CODEOWNERS` com esses times.
3. Ativar branch protection com `Require review from Code Owners`.
4. Definir backup operacional por serviço e rotação simples de incidentes.
