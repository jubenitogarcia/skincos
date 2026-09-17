import { createHash } from 'node:crypto'

export const CATALOG_SCHEMA_VERSION = 'crm-commercial-catalog/v1'
export const OFFER_SCHEMA_VERSION = 'crm-commercial-offer/v1'
export const CATALOG_UNITS = Object.freeze(['barra-shopping-sul', 'novo-hamburgo'])

const UNIT_ALIASES = new Map([
  ['barra-shopping-sul', 'barra-shopping-sul'],
  ['barrashoppingsul', 'barra-shopping-sul'],
  ['barra shopping sul', 'barra-shopping-sul'],
  ['novo-hamburgo', 'novo-hamburgo'],
  ['novohamburgo', 'novo-hamburgo'],
  ['novo hamburgo', 'novo-hamburgo'],
])

export const COMMERCIAL_CATALOG_SQL = `select o.*, u.slug as unit_slug,
    coalesce(json_agg(json_build_object(
        'id', p.id, 'name', p.name, 'aliases', p.aliases,
        'quantity', op.quantity, 'quantity_unit', op.quantity_unit
    ) order by op.display_order, p.name) filter (where p.id is not null), '[]'::json) as procedures
    from crm_atendimento.commercial_offers o
    join crm_atendimento.units u on u.id = o.unit_id
    left join crm_atendimento.commercial_offer_procedures op on op.offer_id = o.id
    left join crm_atendimento.procedures p on p.id = op.procedure_id
    where u.slug = any($1::text[])
      and o.status = 'active'
      and (o.validity_start is null or o.validity_start <= current_date)
      and (o.validity_end is null or o.validity_end >= current_date)
      and ($2::text is null or o.offer_key = $2)
    group by o.id, u.slug
    order by o.updated_at desc`

function fail(code, status = 400) {
  const error = new Error(code)
  error.statusCode = status
  throw error
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function contextHash(value) {
  return createHash('sha256').update(stable(value)).digest('hex')
}

function date(value) {
  return value == null ? null : String(value).slice(0, 10)
}

export function normalizeCatalogUnits(query = {}) {
  const values = []
  const add = (value) => {
    if (Array.isArray(value)) value.forEach(add)
    else if (value != null) String(value).split(',').forEach((part) => values.push(part))
  }
  add(query.units)
  add(query.unit)
  if (!values.length || values.every((value) => String(value).trim() === '')) fail('UNIT_REQUIRED')
  const normalized = [...new Set(values.map((value) => UNIT_ALIASES.get(String(value).trim().toLocaleLowerCase('pt-BR')) || null))]
  if (normalized.includes(null)) fail('UNIT_NOT_FOUND', 404)
  if (normalized.some((unit) => !CATALOG_UNITS.includes(unit))) fail('UNIT_NOT_FOUND', 404)
  return CATALOG_UNITS.filter((unit) => normalized.includes(unit))
}

export function mapCommercialOffer(row = {}) {
  const context = {
    schemaVersion: OFFER_SCHEMA_VERSION,
    offerId: row.id,
    offerKey: row.offer_key,
    revision: Number(row.revision || 1),
    unitSlug: row.unit_slug,
    title: row.title,
    description: row.description || '',
    priceCents: row.price_cents == null ? null : Number(row.price_cents),
    currency: row.currency || 'BRL',
    priceQualifier: row.price_qualifier,
    installmentCount: row.installment_count == null ? null : Number(row.installment_count),
    installmentValueCents: row.installment_value_cents == null ? null : Number(row.installment_value_cents),
    discountPercent: row.discount_percent == null ? null : Number(row.discount_percent),
    conditions: row.conditions || '',
    validityStart: date(row.validity_start),
    validityEnd: date(row.validity_end),
    procedures: (Array.isArray(row.procedures) ? row.procedures : []).map((item) => ({
      id: item.id,
      name: item.name,
      aliases: Array.isArray(item.aliases) ? item.aliases : [],
      quantity: Number(item.quantity || 1),
      quantityUnit: item.quantity_unit || 'unidade',
    })),
  }
  return {
    ...context,
    status: row.status,
    approvedBy: row.approved_by || null,
    approvedAt: row.approved_at || null,
    updatedAt: row.updated_at || null,
    contextHash: contextHash(context),
  }
}

export function createCatalogStore({ pool, clock = () => new Date() } = {}) {
  if (!pool || typeof pool.query !== 'function') throw new TypeError('CATALOG_POOL_REQUIRED')
  return {
    async readiness() {
      const result = await pool.query('select current_database() as database_name, current_user as current_user')
      return { ok: Boolean(result.rows?.[0]), database: result.rows?.[0]?.database_name || null }
    },
    async commercialCatalog(query = {}) {
      const units = normalizeCatalogUnits(query)
      const offerKey = String(query?.offerKey || '').trim() || null
      const result = await pool.query(COMMERCIAL_CATALOG_SQL, [units, offerKey])
      const byUnit = Object.fromEntries(units.map((unitSlug) => [unitSlug, { unitSlug, offers: [] }]))
      for (const row of result.rows || []) {
        const offer = mapCommercialOffer(row)
        if (byUnit[offer.unitSlug]) byUnit[offer.unitSlug].offers.push(offer)
      }
      const payload = {
        schemaVersion: CATALOG_SCHEMA_VERSION,
        asOf: clock().toISOString().slice(0, 10),
        requestedUnits: units,
        units: byUnit,
      }
      if (units.length === 1) {
        payload.unitSlug = units[0]
        payload.offers = byUnit[units[0]].offers
      }
      return payload
    },
  }
}

export function legacyMetaAdsOfferContext(catalog) {
  return { unitSlug: catalog.unitSlug, asOf: catalog.asOf, offers: catalog.offers }
}
