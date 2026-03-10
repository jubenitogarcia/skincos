# Análise da Nova Estrutura do Site - app.espacofacial.com.br

## Login
- URL: https://app.espacofacial.com.br
- Campo de email: `input[type="email"]` com placeholder "Insira seu email"
- Campo de senha: `input[type="password"]` com placeholder "Digite sua senha"
- Botão de login: `button` com texto "Acessar conta"

## Navegação após Login
- Dashboard principal: https://app.espacofacial.com.br/unidade/dashboard/resumo
- Seção de Recepção: https://app.espacofacial.com.br/reception_services/
- Menu lateral com opções: Dashboard, Recepção, Avaliações, Clientes, etc.

## Estrutura do Calendário
- Localizado na seção "Recepção"
- Visualização semanal e mensal disponível
- Botões de navegação: "Semana", "Dia", "Mês"
- Agendamentos mostrados em formato de grade com cores diferentes
- Cada agendamento mostra horário e informações do cliente

## Elementos dos Agendamentos Observados
- Horários visíveis (ex: 14:30-15:30, 15:00-16:00, etc.)
- Nomes dos clientes
- Status dos agendamentos (cores diferentes indicam status)
- Profissionais responsáveis
- Tipos de procedimentos

## Diferenças do Site Anterior
1. Nova URL base: app.espacofacial.com.br (vs sistema.espafacial.com.br)
2. Interface mais moderna
3. Não há seleção de unidade após login (já direcionado para BarraShoppingSul)
4. Estrutura de navegação diferente
5. Layout do calendário reformulado

## Elementos Identificados para Scraping
- Agendamentos estão em elementos com cores de fundo diferentes
- Informações visíveis incluem horário, cliente, profissional
- Possível necessidade de clicar nos agendamentos para obter detalhes completos
