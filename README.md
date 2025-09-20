# SKINCOS AI
## AI Improvement Dashboard
[AI Improvement Dashboard](./docs/ai-knowledge/index.html)

Superproject contendo os módulos:

## Estrutura Organizada

Cada submódulo agora contém seus próprios scripts e configurações:

### comprehensive-crm-so/
- Scripts: `restart_crm.sh`, `backup_crm.sh`
- Configuração: `crm_config.yml`

### whatsapp-gateway/
- Scripts: `restart_whatsapp.sh`
- Configuração: `whatsapp_config.yml`

### broadhub/
- Scripts: `restart_broadhub.sh`

### a0/ (agent-zero)
- Configuração: `agent_config.yml` (com referências atualizadas)

### instagrapi/
- **API de integração Instagram** - Sistema completo de automação e análise
- **Funcionalidades integradas de múltiplos repositórios**:
  - **Core API**: instagrapi (subzeroid) - API privada do Instagram
  - **Download**: instaloader - Download de conteúdo e arquivamento
  - **OSINT**: Osintgram - Análise e reconhecimento de contas
  - **Extração**: toutatis - Extração de informações de contas
  - **Automação**: InstaPy - Ferramentas de engajamento e crescimento
  - **Analytics**: Análise avançada de performance e métricas
- **Recursos**: Download de posts/stories, análise OSINT, automação segura, extração de dados, analytics completos
- **Repositório base**: https://github.com/subzeroid/instagrapi

## Reorganização

Os arquivos foram reorganizados de acordo com sua funcionalidade, movendo scripts e configurações de `a0/` para os submódulos apropriados.

## Como usar o submódulo instagrapi

O submódulo instagrapi agora inclui um conjunto completo de extensões que integram funcionalidades de múltiplos repositórios Instagram populares.

### Inicialização básica:

```bash
git submodule init instagrapi
git submodule update instagrapi
```

### Funcionalidades disponíveis:

1. **Content Downloader** - Download de posts, stories, highlights com metadados
2. **OSINT Analyzer** - Análise de reconhecimento e inteligência de contas
3. **Automation Engine** - Automação segura com limitações de rate
4. **Info Extractor** - Extração de emails, telefones e informações de negócio
5. **Analytics Engine** - Analytics completos de performance e métricas

### Exemplo de uso:

```python
from instagrapi import Client
from instagrapi.extensions import (
    ContentDownloader, OSINTAnalyzer, AutomationEngine,
    InfoExtractor, AnalyticsEngine
)

# Inicializar cliente
cl = Client()
cl.login("usuario", "senha")

# Usar as extensões
downloader = ContentDownloader(cl)
osint = OSINTAnalyzer(cl)
automation = AutomationEngine(cl)
extractor = InfoExtractor(cl)
analytics = AnalyticsEngine(cl)

# Exemplos de operações
posts = downloader.download_profile_posts("usuario_alvo", limit=10)
analysis = osint.analyze_account("usuario_alvo")
report = analytics.generate_account_report("sua_conta")
```

Para documentação completa, consulte: `instagrapi/extensions/README.md`

Ou para inicializar todos os submódulos:

```bash
git submodule init
git submodule update
```
