import React from 'react'

export interface Conversation {
    conversationId: string
    patient: {
        name: string
        age: number
        channel: string
        status: string
    }
    aiAnalysis: {
        confidence: string
        summary: string
        riskLevel: string
        specialtyNeeded: string
    }
    timestamp: string
    status: 'active' | 'paused' | 'critical'
}

interface ConversationCardProps {
    data: Conversation
    onSelect: (id: string) => void
    onTakeControl: (id: string) => void
    onCorrectAI: (id: string) => void
    onAddNote: (id: string) => void
    onMarkCritical: (id: string) => void
    onForwardSpecialist: (id: string) => void
    onValidateAI: (id: string) => void
}

const statusColors = {
    active: 'border-green-500',
    paused: 'border-yellow-500',
    critical: 'border-red-500'
}

const ConversationCard: React.FC<ConversationCardProps> = ({ data, onSelect, ...actions }) => (
    <div className={`border-2 rounded-lg p-4 mb-3 cursor-pointer ${statusColors[data.status]} bg-white shadow-sm`} onClick={() => onSelect(data.conversationId)}>
        <div className="flex justify-between items-center mb-2">
            <div>
                <span className="font-bold text-lg">{data.patient.name}</span>
                <span className="ml-2 text-sm text-gray-500">({data.patient.age} anos)</span>
                <span className="ml-2 text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700">{data.patient.channel}</span>
                <span className="ml-2 text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-700">{data.patient.status}</span>
            </div>
            <span className={`px-2 py-1 rounded text-xs font-semibold ${data.status === 'active' ? 'bg-green-100 text-green-700' : data.status === 'paused' ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-700'}`}>{data.status}</span>
        </div>
        <div className="mb-2 text-sm text-gray-700">{data.aiAnalysis.summary}</div>
        <div className="flex gap-2 mb-2">
            <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">Confiança: {data.aiAnalysis.confidence}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-orange-100 text-orange-700">Risco: {data.aiAnalysis.riskLevel}</span>
            <span className="text-xs px-2 py-0.5 rounded bg-pink-100 text-pink-700">Especialidade: {data.aiAnalysis.specialtyNeeded}</span>
        </div>
        <div className="flex gap-2 flex-wrap">
            <button className="px-2 py-1 rounded bg-blue-600 text-white text-xs hover:bg-blue-700" onClick={e => { e.stopPropagation(); actions.onTakeControl(data.conversationId) }}>Assumir</button>
            <button className="px-2 py-1 rounded bg-yellow-500 text-white text-xs hover:bg-yellow-600" onClick={e => { e.stopPropagation(); actions.onCorrectAI(data.conversationId) }}>Corrigir IA</button>
            <button className="px-2 py-1 rounded bg-gray-600 text-white text-xs hover:bg-gray-700" onClick={e => { e.stopPropagation(); actions.onAddNote(data.conversationId) }}>Nota</button>
            <button className="px-2 py-1 rounded bg-red-600 text-white text-xs hover:bg-red-700" onClick={e => { e.stopPropagation(); actions.onMarkCritical(data.conversationId) }}>Crítica</button>
            <button className="px-2 py-1 rounded bg-purple-600 text-white text-xs hover:bg-purple-700" onClick={e => { e.stopPropagation(); actions.onForwardSpecialist(data.conversationId) }}>Especialista</button>
            <button className="px-2 py-1 rounded bg-green-600 text-white text-xs hover:bg-green-700" onClick={e => { e.stopPropagation(); actions.onValidateAI(data.conversationId) }}>Validar IA</button>
        </div>
    </div>
)

export default ConversationCard
