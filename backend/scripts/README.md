# Scripts Hub

Use os comandos estáveis do runtime nativo:

```bash
./backend/scripts/dev.sh status
./backend/scripts/dev.sh restart
./backend/scripts/e2e.sh health
./backend/scripts/e2e.sh smoke
```

O ciclo de vida de produção é controlado pelas units em `ops/runtime/units` e launchers em `scripts/runtime`. Estes scripts não iniciam implementações alternativas de WhatsApp nem mantêm estado mutável no checkout.
