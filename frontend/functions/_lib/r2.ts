export function getShareBucket(context: any): R2Bucket | null {
  const bucket = (context?.env?.SHARE_BUCKET as R2Bucket | undefined) || undefined
  return bucket || null
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

