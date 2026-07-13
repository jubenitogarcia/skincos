// Pluggable sentiment analysis. If VITE_SENTIMENT_API_URL is defined, you can
// wire a remote classifier here. Otherwise, falls back to naive heuristic.

export type Sentiment = 'positive' | 'neutral' | 'negative'

export function analyzeSentiment(text: string): Sentiment {
    const t = (text || '').toLowerCase()
    const neg = ['erro', 'problema', 'ruim', 'péssimo', 'odiei', 'não funciona', 'cancelar', 'reclamação']
    const pos = ['obrigado', 'valeu', 'perfeito', 'excelente', 'adorei', 'funciona', 'sucesso', 'top']
    if (neg.some(w => t.includes(w))) return 'negative'
    if (pos.some(w => t.includes(w))) return 'positive'
    return 'neutral'
}

// Optional async path (not used by default). Example:
// export async function analyzeSentimentAsync(text: string): Promise<Sentiment> {
//   const url = (import.meta as any).env?.VITE_SENTIMENT_API_URL
//   if (!url) return analyzeSentiment(text)
//   try {
//     const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
//     if (!res.ok) return analyzeSentiment(text)
//     const json = await res.json()
//     return (json.sentiment as Sentiment) || analyzeSentiment(text)
//   } catch { return analyzeSentiment(text) }
// }
