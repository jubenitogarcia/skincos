// API service for real backend integration
export async function postAction(action: string, payload: any) {
    const res = await fetch(`/api/actions/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error('Erro ao enviar ação: ' + res.status)
    return await res.json()
}

export async function postIntervention(payload: any) {
    const res = await fetch(`/api/interventions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
    if (!res.ok) throw new Error('Erro ao enviar intervenção: ' + res.status)
    return await res.json()
}

export async function getConversations() {
    const res = await fetch(`/api/conversations`)
    if (!res.ok) throw new Error('Erro ao buscar conversas: ' + res.status)
    return await res.json()
}
