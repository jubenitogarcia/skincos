# Automação Espaço Facial

Este projeto realiza a automação do processo de coleta de dados de vendas do sistema Espaço Facial e a atualização automática de uma planilha do Google Sheets.

## Funcionalidades
- Login automatizado no sistema Espaço Facial
- Coleta de dados de vendas por unidade (Barra Shopping Sul, Novo Hamburgo, Rio de Janeiro)
- Atualização automática de valores em uma planilha Google Sheets
- Interface interativa com menu guiado
- Diagnóstico do sistema e validação de configurações
- Sistema de logging robusto
- Suporte a múltiplos modos de execução (interativo, direto, diagnóstico)

## Estrutura do Projeto
- `main.py`: Script principal da automação
- `config.local.json`: Configurações do sistema (ignorado), credenciais e mapeamento de dados
- `requirements.txt`: Dependências Python necessárias
- `run.sh`: Script shell para facilitar a execução, setup e diagnóstico

## Pré-requisitos
- Python 3.8+
- Google Service Account com acesso à planilha
- Chrome instalado no sistema

## Instalação
1. Clone este repositório e acesse o diretório do projeto.
2. Execute o script `run.sh` para configurar o ambiente virtual e instalar as dependências:
   ```sh
   ./run.sh
   ```
3. Configure o arquivo `config.local.json` (ou exporte `SCRAPER_CONFIG` apontando para um arquivo externo).
   - Template versionado: `backend/config/templates/modules/scraper/config.example.json`
   - Arquivo local (ignorado): `backend/var/scraper/config.local.json` (via symlink `backend/apps/automations/scraper/config.local.json`)

## Uso
### Execução via Shell Script
- Executar todas as unidades:
  ```sh
  ./run.sh all
  ```
- Executar unidade específica (exemplo: Barra Shopping Sul):
  ```sh
  ./run.sh bss
  ```
- Diagnóstico do sistema:
  ```sh
  ./run.sh diagnose
  ```
- Configurar credenciais:
  ```sh
  ./run.sh configure
  ```

### Execução via Python
- Modo interativo:
  ```sh
  python main.py
  ```
- Execução direta:
  ```sh
  python main.py --mode run --unit bss --headless
  ```
- Diagnóstico:
  ```sh
  python main.py --mode diagnose
  ```

## Configuração
O arquivo `config.local.json` armazena as credenciais do sistema Espaço Facial, dados da conta de serviço Google e mapeamento das células da planilha. Utilize a opção de configuração interativa para preencher corretamente.

No monorepo, recomenda-se usar `config.local.json` (ignorado pelo git) e manter um template em `config.example.json`.

## Segurança
- **Nunca compartilhe seu `config.local.json` publicamente**, pois contém credenciais sensíveis.
- O arquivo `.gitignore` já está configurado para evitar o versionamento de arquivos sensíveis e temporários.

## Licença
Uso interno. Consulte o responsável pelo projeto para mais informações.
