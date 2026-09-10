const enabled = String(process.env.PONTO_PAGES_DEPLOY_ENABLED || '').trim().toLowerCase()

if (enabled !== 'true') {
  throw new Error('PONTO_PAGES_DEPLOY_DISABLED: Phase 1 contains no Pages publisher. Set no deployment intent here; use the governed successor phase.')
}

throw new Error('PONTO_PAGES_PHASE1_NO_PUBLISHER: explicit intent cannot publish from this source-only phase.')
