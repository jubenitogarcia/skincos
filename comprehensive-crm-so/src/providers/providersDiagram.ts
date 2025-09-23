// Provider Order Diagram for tooling and debugging
export const PROVIDERS_DIAGRAM = {
    order: [
        'QueryClientProvider',
        'ContextErrorBoundary',
        'ErrorBoundary',
        'AuthProvider',
        'IntegrationsProvider',
        'NotificationProvider',
        'BootGate',
        'App'
    ],
    critical: 'QueryClientProvider must be first - all React Query hooks depend on it',
    validation: 'BootGate moved AFTER context providers to ensure hooks have access to QueryClient'
}
