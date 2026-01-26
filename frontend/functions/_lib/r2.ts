const normalizePrefix = (raw: string) => {
  let out = String(raw || '').trim()
  if (!out) return ''
  out = out.replace(/^\/+/, '')
  if (!out.endsWith('/')) out += '/'
  return out
}

const stripPrefix = (prefix: string, key: string) => {
  if (!prefix) return key
  return key.startsWith(prefix) ? key.slice(prefix.length) : key
}

const addPrefix = (prefix: string, key: string) => {
  const cleaned = String(key || '').replace(/^\/+/, '')
  return prefix ? `${prefix}${cleaned}` : cleaned
}

function computeShareBucketPrefix(context: any): string {
  const explicit = normalizePrefix(String(context?.env?.R2_KEY_PREFIX || ''))
  if (explicit) return explicit

  const envName = String(context?.env?.CF_PAGES_ENVIRONMENT || '').trim().toLowerCase()
  if (envName === 'production') return ''

  const branch = String(context?.env?.CF_PAGES_BRANCH || '').trim()
  const productionBranch = String(context?.env?.R2_PRODUCTION_BRANCH || 'main').trim()

  const isPreview =
    envName === 'preview' ||
    (!!branch && branch !== productionBranch)

  if (!isPreview) return ''

  const branchPart = branch ? `${encodeURIComponent(branch)}/` : ''
  return `preview/${branchPart}`
}

function wrapBucketWithPrefix(bucket: R2Bucket, prefix: string): R2Bucket {
  const p = normalizePrefix(prefix)
  if (!p) return bucket

  return new Proxy(bucket as any, {
    get(target, prop) {
      const orig = (target as any)[prop]
      if (typeof orig !== 'function') return orig

      if (prop === 'get' || prop === 'head') {
        return (key: string, ...rest: any[]) => orig.call(target, addPrefix(p, key), ...rest)
      }

      if (prop === 'put') {
        return (key: string, value: any, ...rest: any[]) => orig.call(target, addPrefix(p, key), value, ...rest)
      }

      if (prop === 'delete') {
        return (keyOrKeys: string | string[]) => {
          if (Array.isArray(keyOrKeys)) return orig.call(target, keyOrKeys.map((k) => addPrefix(p, k)))
          return orig.call(target, addPrefix(p, keyOrKeys))
        }
      }

      if (prop === 'list') {
        return async (options: any = {}) => {
          const merged = { ...(options || {}) }
          merged.prefix = addPrefix(p, String(options?.prefix || ''))
          const res = await orig.call(target, merged)
          const objects = (res?.objects || []).map((o: any) => ({ ...o, key: stripPrefix(p, String(o.key || '')) }))
          const delimitedPrefixes = (res?.delimitedPrefixes || []).map((k: any) => stripPrefix(p, String(k || '')))
          return { ...res, objects, delimitedPrefixes }
        }
      }

      return (...args: any[]) => orig.apply(target, args)
    },
  }) as any
}

export function getShareBucket(context: any): R2Bucket | null {
  const bucket = (context?.env?.SHARE_BUCKET as R2Bucket | undefined) || undefined
  if (!bucket) return null
  const prefix = computeShareBucketPrefix(context)
  return wrapBucketWithPrefix(bucket, prefix)
}

export async function putJson(bucket: R2Bucket, key: string, value: unknown) {
  await bucket.put(key, JSON.stringify(value), { httpMetadata: { contentType: 'application/json' } })
}

export async function getJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key)
  if (!obj) return null
  const text = await obj.text()
  return JSON.parse(text) as T
}
