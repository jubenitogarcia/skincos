# Roteamento de aliases de email

## Objetivo

Manter as contas principais do iCloud ja existentes e tratar somente aliases
operacionais que devem cair na conta responsavel.

Contas principais ja configuradas no iCloud:

- `contato@skincos.com.br`
- `rh@skincos.com.br`
- `financeiro@skincos.com.br`

Alias ativo neste momento:

| Alias | Conta de destino |
| --- | --- |
| `compras@skincos.com.br` | `financeiro@skincos.com.br` |

## Modelo correto no iCloud

O dominio `skincos.com.br` recebe email pelo iCloud Mail. Portanto, o alias deve
ser tratado no iCloud, nao no Cloudflare Email Routing.

Para `compras@skincos.com.br -> financeiro@skincos.com.br`, use uma destas duas
formas no iCloud:

1. Preferencial: adicionar `compras@skincos.com.br` como endereco adicional da
   mesma pessoa/conta que ja recebe `financeiro@skincos.com.br`.
2. Alternativa: se o iCloud nao permitir o endereco adicional no dominio
   customizado, criar uma regra no Mail do iCloud que encaminhe mensagens
   recebidas por `compras@skincos.com.br` para `financeiro@skincos.com.br`.

Nao recrie nem mova as contas principais `contato`, `rh` e `financeiro`. Elas
servem como destinos finais.

## Passos operacionais

1. Acesse `https://www.icloud.com/icloudplus` com a Apple Account que administra
   o dominio customizado `skincos.com.br`.
2. Abra **Custom Email Domain**.
3. Selecione `skincos.com.br`.
4. Localize a pessoa/conta que contem `financeiro@skincos.com.br`.
5. Adicione `compras@skincos.com.br` como endereco adicional desta mesma conta.
6. Confirme qualquer verificacao exigida pelo iCloud.
7. Envie um teste de uma conta externa para `compras@skincos.com.br`.
8. Confirme que a mensagem chega em `financeiro@skincos.com.br`.

## Validacao tecnica

Antes e depois da alteracao, rode:

```bash
bash scripts/verify-email-alias-routing.sh
```

O script valida os guardrails tecnicos:

- MX publico continua no iCloud;
- SPF continua incluindo iCloud;
- Cloudflare Email Routing continua desativado;
- nao existe regra Cloudflare capturando `compras@skincos.com.br`.

A entrega real do alias so pode ser validada com um envio externo para
`compras@skincos.com.br`, porque a lista de aliases do iCloud nao e exposta pelo
DNS publico.

## Guardrail Cloudflare/GitHub

Cloudflare deve permanecer apenas como DNS neste fluxo. Nao ative Cloudflare
Email Routing para resolver aliases enquanto o dominio continua recebendo pelo
iCloud.

GitHub Actions pode automatizar auditoria futura, mas GitHub nao encaminha email
e nao substitui a configuracao do iCloud.

## Futuras inclusoes

Quando novos aliases forem criados, registre a matriz neste formato:

| Alias | Conta de destino |
| --- | --- |
| `compras@skincos.com.br` | `financeiro@skincos.com.br` |

Para validar outro alias sem alterar o script:

```bash
ALIAS_ROUTES='compras@skincos.com.br=financeiro@skincos.com.br,novo@skincos.com.br=contato@skincos.com.br' \
  bash scripts/verify-email-alias-routing.sh
```
