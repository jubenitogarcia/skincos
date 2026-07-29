import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button } from './button'

const meta = {
  title: 'Primitives/Button',
  component: Button,
  tags: ['autodocs'],
  args: { children: 'Salvar dados sintéticos' },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
export const Hover: Story = { args: { variant: 'outline' } }
export const Focus: Story = { play: async ({ canvas }) => { canvas.getByRole('button').focus() } }
export const Loading: Story = { args: { disabled: true, children: 'Carregando…' } }
export const Empty: Story = { args: { children: 'Sem itens' } }
export const Error: Story = { args: { variant: 'destructive', children: 'Tentar novamente' } }
export const Success: Story = { args: { variant: 'default', children: 'Concluído' } }
export const Disabled: Story = { args: { disabled: true } }
export const LongContent: Story = { args: { children: 'Salvar uma alteração com conteúdo excepcionalmente longo para validar quebra de linha e tamanho do controle' } }
