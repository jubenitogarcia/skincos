# Migração — Ponto (arquivo → banco)

## Objetivo
Eliminar a persistência em arquivo (`backend/var/core/ponto_store.v2.json`) e mover o Ponto para um banco durável.

## Escopo
- Dados: employees, devices, records, audit
- APIs: `/api/ponto/*` permanecem iguais
- Compatibilidade: migração única (arquivo → DB)

## Proposta de schema (base relacional)
**ponto_employees**
- id (PK)
- code
- name
- login_email
- unit
- active
- created_at
- updated_at
- deleted_at
- last_enrolled_at
- pin_hash
- face_templates (JSON/Blob)
- consent_obtained_at
- consent_version

**ponto_devices**
- id (PK)
- label
- unit
- token_hash
- created_at
- revoked_at
- last_seen_at

**ponto_records**
- id (PK)
- kind (PUNCH|CORRECTION)
- employee_id
- employee_name
- type (IN|OUT|AUTO)
- at
- unit
- method
- match_distance
- note
- device_id
- device_label
- ip
- user_agent
- idempotency_key
- created_at
- correction fields (target_record_id, new_at, new_type, new_unit, reason)

**ponto_audit**
- id (PK)
- at
- hash_prev
- hash
- payload (JSON)

## Passos sugeridos
1) Criar schema e bindings no ambiente (D1/SQL).
2) Implementar “storage adapter” que grava também no DB (dual‑write).
3) Rodar migração de arquivo → DB (batch).
4) Validar contagens e amostras (records e audit).
5) Desligar gravação em arquivo.

## Validação mínima
- Registros recentes aparecem no DB e no CSV exportado.
- `/api/ponto/health` reflete `storage=db`.
- `audit/verify` continua OK.

## Rollback
Se DB falhar, retornar ao modo arquivo mantendo o arquivo atualizado (durante dual‑write).
