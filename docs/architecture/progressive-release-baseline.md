# Baseline de liberação progressiva — 2026-07-23

O catálogo técnico mantém todos os módulos em `experimental`. Esta é uma classificação de maturidade, não uma alegação de indisponibilidade: API, Inventory, Ponto e Orb responderam aos probes públicos nesta data. Esses endpoints ainda expõem contratos anteriores ao contrato de observabilidade atual; por isso não provam readiness, versão implantada, dependências ou alerta externo.

O arquivo versionado [release-readiness.json](../../ops/module-governance/release-readiness.json) registra a avaliação individual dos 17 módulos, os bloqueios e o pacote operacional dos três primeiros candidatos. A CI exige uma classificação para cada módulo e impede que uma entrada seja chamada de liberada enquanto o catálogo não estiver ao menos em `pilot`.

## Decisão atual

Nenhum módulo recebe uma nova liberação empresarial nesta avaliação. Isso preserva o uso existente e evita transformar uma resposta HTTP em aprovação operacional. As lacunas comuns são: monitoramento externo ainda não provisionado, cópia offsite criptografada ainda não comprovada e nenhum restore drill isolado com evidência retida.

A ordem de preparação é Financeiro, Ponto e Inventory. Financeiro é o primeiro candidato porque já possui flag desabilitada por padrão e grants explícitos. Ponto vem em seguida pela disponibilidade isolada já preparada; Inventory só entra após ganhar uma flag de módulo própria. Não há ativação ao mesclar `main`.

## Gate antes de liberar um candidato

1. Registrar a aprovação privada do grupo piloto e a janela de ativação.
2. Executar o pacote `requiredEvidence` do candidato em staging.
3. Anexar referências não sensíveis em `promotion-evidence.json` e elevar o estado por PR revisado.
4. Atualizar `releasedModules` com o pacote completo de flag, dados iniciais, treinamento, fallback, suporte, sucesso e reversão.
5. Ativar somente a flag do grupo piloto; validar a jornada e manter o kill switch disponível.

Uma falha de critério, alerta de segurança, desvio de reconciliação ou latência acima do SLO interrompe a expansão: aplica-se o rollback documentado, preserva-se a evidência e o estado não avança.
