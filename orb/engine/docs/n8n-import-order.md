# Ordem de importação n8n

Importar no projeto de teste, nunca no workflow de produção:

1. `CCG-99 Error Handler`;
2. `CCG-10` a `CCG-30`;
3. `CCG-40` a `CCG-60`;
4. `CCG-70` e `CCG-80`;
5. `CCG-90 QA and Package`;
6. `CCG-00 Content Orchestrator`;
7. adapters do organizador e da saída.

Os JSONs estão em `generated-workflows/campaign-creative-generator-v2`. Não houve import real nesta etapa porque não foi localizado um contrato/instância de teste autorizado. A validação local cobre JSON, IDs, conexões, trigger e ausência de publicação.
