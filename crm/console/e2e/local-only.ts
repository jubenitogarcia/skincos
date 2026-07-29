import type { Page } from '@playwright/test'

const loopbackHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

export async function blockNonLoopbackRequests(page: Page) {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (loopbackHosts.has(url.hostname)) {
      await route.continue()
      return
    }

    if (route.request().resourceType() === 'stylesheet') {
      await route.fulfill({ contentType: 'text/css', body: '' })
      return
    }

    await route.abort()
  })
}
