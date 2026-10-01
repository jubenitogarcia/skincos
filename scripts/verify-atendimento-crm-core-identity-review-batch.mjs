#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import {
  assertAtendimentoCrmCoreIdentityReviewBatch,
  digestAtendimentoCrmCoreIdentityReviewBatch,
} from '../shared/crm-auth/atendimentoCrmCoreIdentityReviewBatch.js'

function fail(code) {
  throw new Error(`ATENDIMENTO_CRM_CORE_IDENTITY_REVIEW_BATCH_VERIFICATION_FAILED:${code}`)
}

function parseArguments(args) {
  if (args.length === 2 && args[0] === '--batch' && args[1] && !args[1].startsWith('-')) return args[1]
  fail('OPERATION_NOT_SUPPORTED')
}

function readBatch(file) {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'))
  } catch {
    fail('BATCH_READ_FAILED')
  }
}

export function verifyAtendimentoCrmCoreIdentityReviewBatch(file) {
  const batch = assertAtendimentoCrmCoreIdentityReviewBatch(readBatch(file))
  return Object.freeze({
    contract: batch.contract,
    linkCount: batch.links.length,
    digest: digestAtendimentoCrmCoreIdentityReviewBatch(batch),
  })
}

function main() {
  process.stdout.write(`${JSON.stringify(verifyAtendimentoCrmCoreIdentityReviewBatch(parseArguments(process.argv.slice(2))))}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'ATENDIMENTO_CRM_CORE_IDENTITY_REVIEW_BATCH_VERIFICATION_FAILED'}\n`)
    process.exitCode = 1
  }
}
