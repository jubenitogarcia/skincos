export type PontoApiError = { ok?: boolean; error?: string; message?: string; code?: string; hint?: string; requestId?: string }

export type PontoEmployeePublic = {
  id: string
  employeeId?: string
  code?: string
  name: string
  cpf?: string
  birthDate?: string
  jobTitle?: string
  phone?: string
  loginEmail?: string
  unit?: string
  units?: string[]
  status?: 'ACTIVE' | 'LEAVE' | 'TERMINATED'
  active?: boolean
  createdAt?: string
  updatedAt?: string
  deletedAt?: string | null
  terminatedAt?: string | null
  faceDescriptorsCount?: number
  lastEnrolledAt?: string | null
  pinSet?: boolean
}

export type PontoDevicePublic = { id: string; label?: string; unit?: string; unitId?: string; active?: boolean; createdAt?: string; revokedAt?: string | null; lastSeenAt?: string | null; deviceMode?: 'TERMINAL' | string; networkPolicy?: 'NONE' | 'OBSERVE' | 'REQUIRE' | string; allowedNetworksCount?: number }
export type PontoPresencePolicy = { unitId: string; presenceMode: 'TERMINAL_REQUIRED' | 'EXTERNAL_REVIEW' | 'FLEXIBLE'; geofenceLatitude?: number | null; geofenceLongitude?: number | null; geofenceRadiusMeters?: number }
export type PontoEmailConflict = { email: string; count: number; employees: PontoEmployeePublic[] }
export type PontoPunchRecord = { id: string; kind: 'PUNCH'; employeeId: string; employeeName: string; type: 'IN' | 'OUT' | string; eventType?: string; at: string; unit?: string | null; unitId?: string | null; deviceId?: string | null; deviceLabel?: string | null; method?: 'FACE' | 'PIN' | 'MANUAL' | 'IMPORT' | string; source?: string; note?: string | null; corrected?: { id: string; at: string; reason?: string | null } | null }

export type PontoMeResponse =
  | { ok: true; linked: false; actorEmail?: string; hint?: string; allowedUnits?: string[] }
  | { ok: true; linked: true; actorEmail?: string; allowedUnits?: string[]; employee: PontoEmployeePublic; hasFace: boolean; pinSet: boolean; lastPunch: PontoPunchRecord | null; cooldown?: { active: boolean; secondsRemaining?: number }; suggestedNextMethod?: 'FACE' | 'PIN'; capabilities?: string[] }

export type PontoProfile = {
  employeeId: string
  legalName: string
  socialName?: string | null
  employeeCode?: string | null
  loginEmail?: string | null
  personalEmail?: string | null
  mobilePhone?: string | null
  jobTitle?: string | null
  status: 'ACTIVE' | 'LEAVE' | 'TERMINATED' | string
  admittedAt?: string | null
  dismissedAt?: string | null
  groupName?: string | null
  departmentName?: string | null
  manager?: { employeeId: string; name: string } | null
  units: string[]
  birthDate?: string | null
  birthPlace?: string | null
  educationLevel?: string | null
  address: { zipCode?: string | null; street?: string | null; number?: string | null; complement?: string | null; neighborhood?: string | null; city?: string | null; state?: string | null }
  documents: { cpf: 'CADASTRADO' | 'PENDENTE'; pis: 'CADASTRADO' | 'PENDENTE'; rg: 'CADASTRADO' | 'PENDENTE'; family: 'CADASTRADO' | 'PENDENTE' }
}

export type PontoMyProfileResponse = { ok: true; data: { profile: PontoProfile; completeness: { missing: string[]; complete: string[]; documents: PontoProfile['documents'] } } }

export type PontoDayResult = { date: string; timeZone: string; expectedMinutes: number; workedMinutes: number; breakMinutes: number; lateMinutes: number; earlyLeaveMinutes: number; overtimeMinutes: number; dailyBalanceMinutes: number; accumulatedBalanceMinutes?: number; status: string; inconsistencies: Array<{ code: string; eventId?: string | null }>; frozen?: boolean }
export type PontoMonthlyResult = { employee: PontoEmployeePublic; unitId: string; from: string; to: string; openingBalanceMinutes: number; closingBalanceMinutes: number; days: PontoDayResult[] }
export type PontoCorrection = { id: string; eventId: string; employeeId: string; employeeName: string; unitId: string; originalAtUtc: string; proposedAtUtc: string; requestedAt: string; requestedBy: string; reason: string; status: 'PENDING' | 'APPROVED' | 'REJECTED'; decidedAt?: string | null; decisionReason?: string | null }
export type PontoPermission = 'self.read' | 'self.punch' | 'unit.read' | 'correction.request' | 'correction.approve' | 'period.close' | 'period.reopen' | 'device.manage' | 'export.read' | 'audit.read'
