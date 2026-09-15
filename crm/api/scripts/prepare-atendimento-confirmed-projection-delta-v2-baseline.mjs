#!/usr/bin/env node
/**
 * Offline contract transition helper for a sanitized v5 baseline envelope.
 * It has no database, network, environment secret or deployment access.
 * Database custody remains with confirmedProjectionDeltaV2Migration.js.
 */
import { readFile } from 'node:fs/promises'

import {
  acceptAtendimentoConfirmedProjectionBaselineV2,
  createAtendimentoConfirmedProjectionBaselineV2Prepared,
  markAtendimentoConfirmedProjectionBaselineV2Ready,
} from '../../../shared/crm-auth/atendimentoConfirmedProjectionBaselineV2.js'

function usage() {
  throw new Error('Use exatamente --prepare, --accept ou --ready, com --input <arquivo>.')
}

function action() {
  const selected = ['--prepare', '--accept', '--ready'].filter((entry) => process.argv.includes(entry))
  if (selected.length !== 1) usage()
  return selected[0]
}

function inputPath() {
  const index = process.argv.indexOf('--input')
  if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith('-')) usage()
  return process.argv[index + 1]
}

let envelope
try {
  envelope = JSON.parse(await readFile(inputPath(), 'utf8'))
} catch {
  throw new Error('ATENDIMENTO_CONFIRMED_PROJECTION_BASELINE_V2_INPUT_INVALID')
}

const selected = action()
let result
if (selected === '--prepare') {
  result = createAtendimentoConfirmedProjectionBaselineV2Prepared(envelope)
} else if (selected === '--accept') {
  result = acceptAtendimentoConfirmedProjectionBaselineV2(envelope?.baseline, envelope?.receipts)
} else {
  result = markAtendimentoConfirmedProjectionBaselineV2Ready(envelope?.baseline, envelope?.readback)
}
process.stdout.write(`${JSON.stringify(result)}\n`)
