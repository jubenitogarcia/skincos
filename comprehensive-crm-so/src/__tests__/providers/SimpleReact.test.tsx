/**
 * Simple React Test - Diagnose Basic React Functionality
 * 
 * This test helps identify if the core React setup is working
 * before testing complex BootGate functionality.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import React, { useState } from 'react'

// Simple React component for testing
function SimpleComponent() {
  const [count, setCount] = useState(0)
  
  return (
    <div>
      <div data-testid="count">Count: {count}</div>
      <button 
        data-testid="increment" 
        onClick={() => setCount(c => c + 1)}
      >
        Increment
      </button>
    </div>
  )
}

describe('Simple React Test', () => {
  it('should render a basic React component', () => {
    render(<SimpleComponent />)
    expect(screen.getByTestId('count')).toBeInTheDocument()
    expect(screen.getByText('Count: 0')).toBeInTheDocument()
  })

  it('should handle useState hook', () => {
    render(<SimpleComponent />)
    expect(screen.getByText('Count: 0')).toBeInTheDocument()
    
    // Test useState is working
    const button = screen.getByTestId('increment')
    expect(button).toBeInTheDocument()
  })

  it('should not throw useState null error', () => {
    expect(() => {
      render(<SimpleComponent />)
    }).not.toThrow()
  })
})