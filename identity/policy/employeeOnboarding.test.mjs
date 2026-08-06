import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEmployeeOnboardingFingerprintPayload,
  buildCorporateEmail,
  canCreateEmployee,
  isAllowedCorporateEmail,
  resolveEmployeeProfile,
  validateOnboardingInput,
} from './employeeOnboarding.js';

test('builds a stable onboarding fingerprint payload without raw contact data', () => {
  const base = {
    fullName: 'Pessoa Teste',
    corporateEmail: 'pessoateste@espacofacial.com',
    personalEmailHash: 'personal-hash',
    mobilePhoneHash: 'phone-hash',
    profile: 'CONSULTOR',
    department: 'Comercial',
    units: ['Barra Shopping Sul', 'Novo Hamburgo'],
    accountStatus: 'INVITED',
    requestedUsername: 'pessoateste',
  };
  const first = buildEmployeeOnboardingFingerprintPayload({
    input: base,
    requestedUsername: base.requestedUsername,
    personalEmailHash: base.personalEmailHash,
    mobilePhoneHash: base.mobilePhoneHash,
    team: { units: base.units, status: 'Ativo' },
  });
  const second = buildEmployeeOnboardingFingerprintPayload({
    input: { ...base, units: [...base.units].reverse() },
    requestedUsername: base.requestedUsername,
    personalEmailHash: base.personalEmailHash,
    mobilePhoneHash: base.mobilePhoneHash,
    team: { units: [...base.units].reverse(), status: 'Ativo' },
  });
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes('personal@example.com'), false);
  assert.equal(JSON.stringify(first).includes('51999999999'), false);
});

test('normalizes business role aliases without granting technical ADMIN', () => {
  assert.equal(resolveEmployeeProfile('Diretor').profile, 'GESTOR');
  assert.equal(resolveEmployeeProfile('Admin').profile, 'GESTOR');
  assert.equal(resolveEmployeeProfile('Responsável Técnico').profile, 'INJETOR');
  assert.equal(resolveEmployeeProfile('OPERADOR').profile, 'INJETOR');
});

test('derives closed unit scopes and fail-closes pending profiles', () => {
  const input = validateOnboardingInput({ fullName: 'Pessoa Teste', corporateEmail: 'corp@example.com', personalEmail: 'personal@example.com', mobilePhone: '(51) 99999-9999', units: ['NH', 'Barra Shopping Sul'], jobTitle: 'Coordenador', department: 'Recepção' });
  assert.deepEqual(input.units, ['novo-hamburgo', 'barra-shopping-sul']);
  assert.equal(input.accountStatus, 'PENDING_ACCESS');
  assert.deepEqual(input.modules, []);
  assert.equal(validateOnboardingInput({ ...input, units: ['unidade-invalida'] }), null);
});

test('builds the corporate address from the first and last name without accents or separators', () => {
  assert.equal(buildCorporateEmail('João da Silva'), 'joaosilva@espacofacial.com');
  assert.equal(buildCorporateEmail('Ana'), 'ana@espacofacial.com');
  assert.equal(validateOnboardingInput({
    fullName: 'João da Silva',
    corporateEmail: 'joaosilva2@espacofacial.com',
    personalEmail: 'ana@example.com',
    mobilePhone: '51999999999',
    units: ['NH'],
    jobTitle: 'Consultor',
    department: 'Comercial',
    username: 'joao.silva',
  }, { unified: true }).corporateEmailOverridden, true);
  assert.equal(validateOnboardingInput({
    fullName: 'João da Silva',
    corporateEmail: 'joao@outro.com',
    personalEmail: 'ana@example.com',
    mobilePhone: '51999999999',
    units: ['NH'],
    jobTitle: 'Consultor',
    department: 'Comercial',
  }, { requireCorporateDomain: true }), null);
  assert.equal(validateOnboardingInput({
    fullName: 'Synthetic Ponto Supervisor',
    corporateEmail: 'stg-ponto-123456789-onboarding@staging.invalid',
    personalEmail: 'stg-ponto-123456789-personal@staging.invalid',
    mobilePhone: '+5551999999999',
    units: ['NH'],
    jobTitle: 'Supervisor',
    department: 'stg-ponto-123456789-department',
  }).accountStatus, 'PENDING_ACCESS');
  assert.equal(validateOnboardingInput({
    fullName: 'João da Silva',
    corporateEmail: 'joaosilva@espacofacial.com',
    personalEmail: 'ana@example.com',
    mobilePhone: '51999999999',
    units: ['NH'],
    jobTitle: 'Supervisor',
    department: 'Comercial',
  }, { unified: true }).accountStatus, 'INVITED');
  assert.equal(validateOnboardingInput({
    fullName: 'Synthetic Ponto Supervisor',
    corporateEmail: 'stg-ponto-123456789-onboarding@staging.invalid',
    personalEmail: 'stg-ponto-123456789-personal@staging.invalid',
    mobilePhone: '+5551999999999',
    units: ['NH'],
    jobTitle: 'Supervisor',
    department: 'stg-ponto-123456789-department',
  }, { unified: true }), null);
});

test('accepts only a numeric collision suffix without evaluating user input as a pattern', () => {
  assert.equal(isAllowedCorporateEmail('A+B Pessoa', 'abpessoa@espacofacial.com'), true);
  assert.equal(isAllowedCorporateEmail('A+B Pessoa', 'abpessoa2@espacofacial.com'), true);
  assert.equal(isAllowedCorporateEmail('A+B Pessoa', 'abpessoaabc@espacofacial.com'), false);
  assert.equal(isAllowedCorporateEmail('A+B Pessoa', 'abpessoa+2@espacofacial.com'), false);
});

test('keeps punctuation out of the collision base before checking a suffix', () => {
  assert.equal(buildCorporateEmail('A.* Pessoa'), 'apessoa@espacofacial.com');
  assert.equal(isAllowedCorporateEmail('A.* Pessoa', 'apessoa7@espacofacial.com'), true);
  assert.equal(isAllowedCorporateEmail('A.* Pessoa', 'aXXpessoa7@espacofacial.com'), false);
});

test('enforces hierarchy and unit subset without treating empty scope as global', () => {
  assert.equal(canCreateEmployee({ actorRole: 'GESTOR', actorAllowedUnits: ['novo-hamburgo'], targetProfile: 'GERENTE', units: ['novo-hamburgo'] }), null);
  assert.equal(canCreateEmployee({ actorRole: 'GERENTE', actorAllowedUnits: ['novo-hamburgo'], targetProfile: 'GESTOR', units: ['novo-hamburgo'] }), 'ROLE_DENIED');
  assert.equal(canCreateEmployee({ actorRole: 'GESTOR', actorAllowedUnits: [], targetProfile: 'CONSULTOR', units: ['novo-hamburgo'] }), 'INVITER_SCOPE_REQUIRED');
  assert.equal(canCreateEmployee({ actorRole: 'GESTOR', actorAllowedUnits: ['novo-hamburgo'], targetProfile: 'CONSULTOR', units: ['barra-shopping-sul'] }), 'INVITE_UNITS_DENIED');
});
