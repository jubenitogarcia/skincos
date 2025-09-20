# 🤝 Guia de Contribuição - Comprehensive CRM

Obrigado por seu interesse em contribuir com o Comprehensive CRM! Este guia vai te ajudar a começar e garantir que suas contribuições sejam efetivas e bem recebidas.

## 📋 Índice

- [Código de Conduta](#código-de-conduta)
- [Como Contribuir](#como-contribuir)
- [Configuração do Ambiente](#configuração-do-ambiente)
- [Processo de Desenvolvimento](#processo-de-desenvolvimento)
- [Padrões de Código](#padrões-de-código)
- [Testes](#testes)
- [Documentação](#documentação)
- [Processo de Review](#processo-de-review)
- [Reportar Problemas](#reportar-problemas)
- [Sugerir Funcionalidades](#sugerir-funcionalidades)

## 📜 Código de Conduta

Este projeto segue um código de conduta rigoroso para garantir um ambiente inclusivo e respeitoso para todos. Ao participar, você concorda em manter um comportamento profissional e construtivo.

### Comportamentos Esperados
- Seja respeitoso e inclusivo
- Aceite críticas construtivas
- Foque no que é melhor para a comunidade
- Demonstre empatia com outros colaboradores

### Comportamentos Inaceitáveis
- Linguagem ou imagens inadequadas
- Ataques pessoais ou políticos
- Assédio público ou privado
- Qualquer conduta inadequada em ambiente profissional

## 🚀 Como Contribuir

### Tipos de Contribuição

1. **Correção de Bugs** - Ajude a identificar e corrigir problemas
2. **Novas Funcionalidades** - Implemente recursos solicitados pela comunidade
3. **Melhorias de Performance** - Otimize código existente
4. **Documentação** - Melhore guias, comentários e documentação
5. **Testes** - Adicione ou melhore cobertura de testes
6. **Tradução** - Ajude na internacionalização
7. **Design/UX** - Melhore a experiência do usuário

### Primeiros Passos

1. **Fork** o repositório
2. **Clone** seu fork localmente
3. **Configure** o ambiente de desenvolvimento
4. **Crie** uma branch para sua contribuição
5. **Faça** suas alterações
6. **Teste** suas modificações
7. **Submeta** um Pull Request

## ⚙️ Configuração do Ambiente

### Pré-requisitos

- **Node.js** 18.19.0 ou superior
- **npm** 10.9.2 ou superior  
- **Git** para controle de versão
- Editor com suporte a TypeScript (recomendado: VSCode)

### Instalação

```bash
# 1. Clone o repositório
git clone https://github.com/jubenitogarcia/comprehensive-crm-so.git
cd comprehensive-crm-so

# 2. Instale dependências
npm install

# 3. Configure o ambiente de desenvolvimento
./scripts/setup-dev.sh

# 4. Execute o projeto em modo desenvolvimento
npm run dev
```

### Estrutura do Projeto

```
comprehensive-crm-so/
├── .github/                 # Templates e configurações GitHub
├── src/                     # Código fonte principal
│   ├── components/          # Componentes React
│   ├── lib/                 # Utilitários e helpers
│   └── data/               # Dados e mocks
├── docs/                   # Documentação
├── scripts/                # Scripts de desenvolvimento
├── configs/                # Configurações compartilhadas
└── tests/                  # Testes automatizados
```

## 🔄 Processo de Desenvolvimento

### 1. Planejamento

- Verifique se já existe uma issue para o que você quer trabalhar
- Se não existir, crie uma issue descrevendo o problema/funcionalidade
- Discuta a abordagem antes de começar a codificar

### 2. Desenvolvimento

```bash
# Crie uma branch descritiva
git checkout -b feature/nome-da-funcionalidade
# ou
git checkout -b fix/nome-do-bug

# Faça commits pequenos e frequentes
git commit -m "feat: adiciona validação de email"
git commit -m "test: adiciona testes para validação"
```

### 3. Padrões de Commit

Seguimos o padrão [Conventional Commits](https://www.conventionalcommits.org/):

```
<tipo>(<escopo>): <descrição>

[corpo opcional]

[rodapé opcional]
```

**Tipos válidos:**
- `feat` - Nova funcionalidade
- `fix` - Correção de bug
- `docs` - Alterações na documentação
- `style` - Formatação, ponto e vírgula, etc
- `refactor` - Refatoração de código
- `test` - Adição ou correção de testes
- `chore` - Atualizações de build, dependências, etc

**Exemplos:**
```bash
feat(crm): adiciona filtro avançado de leads
fix(auth): corrige validação de token expirado
docs(readme): atualiza instruções de instalação
test(api): adiciona testes para endpoint de contatos
```

## 📐 Padrões de Código

### TypeScript/JavaScript

- Use **TypeScript** para tipagem forte
- Siga as configurações do **ESLint** e **Prettier**
- Use **nomes descritivos** para variáveis e funções
- Prefira **const** sobre **let** quando possível
- Use **async/await** ao invés de Promises encadeadas

```typescript
// ✅ Bom
const getUserData = async (userId: string): Promise<User> => {
  try {
    const response = await api.get(`/users/${userId}`)
    return response.data
  } catch (error) {
    console.error('Erro ao buscar usuário:', error)
    throw error
  }
}

// ❌ Evitar
function getData(id) {
  return api.get('/users/' + id).then(res => res.data)
}
```

### React Components

- Use **componentes funcionais** com hooks
- Mantenha componentes **pequenos e focados**
- Use **TypeScript interfaces** para props
- Implemente **tratamento de erro** adequado

```tsx
// ✅ Bom
interface UserCardProps {
  user: User
  onEdit: (user: User) => void
  className?: string
}

export const UserCard: React.FC<UserCardProps> = ({ 
  user, 
  onEdit, 
  className = '' 
}) => {
  const handleEdit = useCallback(() => {
    onEdit(user)
  }, [user, onEdit])

  return (
    <div className={`user-card ${className}`}>
      <h3>{user.name}</h3>
      <button onClick={handleEdit}>Editar</button>
    </div>
  )
}
```

### CSS/Styling

- Use **Tailwind CSS** para estilização
- Mantenha classes **organizadas e legíveis**
- Use **variáveis CSS** para valores reutilizáveis
- Implemente **design responsivo**

## 🧪 Testes

### Estratégia de Testes

1. **Unit Tests** - Teste funções e componentes isoladamente
2. **Integration Tests** - Teste interação entre componentes
3. **E2E Tests** - Teste fluxos completos de usuário

### Executando Testes

```bash
# Executar todos os testes
npm test

# Executar testes com watch mode
npm run test:watch

# Executar testes de cobertura
npm run test:coverage

# Executar testes E2E
npm run test:e2e
```

### Escrevendo Testes

```typescript
// Exemplo de teste de componente
import { render, screen, fireEvent } from '@testing-library/react'
import { UserCard } from './UserCard'

describe('UserCard', () => {
  const mockUser = {
    id: '1',
    name: 'João Silva',
    email: 'joao@example.com'
  }

  it('deve renderizar nome do usuário', () => {
    render(<UserCard user={mockUser} onEdit={jest.fn()} />)
    expect(screen.getByText('João Silva')).toBeInTheDocument()
  })

  it('deve chamar onEdit quando botão for clicado', () => {
    const mockOnEdit = jest.fn()
    render(<UserCard user={mockUser} onEdit={mockOnEdit} />)
    
    fireEvent.click(screen.getByText('Editar'))
    expect(mockOnEdit).toHaveBeenCalledWith(mockUser)
  })
})
```

## 📚 Documentação

### Comentários no Código

- Use **JSDoc** para funções e classes importantes
- Mantenha comentários **atualizados** com o código
- Explique o **"porquê"**, não apenas o "como"

```typescript
/**
 * Calcula a pontuação de um lead baseado em critérios específicos
 * @param lead - Dados do lead para avaliação
 * @param criteria - Critérios de pontuação configurados
 * @returns Pontuação numérica do lead (0-100)
 */
export const calculateLeadScore = (
  lead: Lead, 
  criteria: ScoringCriteria
): number => {
  // Implementação...
}
```

### Documentação de Funcionalidades

- Atualize o README.md quando necessário
- Documente novas APIs ou endpoints
- Inclua exemplos de uso
- Mantenha changelog atualizado

## 🔍 Processo de Review

### Preparando seu PR

1. **Sincronize** com a branch principal
2. **Execute** todos os testes
3. **Execute** linting e formatação
4. **Escreva** descrição clara do PR
5. **Referencie** issues relacionadas

```bash
# Antes de submeter o PR
git checkout main
git pull origin main
git checkout sua-branch
git rebase main

npm run lint
npm run type-check
npm test
```

### Template do Pull Request

```markdown
## 📝 Descrição
Breve descrição das alterações feitas.

## 🔗 Issue Relacionada
Closes #123

## 🧪 Testes
- [ ] Testes unitários adicionados/atualizados
- [ ] Testes de integração passando
- [ ] Testado manualmente

## 📋 Checklist
- [ ] Código segue os padrões estabelecidos
- [ ] Documentação atualizada
- [ ] Sem breaking changes ou devidamente documentados
- [ ] Performance considerada
```

### Critérios de Aprovação

- ✅ Todos os testes passando
- ✅ Code review aprovado
- ✅ Documentação adequada
- ✅ Sem conflitos de merge
- ✅ Seguindo padrões do projeto

## 🐛 Reportar Problemas

### Antes de Reportar

1. Verifique se o bug já foi reportado
2. Teste na versão mais recente
3. Colete informações relevantes

### Informações Necessárias

- **Ambiente** (OS, browser, versão Node.js)
- **Passos para reproduzir** o problema
- **Comportamento esperado** vs **atual**
- **Screenshots** ou logs quando relevante

Use o template de bug report disponível ao criar uma nova issue.

## ✨ Sugerir Funcionalidades

### Processo de Sugestão

1. **Verifique** se a funcionalidade já foi sugerida
2. **Descreva** o problema que a funcionalidade resolve
3. **Proponha** uma solução detalhada
4. **Considere** alternativas e impacto

Use o template de feature request para sugestões estruturadas.

## 🎯 Priorização

### Níveis de Prioridade

1. **Crítico** - Bugs que impedem uso do sistema
2. **Alto** - Funcionalidades core ou bugs importantes
3. **Médio** - Melhorias e funcionalidades secundárias
4. **Baixo** - Ajustes cosméticos e otimizações

## 🏆 Reconhecimento

Valorizamos todas as contribuições! Contribuidores ativos serão:

- Reconhecidos no README.md
- Mencionados em releases
- Convidados para discussões técnicas importantes
- Considerados para acesso de colaborador

## 📞 Suporte

### Canais de Comunicação

- **Issues** - Para bugs e funcionalidades
- **Discussions** - Para perguntas e ideias gerais
- **Email** - Para questões privadas ou sensíveis

### Dúvidas Frequentes

**P: Como sei se minha contribuição será aceita?**
R: Siga este guia, discuta nas issues e mantenha qualidade alta.

**P: Posso trabalhar em múltiplas funcionalidades simultaneamente?**
R: Recomendamos focar em uma por vez para facilitar reviews.

**P: Quanto tempo leva para review de um PR?**
R: Geralmente 2-5 dias úteis, dependendo da complexidade.

## 📊 Estatísticas

Acompanhe o progresso do projeto:
- Issues abertas vs fechadas
- Pull requests pendentes
- Cobertura de testes
- Performance metrics

---

## 🙏 Agradecimentos

Obrigado por contribuir com o Comprehensive CRM! Sua participação é fundamental para o sucesso do projeto.

Para dúvidas sobre este guia, abra uma issue com a label `documentation`.

**Happy coding! 🚀**