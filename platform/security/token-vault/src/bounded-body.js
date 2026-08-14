/**
 * Read a request stream without allowing a caller-controlled body to consume
 * unbounded Worker memory. Callers own their error type so this helper stays
 * transport-agnostic.
 */
export async function readBoundedText(body, maximumBytes, onExceeded) {
  if (!body || typeof body.getReader !== 'function') return '';
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      total += chunk.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => {});
        throw onExceeded();
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}
