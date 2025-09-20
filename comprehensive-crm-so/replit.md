# SKINCOS AI - CRM System Architecture Documentation

## Overview

O SKINCOS AI CRM é um sistema empresarial robusto construído com arquitetura Provider-First Boot para máxima confiabilidade e manutenibilidade. Implementa padrões avançados de inicialização determinística, error handling centralizado e testing abrangente.

## Arquitetura Provider-First Boot (Setembro 2025)

### 🏗️ **Ordem Canônica de Providers**

```
QueryClientProvider (PRIMEIRO - React Query foundation)
    ↓
ErrorBoundary (Error catching global)
    ↓
BootGate (Inicialização determinística)
    ↓
ContextErrorBoundary (Context-specific errors)
    ↓
AuthProvider (Authentication management)
    ↓
IntegrationsProvider (WhatsApp, Instagram integrations)
    ↓
NotificationProvider (Notification system)
    ↓
App (ÚLTIMO - Application components)
```

### 🚀 **BootGate Determinístico**

**Arquivo**: `src/providers/BootGate.tsx`

- **Preflight Checks**: Environment, configuration, backend health, feature flags
- **Timeout Configurável**: 5s default (vs 10s anterior) 
- **Failure Screen**: BootFailureScreen para falhas críticas
- **Sem "Proceed Anyway"**: Comportamento determinístico garantido
- **ErrorReporter**: Integração com error reporting centralizado

### 🛡️ **Sistema de Guards Padronizados**

**Arquivo**: `src/utils/createRequiredContextHook.ts`

- **createRequiredContextHook**: Factory para hooks type-safe
- **Error Messages**: Mensagens acionáveis com stack trace
- **Debug Info**: Provider readiness, BootGate status
- **Consistent API**: Interface unificada para todos os contextos

### ⚡ **ErrorReporter Service**

**Arquivo**: `src/services/ErrorReporter.ts`

- **Categorização**: BOOT_TIMEOUT, CRITICAL_DEPENDENCY, CONTEXT_ERROR
- **Sugestões**: Ações recomendadas baseadas no tipo de erro
- **Dev Utilities**: Debug helpers disponíveis em development
- **Centralized**: Único ponto de entrada para error handling

## Testing Architecture

### 🧪 **Testes de Invariantes (130+ cenários)**

**Localização**: `src/__tests__/providers/`

- **AuthProvider**: 27 invariantes (auth states, QueryClient, session, security)
- **IntegrationsProvider**: 26 invariantes (Instagram, WhatsApp, sync, errors)
- **NotificationProvider**: 25 invariantes (CRUD, WebSocket, browser notifications)
- **BootGate**: 27 invariantes (preflight, timeouts, ready states)
- **RootProviders**: 25 invariantes (provider order, integration, cleanup)

### 🔧 **Test Infrastructure**

- **Vitest + React Testing Library**: Ambiente de testes moderno
- **Mocks**: localStorage, fetch, WebSocket, Notification API
- **Test Utils**: Provider wrapper para testes isolados
- **Scripts**: `npm run test:providers`, `npm run test:coverage`

## User Authentication System

### 🔐 **Replit Auth Integration**

**Arquivo**: `src/contexts/AuthContext.tsx`

- **Providers**: Google, GitHub, Apple, Email/Password
- **Backend**: PostgreSQL com sessions via Drizzle ORM
- **Frontend**: React Query integration com AuthContext
- **Security**: Session-based authentication, secure redirects

### 🌐 **Authentication Flow**

1. **useReplitAuth Hook**: Verifica status via `/api/auth/user`
2. **Loading States**: Overlay durante inicialização
3. **Error Handling**: Network errors, invalid credentials
4. **Session Management**: Persistent sessions, secure logout

## Integration Services

### 📱 **WhatsApp Business Integration**

- **WhatsApp Gateway**: Puppeteer-based WhatsApp Web automation
- **Instance Management**: JSON metadata para múltiplas contas
- **QR Code**: Sessão-based authentication suportada
- **Real-time**: WebSocket para mensagens em tempo real

### 📸 **Instagram Integration**

- **Multi-Repository**: Combinação de ferramentas de automação
- **API Integration**: Connection states, error scenarios
- **OSINT Analysis**: Content download e analytics

### 🔔 **Notification System**

- **Types**: Success, error, info, warning notifications
- **WebSocket**: Real-time notification delivery
- **Browser Integration**: Native browser notifications
- **Queue Management**: CRUD operations com filtering

## Development Environment

### 🛠️ **Hot Module Replacement (HMR)**

- **Stable Context**: HMR-stable singleton contexts
- **State Preservation**: React Query cache mantido durante HMR
- **Debug Utilities**: Window globals para troubleshooting

### 🐛 **Debug Features**

- **Provider Diagram**: `window.__PROVIDERS_DIAGRAM__` com ordem canônica
- **Boot Status**: `window.__BOOT_GATE_READY__` para debug de inicialização
- **Context Debugging**: Logs detalhados de inicialização
- **Error Overlay**: Runtime error display em desenvolvimento

## Performance & Resource Management

### ⚡ **Resource Cleanup**

- **Effect Cleanup**: Proper cleanup de timers e event listeners
- **Memory Management**: Prevenção de memory leaks
- **AbortSignal**: Timeout implementation para health checks

### 📊 **Performance Monitoring**

- **Boot Timing**: Tracking de tempo de inicialização
- **Context Ready**: Monitoring de provider readiness
- **Error Reporting**: Performance metrics integrados

## Security Considerations

### 🔒 **Security Best Practices**

- **No Token Exposure**: Replit Auth gerencia tokens internamente
- **Secure Redirects**: `/api/login` e `/api/logout` endpoints
- **CORS Protection**: Configuração adequada para desenvolvimento
- **Session Security**: PostgreSQL-backed session storage

### 🛡️ **Error Boundary Protection**

- **Multiple Layers**: Context, Route, and Global error boundaries
- **Graceful Degradation**: Fallback UI para estados de erro
- **Error Reporting**: Centralizado via ErrorReporter service

## Troubleshooting Guide

### 🚨 **Common Issues & Solutions**

1. **Context Hooks Failing**:
   - Verificar order de providers no RootProviders
   - Confirmar BootGate ready state
   - Checar QueryClient availability

2. **Boot Failures**:
   - BootFailureScreen com retry options
   - ErrorReporter suggestions baseadas no erro
   - Debug info disponível via window globals

3. **Authentication Issues**:
   - Verificar `/api/auth/user` endpoint
   - Confirmar session cookies
   - Checar Replit Auth configuration

## Recent Changes (Setembro 2025)

### ✅ **DEFINITIVAMENTE RESOLVIDO: QueryClient Context Error**

**Problem**: `Error: No QueryClient set, use QueryClientProvider to set one` em ReactQueryDevtools causando crashes completos da aplicação

**Causa Raiz Final Identificada**: ReactQueryDevtools oficial da biblioteca @tanstack/react-query-devtools possui bug de contexto/timing no ambiente Replit com Vite HMR

**Solução Definitiva Implementada**:
1. **REMOÇÃO COMPLETA**: ReactQueryDevtools removido completamente do projeto
2. **CustomQueryDebugger**: Implementado replacement estável e funcional com:
   - Visualização de queries e mutations ativas
   - Botão "Invalidate All" para debugging
   - Interface minimalista e estável
   - Sem dependências externas problemáticas
3. **Provider Guards**: ProviderVerification component implementado seguindo Rules of Hooks
4. **Global Exposure**: QueryClient exposto em window.__REACT_QUERY_CLIENT__ para debug avançado
5. **Architecture Validation**: Ordem de providers validada e documentada

**Arquivos Modificados**:
- `src/providers/RootProviders.tsx`: 
  - Removed ReactQueryDevtools import and usage
  - Added CustomQueryDebugger replacement
  - Fixed ProviderVerification to follow React Rules of Hooks
  - Global QueryClient exposure for debugging
- Provider order FINAL: QueryClientProvider → ProviderVerification → ContextErrorBoundary → ErrorBoundary → AuthProvider → IntegrationsProvider → NotificationProvider → BootGate → App → CustomQueryDebugger

### ✅ **Implemented**

- **Provider-First Boot Architecture**: Ordem determinística garantida
- **BootGate Determinístico**: Eliminado comportamento "proceed anyway"
- **ErrorReporter Service**: Error handling centralizado
- **Invariant Testing**: 130+ cenários de teste implementados
- **Context Guards**: Sistema padronizado de verificações
- **SafeReactQueryDevtools**: Error-proof devtools rendering

### 📋 **Prevention Guidelines**

**Para prevenir erros futuros do QueryClient:**
1. **Sempre verificar**: QueryClient availability antes de usar hooks do React Query
2. **SafeWrapper Pattern**: Use try/catch wrappers para components que dependem de context
3. **Provider Order**: QueryClientProvider deve ser sempre o primeiro provider
4. **Debug Tools**: Use QueryClientDebugger para troubleshooting

### 📋 **Next Steps (Optional)**

1. **E2E Testing**: Playwright tests para validação completa
2. **CI Integration**: Test gates que bloqueiam merges em falhas
3. **Monitoring**: Production error reporting hooks
4. **Performance**: Boot timing optimization

## Architecture Principles

### 🎯 **Core Principles**

1. **Deterministic Boot**: Never "proceed anyway" - always handle failures gracefully
2. **Type Safety**: Strong typing com TypeScript e createRequiredContextHook
3. **Error Resilience**: Multiple layers de error boundaries
4. **Testability**: Comprehensive test coverage com invariant testing
5. **Developer Experience**: Rich debugging tools e clear error messages

### 🔄 **Maintainability**

- **Single Responsibility**: Cada provider tem responsabilidade bem definida
- **Loose Coupling**: Providers independentes com interfaces claras
- **Extensibility**: Fácil adicionar novos providers na ordem correta
- **Documentation**: Código auto-documentado com debug utilities

---

**System Status**: ✅ Production-Ready  
**Last Updated**: Setembro 16, 2025  
**Architecture Version**: Provider-First Boot v1.0  
**Test Coverage**: 130+ invariant scenarios