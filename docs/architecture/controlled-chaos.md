# Suíte de caos controlado

`ops/chaos/controlled-chaos.test.mjs` injeta falhas exclusivamente em memória. Ela não possui URL de produção, credenciais, comandos de deploy, escrita em D1/PostgreSQL ou chamada a APIs da Cloudflare. Cada cenário precisa demonstrar a falha esperada e uma rota de controle que continua disponível.

Os cenários cobrem Identity, Inventory, Financeiro, PostgreSQL, D1, filas, WhatsApp, integrações externas e bindings da Cloudflare. A matriz declarativa está em [controlled-chaos.json](../../ops/chaos/controlled-chaos.json); resultados e pendências auditáveis ficam em [interference-register.json](../../ops/chaos/interference-register.json).

Execute localmente/na CI com:

```bash
npm run chaos:validate
npm run chaos:controlled
```

O teste não é permissão para desligar dependências reais. Um exercício em staging exige janela aprovada, cohort sem dados pessoais, flags de manutenção/kill switch, observabilidade externa e rollback registrado. A execução deve anexar evidência privada ao runbook, sem incluir segredos ou dados de pacientes no repositório.

Os desvios descobertos são corrigidos por P0–P3 no registro. Uma pendência `open` não pode ser promovida silenciosamente: ela requer owner, próximo passo e evidência de validação antes da liberação do módulo afetado.
