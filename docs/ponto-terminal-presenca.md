# Terminal e evidências de presença — Controle de Ponto

## Checklist de ativação

- [ ] Cadastrar a unidade e os vínculos dos funcionários com matrícula única.
- [ ] Criar um dispositivo do modo **Terminal** no CRM, escolher a política de rede e guardar o token uma única vez no navegador administrado do terminal.
- [ ] Abrir `https://crm.skincos.com.br/ponto-terminal.html` no aparelho físico, emparelhar e bloquear o perfil/navegador do sistema operacional.
- [ ] Para `REQUIRE`, cadastrar os CIDRs IPv4 públicos de saída da clínica (não SSID) e configurar `PONTO_NETWORK_CONTEXT_KEY` com o mesmo valor secreto no Pages e no Worker Timekeeping.
- [ ] Para trabalho externo, configurar a política da unidade como **Trabalho externo com revisão** e a geocerca autorizada; comunicar a finalidade ao colaborador.
- [ ] Testar entrada, intervalo, retorno e saída com uma conta sintética; confirmar auditoria e revogar o token em caso de perda do dispositivo.

## Modelo operacional

1. **Terminal autorizado + PIN** é o caminho padrão. O terminal escolhe a unidade pelo próprio cadastro e o Worker usa o horário do servidor. Ele não aceita identificação facial ou horário enviado pelo navegador.
2. **Rede da clínica** é evidência complementar. O Pages assina o IP público observado pela Cloudflare; o Worker só compara esse valor assinado com CIDRs autorizados. O navegador não escolhe nem encaminha IP, SSID ou cabeçalhos de proxy.
3. **Trabalho externo** usa localização apenas no instante da marcação e somente quando a política da unidade exige revisão. O sistema calcula distância e precisão para o resultado, mas não grava latitude, longitude nem IP no banco, log ou interface.

`OBSERVE` não bloqueia uma batida fora/sem rede; `REQUIRE` bloqueia a batida de terminal sem rede assinada correspondente. A política `TERMINAL_REQUIRED` impede marcação pelo navegador pessoal. `EXTERNAL_REVIEW` mantém a marcação externa fora da geocerca como evidência para revisão humana, não como rejeição automática.

## Variáveis e recuperação

- `PONTO_NETWORK_CONTEXT_KEY`: segredo HMAC compartilhado exclusivamente entre a Pages Function do CRM e o Worker Timekeeping. Configure via `wrangler secret put`; nunca em `.env`, Git, URL ou QR code.
- Revogar um dispositivo invalida o token imediatamente. Para trocar a rede, altere somente os CIDRs na tela de Dispositivos e preserve a auditoria.
- Uma perda de token, terminal desbloqueado, CIDR incorreto ou indisponibilidade de geolocalização deve seguir contingência auditada e correção formal, não edição direta de evento.

As regras de presença são operacionais e devem ser validadas pela administração/RH e assessoria trabalhista antes da ativação em produção.
