export async function classifyProcedureOpenAi({ apiKey, model, text }) {
    const key = String(apiKey || '').trim()
    if (!key) return null

    const m = String(model || '').trim() || 'gpt-5-nano'
    const inputText = String(text || '').trim()
    if (!inputText) return null

    const body = {
        model: m,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
            {
                role: 'system',
                content:
                    'Você classifica o procedimento estético mais provável a partir de texto. Responda SOMENTE com JSON válido.',
            },
            {
                role: 'user',
                content:
                    `Texto:\n${inputText}\n\nResponda no formato:\n{\n  "procedure_code": "<string ou null>",\n  "confidence": <number 0..1>\n}\n\nRegras:\n- Se não tiver certeza, use procedure_code=null e confidence baixa.\n- Não invente nomes longos: prefira nomes curtos (ex.: Botox, Lavieen, Sculptra).`,
            },
        ],
    }

    try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                authorization: `Bearer ${key}`,
            },
            body: JSON.stringify(body),
        })

        if (!r.ok) return null
        const data = await r.json()
        const content = data?.choices?.[0]?.message?.content
        if (!content) return null

        const parsed = JSON.parse(content)
        const procedureCode = parsed?.procedure_code != null ? String(parsed.procedure_code).trim() : null
        const confidence = Number(parsed?.confidence)
        return {
            procedureCode: procedureCode || null,
            confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
        }
    } catch {
        return null
    }
}

