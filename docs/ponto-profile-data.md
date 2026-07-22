# Perfil canônico no Ponto

`Pessoas.xlsx` é um modelo de importação, não uma fonte de pessoas. A planilha recebida está intencionalmente vazia: nenhum funcionário é criado por esta documentação ou pela interface.

O identificador canônico é `workforce_employees.canonical_employee_id`. A tabela `workforce_employee_profiles` é uma extensão 1:1 desse cadastro; ela não cria uma segunda identidade e preserva o vínculo já usado por Escala e Ponto.

## Mapeamento do modelo

| Coluna do modelo | Destino | Regra de acesso |
| --- | --- | --- |
| Nome completo, matrícula, cargo, data de nascimento | `workforce_employees` | perfil próprio e RH conforme escopo |
| CPF, celular | hash para deduplicação no funcionário; valor em `private_data_encrypted` no perfil | nunca em listagem, log ou auditoria |
| E-mail | `login_email` para acesso; `personal_email` para contato | próprio perfil/RH |
| CNPJ | `workforce_unit_legal_profiles` | unidade/empresa, não pessoa |
| Admissão, demissão, grupo, departamento, líder | `workforce_employee_profiles` | preserva temporalidade e escopo de unidade |
| PIS, RG, órgão/UF/data de emissão, filiação | `private_data_encrypted` | somente estado de cadastro é exibido no CRM |
| Nome social, naturalidade, grau de instrução | `workforce_employee_profiles` | perfil próprio/RH |
| CEP e endereço | `private_data_encrypted`, cidade/UF no perfil | próprio perfil/RH |

O CPF do líder é recebido apenas para reconciliação: é convertido em hash (`manager_cpf_hash`) e deve ser associado a `manager_employee_id` por revisão humana ou importador autorizado. Não há fusão automática de pessoas.

## Proteção e APIs

O secret `PONTO_PROFILE_DATA_KEY` é obrigatório para gravar dados privados. Ele deve ser configurado com `wrangler secret put PONTO_PROFILE_DATA_KEY`; não deve aparecer em `wrangler.toml`, planilhas, logs ou commits.

- `GET /api/ponto/me/profile`: perfil da própria conta vinculada;
- `PATCH /api/ponto/me/profile`: somente contato/endereço e campos pessoais permitidos;
- `GET /api/ponto/employees/:employeeId/profile`: Supervisor/Admin dentro do escopo;
- `PATCH /api/ponto/employees/:employeeId/profile`: Supervisor/Admin, auditado sem valores sensíveis.

O CRM mostra indicadores `cadastrado`/`pendente` para CPF, PIS, RG e filiação, nunca os números ou nomes. A auditoria registra somente os nomes dos campos alterados e a correlação da requisição.

## Importação futura

Antes de importar uma planilha preenchida: validar cabeçalhos, normalizar CPF/telefone, detectar conflitos de CPF/e-mail/matrícula, executar dry-run e exigir revisão humana de duplicidades e líder imediato. O importador deve usar `canonical_employee_id` existente ou criar o vínculo canônico uma única vez; não deve alimentar tabelas legadas de Ponto.
