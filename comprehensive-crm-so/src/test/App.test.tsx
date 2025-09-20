import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { AuthProvider } from '../contexts/AuthContext'
import { IntegrationsProvider } from '../contexts/IntegrationsContext'
import App from '../App'

// Test wrapper with providers
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>
    <IntegrationsProvider>
      {children}
    </IntegrationsProvider>
  </AuthProvider>
)

describe('App', () => {
  it('renders without crashing', () => {
    expect(() => {
      render(
        <TestWrapper>
          <App />
        </TestWrapper>
      )
    }).not.toThrow()
  })
})