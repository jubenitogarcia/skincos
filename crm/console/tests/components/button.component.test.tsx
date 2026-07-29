import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Button } from '../../button'

describe('Button infrastructure smoke', () => {
  it('supports an accessible name, keyboard focus and perceived interaction', async () => {
    const user = userEvent.setup()
    let clicks = 0
    render(<Button onClick={() => { clicks += 1 }}>Salvar dados sintéticos</Button>)

    const button = screen.getByRole('button', { name: 'Salvar dados sintéticos' })
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(clicks).toBe(1)
  })
})
