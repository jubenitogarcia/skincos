#!/usr/bin/env node
/**
 * Source-only handoff state transition for the Atendimento -> CRM Core delta.
 *
 * The command reads one operator-supplied JSON envelope and writes the next
 * envelope to stdout. It has no database, network, environment, secret or
 * deployment access by construction. A real operator must obtain the source
 * snapshot, Core receipt and readback from their separately governed steps.
 */
import { readFile } from 'node:fs/promises'

import {
    acceptAtendimentoProjectionDeltaBaseline,
    createAtendimentoProjectionDeltaBaselinePrepared,
    markAtendimentoProjectionDeltaReady,
} from '../server/atendimento/crmCoreProjectionDeltaBaseline.js'

function usage() {
    throw new Error('Use exatamente uma ação: --prepare, --accept ou --ready, com --input <arquivo>.')
}

function argument(name) {
    const index = process.argv.indexOf(name)
    if (index < 0 || !process.argv[index + 1] || process.argv[index + 1].startsWith('-')) usage()
    return process.argv[index + 1]
}

function action() {
    const actions = ['--prepare', '--accept', '--ready'].filter((entry) => process.argv.includes(entry))
    if (actions.length !== 1) usage()
    return actions[0]
}

async function input() {
    try {
        const raw = await readFile(argument('--input'), 'utf8')
        return JSON.parse(raw)
    } catch {
        throw new Error('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INPUT_INVALID')
    }
}

const selected = action()
const value = await input()
let result
if (selected === '--prepare') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ATENDIMENTO_CRM_PROJECTION_DELTA_BASELINE_INPUT_INVALID')
    result = createAtendimentoProjectionDeltaBaselinePrepared(value)
} else if (selected === '--accept') {
    result = acceptAtendimentoProjectionDeltaBaseline(value?.baseline, value?.receipt)
} else {
    result = markAtendimentoProjectionDeltaReady(value?.baseline, value?.readback)
}
process.stdout.write(`${JSON.stringify(result)}\n`)
