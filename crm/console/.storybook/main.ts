import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  stories: ['../*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-a11y',
    { name: '@storybook/addon-mcp', options: { endpoint: '/mcp' } },
  ],
  framework: { name: '@storybook/react-vite', options: {} },
}

export default config
