export async function boundedProductionJson(response, maxBytes = 256 * 1024) {
  const reader = response.body?.getReader()
  if (!reader) throw new Error('production_response_invalid')
  const chunks = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error('production_response_invalid')
      chunks.push(value)
    }
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock() }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return JSON.parse(new TextDecoder().decode(bytes))
}
