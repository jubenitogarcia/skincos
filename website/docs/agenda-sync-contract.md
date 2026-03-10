# Agenda Sync Contract (v1)

## Endpoint
- `POST /api/agenda/sync`
- Auth: `Authorization: Bearer <AGENDA_SYNC_TOKEN>` **or** `x-agenda-sync-token: <token>`

## Payload
```json
{
  "schema_version": 1,
  "runId": "optional-string",
  "unit": "BarraShoppingSul",
  "added": [
    {
      "data": "03/03/2026",
      "horario": "10:30",
      "cliente": "Nome do cliente",
      "tipo": "Avaliação",
      "profissional": "Dra. Maria",
      "telefone": "51999999999",
      "cpf": "00000000000",
      "source": "sistema-x",
      "servico": "Botox",
      "observacoes": "Texto livre",
      "status": "confirmado",
      "duration_min": 60
    }
  ],
  "removed": [
    {
      "data": "03/03/2026",
      "horario": "10:30",
      "cliente": "Nome do cliente",
      "tipo": "Avaliação",
      "profissional": "Dra. Maria"
    }
  ]
}
```

## Regras
- `schema_version`: opcional, se enviado deve ser `1`.
- `duration_min`: opcional, inteiro > 0; usado para bloquear overlaps de agenda.
- `added`: itens sem `data`, `horario`, `cliente`, `tipo` ou `profissional` são ignorados.
- `removed`: se faltar `cliente/tipo/profissional`, remove por `unit_slug + date_key + time_key`.

## Resposta (200)
```json
{
  "ok": true,
  "unit": "barrashoppingsul",
  "added": 10,
  "removed": 2,
  "added_skipped": 1,
  "removed_skipped": 0,
  "runId": "optional-string",
  "schema_version": 1
}
```
