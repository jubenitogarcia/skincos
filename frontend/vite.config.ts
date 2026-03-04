import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";
import type { PluginOption } from "vite";

function createIconImportProxy() {
  return {
    name: 'mock-icon-import-proxy',
    configureServer() { },
    transform() {
      return null
    }
  }
}

function sparkPlugin() {
  return {
    name: 'mock-spark-plugin',
    configureServer() { },
    transform() {
      return null
    }
  }
}
import { resolve } from 'path'

const projectRoot = process.env.PROJECT_ROOT || import.meta.dirname

// https://vite.dev/config/
const apiProxyTarget =
  process.env.VITE_API_PROXY_TARGET ||
  process.env.API_PROXY_TARGET ||
  'http://localhost:8099'

const localAuthBypassEnabled = String(process.env.VITE_LOCAL_AUTH_BYPASS ?? 'true').toLowerCase() !== 'false'
const localAuthRole = (() => {
  const raw = String(process.env.VITE_LOCAL_AUTH_ROLE || 'GESTOR').trim().toUpperCase()
  if (raw === 'ADMIN') return 'GESTOR'
  if (raw === 'OPERADOR') return 'INJETOR'
  return raw || 'GESTOR'
})()
const localAuthEmail = String(process.env.VITE_LOCAL_AUTH_EMAIL || 'dev@local.test').trim() || 'dev@local.test'
const localAuthUsername = String(process.env.VITE_LOCAL_AUTH_USERNAME || localAuthEmail.split('@')[0] || 'dev').trim() || 'dev'
const localAuthName = String(process.env.VITE_LOCAL_AUTH_NAME || 'Dev Local').trim() || 'Dev Local'
const localAuthAllowedUnits = String(process.env.VITE_LOCAL_AUTH_ALLOWED_UNITS || '').trim()
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const localAuthAllowedModules = String(process.env.VITE_LOCAL_AUTH_ALLOWED_MODULES || '').trim()
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean)
const localEscalaMockEnabled = localAuthBypassEnabled && String(process.env.VITE_LOCAL_ESCALA_MOCK ?? 'true').toLowerCase() !== 'false'
const localAuthUser = {
  username: localAuthUsername,
  email: localAuthEmail,
  displayName: localAuthName,
  role: localAuthRole,
  allowedUnits: localAuthAllowedUnits,
  allowedModules: localAuthAllowedModules,
  createdAt: new Date().toISOString()
}

type LocalProfessional = {
  name: string
  status: string
  units: string[]
  role: string
  shift: string
  nickname: string
  phone: string
  email: string
  instagram: string
}
type LocalScheduleEntry = { date: string; unit: string; professional: string }
type LocalClosedDay = { date: string; unit: string; reason: string }
type LocalHoliday = { date: string; unit: string; name: string }

const localEscalaStore: {
  professionals: LocalProfessional[]
  schedule: LocalScheduleEntry[]
  closedDays: LocalClosedDay[]
  holidays: LocalHoliday[]
} = {
  professionals: [
    {
      name: 'Dra. Ana',
      status: 'Ativo',
      units: ['novo-hamburgo'],
      role: 'Injetor',
      shift: 'Integral',
      nickname: 'Ana',
      phone: '',
      email: 'ana@local.test',
      instagram: ''
    },
    {
      name: 'Dr. Lucas',
      status: 'Ativo',
      units: ['novo-hamburgo', 'porto-alegre'],
      role: 'Injetor',
      shift: 'Integral',
      nickname: 'Lucas',
      phone: '',
      email: 'lucas@local.test',
      instagram: ''
    },
    {
      name: 'Dra. Carla',
      status: 'Ativo',
      units: ['porto-alegre'],
      role: 'Injetor',
      shift: 'Integral',
      nickname: 'Carla',
      phone: '',
      email: 'carla@local.test',
      instagram: ''
    }
  ],
  schedule: [],
  closedDays: [],
  holidays: []
}

function toJson(res: any, status: number, body: any) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(body))
}

function parseJsonBody(req: any): Promise<any> {
  return new Promise((resolve) => {
    const chunks: any[] = []
    req.on('data', (chunk: any) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve(null)
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

function isValidIsoDate(value: unknown): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

function csvNames(input: unknown): string[] {
  if (Array.isArray(input)) {
    return input.map((item) => String(item || '').trim()).filter(Boolean)
  }
  return String(input || '').split(',').map((item) => item.trim()).filter(Boolean)
}

async function maybeHandleLocalEscala(req: any, res: any): Promise<boolean> {
  if (!localEscalaMockEnabled || !req.url || !req.url.startsWith('/api/escala')) return false

  const method = String(req.method || 'GET').toUpperCase()
  const url = new URL(req.url, 'http://localhost')
  const path = url.pathname
  const unit = String(url.searchParams.get('unit') || '').trim()
  const month = String(url.searchParams.get('month') || '').trim()

  if (path === '/api/escala/_proxy-status') {
    toJson(res, 200, { ok: true, localMockEnabled: true, mode: 'local-mock' })
    return true
  }

  if (path === '/api/escala/overview' && method === 'GET') {
    const units = new Set<string>()
    localEscalaStore.professionals.forEach((prof) => prof.units.forEach((u) => units.add(u)))
    localEscalaStore.schedule.forEach((row) => units.add(row.unit))
    localEscalaStore.closedDays.forEach((row) => units.add(row.unit))
    localEscalaStore.holidays.forEach((row) => units.add(row.unit))
    const months = new Set(localEscalaStore.schedule.map((row) => row.date.slice(0, 7)))
    toJson(res, 200, { ok: true, units: Array.from(units).sort(), months: Array.from(months).sort(), source: 'local-mock' })
    return true
  }

  if (path === '/api/escala/professionals' && method === 'GET') {
    const data = localEscalaStore.professionals.filter((prof) => !unit || !prof.units.length || prof.units.includes(unit))
    toJson(res, 200, { ok: true, data, source: 'local-mock' })
    return true
  }

  if (path === '/api/escala/schedule' && method === 'GET') {
    let schedule = [...localEscalaStore.schedule]
    let closedDays = [...localEscalaStore.closedDays]
    let holidays = [...localEscalaStore.holidays]
    if (unit) {
      schedule = schedule.filter((row) => row.unit === unit)
      closedDays = closedDays.filter((row) => row.unit === unit)
      holidays = holidays.filter((row) => row.unit === unit)
    }
    if (month) {
      schedule = schedule.filter((row) => row.date.startsWith(`${month}-`))
      closedDays = closedDays.filter((row) => row.date.startsWith(`${month}-`))
      holidays = holidays.filter((row) => row.date.startsWith(`${month}-`))
    }
    toJson(res, 200, { ok: true, schedule, closedDays, holidays, source: 'local-mock' })
    return true
  }

  if (path === '/api/escala/schedule' && method === 'POST') {
    const payload = await parseJsonBody(req)
    const date = String(payload?.date || '').trim()
    const reqUnit = String(payload?.unit || '').trim()
    const professionals = csvNames(payload?.professionals || payload?.professional)
    if (!isValidIsoDate(date) || !reqUnit || !professionals.length) {
      toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' })
      return true
    }
    professionals.forEach((professional) => {
      const exists = localEscalaStore.schedule.some((row) => row.date === date && row.unit === reqUnit && row.professional === professional)
      if (!exists) localEscalaStore.schedule.push({ date, unit: reqUnit, professional })
    })
    toJson(res, 200, { ok: true, source: 'local-mock' })
    return true
  }

  if (path === '/api/escala/schedule' && method === 'PUT') {
    const payload = await parseJsonBody(req)
    const date = String(payload?.date || '').trim()
    const reqUnit = String(payload?.unit || '').trim()
    const professionals = csvNames(payload?.professionals)
    if (!isValidIsoDate(date) || !reqUnit || !professionals.length) {
      toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' })
      return true
    }
    localEscalaStore.schedule = localEscalaStore.schedule.filter((row) => !(row.date === date && row.unit === reqUnit))
    professionals.forEach((professional) => localEscalaStore.schedule.push({ date, unit: reqUnit, professional }))
    toJson(res, 200, { ok: true, source: 'local-mock' })
    return true
  }

  if (path === '/api/escala/schedule' && method === 'DELETE') {
    const payload = await parseJsonBody(req)
    const date = String(payload?.date || '').trim()
    const reqUnit = String(payload?.unit || '').trim()
    const professional = String(payload?.professional || '').trim()
    if (!isValidIsoDate(date) || !reqUnit) {
      toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' })
      return true
    }
    localEscalaStore.schedule = localEscalaStore.schedule.filter((row) => {
      if (row.date !== date || row.unit !== reqUnit) return true
      if (!professional) return false
      return row.professional !== professional
    })
    toJson(res, 200, { ok: true, source: 'local-mock' })
    return true
  }

  if (path === '/api/escala/closed-days' && method === 'POST') {
    const payload = await parseJsonBody(req)
    const date = String(payload?.date || '').trim()
    const reqUnit = String(payload?.unit || '').trim()
    const reason = String(payload?.reason || '').trim() || 'Sem atendimento'
    if (!isValidIsoDate(date) || !reqUnit) {
      toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' })
      return true
    }
    localEscalaStore.closedDays = localEscalaStore.closedDays.filter((row) => !(row.date === date && row.unit === reqUnit))
    localEscalaStore.closedDays.push({ date, unit: reqUnit, reason })
    toJson(res, 200, { ok: true, source: 'local-mock' })
    return true
  }

  if (path === '/api/escala/closed-days' && method === 'DELETE') {
    const payload = await parseJsonBody(req)
    const date = String(payload?.date || '').trim()
    const reqUnit = String(payload?.unit || '').trim()
    if (!isValidIsoDate(date) || !reqUnit) {
      toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' })
      return true
    }
    localEscalaStore.closedDays = localEscalaStore.closedDays.filter((row) => !(row.date === date && row.unit === reqUnit))
    toJson(res, 200, { ok: true, source: 'local-mock' })
    return true
  }

  if (path === '/api/escala/holidays' && method === 'POST') {
    const payload = await parseJsonBody(req)
    const date = String(payload?.date || '').trim()
    const reqUnit = String(payload?.unit || '').trim()
    const name = String(payload?.name || '').trim()
    if (!isValidIsoDate(date) || !reqUnit || !name) {
      toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' })
      return true
    }
    const exists = localEscalaStore.holidays.some((row) => row.date === date && row.unit === reqUnit && row.name === name)
    if (!exists) localEscalaStore.holidays.push({ date, unit: reqUnit, name })
    toJson(res, 200, { ok: true, source: 'local-mock' })
    return true
  }

  if (path === '/api/escala/holidays' && method === 'DELETE') {
    const payload = await parseJsonBody(req)
    const date = String(payload?.date || '').trim()
    const reqUnit = String(payload?.unit || '').trim()
    const name = String(payload?.name || '').trim()
    if (!isValidIsoDate(date) || !reqUnit || !name) {
      toJson(res, 400, { ok: false, error: 'INVALID_PAYLOAD' })
      return true
    }
    localEscalaStore.holidays = localEscalaStore.holidays.filter((row) => !(row.date === date && row.unit === reqUnit && row.name === name))
    toJson(res, 200, { ok: true, source: 'local-mock' })
    return true
  }

  toJson(res, 404, { ok: false, error: 'NOT_FOUND' })
  return true
}

function attachDevMiddleware(server: any) {
  server.middlewares.use((req: any, res: any, next: any) => {
    if (!req.url) return next()
    const method = String(req.method || 'GET').toUpperCase()
    if (localAuthBypassEnabled) {
      if (req.url.startsWith('/api/auth/me') && method === 'GET') {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true, user: localAuthUser, csrfToken: 'local-dev-csrf' }))
        return
      }
      if ((req.url.startsWith('/api/auth/login') || req.url.startsWith('/api/auth/register') || req.url.startsWith('/api/auth/refresh')) && method === 'POST') {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ ok: true, user: localAuthUser, csrfToken: 'local-dev-csrf' }))
        return
      }
      if (req.url.startsWith('/api/auth/logout') && method === 'POST') {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end('{"ok":true}')
        return
      }
      if (req.url.startsWith('/api/insumos/auth/me') && method === 'GET') {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ success: true, user: localAuthUser, csrfToken: 'local-dev-csrf' }))
        return
      }
    }
    maybeHandleLocalEscala(req, res).then((handled) => {
      if (handled) return
      if (
        req.url.startsWith('/health') ||
        req.url.startsWith('/api/health') ||
        req.url.startsWith('/v1/health') ||
        req.url.startsWith('/api/insumos/health')
      ) {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end('{"ok":true}')
        return
      }
      if (req.url.startsWith('/api/instagram/status')) {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end('{"ok":true,"connected":false}')
        return
      }
      if (req.url.startsWith('/api/instagram/oauth/status')) {
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end('{"ok":true,"configured":false,"missing":["META_APP_ID","META_APP_SECRET","META_OAUTH_STATE_SECRET"]}')
        return
      }
      next()
    }).catch(() => next())
  })
}

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    // DO NOT REMOVE
    createIconImportProxy() as PluginOption,
    sparkPlugin() as PluginOption,
    // Inject simple health endpoints for dev/preview to satisfy automated probes
    {
      name: 'health-endpoints',
      configureServer(server) {
        attachDevMiddleware(server)
      },
      configurePreviewServer(server) {
        attachDevMiddleware(server)
      }
    } as PluginOption,
  ],
  resolve: {
    alias: {
      '@': resolve(projectRoot, '.'),
    },
    // DEDUPE React to prevent multiple copies causing useContext null errors
    dedupe: ['react', 'react-dom']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          ui: ['@radix-ui/react-tabs', '@radix-ui/react-dialog', '@radix-ui/react-select'],
          icons: ['@phosphor-icons/react'],
          charts: ['recharts', 'd3'],
          utils: ['date-fns', 'clsx', 'tailwind-merge']
        }
      }
    },
    chunkSizeWarningLimit: 1000
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      '@phosphor-icons/react',
      '@radix-ui/react-tabs',
      '@radix-ui/react-dialog',
      '@radix-ui/react-select'
    ]
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true, // Allow all hosts for Replit compatibility
    hmr: {
      overlay: false
    },
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
        ws: true,
        timeout: 30000
      },
      '/whatsapp': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
        timeout: 30000
      }
    }
  },
});
