# Provider Hierarchy - Critical Order

**⚠️ CRITICAL: Provider order must be preserved to prevent QueryClient errors**

## Required Order
```
QueryClientProvider (FIRST - must wrap everything)
├── ContextErrorBoundary
├── ErrorBoundary
├── AuthProvider
├── IntegrationsProvider
├── NotificationProvider
└── App (LAST)
```

## Why This Order Matters
- **QueryClientProvider** must be the outermost provider
- All React Query hooks (`useQuery`, `useQueryClient`) require QueryClient context
- Changing this order will cause: "No QueryClient set, use QueryClientProvider to set one"

## Prevention
- Never move QueryClientProvider below other providers
- Always verify provider order during refactoring
- Keep this hierarchy documented and updated

---
*Generated automatically to prevent regressions*