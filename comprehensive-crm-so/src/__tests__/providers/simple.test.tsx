import { describe, it, expect } from 'vitest'
import React from 'react'
import { render, screen } from '@testing-library/react'

function SimpleComponent() {
  return <div data-testid="simple">Simple Test</div>
}

describe('Simple Test', () => {
  it('should render a simple component', () => {
    render(<SimpleComponent />)
    expect(screen.getByTestId('simple')).toHaveTextContent('Simple Test')
  })
})