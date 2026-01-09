# Automação Sprinta (Selenium)

Automatiza o fluxo de inscrição de um participante (ou vários) no evento Sprinta, gerando o link de checkout ao final.

> URL pública do evento (página inicial): `https://app.sprinta.com.br/event/30560768ac8e7500fef`
> URL direta utilizada pelo script para iniciar a inscrição: `https://app.sprinta.com.br/event/inscription/30560768ac8e7500fef`

## Features
- Parametrização completa dos campos
- Suporte a múltiplos participantes via CSV
- Execução headless opcional
- Validação de campos com Pydantic
- Login automático opcional com reutilização de sessão (perfil Chrome persistente)

## Requisitos
- Python 3.10+
- Google Chrome instalado (e chromedriver compatível gerenciado automaticamente pelo Selenium 4 se disponível no PATH)

## Instalação
```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r requirements.txt
```

## Uso
### Exemplo rápido (um participante de demonstração)
```bash
python -m src --exemplo
```

### CSV
Crie um arquivo `data/participantes.csv` com cabeçalho:
```
nome,email,telefone,time,aniversario,cpf,genero,categoria,camiseta,nome_equipe
```
Preencha as linhas com os dados. Exemplo:
```
João Teste,joao.teste@email.com,11999990000,Os Velozes,01/05/1980,12345678909,m,5KM,GG,Equipe Veloz IA
```
Execute:
```bash
python -m src --csv data/participantes.csv --headless
```

### Login automático & sessão persistente
Para evitar refazer login a cada execução:

1. Defina variáveis de ambiente (mais seguro que passar via CLI):
```bash
export SPRINTA_EMAIL="seu_email@example.com"
export SPRINTA_SENHA="sua_senha_aqui"
```
2. Use um diretório de perfil persistente do Chrome:
```bash
python -m src --csv data/participantes.csv --profile-dir ./.chrome-profile
```
Na primeira execução o script fará login. Nas próximas, se a sessão ainda estiver válida, ele seguirá direto para a inscrição.

Também é possível passar credenciais diretamente (menos recomendado):
```bash
python -m src --csv data/participantes.csv --email seu_email@example.com --senha SUA_SENHA --profile-dir ./.chrome-profile
```
Forçar tentativa de login mesmo que pareça já estar autenticado:
```bash
python -m src --csv data/participantes.csv --force-login --profile-dir ./.chrome-profile
```

Se estiver usando `--headless`, algumas vezes o Chrome pode não reaproveitar completamente o perfil; caso perceba que o login não persiste, teste sem `--headless` uma vez para criar a sessão.

## Observações
- Utilize CPFs válidos para evitar bloqueios.
- Ajuste esperas de `time.sleep` para algo mais robusto (WebDriverWait) em produção.
 - Caso queira começar pela página do evento (sem o `/inscription/`), basta abrir a URL pública e adaptar o fluxo para clicar no botão de inscrição antes de prosseguir.
 - Perfil persistente: evite reutilizar o mesmo diretório enquanto múltiplas execuções simultâneas estiverem ativas para não corromper o perfil.

## Próximos Passos Sugeridos
- Adicionar WebDriverWait explícito
- Exportar resultados em JSON/Excel
- Envio automático de e-mail com o link de checkout
- Suporte Playwright (mais estável/headless)

## Aviso
Automatizar interações em sites pode violar termos de uso. Use de forma ética e responsável.
