import { normalizeAllowedUnits, unknownUnitScopes } from '../../shared/identity-contract/index.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CORPORATE_DOMAIN = 'espacofacial.com';
const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,39}$/;

export const EMPLOYEE_PROFILES = Object.freeze({
  GESTOR: Object.freeze({ rank: 4, modules: ['ponto', 'atendimento', 'conversa', 'finance', 'insumos'], accountStatus: 'INVITED' }),
  GERENTE: Object.freeze({ rank: 3, modules: ['ponto', 'atendimento', 'insumos'], accountStatus: 'INVITED' }),
  SUPERVISOR: Object.freeze({ rank: 2, modules: [], accountStatus: 'PENDING_ACCESS' }),
  INJETOR: Object.freeze({ rank: 1, modules: [], accountStatus: 'PENDING_ACCESS' }),
  CONSULTOR: Object.freeze({ rank: 1, modules: ['atendimento'], accountStatus: 'PENDING_ACCESS' }),
});

// The unified team contract is intentionally opt-in so the existing onboarding
// saga keeps its states and compensation semantics during the expand phase.
const UNIFIED_EMPLOYEE_PROFILES = Object.freeze({
  GESTOR: EMPLOYEE_PROFILES.GESTOR,
  GERENTE: EMPLOYEE_PROFILES.GERENTE,
  SUPERVISOR: Object.freeze({ rank: 2, modules: ['ponto'], accountStatus: 'INVITED' }),
  INJETOR: Object.freeze({ rank: 1, modules: ['ponto'], accountStatus: 'INVITED' }),
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

export function normalizePersonalEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return EMAIL_RE.test(email) ? email : '';
}

function normalizeNameSlug(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 40);
}

export function buildCorporateEmail(fullName) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  const first = normalizeNameSlug(parts[0]);
  const last = parts.length > 1 ? normalizeNameSlug(parts[parts.length - 1]) : '';
  if (!first || (parts.length > 1 && !last)) return '';
  return `${first}${last}@${CORPORATE_DOMAIN}`;
}

export function normalizeEmployeeUsername(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9._-]+/g, '')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 40);
  return USERNAME_RE.test(normalized) ? normalized : '';
}

export function suggestEmployeeUsername(fullName, corporateEmail = '') {
  const local = String(corporateEmail || '').split('@')[0] || '';
  const fromEmail = normalizeEmployeeUsername(local);
  if (fromEmail) return fromEmail;
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  const candidate = normalizeEmployeeUsername(`${parts[0] || ''}${parts.length > 1 ? parts[parts.length - 1] : ''}`);
  return candidate || '';
}

export function isAllowedCorporateEmail(fullName, corporateEmail) {
  const email = normalizeCorporateEmail(corporateEmail);
  const generated = buildCorporateEmail(fullName);
  if (!email || !email.endsWith(`@${CORPORATE_DOMAIN}`) || !generated) return false;
  const local = email.slice(0, email.indexOf('@'));
  const generatedLocal = generated.slice(0, generated.indexOf('@'));
  if (local === generatedLocal) return true;
  if (!local.startsWith(generatedLocal)) return false;
  const suffix = local.slice(generatedLocal.length);
  return suffix.length > 0 && Array.from(suffix).every((character) => character >= '0' && character <= '9');
}

export function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  const e164 = digits.startsWith('55') ? digits : `55${digits}`;
  return e164.length >= 12 && e164.length <= 13 ? `+${e164}` : '';
}

export function resolveEmployeeProfile(value, options = {}) {
  const profile = TITLE_ALIASES[key(value)] || '';
  const definitions = options.unified === true ? UNIFIED_EMPLOYEE_PROFILES : EMPLOYEE_PROFILES;
  return profile ? { profile, ...definitions[profile] } : null;
}

export function displayJobTitle(profile) {
  return ({ GESTOR: 'Gestor', GERENTE: 'Gerente', SUPERVISOR: 'Coordenador', INJETOR: 'Injetor', CONSULTOR: 'Consultor' })[profile] || '';
}

export function validateOnboardingInput(input = {}, options = {}) {
  const unified = options.unified === true;
  const requireCorporateDomain = options.requireCorporateDomain === true || unified;
  const fullName = String(input.fullName ?? input.name ?? '').trim().replace(/\s+/g, ' ');
  const generatedCorporateEmail = buildCorporateEmail(fullName);
  const rawCorporateEmail = input.corporateEmail ?? input.email;
  const hasSuppliedCorporateEmail = rawCorporateEmail !== undefined && rawCorporateEmail !== null && String(rawCorporateEmail).trim() !== '';
  const suppliedCorporateEmail = normalizeCorporateEmail(rawCorporateEmail);
  const corporateEmail = suppliedCorporateEmail || generatedCorporateEmail;
  const personalEmail = normalizePersonalEmail(input.personalEmail);
  const mobilePhone = normalizePhone(input.mobilePhone ?? input.phone);
  const invalidUnits = unknownUnitScopes(input.units ?? input.allowedUnits);
  const units = normalizeAllowedUnits(input.units ?? input.allowedUnits);
  const profile = resolveEmployeeProfile(input.jobTitle ?? input.role, { unified });
  const department = String(input.department || '').trim().replace(/\s+/g, ' ').slice(0, 120);
  const suppliedUsername = input.username ?? input.requestedUsername;
  const requestedUsername = suppliedUsername === undefined || suppliedUsername === null || String(suppliedUsername).trim() === ''
    ? suggestEmployeeUsername(fullName, corporateEmail)
    : normalizeEmployeeUsername(suppliedUsername);
  if (
    !fullName ||
    !generatedCorporateEmail ||
    (hasSuppliedCorporateEmail && !suppliedCorporateEmail) ||
    !corporateEmail ||
    (requireCorporateDomain && !isAllowedCorporateEmail(fullName, corporateEmail)) ||
    !personalEmail ||
    !mobilePhone ||
    !department ||
    !profile ||
    !requestedUsername ||
    !units.length ||
    invalidUnits.length
  ) return null;
  const base = {
    fullName,
    corporateEmail,
    personalEmail,
    mobilePhone,
    units,
    department,
    ...profile,
  };
  if (!unified) return base;
  return {
    ...base,
    generatedCorporateEmail,
    corporateEmailOverridden: corporateEmail !== generatedCorporateEmail,
    requestedUsername,
  };
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
    username: row.requested_username || null,
    workforceEmployeeId: row.workforce_employee_id || null,
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
