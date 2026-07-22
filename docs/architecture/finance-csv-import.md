# Importação CSV Financeira

O CSV é uma entrada de domínio do `finance`: o CRM apenas lê o arquivo no navegador, mostra o resultado do staging e envia intenções tipadas para `/finance/imports/*`.

- `POST /imports` guarda o conteúdo original no D1 oficial, o fingerprint SHA-256, encoding declarado, delimitador, cabeçalho, formato de data e mapeamento inferido.
- `POST /imports/:id/analyze` reaplica somente a normalização materializada; o CSV original e as decisões append-only não são removidos.
- `POST /imports/:id/decisions` registra cada decisão humana em `finance_import_row_decisions`, além da auditoria de domínio. Todas as referências são validadas no escopo autorizado.
- `POST /imports/:id/commit` cria apenas linhas aprovadas, com chave de idempotência, lançamentos postados e razão balanceada. Transferência exige conta de destino e nunca recebe categoria de receita/despesa.
- `POST /imports/:id/undo` não apaga lote, linha, lançamento ou auditoria: cria estornos e linhas reversas, marca os lançamentos cancelados e registra a operação compensatória.

Duplicidade exata é o fingerprint normalizado da linha no mesmo escopo; ela inicia em revisão. Duplicidade provável é um candidato por valor, data e natureza já persistido para decisão humana. Possíveis transferências também são candidatos, nunca uma classificação automática.

O contexto pessoal não é elegível na interface e continua dependente de grant explícito no servidor. Não há conector bancário nem segredo no navegador nesta fase.
