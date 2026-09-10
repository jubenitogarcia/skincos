import { describe, expect, it } from 'vitest'
import { verifyPontoPagesRemoteProject } from '../scripts/verify-ponto-pages-remote-project.mjs'

const project = 'skincos-ponto-staging'
const subdomain = `${project}.pages.dev`

function response(domains: string[]) {
  return {
    success: true,
    result: {
      name: project,
      production_branch: 'main',
      subdomain,
      domains,
      source: null,
    },
  }
}

describe('dedicated Ponto Pages remote project identity', () => {
  it('accepts the Pages-owned subdomain listed by Cloudflare', () => {
    expect(() => verifyPontoPagesRemoteProject(response([subdomain]), project)).not.toThrow()
  })

  it('rejects every custom domain while preserving the Pages-owned subdomain exception', () => {
    expect(() => verifyPontoPagesRemoteProject(response([subdomain, 'ponto.example.com']), project))
      .toThrow('PONTO_PAGES_REMOTE_CUSTOM_DOMAIN_PRESENT')
  })
})
