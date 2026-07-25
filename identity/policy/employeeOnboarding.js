import { normalizeAllowedUnits, unknownUnitScopes } from '../../shared/identity-contract/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const EMPLOYEE_PROFILES = Object.freeze({
  GESTOR: Object.freeze({ rank: 4, modules: ['ponto', 'atendimento', 'conversa', 'finance', 'insumos'], accountStatus: 'INVITED' }),
  GERENTE: Object.freeze({ rank: 3, modules: ['ponto', 'atendimento', 'insumos'], accountStatus: 'INVITED' }),
  SUPERVISOR: Object.freeze({ rank: 2, modules: [], accountStatus: 'PENDING_ACCESS' }),
  INJETOR: Object.freeze({ rank: 1, modules: [], accountStatus: 'PENDING_ACCESS' }),
  CONSULTOR: Object.freeze({ rank: 1, modules: ['atendimento'], accountStatus: 'INVITED' }),
});

const TITLE_ALIASES = Object.freeze({
  diretor: 'GESTOR', gestor: 'GESTOR', admin: 'GESTOR',
  gerente: 'GERENTE', coordenador: 'SUPERVISOR', supervisor: 'SUPERVISOR',
  'responsavel tecnico': 'INJETOR', 'responsável técnico': 'INJETOR', injetor: 'INJETOR', operador: 'INJETOR',
  consultor: 'CONSULTOR',
});

function key(value) {
  return String(value || '').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

export function normalizeCorporateEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : '';
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  const e164 = digits.startsWith('55') ? digits : `55${digits}`;
  return e164.length >= 12 && e164.length <= 13 ? `+${e164}` : '';
}

export function resolveEmployeeProfile(value) {
  const profile = TITLE_ALIASES[key(value)] || '';
  return profile ? { profile, ...EMPLOYEE_PROFILES[profile] } : null;
}

export function displayJobTitle(profile) {
  return ({ GESTOR: 'Gestor', GERENTE: 'Gerente', SUPERVISOR: 'Coordenador', INJETOR: 'Injetor', CONSULTOR: 'Consultor' })[profile] || '';
}

export function validateOnboardingInput(input = {}) {
  const fullName = String(input.fullName ?? input.name ?? '').trim().replace(/\s+/g, ' ');
  const corporateEmail = normalizeCorporateEmail(input.corporateEmail ?? input.email);
  const personalEmail = normalizeCorporateEmail(input.personalEmail);
  const mobilePhone = normalizePhone(input.mobilePhone ?? input.phone);
  const invalidUnits = unknownUnitScopes(input.units ?? input.allowedUnits);
  const units = normalizeAllowedUnits(input.units ?? input.allowedUnits);
  const profile = resolveEmployeeProfile(input.jobTitle ?? input.role);
  const department = String(input.department || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!fullName || !corporateEmail || !personalEmail || !mobilePhone || !department || !profile || !units.length || invalidUnits.length) return null;
  return { fullName, corporateEmail, personalEmail, mobilePhone, units, department, ...profile };
}

export function canCreateEmployee({ actorRole, actorAllowedUnits, targetProfile, units }) {
  const actorProfile = String(actorRole || '').trim().toUpperCase();
  if (actorProfile === 'ADMIN') return null; // technical break-glass compatibility
  const actor = EMPLOYEE_PROFILES[actorProfile];
  const target = EMPLOYEE_PROFILES[String(targetProfile || '').toUpperCase()];
  if (!actor || !target || target.rank >= actor.rank) return 'ROLE_DENIED';
  const allowed = normalizeAllowedUnits(actorAllowedUnits);
  if (!allowed.length) return 'INVITER_SCOPE_REQUIRED';
  if ((units || []).some((unit) => !allowed.includes(unit))) return 'INVITE_UNITS_DENIED';
  return null;
}

export function publicOnboarding(row) {
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.full_name,
    corporateEmail: row.corporate_email,
    profile: row.profile,
    jobTitle: row.job_title,
    department: row.department_name,
    units: normalizeAllowedUnits(row.units_json),
    accountStatus: row.account_status,
    inviteId: row.invite_id || null,
    provisioningState: row.provisioning_state || null,
    compensationState: row.compensation_state || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
