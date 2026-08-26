# SKINCOS como consumidor do Orb MCP

O SKINCOS não instala, hospeda ou sincroniza o MCP do Orb. O Codex de cada
operador se conecta diretamente aos quatro servidores remotos do Orb:

| Nome no Codex | URL |
| --- | --- |
| `orb_readonly` | `https://mcp-read.orb.skincos.com.br/mcp` |
| `orb_workflows` | `https://mcp-workflows.orb.skincos.com.br/mcp` |
| `orb_admin` | `https://mcp-admin.orb.skincos.com.br/mcp` |
| `orb_ops` | `https://mcp-ops.orb.skincos.com.br/mcp` |

Os headers Cloudflare Access, tokens OAuth e escolhas de aprovação pertencem ao
cofre/configuração local do Codex. O contrato canônico, o bloco `config.toml`
e o rollout ficam no repositório Orb. O domínio
`https://orb.skincos.com.br`, o healthcheck e integrações CRM/compliance não
são renomeados por esta separação.
