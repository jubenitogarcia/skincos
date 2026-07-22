import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSupplementalLeadIdentityPlan, buildSupplementalLeadProfiles } from '../supplementalLeadIdentity.js'

test('consolidates exact duplicate lead rows without merging a shared-family phone', () => {
    const profiles = buildSupplementalLeadProfiles({ spreadsheetId: 'lead-test', tabs: { Lead: [
        ['NOME', 'TELEFONE', 'EMAIL', 'UNIDADE'],
        ['Ana Silva', '(51) 99999-0000', 'ana@example.com', 'Novo Hamburgo'],
        ['Ana Silva', '51999990000', '', 'Novo Hamburgo'],
        ['Bruno Silva', '51999990000', '', 'Novo Hamburgo'],
    ] } })
    assert.equal(profiles.length, 2)
    assert.equal(profiles.find((item) => item.nameKey === 'ana silva').sourceRows.length, 2)
})

test('automatically confirms only unique email or matching name and phone', () => {
    const profiles = buildSupplementalLeadProfiles({ spreadsheetId: 'lead-test', tabs: { Lead: [
        ['NOME', 'TELEFONE', 'EMAIL'], ['Ana Silva', '51999990000', 'ana@example.com'], ['Bruno Silva', '51999990000', ''],
    ] } })
    const plan = buildSupplementalLeadIdentityPlan({ profiles, appRegistrations: [
        { id: 'app-ana', nameKey: 'ana silva', phones: [], emails: ['ana@example.com'], units: [] },
        { id: 'app-camila', nameKey: 'camila souza', phones: ['5551999990000'], emails: [], units: [] },
    ] })
    assert.equal(plan.appLinks.filter((item) => item.status === 'auto_confirmed').length, 1)
    assert.equal(plan.appLinks.filter((item) => item.status === 'suggested').length, 1)
})
